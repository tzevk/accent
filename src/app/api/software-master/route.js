import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		db = await dbConnect();

		const [cats] = await db.execute(
			'SELECT id, name, description, status, created_at, updated_at FROM software_categories WHERE isDelete = 0 ORDER BY name'
		);
		let softwares = [];
		try {
			const [sws] = await db.execute(
				'SELECT id, category_id, name, provider, created_at, updated_at FROM softwares WHERE isDelete = 0 ORDER BY name'
			);
			softwares = sws;
		} catch {
			softwares = [];
		}

		let versions = [];
		try {
			const [vers] = await db.execute(
				'SELECT id, software_id, name, release_date, notes, created_at, updated_at FROM software_versions WHERE isDelete = 0 ORDER BY name'
			);
			versions = vers;
		} catch {
			versions = [];
		}

		const mapped = cats.map((cat) => ({
			id: cat.id,
			name: cat.name,
			description: cat.description,
			status: cat.status,
			created_at: cat.created_at,
			updated_at: cat.updated_at,
			softwares: (softwares.filter((s) => s.category_id === cat.id) || []).map(
				(s) => ({
					id: s.id,
					name: s.name,
					provider: s.provider,
					created_at: s.created_at,
					updated_at: s.updated_at,
					versions: (
						versions.filter((v) => String(v.software_id) === String(s.id)) || []
					).map((v) => ({
						id: v.id,
						name: v.name,
						release_date: v.release_date,
						notes: v.notes,
					})),
				})
			),
		}));

		return NextResponse.json({ success: true, data: mapped });
	} catch (error) {
		console.error('Software master GET error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to load software master',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch (e) {
				console.error('Error releasing connection:', e);
			}
		}
	}
}

export async function POST(request) {
	// RBAC check
	const authResultPost = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
		PERMISSIONS.UPDATE
	);
	if (authResultPost instanceof Response) return authResultPost;
	if (!authResultPost.authorized) return authResultPost.response;

	let db;
	try {
		const body = await request.json();
		const { name, description = '', status = 'active' } = body;
		if (!name)
			return NextResponse.json(
				{ success: false, error: 'Category name is required' },
				{ status: 400 }
			);

		const id = randomUUID();
		db = await dbConnect();

		await db.execute(
			'INSERT INTO software_categories (id, name, description, status) VALUES (?, ?, ?, ?)',
			[id, name, description, status]
		);

		return NextResponse.json({ success: true, data: { id } }, { status: 201 });
	} catch (error) {
		console.error('Software master POST error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to create category',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function PUT(request) {
	// RBAC check
	const authResultPut = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
		PERMISSIONS.UPDATE
	);
	if (authResultPut instanceof Response) return authResultPut;
	if (!authResultPut.authorized) return authResultPut.response;

	let db;
	try {
		const body = await request.json();
		const { id, name, description, status } = body;
		if (!id)
			return NextResponse.json(
				{ success: false, error: 'Category id is required' },
				{ status: 400 }
			);

		db = await dbConnect();
		await db.execute(
			`UPDATE software_categories SET name = COALESCE(?, name), description = COALESCE(?, description), status = COALESCE(?, status) WHERE id = ? AND isDelete = 0`,
			[name ?? null, description ?? null, status ?? null, id]
		);

		return NextResponse.json({ success: true, message: 'Category updated' });
	} catch (error) {
		console.error('Software master PUT error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update category',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function DELETE(request) {
	// RBAC check
	const authResultDel = await ensurePermission(
		request,
		RESOURCES.SETTINGS,
		PERMISSIONS.DELETE
	);
	if (authResultDel instanceof Response) return authResultDel;
	if (!authResultDel.authorized) return authResultDel.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');
		if (!id)
			return NextResponse.json(
				{ success: false, error: 'Category id is required' },
				{ status: 400 }
			);

		db = await dbConnect();
		try {
			await db.execute(
				'UPDATE software_versions SET isDelete = 1 WHERE software_id IN (SELECT id FROM softwares WHERE category_id = ?)',
				[id]
			);
		} catch {}
		try {
			await db.execute(
				'UPDATE softwares SET isDelete = 1 WHERE category_id = ?',
				[id]
			);
		} catch {
			// ignore
		}
		await db.execute(
			'UPDATE software_categories SET isDelete = 1 WHERE id = ?',
			[id]
		);

		return NextResponse.json({ success: true, message: 'Category deleted' });
	} catch (error) {
		console.error('Software master DELETE error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete category',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}
