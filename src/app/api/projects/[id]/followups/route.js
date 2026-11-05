import {
	loadLeadPolicy,
	projectAccessDeniedResponse,
	requireProjectAccess,
} from '@/lib/project-rights';

function denied() {
	return projectAccessDeniedResponse();
}

/** Discussion contribution is a section right, not a global update grant. */
function canWriteDiscussion(rights) {
	return (
		rights.canContribute &&
		(!rights.isLead || rights.sections.discussion.edit === true)
	);
}

async function withAccess(request, id, options) {
	const access = await requireProjectAccess(request, id, {
		getLeadPolicy: loadLeadPolicy,
		...options,
	});
	return access;
}

function releaseQuietly(db, ownsDb) {
	if (!ownsDb) return;
	try {
		db?.release?.();
	} catch {}
}

// GET follow-ups for a specific project
export async function GET(request, { params }) {
	const { id } = await params;
	if (!id) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}

	const access = await withAccess(request, id);
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!rights.sections.discussion.read) return denied();

		const [rows] = await db.execute(
			`SELECT * FROM project_followups 
       WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL)
       ORDER BY follow_up_date DESC, created_at DESC`,
			[project.project_id ?? project.id]
		);

		return Response.json({ success: true, data: rows });
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{ success: false, error: 'Failed to fetch follow-ups' },
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}

// POST - Create new follow-up for a project
export async function POST(request, { params }) {
	const { id } = await params;
	if (!id) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}

	let data;
	try {
		data = await request.json();
	} catch {
		return Response.json(
			{ success: false, error: 'Malformed request body' },
			{ status: 400 }
		);
	}

	const {
		follow_up_date,
		follow_up_type,
		description,
		status,
		priority,
		milestone,
		responsible_person,
		action_items,
		outcome,
		next_action,
		next_follow_up_date,
		blockers,
		notes,
		logged_by,
		created_by,
	} = data || {};

	if (!follow_up_date || !description) {
		return Response.json(
			{
				success: false,
				error: 'Follow-up date and description are required',
			},
			{ status: 400 }
		);
	}

	const access = await withAccess(request, id, { requireContribution: true });
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!canWriteDiscussion(rights)) return denied();

		const [result] = await db.execute(
			`INSERT INTO project_followups 
        (project_id, follow_up_date, follow_up_type, description, status, priority, milestone, 
         responsible_person, action_items, outcome, next_action, next_follow_up_date, blockers, notes, logged_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				project.project_id ?? project.id,
				follow_up_date,
				follow_up_type || 'Internal Review',
				description,
				status || 'Scheduled',
				priority || 'Medium',
				milestone || null,
				responsible_person || null,
				action_items || null,
				outcome || null,
				next_action || null,
				next_follow_up_date || null,
				blockers || null,
				notes || null,
				logged_by || null,
				created_by || null,
			]
		);

		return Response.json({
			success: true,
			message: 'Follow-up created successfully',
			id: result.insertId,
		});
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{ success: false, error: 'Failed to create follow-up' },
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}

// PUT - Update existing follow-up
export async function PUT(request, { params }) {
	const { id: projectId } = await params;
	if (!projectId) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}

	let data;
	try {
		data = await request.json();
	} catch {
		return Response.json(
			{ success: false, error: 'Malformed request body' },
			{ status: 400 }
		);
	}

	const { id: followupId, ...updateFields } = data || {};
	if (!followupId) {
		return Response.json(
			{ success: false, error: 'Follow-up ID is required' },
			{ status: 400 }
		);
	}

	const access = await withAccess(request, projectId, {
		requireContribution: true,
	});
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!canWriteDiscussion(rights)) return denied();

		// Build dynamic update query
		const allowedFields = [
			'follow_up_date',
			'follow_up_type',
			'description',
			'status',
			'priority',
			'milestone',
			'responsible_person',
			'action_items',
			'outcome',
			'next_action',
			'next_follow_up_date',
			'blockers',
			'notes',
			'logged_by',
		];

		const updates = [];
		const values = [];

		for (const field of allowedFields) {
			if (updateFields[field] !== undefined) {
				updates.push(`${field} = ?`);
				values.push(updateFields[field] || null);
			}
		}

		if (updates.length === 0) {
			return Response.json(
				{ success: false, error: 'No fields to update' },
				{ status: 400 }
			);
		}

		values.push(followupId, project.project_id ?? project.id);

		await db.execute(
			`UPDATE project_followups SET ${updates.join(', ')} WHERE id = ? AND project_id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			values
		);

		return Response.json({
			success: true,
			message: 'Follow-up updated successfully',
		});
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{ success: false, error: 'Failed to update follow-up' },
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}

// DELETE - Delete a follow-up
export async function DELETE(request, { params }) {
	const { id: projectId } = await params;
	const { searchParams } = new URL(request.url);
	const followupId = searchParams.get('followup_id');

	if (!projectId) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}
	if (!followupId) {
		return Response.json(
			{ success: false, error: 'Follow-up ID is required' },
			{ status: 400 }
		);
	}

	const access = await withAccess(request, projectId, {
		requireContribution: true,
	});
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!canWriteDiscussion(rights)) return denied();

		await db.execute(
			'UPDATE project_followups SET isDelete = 1 WHERE id = ? AND project_id = ? AND (isDelete = 0 OR isDelete IS NULL)',
			[followupId, project.project_id ?? project.id]
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
		releaseQuietly(db, ownsDb);
	}
}
