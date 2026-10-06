import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'expenses';

/**
 * The financial fields of a direct cost — the ones the versioned command path
 * owns. The register edit path must not rewrite them: it carries no
 * `financial_version` and appends no journal entry, so an edit here would
 * change the amount a later `recognize` confirms while every command still
 * sees the old version. Operational fields (vendor, payment, description,
 * notes, category, and the register's own `status`) stay editable here.
 */
const FINANCIAL_FIELDS = [
	'expense_date',
	'amount',
	'tax_amount',
	'total_amount',
	'currency',
	'project_id',
	// #317: the spend's nature decides whether the amount is cost or a balance
	// consumed across periods, so it is a versioned financial field too.
	'cost_nature',
];

/**
 * Confirmed cost is frozen here: an edit or a soft delete through the register
 * would change recognized cost with no version and no journal entry. The
 * recognition workflow is the way to change it (cancel it, then record the
 * correction), so these paths refuse instead of mutating it silently.
 */
async function refuseRecognizedCostEdit(db, id) {
	const [rows] = await db.execute(
		`SELECT recognition_state FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
		[id]
	);
	if (rows.length === 0) {
		return NextResponse.json(
			{ success: false, error: 'Expense not found' },
			{ status: 404 }
		);
	}
	if (rows[0].recognition_state === 'recognized') {
		return NextResponse.json(
			{
				success: false,
				error:
					'This expense is recognized cost. Cancel it with a versioned command before changing or removing it.',
				code: 'cost_recognized',
			},
			{ status: 409 }
		);
	}
	return null;
}

export async function GET(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT * FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
			[id]
		);
		if (rows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Not found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data: rows[0] });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function PUT(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const body = await request.json();
		const user = authResult.user;

		db = await dbConnect();

		const refusal = await refuseRecognizedCostEdit(db, id);
		if (refusal) return refusal;

		const attemptedFinancialFields = FINANCIAL_FIELDS.filter(
			(field) => body[field] !== undefined
		);
		if (attemptedFinancialFields.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error:
						'Amount, tax, total, currency, expense date, project, and nature are versioned financial fields. Change them through POST /api/admin/expenses/{id}/commands with command "update" and the current expected_version.',
					code: 'financial_fields_versioned',
					fields: attemptedFinancialFields,
				},
				{ status: 422 }
			);
		}

		const fields = [
			'category',
			'sub_category',
			'description',
			'vendor_name',
			'payment_mode',
			'payment_reference',
			'paid_to',
			'paid_by',
			'receipt_url',
			'is_billable',
			'is_reimbursable',
			'department',
			'notes',
			'status',
		];
		const setClauses = [];
		const values = [];
		for (const f of fields) {
			if (body[f] !== undefined) {
				setClauses.push(`${f} = ?`);
				values.push(
					f === 'is_billable' || f === 'is_reimbursable'
						? body[f]
							? 1
							: 0
						: body[f]
				);
			}
		}
		if (body.status === 'approved') {
			setClauses.push('approved_by = ?', 'approved_at = NOW()');
			values.push(user?.id || null);
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
			resourceType: 'expense',
			resourceId: id,
			description: `Updated expense ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function DELETE(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const user = authResult.user;
		db = await dbConnect();

		const refusal = await refuseRecognizedCostEdit(db, id);
		if (refusal) return refusal;

		const [result] = await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND isDelete = 0`,
			[user?.id ?? null, id]
		);
		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Expense not found' },
				{ status: 404 }
			);
		}

		await logActivity({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'expense',
			resourceId: id,
			description: `Deleted expense ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
