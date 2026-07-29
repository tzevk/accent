import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { R, add, sub, mul, pctOf, toNumber } from '@/lib/money';

// ── Types ──────────────────────────────────────────────────────────

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: {
							permission?: string;
						};
						project_reports?: {
							permission?: string;
						};
					};
				};
			};
		};
	};
}

interface ReportUser {
	id: number;
	email: string;
	is_super_admin: boolean | number;
	field_permissions?: string | FieldPermissionsShape | null;
}

// ── Permission helpers ─────────────────────────────────────────────

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

// ── Raw row shape ──────────────────────────────────────────────────

interface SalesRegisterRow {
	invoice_id: number;
	company_id: number | null;
	company_name: string;
	invoice_number: string;
	po_number: string | null;
	invoice_date: string | null;
	due_date: string | null;
	gross_invoice_amount: string | null;
	cgst_amount_sql: string | null;
	sgst_amount_sql: string | null;
	igst_amount_sql: string | null;
	cgst_rate: string | null;
	sgst_rate: string | null;
	gst_type: string | null;
	igst_rate: string | null;
	total_invoice_amount_with_tax: string | null;
	payment_received: string;
	tds_deduction: string;
	gst_hold_amount: string;
	payment_received_date: string | null;
	receipt_no: string | null;
	thirty_days_credit: string;
	overdue_days: string;
	remark: string | null;
}

// ── Output shape ───────────────────────────────────────────────────

export interface SalesRegisterItem {
	invoice_id: number;
	company_id: number | null;
	company_name: string;
	invoice_number: string;
	po_number: string | null;
	invoice_date: string | null;
	due_date: string | null;
	gross_invoice_amount: number;
	cgst_amount: number;
	sgst_amount: number;
	igst_amount: number;
	total_invoice_amount_with_tax: number;
	payment_received: number;
	tds_deduction: number;
	gst_hold_amount: number;
	net_invoice_amount_receivable: number;
	receipt_no: string | null;
	payment_received_date: string | null;
	thirty_days_credit: 'Yes' | 'No';
	overdue_days: number;
	remark: string | null;
}

interface ReportMeta {
	total_entries: number;
	total_gross: number;
	total_tax: number;
	total_received: number;
	total_receivable: number;
}

