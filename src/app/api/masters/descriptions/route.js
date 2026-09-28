import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// GET - List all descriptions
export async function GET(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	let db;
	try {
		db = await dbConnect();

		const [rows] = await db.execute(`
      SELECT * FROM description_master 
      ORDER BY description_name ASC
    `);

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching descriptions:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch descriptions' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// POST - Create new description
export async function POST(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;

	let db;
	try {
		const body = await request.json();
		const { description_name, is_active = true } = body;

		if (!description_name?.trim()) {
			return NextResponse.json(
				{ success: false, error: 'Description name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [result] = await db.execute(
			`INSERT INTO description_master (description_name, is_active, created_by) VALUES (?, ?, ?)`,
			[description_name.trim(), is_active ? 1 : 0, auth.user.id]
		);

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, description_name, is_active },
		});
	} catch (error) {
		console.error('Error creating description:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to create description' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// PUT - Update description
export async function PUT(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
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
		const { description_name, is_active } = body;

		if (!description_name?.trim()) {
			return NextResponse.json(
				{ success: false, error: 'Description name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		await db.execute(
			`UPDATE description_master SET description_name = ?, is_active = ? WHERE id = ?`,
			[description_name.trim(), is_active ? 1 : 0, id]
		);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error updating description:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update description' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// DELETE - Delete description
export async function DELETE(request) {
	// RBAC check
	const auth = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
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
		await db.execute('DELETE FROM description_master WHERE id = ?', [id]);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting description:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete description' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
