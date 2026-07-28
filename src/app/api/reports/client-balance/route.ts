import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { R, add, sub, toNumber } from '@/lib/money';

/**
 * GET /api/reports/client-balance
 *
 * Client-wise balance sheet aggregating data from:
 *   - invoices          (sale invoices — billing)
 *   - payment_entries   (payments received — receipts)
 *   - quotations        (pipeline — pending/approved quotes)
 *   - payment_receivables (AR tracking — overdue, follow-ups)
 *
 * Query params:
 *   from_date (string, YYYY-MM-DD) — optional
 *   to_date   (string, YYYY-MM-DD) — optional
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit).
 */

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: Record<string, { permission?: string } | undefined>;
				};
			};
		};
	};
}

interface ReportUser {
	is_super_admin?: boolean | number;
	field_permissions?: FieldPermissionsShape | string | null;
}

function hasProjectActivitiesFieldPermission(
	user: ReportUser | null | undefined
): boolean {
	if (!user) return false;
	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms) as FieldPermissionsShape;
		} catch {
			fieldPerms = null;
		}
	}
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	if (!section?.enabled) return false;
	const perm = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return (
		perm === 'view' || perm === 'edit' || legacy === 'view' || legacy === 'edit'
	);
}

// ── Raw row shapes ────────────────────────────────────────────────

interface InvoiceRow {
	client_name: string;
	total_invoiced: number;
	amount_received_inv: number;
	balance_due_inv: number;
	invoice_count: number;
	unbilled_count: number;
	paid_count: number;
	partial_count: number;
	overdue_inv_count: number;
}

interface PaymentEntryRow {
	client_name: string;
	total_received: number;
	total_received_gross: number;
	total_tds: number;
	gst_amount: number;
	receipt_count: number;
}

interface QuotationRow {
	client_name: string;
	pipeline_value: number;
	quotation_count: number;
	approved_count: number;
	sent_count: number;
}

interface ReceivableRow {
	client_name: string;
	ar_invoiced: number;
	ar_paid: number;
	ar_balance: number;
	ar_count: number;
	ar_overdue_count: number;
	ar_overdue_amount: number;
	ar_pending_count: number;
	ar_partial_count: number;
	ar_received_count: number;
}

interface IssueRow {
	client_name: string;
	total_issued: number;
	total_issued_gross: number;
	total_issued_deduction: number;
	issue_count: number;
}

interface PeriodRow {
	client_name: string;
	period_invoiced: number;
	period_received: number;
	period_issued: number;
}
interface OpeningBalanceRow {
	client_name: string;
	opening_invoiced: number;
	opening_received: number;
	opening_issued: number;
}

// ── Output shape ──────────────────────────────────────────────────

export interface ClientBalanceItem {
	client_name: string;
	/** From invoices */
	total_invoiced: number;
	amount_received_via_invoice: number;
	invoice_balance_due: number;
	invoice_count: number;
	unbilled_count: number;
	paid_count: number;
	partial_count: number;
	overdue_inv_count: number;
	/** From payment_entries */
	total_received: number;
	total_received_gross: number;
	total_tds: number;
	total_gst: number;
	receipt_count: number;
	/** From payment_issues (issued to client) */
	total_issued: number;
	total_issued_gross: number;
	total_issued_deduction: number;
	issue_count: number;
	/** From quotations (pipeline) */
	pipeline_value: number;
	quotation_count: number;
	approved_quote_count: number;
	sent_quote_count: number;
	/** From payment_receivables (AR tracking) */
	ar_overdue_amount: number;
	ar_overdue_count: number;
	ar_pending_count: number;
	ar_partial_count: number;
	ar_received_count: number;
	/** Current net balance = invoiced - received + issued */
	net_balance: number;
	/** Period fields (only when date range provided) */
	opening_balance?: number;
	period_invoiced?: number;
	period_received?: number;
	period_issued?: number;
	closing_balance?: number;
}
// ── Helpers ───────────────────────────────────────────────────────

function normKey(name: string): string {
	return (name || '').trim().toLowerCase();
}

