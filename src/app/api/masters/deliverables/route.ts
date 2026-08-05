import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'deliverables_master';

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
			`SELECT id, deliverable_name, created_at FROM ${TABLE} WHERE isDelete = 0 ORDER BY deliverable_name ASC`
		);
		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching deliverables:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to fetch deliverables',
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
		const { deliverable_name } = await request.json();
		const name = String(deliverable_name || '').trim();
		if (!name) {
			return NextResponse.json(
				{ success: false, error: 'Deliverable name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		const [result] = await db.execute(
			`INSERT INTO ${TABLE} (deliverable_name) VALUES (?)`,
			[name]
		);
		const insertId = result.insertId;

		logActivity({
			userId: authResult.user.id,
			actionType: 'create',
			resourceType: 'deliverables_master',
			resourceId: insertId,
			description: 'Created deliverable: ' + name,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({
			success: true,
			data: { id: insertId, deliverable_name: name },
		});
	} catch (error) {
		console.error('Error creating deliverable:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to create deliverable',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
