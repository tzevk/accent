import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'deliverable_categories';

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
			`UPDATE ${TABLE} SET category_name = ? WHERE id = ? AND isDelete = 0`,
			[name, id]
		);
		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Deliverable category not found' },
				{ status: 404 }
			);
		}

		logActivity({
			userId: authResult.user.id,
			actionType: 'update',
			resourceType: 'deliverable_categories',
			resourceId: Number(id),
			description: 'Updated deliverable category: ' + name,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({
			success: true,
			data: { id, category_name: name },
		});
	} catch (error) {
		console.error('Error updating deliverable category:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to update deliverable category',
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
				{ success: false, error: 'Deliverable category not found' },
				{ status: 404 }
			);
		}

		logActivity({
			userId: authResult.user.id,
			actionType: 'delete',
			resourceType: 'deliverable_categories',
			resourceId: Number(id),
			description: 'Deleted deliverable category id ' + id,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting deliverable category:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to delete deliverable category',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
