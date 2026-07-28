import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

/**
 * GET /api/reports/client-balance/detail
 *
 * Returns individual transactions for a single client, sourced from:
 *   - invoices          (sale invoices)
 *   - payment_entries   (payments received)
 *   - quotations        (pipeline quotes)
 *   - payment_receivables (AR tracking)
 *
 * Query params:
 *   client_name (string, required) — canonical client name
 *   from_date   (string, YYYY-MM-DD) — optional
 *   to_date     (string, YYYY-MM-DD) — optional
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit).
 */

// ── Types ──────────────────────────────────────────────────────────────

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

// ── Row shapes ─────────────────────────────────────────────────────────

interface InvoiceDetail {
	invoice_number: string;
	invoice_date: string | null;
	due_date: string | null;
	net_amount: number;
	amount_paid: number;
	balance_due: number;
	status: string;
}

interface PaymentDetail {
	receipt_no: string | null;
	receipt_date: string | null;
	payment_date: string | null;
	amount: number;
	net_amount: number;
	tds_amount: number;
	gst_amount: number;
	payment_type: string | null;
	invoice_no: string | null;
	transaction_id: string | null;
	bank_name: string | null;
}

interface IssueDetail {
	payee_name: string;
	invoice_number: string | null;
	invoice_date: string | null;
	invoice_amount: number;
	amount: number;
	deduction: number;
	net_amount: number;
	issue_date: string | null;
	transaction_reference: string | null;
	bank_name: string | null;
	status: string;
}

interface QuotationDetail {
	quotation_number: string | null;
	quotation_date: string | null;
	amount: number;
	status: string;
}

interface ReceivableDetail {
	reference_number: string;
	invoice_number: string | null;
	invoice_date: string | null;
	due_date: string | null;
	invoice_amount: number;
	paid_amount: number;
	balance_due: number;
	status: string;
	received_date: string | null;
	payment_mode: string | null;
}

interface ClientDetailResponse {
	success: true;
	client_name: string;
	invoices: InvoiceDetail[];
	payments: PaymentDetail[];
	issued: IssueDetail[];
	quotations: QuotationDetail[];
	receivables: ReceivableDetail[];
}

// ── Handler ────────────────────────────────────────────────────────────

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
					error: 'You do not have permission to view client balance details',
				},
				{ status: 403 }
			);
		}

		const { searchParams } = new URL(request.url);
		const clientName = searchParams.get('client_name');

		if (!clientName || !clientName.trim()) {
			return NextResponse.json(
				{ success: false, error: 'client_name is required' },
				{ status: 400 }
			);
		}

		const fromDate = searchParams.get('from_date') || '';
		const toDate = searchParams.get('to_date') || '';
		const hasDateRange = !!(fromDate && toDate);

		// ── 1. Invoices ──────────────────────────────────────────────
		let invoiceQuery = `
			SELECT
				invoice_number,
				invoice_date,
				due_date,
				COALESCE(net_amount, 0) AS net_amount,
				COALESCE(amount_paid, 0) AS amount_paid,
				COALESCE(balance_due, 0) AS balance_due,
				status
			FROM invoices
			WHERE isDelete = 0
				AND LOWER(TRIM(client_name)) = LOWER(TRIM(?))
		`;
		const invoiceParams: (string | number)[] = [clientName];

		if (hasDateRange) {
			invoiceQuery += ` AND invoice_date >= ? AND invoice_date <= ?`;
			invoiceParams.push(fromDate, toDate);
		}

		invoiceQuery += ` ORDER BY invoice_date DESC, invoice_number DESC`;

		const [invoiceRows] = await query(invoiceQuery, invoiceParams);

		// ── 2. Payment entries (receipts) ────────────────────────────
		let paymentQuery = `
			SELECT
				receipt_no,
				receipt_date,
				payment_date,
				COALESCE(amount, 0) AS amount,
				COALESCE(net_amount, 0) AS net_amount,
				COALESCE(tds_amount, 0) AS tds_amount,
				COALESCE(gst_amount, 0) AS gst_amount,
				payment_type,
				invoice_no,
				transaction_id,
				bank_name
			FROM payment_entries
			WHERE isDelete = 0
				AND LOWER(TRIM(company_name)) = LOWER(TRIM(?))
		`;
		const paymentParams: (string | number)[] = [clientName];

		if (hasDateRange) {
			paymentQuery += ` AND payment_date >= ? AND payment_date <= ?`;
			paymentParams.push(fromDate, toDate);
		}

		paymentQuery += ` ORDER BY payment_date DESC, receipt_no DESC`;

		const [paymentRows] = await query(paymentQuery, paymentParams);
		// ── 3. Payment issues (issued to client) ────────────────────
		let issueRows: IssueDetail[] = [];
		try {
			let issueQuery = `
				SELECT
					payee_name,
					invoice_number,
					invoice_date,
					COALESCE(invoice_amount, 0) AS invoice_amount,
					COALESCE(amount, 0) AS amount,
					COALESCE(deduction, 0) AS deduction,
					COALESCE(net_amount, 0) AS net_amount,
					issue_date,
					transaction_reference,
					bank_name,
					status
				FROM payment_issues
				WHERE isDelete = 0 AND payee_type = 'company'
					AND LOWER(TRIM(payee_name)) = LOWER(TRIM(?))
			`;
			const issueParams: (string | number)[] = [clientName];

			if (hasDateRange) {
				issueQuery += ` AND issue_date >= ? AND issue_date <= ?`;
				issueParams.push(fromDate, toDate);
			}

			issueQuery += ` ORDER BY issue_date DESC, invoice_number DESC`;

			const [rows] = await query(issueQuery, issueParams);
			issueRows = rows as IssueDetail[];
		} catch {
			// payment_issues table may not exist
		}

		// ── 4. Quotations ────────────────────────────────────────────
		const [quoteRows] = await query(
			`SELECT
				quotation_number,
				quotation_date,
				COALESCE(net_amount, total, 0) AS amount,
				status
			FROM quotations
			WHERE isDelete = 0
				AND LOWER(TRIM(client_name)) = LOWER(TRIM(?))
			ORDER BY quotation_date DESC, quotation_number DESC`,
			[clientName]
		);

		// ── 5. Payment receivables (AR) ──────────────────────────────
		const [arRows] = await query(
			`SELECT
				reference_number,
				invoice_number,
				invoice_date,
				due_date,
				COALESCE(invoice_amount, 0) AS invoice_amount,
				COALESCE(paid_amount, 0) AS paid_amount,
				COALESCE(balance_due, 0) AS balance_due,
				status,
				received_date,
				payment_mode
			FROM payment_receivables
			WHERE isDelete = 0
				AND LOWER(TRIM(client_name)) = LOWER(TRIM(?))
			ORDER BY invoice_date DESC, reference_number DESC`,
			[clientName]
		);

		return NextResponse.json({
			success: true,
			client_name: clientName,
			invoices: invoiceRows as InvoiceDetail[],
			payments: paymentRows as PaymentDetail[],
			issued: issueRows as IssueDetail[],
			quotations: quoteRows as QuotationDetail[],
			receivables: arRows as ReceivableDetail[],
		} satisfies ClientDetailResponse);
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : 'Unknown server error';
		return NextResponse.json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
}
