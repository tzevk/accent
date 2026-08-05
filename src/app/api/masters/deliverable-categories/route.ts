import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'deliverable_categories';

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.DELIVERABLES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT id, category_name, created_at FROM ${TABLE} WHERE isDelete = 0 ORDER BY category_name ASC`
		);
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching deliverable categories:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to fetch deliverable categories',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function POST(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.DELIVERABLES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { category_name } = await request.json();
		const name = String(category_name || '').trim();
		if (!name) {
			return NextResponse.json(
				{ success: false, error: 'Category name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		const [result] = await db.execute(
			`INSERT INTO ${TABLE} (category_name) VALUES (?)`,
			[name]
		);
		const insertId = result.insertId;

		logActivity({
			userId: authResult.user.id,
			actionType: 'create',
			resourceType: 'deliverable_categories',
			resourceId: insertId,
			description: 'Created deliverable category: ' + name,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({
			success: true,
			data: { id: insertId, category_name: name },
		});
	} catch (error) {
		console.error('Error creating deliverable category:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to create deliverable category',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
