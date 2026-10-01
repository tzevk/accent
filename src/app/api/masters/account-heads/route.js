import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// GET - List all account heads
export async function GET(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.ACCOUNTS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	let db;
	try {
		db = await dbConnect();

		const [rows] = await db.execute(`
      SELECT * FROM account_head_master 
      ORDER BY account_head_name ASC
    `);

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching account heads:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch account heads' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// POST - Create new account head
export async function POST(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.ACCOUNTS,
		PERMISSIONS.CREATE
	);
	if (auth instanceof Response) return auth;

	let db;
	try {
		const body = await request.json();
		const { account_head_name, is_active = true } = body;

		if (!account_head_name?.trim()) {
			return NextResponse.json(
				{ success: false, error: 'Account head name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [result] = await db.execute(
			`INSERT INTO account_head_master (account_head_name, is_active, created_by) VALUES (?, ?, ?)`,
			[account_head_name.trim(), is_active ? 1 : 0, auth.user.id]
		);

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, account_head_name, is_active },
		});
	} catch (error) {
		console.error('Error creating account head:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to create account head' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// PUT - Update account head
export async function PUT(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.ACCOUNTS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		const body = await request.json();
		const { account_head_name, is_active } = body;

		if (!account_head_name?.trim()) {
			return NextResponse.json(
				{ success: false, error: 'Account head name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		await db.execute(
			`UPDATE account_head_master SET account_head_name = ?, is_active = ? WHERE id = ?`,
			[account_head_name.trim(), is_active ? 1 : 0, id]
		);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error updating account head:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update account head' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// DELETE - Delete account head
export async function DELETE(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.ACCOUNTS,
		PERMISSIONS.DELETE
	);
	if (auth instanceof Response) return auth;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		await db.execute('DELETE FROM account_head_master WHERE id = ?', [id]);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting account head:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete account head' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
