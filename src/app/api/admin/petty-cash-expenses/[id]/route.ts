/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'petty_cash_expenses';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let db: any;
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
	} catch (error: any) {
		return NextResponse.json(
			{ success: false, error: error.message },
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
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.UPDATE
	);
	if (authResult.authorized === false) return authResult.response;

	let db: any;
	try {
		const { id } = await params;
		const body = await request.json();
		const user = authResult.user;

		db = await dbConnect();

		const fields = [
			'transaction_date',
			'transaction_type',
			'expense_category',
			'description',
			'amount',
			'payment_mode',
			'payment_reference',
			'recipient_name',
			'custodian_employee_id',
			'custodian_employee_name',
			'bill_no',
			'bill_date',
			'notes',
			'status',
		];
		const setClauses: string[] = [];
		const values: (string | number | null)[] = [];

		for (const f of fields) {
			if (body[f] !== undefined) {
				setClauses.push(`${f} = ?`);
				values.push(f === 'amount' ? Math.abs(Number(body[f])) : body[f]);
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
			`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = ?`,
			values
		);

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'update',
			resourceType: 'petty_cash_expense',
			resourceId: id as any,
			description: `Updated petty cash expense ${id}`,
			request: request as any,
		});

		return NextResponse.json({ success: true });
	} catch (error: any) {
		return NextResponse.json(
			{ success: false, error: error.message },
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
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.DELETE
	);
	if (authResult.authorized === false) return authResult.response;

	let db: any;
	try {
		const { id } = await params;
		const user = authResult.user;
		db = await dbConnect();
		await db.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'petty_cash_expense',
			resourceId: id as any,
			description: `Deleted petty cash expense ${id}`,
			request: request as any,
		});

		return NextResponse.json({ success: true });
	} catch (error: any) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
