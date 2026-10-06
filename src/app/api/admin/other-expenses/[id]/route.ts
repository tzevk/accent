import { NextResponse } from 'next/server';
import type { PoolConnection } from 'mysql2/promise';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { CostError } from '@/lib/company-expenditure';

const TABLE = 'other_expenses';

/**
 * Fields the versioned cost commands own. A register edit may not change them:
 * every financial change carries an expected version, a reason where the rules
 * require one, and one journal row. A receipt copy's link is one of them — it
 * is a review decision, not an operational edit.
 */
const FINANCIAL_FIELDS = [
	'bill_date',
	'bill_amount',
	'gst_amount',
	'net_amount',
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
	'linked_cost_uid',
	'cost_uid',
	'recognition_state',
	'recognition_period',
	'period_basis',
	'recognized_amount',
	'recognized_by',
	'recognized_at',
	'financial_version',
	'row_no',
	'submit',
	// Conversion evidence is a module-owned financial field (#319); this
	// register does not capture it yet, so a register edit must not pretend to.
	'reporting_currency',
	'conversion_rate',
	'conversion_date',
	'conversion_evidence_reference',
	'converted_amount'
] as const;

/** Operational fields the register itself owns. */
const OPERATIONAL_FIELDS = [
	'voucher_number',
	'voucher_date',
	'expense_category',
	'payee_type',
	'vendor_id',
	'vendor_name',
	'employee_id',
	'employee_name',
	'bill_no',
	'description',
	'status',
	'receipt_url'
] as const;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected error';
}

/** The row's recognition state, or null when it does not exist. */
async function loadRecognitionState(
	db: PoolConnection,
	id: string
): Promise<{ recognition_state: string; has_recognized_history: boolean } | null> {
	const [rows] = await db.execute(
		`SELECT e.recognition_state,
            EXISTS(
              SELECT 1 FROM financial_cost_events ev
               WHERE ev.source_table = 'other_expenses' AND ev.source_id = e.id
                 AND ev.command = 'recognized'
            ) AS has_recognized_history
       FROM ${TABLE} e
      WHERE e.id = ? AND e.isDelete = 0`,
		[id]
	);
	const found = rows as Array<{
		recognition_state: string;
		has_recognized_history: number;
	}>;
	return found.length > 0 ? found[0] : null;
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	let db: PoolConnection | null = null;
	try {
		const { id } = await params;
		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT * FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
			[id]
		);
		return NextResponse.json({ success: true, data: (rows as unknown[])[0] });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;
	const user = auth.user;

	let db: PoolConnection | null = null;
	try {
		const { id } = await params;
		const body = (await request.json()) as Record<string, unknown>;

		db = await dbConnect();
		const state = await loadRecognitionState(db, id);
		if (!state) {
			return NextResponse.json(
				{ success: false, error: 'Other expense not found' },
				{ status: 404 }
			);
		}
		if (state.recognition_state === 'recognized') {
			return NextResponse.json(
				{
					success: false,
					error:
						'Confirmed cost cannot be edited in the register; cancel it through the versioned command path instead',
					code: 'cost_recognized'
				},
				{ status: 409 }
			);
		}

		const refused = FINANCIAL_FIELDS.filter((field) => body[field] !== undefined);
		if (refused.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error:
						'Financial fields are versioned; change them through the expense commands',
					code: 'financial_fields_versioned',
					fields: refused
				},
				{ status: 422 }
			);
		}

		const setClauses: string[] = [];
		const values: (string | number | null)[] = [];
		for (const field of OPERATIONAL_FIELDS) {
			if (body[field] !== undefined) {
				setClauses.push(`${field} = ?`);
				values.push(body[field] as string | number | null);
			}
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
			resourceType: 'other_expense',
			resourceId: id,
			description: `Updated other expense ${id}`,
			request
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: error.status }
			);
		}
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.DELETE
	);
	if (auth instanceof Response) return auth;
	const user = auth.user;

	let db: PoolConnection | null = null;
	try {
		const { id } = await params;
		db = await dbConnect();
		const state = await loadRecognitionState(db, id);
		if (!state) {
			return NextResponse.json(
				{ success: false, error: 'Other expense not found' },
				{ status: 404 }
			);
		}
		// Ordinary deletion cannot remove confirmed cost, and cannot erase the
		// history of a cost that was once recognized either: the supported
		// correction is the versioned cancellation, which keeps the row.
		if (state.recognition_state === 'recognized') {
			return NextResponse.json(
				{
					success: false,
					error:
						'Confirmed cost cannot be deleted; cancel it through the versioned command path',
					code: 'cost_recognized'
				},
				{ status: 409 }
			);
		}
		if (Number(state.has_recognized_history) !== 0) {
			return NextResponse.json(
				{
					success: false,
					error:
						'This entry has recognized history; deletion would erase it. Cancel it through the versioned command path instead',
					code: 'cost_history_preserved'
				},
				{ status: 409 }
			);
		}

		const [result] = await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND isDelete = 0`,
			[user?.id ?? null, id]
		);
		const updated = result as { affectedRows?: number };
		if (Number(updated.affectedRows ?? 0) === 0) {
			return NextResponse.json(
				{ success: false, error: 'Other expense not found' },
				{ status: 404 }
			);
		}

		await logActivity({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'other_expense',
			resourceId: id,
			description: `Deleted other expense ${id}`,
			request
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
