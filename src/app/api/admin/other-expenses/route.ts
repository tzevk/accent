import { NextResponse } from 'next/server';
import type { PoolConnection } from 'mysql2/promise';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	captureOtherExpense,
	CostError,
	type OtherExpenseCaptureInput,
} from '@/lib/company-expenditure';

const TABLE = 'other_expenses';

const CAPTURE_FIELDS = [
	'voucher_number',
	'voucher_date',
	'expense_category',
	'payee_type',
	'vendor_id',
	'vendor_name',
	'employee_id',
	'employee_name',
	'bill_no',
	'bill_date',
	'bill_amount',
	'gst_amount',
	'net_amount',
	'description',
	'status',
	'gross_amount',
	'amount',
	'tax_amount',
	'currency',
	'cost_classification',
	'project_id',
	'service_period_start',
	'service_period_end',
	'tax_treatment',
	'tax_evidence_reference',
	'source_reference',
	'evidence_reference',
	'receipt_url',
	'reporting_currency',
	'conversion_rate',
	'conversion_date',
	'conversion_evidence_reference',
	'linked_cost_uid',
	'submit',
] as const;

/** The register body, exactly the fields the module validates. */
function toCaptureInput(
	body: Record<string, unknown>
): OtherExpenseCaptureInput {
	const input: Record<string, unknown> = {};
	for (const field of CAPTURE_FIELDS) {
		input[field] = body[field];
	}
	return input;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected error';
}

export async function GET(request: Request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	let db: PoolConnection | null = null;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const category = searchParams.get('expense_category');
		const payeeType = searchParams.get('payee_type');
		const recognitionState = searchParams.get('recognition_state');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();

		const where = ['1=1 AND isDelete = 0'];
		const params: (string | number)[] = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (category && category !== 'all') {
			where.push('expense_category = ?');
			params.push(category);
		}
		if (payeeType && payeeType !== 'all') {
			where.push('payee_type = ?');
			params.push(payeeType);
		}
		// `linked` is its own view: a receipt copy evidences a cost, it is not a
		// cost in any recognition state.
		if (recognitionState === 'linked') {
			where.push('linked_cost_uid IS NOT NULL');
		} else if (recognitionState && recognitionState !== 'all') {
			where.push('recognition_state = ?');
			params.push(recognitionState);
		}
		if (search) {
			where.push(
				'(voucher_number LIKE ? OR bill_no LIKE ? OR vendor_name LIKE ? OR employee_name LIKE ? OR description LIKE ? OR source_reference LIKE ?)'
			);
			const s = `%${search}%`;
			params.push(s, s, s, s, s, s);
		}

		const whereSql = where.join(' AND ');
		const [countRows] = await db.execute(
			`SELECT COUNT(*) as total FROM ${TABLE} WHERE ${whereSql}`,
			params
		);
		const count = countRows as Array<{ total: number }>;
		const total = count[0]?.total || 0;

		const [rows] = await db.execute(
			`SELECT *, ROW_NUMBER() OVER (ORDER BY voucher_date DESC, created_at DESC) as sr_no FROM ${TABLE} WHERE ${whereSql} ORDER BY voucher_date DESC, created_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				COALESCE(SUM(net_amount), 0) as totalAmount,
				COALESCE(SUM(CASE WHEN status = 'approved' THEN net_amount ELSE 0 END), 0) as approvedAmount,
				SUM(CASE WHEN recognition_state = 'recognized' AND linked_cost_uid IS NULL THEN 1 ELSE 0 END) as recognizedCost,
				SUM(CASE WHEN linked_cost_uid IS NOT NULL THEN 1 ELSE 0 END) as linkedCopies
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
			stats: (statsRows as Array<Record<string, unknown>>)[0] || {},
		});
	} catch (error) {
		console.error('Error fetching other expenses:', error);
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function POST(request: Request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.CREATE
	);
	if (auth instanceof Response) return auth;
	const user = auth.user;

	try {
		const body = (await request.json()) as Record<string, unknown>;
		if (!body.voucher_date) {
			return NextResponse.json(
				{ success: false, error: 'voucher_date is required' },
				{ status: 400 }
			);
		}
		if (!body.expense_category) {
			return NextResponse.json(
				{ success: false, error: 'expense_category is required' },
				{ status: 400 }
			);
		}
		if (!body.payee_type) {
			return NextResponse.json(
				{ success: false, error: 'payee_type is required' },
				{ status: 400 }
			);
		}

		// Number minting, the register row, the canonical identity (or receipt
		// link), and the journal row are one transaction inside the module.
		const data = await captureOtherExpense(toCaptureInput(body), {
			id: user?.id ?? null,
		});

		const payeeLabel =
			body.payee_type === 'vendor'
				? `vendor ${body.vendor_name || body.vendor_id || ''}`
				: `employee ${body.employee_name || body.employee_id || ''}`;

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'other_expense',
			resourceId: data.id,
			description: `Created other expense ${data.voucher_number} for ${body.expense_category} (${payeeLabel})`,
			request,
		});

		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('Error creating other expense:', error);
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	}
}
