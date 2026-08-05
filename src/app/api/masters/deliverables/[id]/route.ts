import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'deliverables_master';

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.DELIVERABLES,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
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
			`UPDATE ${TABLE} SET deliverable_name = ? WHERE id = ? AND isDelete = 0`,
			[name, id]
		);
		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Deliverable not found' },
				{ status: 404 }
			);
		}

		logActivity({
			userId: authResult.user.id,
			actionType: 'update',
			resourceType: 'deliverables_master',
			resourceId: Number(id),
			description: 'Updated deliverable: ' + name,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({
			success: true,
			data: { id, deliverable_name: name },
		});
	} catch (error) {
		console.error('Error updating deliverable:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to update deliverable',
			},
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
	const authResult = await ensurePermission(
		request,
		RESOURCES.DELIVERABLES,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		db = await dbConnect();
		const [result] = await db.execute(
			`UPDATE ${TABLE} SET isDelete = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND isDelete = 0`,
			[authResult.user.id, id]
		);
		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Deliverable not found' },
				{ status: 404 }
			);
		}

		logActivity({
			userId: authResult.user.id,
			actionType: 'delete',
			resourceType: 'deliverables_master',
			resourceId: Number(id),
			description: 'Deleted deliverable id ' + id,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting deliverable:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to delete deliverable',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
