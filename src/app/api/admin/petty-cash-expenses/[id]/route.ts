import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';
import {
	isMonthClosed,
	loadPettyCashGuardRow,
	pettyCashRegisterRefusal,
} from '@/lib/company-expenditure';

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
 * The register guard is the module's hook (`loadPettyCashGuardRow` +
 * `pettyCashRegisterRefusal`), read under a row lock inside this request's
 * transaction: a funding credit belongs to its voucher, confirmed spending is
 * frozen, and spending that was ever recognized keeps its history even after a
 * cancellation — only the versioned command path changes those.
 */
async function refuseProtectedEntry(
	db,
	id: string,
	operation: 'update' | 'delete'
) {
	const row = await loadPettyCashGuardRow(db, id);
	if (!row) {
		return NextResponse.json(
			{ success: false, error: 'Not found' },
			{ status: 404 }
		);
	}
	// A closed financial month is the terminal freeze: its refusal is the
	// operative one, ahead of the register history hook (#322).
	const [dateRows] = (await db.execute(
		`SELECT recognition_period, transaction_date FROM ${TABLE}
      WHERE id = ? AND isDelete = 0`,
		[id]
	)) as [
		Array<{ recognition_period: unknown; transaction_date: unknown }>,
		unknown,
	];
	for (const value of [
		dateRows[0]?.recognition_period,
		dateRows[0]?.transaction_date,
	]) {
		const period = String(value ?? '').slice(0, 7);
		if (/^\d{4}-\d{2}$/.test(period) && (await isMonthClosed(db, period))) {
			return NextResponse.json(
				{
					success: false,
					error:
						'This financial month is closed. Ordinary writes are blocked; change closed figures through the financial revision workflow instead.',
					code: 'month_closed',
				},
				{ status: 409 }
			);
		}
	}
	const refusal = pettyCashRegisterRefusal(row, operation);
	if (refusal) {
		return NextResponse.json(
			{
				success: false,
				error: refusal.message,
				code: refusal.code,
				...refusal.detail,
			},
			{ status: refusal.status }
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

		// The guard row is read under a row lock inside this transaction, so a
		// concurrent command cannot change the state between guard and update.
		await db.execute('START TRANSACTION');
		const refusal = await refuseProtectedEntry(db, id, 'update');
		if (refusal) {
			await db.execute('ROLLBACK');
			return refusal;
		}

		const attemptedFinancialFields = FINANCIAL_FIELDS.filter(
			(field) => body[field] !== undefined
		);
		if (attemptedFinancialFields.length > 0) {
			await db.execute('ROLLBACK');
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
			await db.execute('ROLLBACK');
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
		await db.execute('COMMIT');

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
		try {
			if (db) await db.execute('ROLLBACK');
		} catch {
			/* the transaction may already be gone */
		}
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

		// The guard row is read under a row lock inside this transaction; the
		// history guard refuses deleting spending that was ever recognized.
		await db.execute('START TRANSACTION');
		const refusal = await refuseProtectedEntry(db, id, 'delete');
		if (refusal) {
			await db.execute('ROLLBACK');
			return refusal;
		}

		const [result] = await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1 WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (result.affectedRows === 0) {
			await db.execute('ROLLBACK');
			return NextResponse.json(
				{ success: false, error: 'Not found' },
				{ status: 404 }
			);
		}
		await db.execute('COMMIT');

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
		try {
			if (db) await db.execute('ROLLBACK');
		} catch {
			/* the transaction may already be gone */
		}
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
