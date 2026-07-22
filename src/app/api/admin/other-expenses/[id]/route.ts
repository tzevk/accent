/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'other_expenses';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: any;
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
	} catch (error: any) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: any;
	try {
		const { id } = await params;
		const body = await request.json();
		const user = authResult.user;

		db = await dbConnect();

		const fields = [
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
			'description',
			'status',
		];
		const setClauses: string[] = [];
		const values: (string | number | null)[] = [];

		for (const f of fields) {
			if (body[f] !== undefined) {
				setClauses.push(`${f} = ?`);
				values.push(body[f]);
			}
		}

		if (body.bill_amount !== undefined || body.gst_amount !== undefined) {
			setClauses.push('net_amount = ?');
			const bAmt =
				body.bill_amount !== undefined ? Number(body.bill_amount) : null;
			const gAmt =
				body.gst_amount !== undefined ? Number(body.gst_amount) : null;
			if (bAmt !== null && gAmt !== null) {
				values.push(bAmt + gAmt);
			} else if (bAmt !== null) {
				const [rows] = await db.execute(
					`SELECT gst_amount FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
					[id]
				);
				if (rows.length > 0) {
					values.push(bAmt + Number(rows[0].gst_amount || 0));
				}
			} else if (gAmt !== null) {
				const [rows] = await db.execute(
					`SELECT bill_amount FROM ${TABLE} WHERE id = ? AND isDelete = 0`,
					[id]
				);
				if (rows.length > 0) {
					values.push(Number(rows[0].bill_amount || 0) + gAmt);
				}
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

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'update',
			resourceType: 'other_expense',
			resourceId: id as any,
			description: `Updated other expense ${id}`,
			request: request as any,
		});

		return NextResponse.json({ success: true });
	} catch (error: any) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: any;
	try {
		const { id } = await params;
		const user = authResult.user;
		db = await dbConnect();
		await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1 WHERE id = ? AND isDelete = 0`,
			[id]
		);

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'other_expense',
			resourceId: id as any,
			description: `Deleted other expense ${id}`,
			request: request as any,
		});

		return NextResponse.json({ success: true });
	} catch (error: any) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
