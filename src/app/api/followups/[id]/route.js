import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// GET specific follow-up by ID
export async function GET(request, { params }) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = params;

		if (!id || isNaN(parseInt(id))) {
			return Response.json(
				{ success: false, error: 'Valid follow-up ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT f.*, l.company_name, l.contact_name, l.contact_email, l.phone
       FROM follow_ups f
       JOIN leads l ON f.lead_id = l.id
       WHERE f.id = ?`,
			[id]
		);

		if (!rows || rows.length === 0) {
			return Response.json(
				{ success: false, error: 'Follow-up not found' },
				{ status: 404 }
			);
		}

		return Response.json({ success: true, data: rows[0] });
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{ success: false, error: 'Failed to fetch follow-up' },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

// PUT - Update follow-up
export async function PUT(request, { params }) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = params;
		const data = await request.json();

		if (!id || isNaN(parseInt(id))) {
			return Response.json(
				{ success: false, error: 'Valid follow-up ID is required' },
				{ status: 400 }
			);
		}

		const {
			follow_up_date,
			follow_up_type,
			description,
			status,
			next_action,
			next_follow_up_date,
			notes,
		} = data;

		if (!follow_up_date || !description) {
			return Response.json(
				{
					success: false,
					error: 'follow_up_date and description are required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// Check if follow-up exists
		const [existingRows] = await db.execute(
			'SELECT id FROM follow_ups WHERE id = ? AND isDelete = 0',
			[id]
		);
		if (!existingRows || existingRows.length === 0) {
			return Response.json(
				{ success: false, error: 'Follow-up not found' },
				{ status: 404 }
			);
		}

		// Update follow-up
		await db.execute(
			`UPDATE follow_ups SET 
        follow_up_date = ?, 
        follow_up_type = ?, 
        description = ?,
        status = ?, 
        next_action = ?, 
        next_follow_up_date = ?, 
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND isDelete = 0`,
			[
				follow_up_date,
				follow_up_type || 'Call',
				description,
				status || 'Scheduled',
				next_action || null,
				next_follow_up_date || null,
				notes || null,
				id,
			]
		);

		// Return the updated follow-up with lead info
		const [rows] = await db.execute(
			`SELECT f.*, l.company_name, l.contact_name, l.contact_email, l.phone
       FROM follow_ups f
       JOIN leads l ON f.lead_id = l.id
       WHERE f.id = ? AND f.isDelete = 0`,
			[id]
		);

		const updated = rows && rows[0] ? rows[0] : { id: parseInt(id) };

		return Response.json({
			success: true,
			data: updated,
			message: 'Follow-up updated successfully',
		});
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{ success: false, error: 'Failed to update follow-up' },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

// DELETE - Delete follow-up
export async function DELETE(request, { params }) {
	// RBAC check
	const authResultDel = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.DELETE
	);
	if (authResultDel instanceof Response) return authResultDel;
	if (!authResultDel.authorized) return authResultDel.response;

	let db;
	try {
		const { id } = params;

		if (!id || isNaN(parseInt(id))) {
			return Response.json(
				{ success: false, error: 'Valid follow-up ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// Check if follow-up exists
		const [existingRows] = await db.execute(
			'SELECT id FROM follow_ups WHERE id = ? AND isDelete = 0',
			[id]
		);
		if (!existingRows || existingRows.length === 0) {
			return Response.json(
				{ success: false, error: 'Follow-up not found' },
				{ status: 404 }
			);
		}

		// Soft delete follow-up
		await db.execute(
			'UPDATE follow_ups SET isDelete = 1 WHERE id = ? AND isDelete = 0',
			[id]
		);

		return Response.json({
			success: true,
			message: 'Follow-up deleted successfully',
		});
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{ success: false, error: 'Failed to delete follow-up' },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
