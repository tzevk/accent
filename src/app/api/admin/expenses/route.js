import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { CostError, recordCost } from '@/lib/company-expenditure';

const TABLE = 'expenses';

/** Map the request body onto the module's record input (camelCase). */
function toRecordInput(body) {
	return {
		expenseNumber: body.expense_number ?? null,
		expenseDate: body.expense_date ?? null,
		category: body.category ?? null,
		subCategory: body.sub_category ?? null,
		description: body.description ?? null,
		vendorName: body.vendor_name ?? null,
		notes: body.notes ?? null,
		amount: body.amount ?? null,
		taxAmount: body.tax_amount ?? null,
		grossAmount: body.total_amount ?? body.gross_amount,
		currency: body.currency ?? null,
		// Currency conversion evidence (#319).
		reportingCurrency: body.reporting_currency ?? null,
		conversionRate: body.conversion_rate ?? null,
		conversionDate: body.conversion_date ?? null,
		conversionEvidenceReference: body.conversion_evidence_reference ?? null,
		paymentMode: body.payment_mode ?? null,
		paymentReference: body.payment_reference ?? null,
		paidTo: body.paid_to ?? null,
		paidBy: body.paid_by ?? null,
		receiptUrl: body.receipt_url ?? null,
		isBillable: body.is_billable ? 1 : 0,
		isReimbursable: body.is_reimbursable ? 1 : 0,
		department: body.department ?? null,
		operationalStatus: body.status ?? null,
		projectId: body.project_id ?? null,
		// Financial recognition fields (#306).
		classification: body.cost_classification ?? null,
		// What the spend is (#317): operating cost by default, or an advance,
		// deposit, prepayment, capital item, or explicitly unresolved treatment.
		nature: body.cost_nature ?? undefined,
		servicePeriodStart: body.service_period_start ?? null,
		servicePeriodEnd: body.service_period_end ?? null,
		billDate: body.bill_date ?? null,
		taxTreatment: body.tax_treatment ?? undefined,
		taxEvidenceReference: body.tax_evidence_reference ?? null,
		sourceReference: body.source_reference ?? null,
		evidenceReference: body.evidence_reference ?? null,
		submit: body.submit === true || body.recognition_state === 'pending_evidence',
	};
}

export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		// No EXPENSES resource exists; OTHER_EXPENSES is the closest existing
		// expense-ledger resource (admin/expenses is the general company-expense
		// ledger next to other-expenses/petty-cash, which have their own).
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const category = searchParams.get('category');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();

		const where = ['1=1 AND isDelete = 0'];
		const params = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (category && category !== 'all') {
			where.push('category = ?');
			params.push(category);
		}
		if (search) {
			where.push(
				'(expense_number LIKE ? OR vendor_name LIKE ? OR description LIKE ? OR paid_to LIKE ?)'
			);
			const s = `%${search}%`;
			params.push(s, s, s, s);
		}

		const whereSql = where.join(' AND ');
		const [countRows] = await db.execute(
			`SELECT COUNT(*) as total FROM ${TABLE} WHERE ${whereSql}`,
			params
		);
		const total = countRows[0]?.total || 0;

		const [rows] = await db.execute(
			`SELECT * FROM ${TABLE} WHERE ${whereSql} ORDER BY expense_date DESC, created_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				SUM(CASE WHEN status = 'reimbursed' THEN 1 ELSE 0 END) as reimbursed,
				COALESCE(SUM(total_amount), 0) as totalAmount,
				COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END), 0) as approvedAmount,
				COALESCE(SUM(CASE WHEN status = 'reimbursed' THEN total_amount ELSE 0 END), 0) as reimbursedAmount
			FROM ${TABLE}
			WHERE isDelete = 0
		`);

		return NextResponse.json({
			success: true,
			data: rows,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
			stats: statsRows[0] || {},
		});
	} catch (error) {
		console.error('Error fetching expenses:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function POST(request) {
	const authResult = await ensurePermission(
		request,
		// No EXPENSES resource exists; OTHER_EXPENSES is the closest existing
		// expense-ledger resource (see the GET guard).
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = await request.json();
		const user = authResult.user;

		if (!body.category) {
			return NextResponse.json(
				{ success: false, error: 'category is required' },
				{ status: 400 }
			);
		}

		// One write path: the module mints the number and the cost identity,
		// applies the recognition-period and tax rules, and journals the row.
		const recorded = await recordCost(toRecordInput(body), {
			id: user?.id ?? null,
		});

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'expense',
			resourceId: recorded.id,
			description: `Created expense ${recorded.expense_number} for ${body.category}`,
			request,
		});

		return NextResponse.json({ success: true, data: recorded });
	} catch (error) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code, ...error.detail },
				{ status: error.status }
			);
		}
		console.error('Error creating expense:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	}
}