// ── Handler ────────────────────────────────────────────────────────

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
					error: 'You do not have permission to view the sales register',
				},
				{ status: 403 }
			);
		}

		const { searchParams } = new URL(request.url);
		const fromDate = searchParams.get('from_date') || '';
		const toDate = searchParams.get('to_date') || '';
		const search = searchParams.get('search') || '';
		const companyId = searchParams.get('company_id') || '';

		// ── Build query ────────────────────────────────────────────

		const conditions: string[] = ['i.isDelete = 0'];
		const params: (string | number)[] = [];

		if (fromDate) {
			conditions.push('i.invoice_date >= ?');
			params.push(fromDate);
		}
		if (toDate) {
			conditions.push('i.invoice_date <= ?');
			params.push(toDate);
		}
		if (search) {
			conditions.push('(i.client_name LIKE ? OR i.invoice_number LIKE ?)');
			params.push(`%${search}%`, `%${search}%`);
		}
		if (companyId) {
			conditions.push('c.id = ?');
			params.push(Number(companyId));
		}

		const whereClause = conditions.length
			? `WHERE ${conditions.join(' AND ')}`
			: '';

		const sql = `
			SELECT
				i.id AS invoice_id,
				c.id AS company_id,
				i.client_name AS company_name,
				i.invoice_number,
				i.po_number,
				i.invoice_date,
				i.due_date,
				i.gross_amount AS gross_invoice_amount,
				ROUND(COALESCE(i.gross_amount, 0) * COALESCE(i.cgst_rate, 0) / 100, 2) AS cgst_amount_sql,
				ROUND(COALESCE(i.gross_amount, 0) * COALESCE(i.sgst_rate, 0) / 100, 2) AS sgst_amount_sql,
				ROUND(COALESCE(i.gross_amount, 0) * COALESCE(i.igst_rate, 0) / 100, 2) AS igst_amount_sql,
				COALESCE(i.cgst_rate, 0) AS cgst_rate,
				COALESCE(i.sgst_rate, 0) AS sgst_rate,
				COALESCE(i.igst_rate, 0) AS igst_rate,
				i.gst_type,
				i.total AS total_invoice_amount_with_tax,
				COALESCE(pe.total_received, 0) AS payment_received,
				COALESCE(pe.total_tds, 0) AS tds_deduction,
				COALESCE(pe.total_gst, 0) AS gst_hold_amount,
				pe.latest_payment_date AS payment_received_date,
				pe.latest_receipt_no AS receipt_no,
				CASE
					WHEN i.due_date IS NOT NULL AND i.invoice_date IS NOT NULL
						AND DATEDIFF(i.due_date, i.invoice_date) >= 30
					THEN 'Yes'
					ELSE 'No'
				END AS thirty_days_credit,
				CASE
					WHEN i.due_date IS NOT NULL
						AND i.status NOT IN ('paid', 'fully_paid')
						AND i.due_date < CURDATE()
					THEN DATEDIFF(CURDATE(), i.due_date)
					ELSE 0
				END AS overdue_days,
				i.notes AS remark
			FROM invoices i
			LEFT JOIN companies c
				ON c.id = (
					SELECT c2.id FROM companies c2
					WHERE c2.isDelete = 0
						AND LOWER(TRIM(c2.company_name)) = LOWER(TRIM(i.client_name))
					ORDER BY c2.id
					LIMIT 1
				)
			LEFT JOIN (
				SELECT invoice_no,
					SUM(COALESCE(amount, 0)) AS total_received,
					SUM(COALESCE(tds_amount, 0)) AS total_tds,
					SUM(COALESCE(gst_amount, 0)) AS total_gst,
					MAX(receipt_no) AS latest_receipt_no,
					MAX(payment_date) AS latest_payment_date
				FROM payment_entries
				WHERE isDelete = 0
					AND invoice_no IS NOT NULL
					AND invoice_no != ''
				GROUP BY invoice_no
			) pe ON pe.invoice_no = i.invoice_number
			${whereClause}
			ORDER BY i.invoice_date DESC
		`;

		const [rows] = await query(sql, params);
		const rawRows = rows as SalesRegisterRow[];

		// ── Recompute GST with money lib for precision ─────────────
		// ── Skip rows with NULL gross_amount ───────────────────────

		const data: SalesRegisterItem[] = [];

		for (const r of rawRows) {
			const gross = R(r.gross_invoice_amount ?? 0);
			const grossNum = toNumber(gross);

			if (grossNum === 0 && r.gross_invoice_amount === null) continue;

			const cgstRate = parseFloat(r.cgst_rate || '0');
			const sgstRate = parseFloat(r.sgst_rate || '0');
			const igstRate = parseFloat(r.igst_rate || '0');
			const isCgstSgst = r.gst_type === 'cgst_sgst';

			const cgstAmount = isCgstSgst ? toNumber(pctOf(gross, cgstRate)) : 0;
			const sgstAmount = isCgstSgst ? toNumber(pctOf(gross, sgstRate)) : 0;
			const igstAmount = isCgstSgst ? 0 : toNumber(pctOf(gross, igstRate));

			const totalWithTax = toNumber(R(r.total_invoice_amount_with_tax ?? 0));
			const paymentReceived = toNumber(R(r.payment_received));
			const tdsDeduction = toNumber(R(r.tds_deduction));
			const gstHoldAmount = toNumber(R(r.gst_hold_amount));

			const netReceivable = toNumber(
				sub(
					sub(sub(R(totalWithTax), paymentReceived), tdsDeduction),
					gstHoldAmount
				)
			);

			data.push({
				invoice_id: r.invoice_id,
				company_id: r.company_id,
				company_name: r.company_name,
				invoice_number: r.invoice_number,
				po_number: r.po_number,
				invoice_date: r.invoice_date,
				due_date: r.due_date,
				gross_invoice_amount: grossNum,
				cgst_amount: cgstAmount,
				sgst_amount: sgstAmount,
				igst_amount: igstAmount,
				total_invoice_amount_with_tax: totalWithTax,
				payment_received: paymentReceived,
				tds_deduction: tdsDeduction,
				gst_hold_amount: gstHoldAmount,
				receipt_no: r.receipt_no ?? null,
				net_invoice_amount_receivable: netReceivable,
				payment_received_date: r.payment_received_date,
				thirty_days_credit: r.thirty_days_credit as 'Yes' | 'No',
				overdue_days: parseInt(r.overdue_days, 10) || 0,
				remark: r.remark,
			});
		}

		// ── Meta ───────────────────────────────────────────────────

		const totalGross = toNumber(
			data.reduce((s, c) => add(s, c.gross_invoice_amount), R(0))
		);
		const totalTax = toNumber(
			data.reduce(
				(s, c) => add(s, c.cgst_amount, c.sgst_amount, c.igst_amount),
				R(0)
			)
		);
		const totalReceived = toNumber(
			data.reduce((s, c) => add(s, c.payment_received), R(0))
		);
		const totalReceivable = toNumber(
			data.reduce((s, c) => add(s, c.net_invoice_amount_receivable), R(0))
		);

		const meta: ReportMeta = {
			total_entries: data.length,
			total_gross: totalGross,
			total_tax: totalTax,
			total_received: totalReceived,
			total_receivable: totalReceivable,
		};

		return NextResponse.json({ success: true, data, meta });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return NextResponse.json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
}
