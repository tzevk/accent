import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

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
      SELECT * FROM category_master
      ORDER BY category_name ASC
    `);

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching categories:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch categories' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

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
		const { category_name, is_active = true } = body;

		if (!category_name?.trim()) {
			return NextResponse.json(
				{ success: false, error: 'Category name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [result] = await db.execute(
			`INSERT INTO category_master (category_name, is_active, created_by) VALUES (?, ?, ?)`,
			[category_name.trim(), is_active ? 1 : 0, auth.user.id]
		);

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, category_name, is_active },
		});
	} catch (error) {
		console.error('Error creating category:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to create category' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

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
		const { category_name, is_active } = body;

		if (!category_name?.trim()) {
			return NextResponse.json(
				{ success: false, error: 'Category name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		await db.execute(
			`UPDATE category_master SET category_name = ?, is_active = ? WHERE id = ?`,
			[category_name.trim(), is_active ? 1 : 0, id]
		);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error updating category:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update category' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

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
		await db.execute('DELETE FROM category_master WHERE id = ?', [id]);

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting category:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete category' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
