import { randomUUID } from 'crypto';
import {
	loadLeadPolicy,
	projectAccessDeniedResponse,
	requireProjectAccess,
} from '@/lib/project-rights';

function denied() {
	return projectAccessDeniedResponse();
}

function releaseQuietly(db, ownsDb) {
	if (!ownsDb) return;
	try {
		db?.release?.();
	} catch {}
}

function projectKey(project) {
	return project.project_id ?? project.id;
}

async function requireActivityAccess(request, id, options) {
	return requireProjectAccess(request, id, {
		getLeadPolicy: loadLeadPolicy,
		...options,
	});
}

// GET - Fetch all activities for a project
export async function GET(request, { params }) {
	const { id } = await params;
	if (!id) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}

	const access = await requireActivityAccess(request, id);
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!rights.sections.project_activity.read) return denied();

		const [activities] = await db.execute(
			`SELECT * FROM project_activities 
       WHERE project_id = ? 
       ORDER BY created_at DESC`,
			[projectKey(project)]
		);

		return Response.json({
			success: true,
			data: activities,
		});
	} catch (error) {
		console.error('GET project activities error:', error);
		return Response.json(
			{
				success: false,
				error: 'Failed to fetch project activities',
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}

// POST - Add new activity to project
export async function POST(request, { params }) {
	const { id } = await params;
	if (!id) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}

	const access = await requireActivityAccess(request, id);
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!rights.sections.project_activity.edit) return denied();

		const data = await request.json();

		const {
			activity_id,
			activity_name,
			discipline_id,
			discipline_name,
			start_date,
			end_date,
			manhours_planned,
			manhours_actual,
			status,
			progress_percentage,
			notes,
			save_to_master = false, // Flag to save as custom activity to master
		} = data;

		if (!activity_name) {
			return Response.json(
				{
					success: false,
					error: 'Activity name is required',
				},
				{ status: 400 }
			);
		}

		let finalActivityId = activity_id;
		let finalDisciplineId = discipline_id;

		// If save_to_master is true and this is a custom activity, save it to activities_master
		if (save_to_master && !activity_id && discipline_id) {
			try {
				const newActivityId = randomUUID();
				await db.execute(
					'INSERT INTO activities_master (id, function_id, activity_name) VALUES (?, ?, ?)',
					[newActivityId, discipline_id, activity_name]
				);
				finalActivityId = newActivityId;
				console.log(
					`✅ Saved custom activity "${activity_name}" to master with ID: ${newActivityId}`
				);
			} catch (masterError) {
				console.error(
					'Warning: Failed to save to activities_master:',
					masterError
				);
				// Continue anyway - we'll still save to project_activities
			}
		}

		// Create the project activity record
		const projectActivityId = randomUUID();
		await db.execute(
			`INSERT INTO project_activities (
        id, project_id, activity_id, activity_name,
        discipline_id, discipline_name,
        start_date, end_date,
        manhours_planned, manhours_actual,
        status, progress_percentage, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				projectActivityId,
				projectKey(project),
				finalActivityId || null,
				activity_name,
				finalDisciplineId || null,
				discipline_name || null,
				start_date || null,
				end_date || null,
				manhours_planned || 0,
				manhours_actual || 0,
				status || 'Pending',
				progress_percentage || 0,
				notes || null,
			]
		);

		return Response.json(
			{
				success: true,
				message: 'Activity added successfully',
				id: projectActivityId,
				activity_id: finalActivityId,
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('POST project activities error:', error);
		return Response.json(
			{
				success: false,
				error: 'Failed to add activity',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}

// PUT - Update existing project activity
export async function PUT(request, { params }) {
	const { id } = await params;
	if (!id) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}

	const access = await requireActivityAccess(request, id);
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!rights.sections.project_activity.edit) return denied();

		const data = await request.json();

		const {
			activity_record_id, // ID of the project_activities record
			activity_name,
			start_date,
			end_date,
			manhours_planned,
			manhours_actual,
			status,
			progress_percentage,
			notes,
		} = data;

		if (!activity_record_id) {
			return Response.json(
				{
					success: false,
					error: 'Activity record ID is required',
				},
				{ status: 400 }
			);
		}

		await db.execute(
			`UPDATE project_activities SET 
        activity_name = COALESCE(?, activity_name),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        manhours_planned = COALESCE(?, manhours_planned),
        manhours_actual = COALESCE(?, manhours_actual),
        status = COALESCE(?, status),
        progress_percentage = COALESCE(?, progress_percentage),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ?`,
			[
				activity_name || null,
				start_date || null,
				end_date || null,
				manhours_planned !== undefined ? manhours_planned : null,
				manhours_actual !== undefined ? manhours_actual : null,
				status || null,
				progress_percentage !== undefined ? progress_percentage : null,
				notes || null,
				activity_record_id,
				projectKey(project),
			]
		);

		return Response.json({
			success: true,
			message: 'Activity updated successfully',
		});
	} catch (error) {
		console.error('PUT project activities error:', error);
		return Response.json(
			{
				success: false,
				error: 'Failed to update activity',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}

// DELETE - Remove activity from project
export async function DELETE(request, { params }) {
	const { id } = await params;
	const { searchParams } = new URL(request.url);
	const activityRecordId = searchParams.get('activity_record_id');

	if (!id) {
		return Response.json(
			{ success: false, error: 'Project ID is required' },
			{ status: 400 }
		);
	}
	if (!activityRecordId) {
		return Response.json(
			{
				success: false,
				error: 'Activity record ID is required',
			},
			{ status: 400 }
		);
	}

	const access = await requireActivityAccess(request, id);
	if ('response' in access) return access.response;
	const { project, rights, db, ownsDb } = access;

	try {
		if (!rights.sections.project_activity.edit) return denied();

		await db.execute(
			'DELETE FROM project_activities WHERE id = ? AND project_id = ?',
			[activityRecordId, projectKey(project)]
		);

		return Response.json({
			success: true,
			message: 'Activity removed successfully',
		});
	} catch (error) {
		console.error('DELETE project activities error:', error);
		return Response.json(
			{
				success: false,
				error: 'Failed to remove activity',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db, ownsDb);
	}
}
