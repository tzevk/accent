import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'petty_cash_expenses';

/**
 * The financial fields the versioned command path owns. The register edit path
 * carries no `financial_version` and appends no journal entry, so an edit here
 * would change what a later `recognize` confirms while every command still
 * sees the old version. Operational fields (category, description, payment
 * details, recipient, bill number, notes, the register's own `status`) stay
 * editable.
 */
const FINANCIAL_FIELDS = [
	'transaction_date',
	'credit_amount',
	'debit_amount',
	'source_voucher_id',
	'cost_uid',
	'cost_classification',
	'project_id',
	'service_period_start',
	'service_period_end',
	'bill_date',
	'currency',
	'reporting_currency',
	'conversion_rate',
	'conversion_date',
	'conversion_evidence_reference',
	'tax_amount',
	'tax_treatment',
	'tax_evidence_reference',
	'source_reference',
	'evidence_reference',
	'linked_cost_uid',
];

/**
 * A funding credit is the mirror of its cash voucher (cash movement, never
 * cost) and confirmed spending is frozen against register edits; both are
 * changed only through their own controlled path.
 */
async function refuseProtectedEntry(db, id: string) {
	const [rows] = await db.execute(
		`SELECT entry_kind, recognition_state FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
		[id]
	);
	if (rows.length === 0) {
		return NextResponse.json(
			{ success: false, error: 'Not found' },
			{ status: 404 }
		);
	}
	if (rows[0].entry_kind === 'funding') {
		return NextResponse.json(
			{
				success: false,
				error:
					'A funding credit mirrors its cash voucher. Edit or delete the voucher instead; funding is cash movement, never cost.',
				code: 'funding_event_managed_by_voucher',
			},
			{ status: 409 }
		);
	}
	if (rows[0].recognition_state === 'recognized') {
		return NextResponse.json(
			{
				success: false,
				error:
					'This petty-cash spend is recognized cost. Cancel it with a versioned command before changing or removing it.',
				code: 'cost_recognized',
			},
			{ status: 409 }
		);
	}
	return null;
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		db = await dbConnect();
		const [rows] = await db.execute(`SELECT * FROM ${TABLE} WHERE id = ?`, [
			id,
		]);
		if (rows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Not found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data: rows[0] });
	} catch (error) {
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const body = (await request.json()) as Record<string, unknown>;
		const user = authResult.user;

		db = await dbConnect();

		const refusal = await refuseProtectedEntry(db, id);
		if (refusal) return refusal;

		const attemptedFinancialFields = FINANCIAL_FIELDS.filter(
			(field) => body[field] !== undefined
		);
		if (attemptedFinancialFields.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error:
						'Amounts, dates, voucher and Project references, classification, period, tax, and the linked cost are versioned financial fields. Change them through POST /api/admin/petty-cash-expenses/{id}/commands with command "update" and the current expected_version.',
					code: 'financial_fields_versioned',
					fields: attemptedFinancialFields,
				},
				{ status: 422 }
			);
		}

		const fields = [
			'expense_category',
			'description',
			'payment_mode',
			'payment_reference',
			'recipient_name',
			'custodian_employee_id',
			'custodian_employee_name',
			'bill_no',
			'notes',
			'status',
		];
		const setClauses: string[] = [];
		const values: unknown[] = [];
		for (const field of fields) {
			if (body[field] !== undefined) {
				setClauses.push(`${field} = ?`);
				values.push(body[field]);
			}
		}
		if (body.status === 'approved') {
			let approverName = null;
			const [userRows] = await db.execute(
				'SELECT full_name FROM users WHERE id = ?',
				[user?.id || null]
			);
			if (userRows.length > 0) {
				approverName = userRows[0].full_name || null;
			}
			setClauses.push(
				'approved_by = ?',
				'approved_by_name = ?',
				'approved_at = NOW()'
			);
			values.push(user?.id || null, approverName);
		}

		if (setClauses.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'No fields to update' },
				{ status: 400 }
			);
		}

		values.push(id);
		await db.execute(
			`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = ? AND isDelete = 0`,
			values
		);

		await logActivity({
			userId: user?.id,
			actionType: 'update',
			resourceType: 'petty_cash_expense',
			resourceId: id,
			description: `Updated petty cash expense ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to update',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const user = authResult.user;
		db = await dbConnect();

		const refusal = await refuseProtectedEntry(db, id);
		if (refusal) return refusal;

		const [result] = await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1 WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Not found' },
				{ status: 404 }
			);
		}

		await logActivity({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'petty_cash_expense',
			resourceId: id,
			description: `Deleted petty cash expense ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to delete',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