function n(v: unknown): number {
	return Number(v ?? 0);
}

// ── Handler ───────────────────────────────────────────────────────

export async function GET(request: Request) {
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		const hasReportsPermission = hasPermission(
			user,
			RESOURCES.REPORTS,
			PERMISSIONS.READ
		);
		const hasFieldPermission = hasProjectActivitiesFieldPermission(user);

		if (!isSuperAdmin && !hasReportsPermission && !hasFieldPermission) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view the client balance report',
				},
				{ status: 403 }
			);
		}

		const { searchParams } = new URL(request.url);
		const fromDate = searchParams.get('from_date') || '';
		const toDate = searchParams.get('to_date') || '';
		const hasDateRange = !!(fromDate && toDate);

		// ── 0. Build canonical entity map from companies + vendors ──
		const entityMap = new Map<
			string,
			{
				canonical: string;
				entity_type: 'company' | 'vendor';
				entity_id: number;
			}
		>();

		const [companyRows] = await query(
			`SELECT id, company_name FROM companies WHERE isDelete = 0 AND company_name IS NOT NULL AND company_name != ''`
		);
		for (const r of companyRows as Array<{
			id: number;
			company_name: string;
		}>) {
			const key = normKey(r.company_name);
			if (!entityMap.has(key)) {
				entityMap.set(key, {
					canonical: r.company_name,
					entity_type: 'company',
					entity_id: r.id,
				});
			}
		}

		const [vendorRows] = await query(
			`SELECT id, vendor_name FROM vendors WHERE isDelete = 0 AND vendor_name IS NOT NULL AND vendor_name != ''`
		);
		for (const r of vendorRows as Array<{ id: number; vendor_name: string }>) {
			const key = normKey(r.vendor_name);
			if (!entityMap.has(key)) {
				entityMap.set(key, {
					canonical: r.vendor_name,
					entity_type: 'vendor',
					entity_id: r.id,
				});
			}
		}

		function resolveName(rawName: string): string {
			const key = normKey(rawName);
			const match = entityMap.get(key);
			return match ? match.canonical : rawName.trim();
		}

		// ── 1. Invoices ──────────────────────────────────────────
		const [invRows] = await query(
			`SELECT
				client_name,
				COALESCE(SUM(net_amount), 0) AS total_invoiced,
				COALESCE(SUM(amount_paid), 0) AS amount_received_inv,
				COALESCE(SUM(balance_due), 0) AS balance_due_inv,
				COUNT(*) AS invoice_count,
				SUM(CASE WHEN status IN ('draft','sent') THEN 1 ELSE 0 END) AS unbilled_count,
				SUM(CASE WHEN status IN ('paid','fully_paid') THEN 1 ELSE 0 END) AS paid_count,
				SUM(CASE WHEN status = 'partially_paid' THEN 1 ELSE 0 END) AS partial_count,
				SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_inv_count
			FROM invoices
			WHERE isDelete = 0 AND client_name IS NOT NULL AND client_name != ''
			GROUP BY client_name`
		);

		// ── 2. Payment entries ───────────────────────────────────
		const [payRows] = await query(
			`SELECT
				company_name AS client_name,
				COALESCE(SUM(net_amount), 0) AS total_received,
				COALESCE(SUM(amount), 0) AS total_received_gross,
				COALESCE(SUM(tds_amount), 0) AS total_tds,
				COALESCE(SUM(gst_amount), 0) AS gst_amount,
				COUNT(*) AS receipt_count
			FROM payment_entries
			WHERE isDelete = 0 AND company_name IS NOT NULL AND company_name != ''
			GROUP BY company_name`
		);

		// ── 3. Quotations (pipeline) ─────────────────────────────
		const [quoteRows] = await query(
			`SELECT
				client_name,
				COALESCE(SUM(
					CASE WHEN status IN ('sent','approved')
					THEN COALESCE(net_amount, total, 0)
					ELSE 0 END
				), 0) AS pipeline_value,
				COUNT(*) AS quotation_count,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
				SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count
			FROM quotations
			WHERE isDelete = 0 AND client_name IS NOT NULL AND client_name != ''
			GROUP BY client_name`
		);

		// ── 4. Payment receivables (AR tracking) ─────────────────
		const [arRows] = await query(
			`SELECT
				client_name,
				COALESCE(SUM(invoice_amount), 0) AS ar_invoiced,
				COALESCE(SUM(paid_amount), 0) AS ar_paid,
				COALESCE(SUM(balance_due), 0) AS ar_balance,
				COUNT(*) AS ar_count,
				SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS ar_overdue_count,
				SUM(CASE WHEN status = 'overdue' THEN balance_due ELSE 0 END) AS ar_overdue_amount,
				SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS ar_pending_count,
				SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS ar_partial_count,
				SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS ar_received_count
			FROM payment_receivables
			WHERE isDelete = 0 AND client_name IS NOT NULL AND client_name != ''
			GROUP BY client_name`
		);
		// ── 5. Payment issues (issued to client) ─────────────────
		let issueRows: IssueRow[] = [];
		try {
			const [rows] = await query(
				`SELECT
					payee_name AS client_name,
					COALESCE(SUM(net_amount), 0) AS total_issued,
					COALESCE(SUM(amount), 0) AS total_issued_gross,
					COALESCE(SUM(deduction), 0) AS total_issued_deduction,
					COUNT(*) AS issue_count
				FROM payment_issues
				WHERE isDelete = 0 AND payee_type = 'company'
					AND payee_name IS NOT NULL AND payee_name != ''
				GROUP BY payee_name`
			);
			issueRows = rows as IssueRow[];
		} catch {
			// payment_issues table may not exist
		}

		// ── 6. Period computations (only when date range) ────────
		let periodRows: PeriodRow[] = [];
		let openingRows: OpeningBalanceRow[] = [];

		if (hasDateRange) {
			const [pRows] = await query(
				`SELECT
					client_name,
					COALESCE(SUM(CASE WHEN invoice_date >= ? AND invoice_date <= ? THEN net_amount ELSE 0 END), 0) AS period_invoiced
				FROM invoices
				WHERE isDelete = 0 AND client_name IS NOT NULL AND client_name != ''
				GROUP BY client_name`,
				[fromDate, toDate]
			);
			periodRows = (
				pRows as Array<{ client_name: string; period_invoiced: number }>
			).map((r) => ({
				client_name: r.client_name,
				period_invoiced: n(r.period_invoiced),
				period_received: 0,
				period_issued: 0,
			}));

			const [payPRows] = await query(
				`SELECT
					company_name AS client_name,
					COALESCE(SUM(CASE WHEN payment_date >= ? AND payment_date <= ? THEN net_amount ELSE 0 END), 0) AS period_received
				FROM payment_entries
				WHERE isDelete = 0 AND company_name IS NOT NULL AND company_name != ''
				GROUP BY company_name`,
				[fromDate, toDate]
			);

			const payMap = new Map<string, number>();
			for (const r of payPRows as Array<{
				client_name: string;
				period_received: number;
			}>) {
				payMap.set(normKey(resolveName(r.client_name)), n(r.period_received));
			}
			for (const r of periodRows) {
				const key = normKey(resolveName(r.client_name));
				r.period_received = payMap.get(key) ?? 0;
			}
			for (const r of payPRows as Array<{
				client_name: string;
				period_received: number;
			}>) {
				const key = normKey(resolveName(r.client_name));
				if (
					!periodRows.some((pr) => normKey(resolveName(pr.client_name)) === key)
				) {
					periodRows.push({
						client_name: r.client_name,
						period_invoiced: 0,
						period_received: n(r.period_received),
						period_issued: 0,
					});
				}
			}

			let issuePRows: Array<{ client_name: string; period_issued: number }> =
				[];
			try {
				const [rows] = await query(
					`SELECT
						payee_name AS client_name,
						COALESCE(SUM(CASE WHEN issue_date >= ? AND issue_date <= ? THEN net_amount ELSE 0 END), 0) AS period_issued
					FROM payment_issues
					WHERE isDelete = 0 AND payee_type = 'company'
						AND payee_name IS NOT NULL AND payee_name != ''
					GROUP BY payee_name`,
					[fromDate, toDate]
				);
				issuePRows = rows as Array<{
					client_name: string;
					period_issued: number;
				}>;
			} catch {
				// payment_issues table may not exist
			}

			const issuePMap = new Map<string, number>();
			for (const r of issuePRows) {
				issuePMap.set(normKey(resolveName(r.client_name)), n(r.period_issued));
			}
			for (const r of periodRows) {
				const key = normKey(resolveName(r.client_name));
				r.period_issued = issuePMap.get(key) ?? 0;
			}
			for (const r of issuePRows) {
				const key = normKey(resolveName(r.client_name));
				if (
					!periodRows.some((pr) => normKey(resolveName(pr.client_name)) === key)
				) {
					periodRows.push({
						client_name: r.client_name,
						period_invoiced: 0,
						period_received: 0,
						period_issued: n(r.period_issued),
					});
				}
			}

			const [openInvRows] = await query(
				`SELECT
					client_name,
					COALESCE(SUM(net_amount), 0) AS opening_invoiced
				FROM invoices
				WHERE isDelete = 0 AND invoice_date < ? AND client_name IS NOT NULL AND client_name != ''
				GROUP BY client_name`,
				[fromDate]
			);

			const [openPayRows] = await query(
				`SELECT
					company_name AS client_name,
					COALESCE(SUM(net_amount), 0) AS opening_received
				FROM payment_entries
				WHERE isDelete = 0 AND payment_date < ? AND company_name IS NOT NULL AND company_name != ''
				GROUP BY company_name`,
				[fromDate]
			);

			const openPayMap = new Map<string, number>();
			for (const r of openPayRows as Array<{
				client_name: string;
				opening_received: number;
			}>) {
				openPayMap.set(
					normKey(resolveName(r.client_name)),
					n(r.opening_received)
				);
			}

			openingRows = (
				openInvRows as Array<{ client_name: string; opening_invoiced: number }>
			).map((r) => ({
				client_name: r.client_name,
				opening_invoiced: n(r.opening_invoiced),
				opening_received:
					openPayMap.get(normKey(resolveName(r.client_name))) ?? 0,
				opening_issued: 0,
			}));
			for (const r of openPayRows as Array<{
				client_name: string;
				opening_received: number;
			}>) {
				const key = normKey(resolveName(r.client_name));
				if (
					!openingRows.some(
						(or) => normKey(resolveName(or.client_name)) === key
					)
				) {
					openingRows.push({
						client_name: r.client_name,
						opening_invoiced: 0,
						opening_received: n(r.opening_received),
						opening_issued: 0,
					});
				}
			}

			let openIssueRows: Array<{
				client_name: string;
				opening_issued: number;
			}> = [];
			try {
				const [rows] = await query(
					`SELECT
						payee_name AS client_name,
						COALESCE(SUM(net_amount), 0) AS opening_issued
					FROM payment_issues
					WHERE isDelete = 0 AND payee_type = 'company'
						AND issue_date < ? AND payee_name IS NOT NULL AND payee_name != ''
					GROUP BY payee_name`,
					[fromDate]
				);
				openIssueRows = rows as Array<{
					client_name: string;
					opening_issued: number;
				}>;
			} catch {
				// payment_issues table may not exist
			}

			const openIssueMap = new Map<string, number>();
			for (const r of openIssueRows) {
				openIssueMap.set(
					normKey(resolveName(r.client_name)),
					n(r.opening_issued)
				);
			}
			for (const r of openingRows) {
				const key = normKey(resolveName(r.client_name));
				r.opening_issued = openIssueMap.get(key) ?? 0;
			}
			for (const r of openIssueRows) {
				const key = normKey(resolveName(r.client_name));
				if (
					!openingRows.some(
						(or) => normKey(resolveName(or.client_name)) === key
					)
				) {
					openingRows.push({
						client_name: r.client_name,
						opening_invoiced: 0,
						opening_received: 0,
						opening_issued: n(r.opening_issued),
					});
				}
			}
		}

		// ── Merge: pre-populate with ALL master entities ─────────
		const clientMap = new Map<string, ClientBalanceItem>();

		function ensure(key: string, displayName: string): ClientBalanceItem {
			if (!clientMap.has(key)) {
				clientMap.set(key, {
					client_name: displayName,
					total_invoiced: 0,
					amount_received_via_invoice: 0,
					invoice_balance_due: 0,
					invoice_count: 0,
					unbilled_count: 0,
					paid_count: 0,
					partial_count: 0,
					overdue_inv_count: 0,
					total_received: 0,
					total_received_gross: 0,
					total_tds: 0,
					total_gst: 0,
					receipt_count: 0,
					total_issued: 0,
					total_issued_gross: 0,
					total_issued_deduction: 0,
					issue_count: 0,
					pipeline_value: 0,
					quotation_count: 0,
					approved_quote_count: 0,
					sent_quote_count: 0,
					ar_overdue_amount: 0,
					ar_overdue_count: 0,
					ar_pending_count: 0,
					ar_partial_count: 0,
					ar_received_count: 0,
					net_balance: 0,
				});
			}
			return clientMap.get(key)!;
		}

		// Pre-populate every company and vendor, even with zero transactions
		for (const [, entity] of entityMap) {
			ensure(normKey(entity.canonical), entity.canonical);
		}

		// Aggregate invoices — resolve names to canonical
		for (const r of invRows as InvoiceRow[]) {
			const canonical = resolveName(r.client_name);
			const c = ensure(normKey(canonical), canonical);
			c.total_invoiced += n(r.total_invoiced);
			c.amount_received_via_invoice += n(r.amount_received_inv);
			c.invoice_balance_due += n(r.balance_due_inv);
			c.invoice_count += n(r.invoice_count);
			c.unbilled_count += n(r.unbilled_count);
			c.paid_count += n(r.paid_count);
			c.partial_count += n(r.partial_count);
			c.overdue_inv_count += n(r.overdue_inv_count);
		}

		for (const r of payRows as PaymentEntryRow[]) {
			const canonical = resolveName(r.client_name);
			const c = ensure(normKey(canonical), canonical);
			c.total_received += n(r.total_received);
			c.total_received_gross += n(r.total_received_gross);
			c.total_tds += n(r.total_tds);
			c.total_gst += n(r.gst_amount);
			c.receipt_count += n(r.receipt_count);
		}

		for (const r of quoteRows as QuotationRow[]) {
			const canonical = resolveName(r.client_name);
			const c = ensure(normKey(canonical), canonical);
			c.pipeline_value += n(r.pipeline_value);
			c.quotation_count += n(r.quotation_count);
			c.approved_quote_count += n(r.approved_count);
			c.sent_quote_count += n(r.sent_count);
		}

		for (const r of arRows as ReceivableRow[]) {
			const canonical = resolveName(r.client_name);
			const c = ensure(normKey(canonical), canonical);
			c.ar_overdue_amount += n(r.ar_overdue_amount);
			c.ar_overdue_count += n(r.ar_overdue_count);
			c.ar_pending_count += n(r.ar_pending_count);
			c.ar_partial_count += n(r.ar_partial_count);
			c.ar_received_count += n(r.ar_received_count);
		}

		for (const r of issueRows as IssueRow[]) {
			const canonical = resolveName(r.client_name);
			const c = ensure(normKey(canonical), canonical);
			c.total_issued += n(r.total_issued);
			c.total_issued_gross += n(r.total_issued_gross);
			c.total_issued_deduction += n(r.total_issued_deduction);
			c.issue_count += n(r.issue_count);
		}

		// Period & opening data — resolve names
		if (hasDateRange) {
			const periodMap = new Map<string, PeriodRow>();
			for (const r of periodRows) {
				const key = normKey(resolveName(r.client_name));
				const existing = periodMap.get(key);
				if (existing) {
					existing.period_invoiced += r.period_invoiced;
					existing.period_received += r.period_received;
					existing.period_issued += r.period_issued;
				} else {
					periodMap.set(key, { ...r });
				}
			}
			const openMap = new Map<string, OpeningBalanceRow>();
			for (const r of openingRows) {
				const key = normKey(resolveName(r.client_name));
				const existing = openMap.get(key);
				if (existing) {
					existing.opening_invoiced += r.opening_invoiced;
					existing.opening_received += r.opening_received;
					existing.opening_issued += r.opening_issued;
				} else {
					openMap.set(key, { ...r });
				}
			}

			for (const [key, c] of clientMap) {
				const pr = periodMap.get(key);
				const or = openMap.get(key);
				const opening = or
					? toNumber(
							add(
								sub(or.opening_invoiced, or.opening_received),
								or.opening_issued
							)
						)
					: 0;
				const periodInv = pr?.period_invoiced ?? 0;
				const periodRecv = pr?.period_received ?? 0;
				const periodIss = pr?.period_issued ?? 0;

				c.opening_balance = opening;
				c.period_invoiced = periodInv;
				c.period_received = periodRecv;
				c.period_issued = periodIss;
				c.closing_balance = toNumber(
					add(sub(add(opening, periodInv), periodRecv), periodIss)
				);
			}
			for (const r of periodRows) {
				const key = normKey(resolveName(r.client_name));
				if (!clientMap.has(key)) {
					const c = ensure(key, resolveName(r.client_name));
					const or = openMap.get(key);
					const opening = or
						? toNumber(
								add(
									sub(or.opening_invoiced, or.opening_received),
									or.opening_issued
								)
							)
						: 0;
					c.opening_balance = opening;
					c.period_invoiced = r.period_invoiced;
					c.period_received = r.period_received;
					c.period_issued = r.period_issued;
					c.closing_balance = toNumber(
						add(
							sub(add(opening, r.period_invoiced), r.period_received),
							r.period_issued
						)
					);
				}
			}
			for (const r of openingRows) {
				const key = normKey(resolveName(r.client_name));
				const c = ensure(key, resolveName(r.client_name));
				if (c.opening_balance === undefined) {
					const opening = toNumber(
						add(sub(r.opening_invoiced, r.opening_received), r.opening_issued)
					);
					c.opening_balance = opening;
					c.period_invoiced = c.period_invoiced ?? 0;
					c.period_received = c.period_received ?? 0;
					c.period_issued = c.period_issued ?? 0;
					c.closing_balance = toNumber(
						add(
							sub(add(opening, c.period_invoiced ?? 0), c.period_received ?? 0),
							c.period_issued ?? 0
						)
					);
				}
			}
		}

		// Compute net_balance = invoiced - received + issued
		for (const c of clientMap.values()) {
			c.net_balance = toNumber(
				add(sub(c.total_invoiced, c.total_received), c.total_issued)
			);
		}
		const data = Array.from(clientMap.values()).sort(
			(a, b) => b.net_balance - a.net_balance
		);

		// Meta
		const totalOutstanding = toNumber(
			data.reduce((s, c) => add(s, c.net_balance), R(0))
		);
		const totalInvoiced = toNumber(
			data.reduce((s, c) => add(s, c.total_invoiced), R(0))
		);
		const totalReceived = toNumber(
			data.reduce((s, c) => add(s, c.total_received), R(0))
		);
		const totalIssued = toNumber(
			data.reduce((s, c) => add(s, c.total_issued), R(0))
		);
		const totalPipeline = toNumber(
			data.reduce((s, c) => add(s, c.pipeline_value), R(0))
		);
		return NextResponse.json({
			success: true,
			data,
			meta: {
				total_clients: data.length,
				total_invoiced: totalInvoiced,
				total_received: totalReceived,
				total_issued: totalIssued,
				total_outstanding: totalOutstanding,
				total_pipeline: totalPipeline,
				...(hasDateRange && { from_date: fromDate, to_date: toDate }),
			},
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return NextResponse.json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
}
