import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'outgoing_quotations';

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
			'quotation_date',
			'vendor_name',
			'vendor_email',
			'vendor_phone',
			'vendor_address',
			'subject',
			'subtotal',
			'tax_rate',
			'tax_amount',
			'discount',
			'total',
			'valid_until',
			'notes',
			'terms',
			'status',
			'project_id',
		];
		const setClauses = [];
		const values = [];
		for (const f of fields) {
			if (body[f] !== undefined) {
				setClauses.push(`${f} = ?`);
				values.push(body[f]);
			}
		}
		if (body.items !== undefined) {
			setClauses.push('items = ?');
			values.push(JSON.stringify(body.items));
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
			resourceType: 'outgoing_quotation',
			resourceId: id,
			description: `Updated outgoing quotation ${id}`,
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
			resourceType: 'outgoing_quotation',
			resourceId: id,
			description: `Deleted outgoing quotation ${id}`,
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
