import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'payment_receivables';

export async function GET(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

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
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function PUT(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.UPDATE
	);
	if (authResult.authorized === false) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const body = await request.json();
		const user = authResult.user;

		db = await dbConnect();

		const fields = [
			'invoice_number',
			'invoice_id',
			'client_name',
			'client_email',
			'client_phone',
			'invoice_date',
			'due_date',
			'invoice_amount',
			'paid_amount',
			'balance_due',
			'currency',
			'project_id',
			'po_number',
			'payment_terms',
			'last_follow_up_date',
			'next_follow_up_date',
			'notes',
			'status',
			'received_date',
			'payment_mode',
			'transaction_reference',
			'assigned_to',
		];
		const setClauses = [];
		const values = [];
		for (const f of fields) {
			if (body[f] !== undefined) {
				setClauses.push(`${f} = ?`);
				values.push(body[f]);
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
			`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = ?`,
			values
		);

		await logActivity({
			userId: user?.id,
			actionType: 'update',
			resourceType: 'payment_receivable',
			resourceId: id,
			description: `Updated receivable ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function DELETE(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.DELETE
	);
	if (authResult.authorized === false) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const user = authResult.user;
		db = await dbConnect();
		await db.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);

		await logActivity({
			userId: user?.id,
			actionType: 'delete',
			resourceType: 'payment_receivable',
			resourceId: id,
			description: `Deleted receivable ${id}`,
			request,
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
