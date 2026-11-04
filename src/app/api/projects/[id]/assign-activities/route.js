import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { randomUUID } from 'crypto';
import {
	ASSIGNEE_NOT_PROJECT_MEMBER,
	PROJECT_ACCESS_DENIED,
	assigneeNotMemberMessage,
	findNonMemberTargets,
	requireProjectAccess,
} from '@/lib/project-rights';

/** The one 409 body for a target who is not on the project team. */
function assigneeConflict(name) {
	return NextResponse.json(
		{
			success: false,
			code: ASSIGNEE_NOT_PROJECT_MEMBER,
			error: assigneeNotMemberMessage(name),
		},
		{ status: 409 }
	);
}

function forbidden() {
	return NextResponse.json(
		{ success: false, error: PROJECT_ACCESS_DENIED },
		{ status: 403 }
	);
}

function projectKey(project) {
	const value = project?.project_id ?? project?.id;
	return value === null || value === undefined ? null : value;
}

function releaseQuietly(db) {
	if (!db) return;
	try {
		db.release();
	} catch {}
}

/**
 * Resolve the display identity of every requested assignee in one query so
 * membership can match id or email. A missing user row is not an error here:
 * the stored team list is the membership source.
 */
async function loadAssignmentTargets(db, userIds) {
	const ids = [
		...new Set(
			(userIds || [])
				.map((value) => Number(value))
				.filter((value) => Number.isFinite(value) && value > 0)
		),
	];
	if (ids.length === 0) return [];

	const placeholders = ids.map(() => '?').join(', ');
	const [rows] = await db.execute(
		`SELECT id, full_name, username, email FROM users WHERE id IN (${placeholders})`,
		ids
	);
	const byId = new Map((rows || []).map((row) => [String(row.id), row]));

	return ids.map((id) => {
		const row = byId.get(String(id));
		return {
			userId: id,
			email: row?.email ?? null,
			name: row?.full_name || row?.username || row?.email || null,
		};
	});
}

/** Membership pre-pass: no write happens when any target is a non-member. */
async function firstNonMember(db, project, targets) {
	const identities = await loadAssignmentTargets(
		db,
		targets.map((target) => target.userId)
	);
	const targetsWithIdentity = targets.map((target) => {
		const identity = identities.find(
			(candidate) => String(candidate.userId) === String(target.userId)
		);
		return {
			...target,
			email: identity?.email ?? target.email ?? null,
			name: identity?.name ?? target.name ?? null,
		};
	});
	const nonMembers = findNonMemberTargets(
		project?.project_team,
		targetsWithIdentity
	);
	return nonMembers[0] || null;
}

/**
 * POST /api/projects/[id]/assign-activities
 * Bulk assign activities to team members in a project
 *
 * Request body:
 * {
 *   activities: [
 *     {
 *       user_id: number,
 *       employee_id?: number,
 *       activity_name: string,
 *       activity_id?: string,
 *       discipline_name?: string,
 *       discipline_id?: string,
 *       due_date?: string,
 *       priority?: 'Low' | 'Medium' | 'High' | 'Critical',
 *       estimated_hours?: number,
 *       notes?: string
 *     }
 *   ]
 * }
 */
export async function POST(request, { params }) {
	let db;
	try {
		db = await dbConnect();
		const { id } = await params;
		const access = await requireProjectAccess(request, id, { db });
		if ('response' in access) return access.response;
		if (!access.rights.canAssignActivity) return forbidden();

		const projectId = projectKey(access.project);
		const currentUser = access.user;
		const data = await request.json();

		const assignments = data?.activities ?? data?.assignments;

		if (
			!assignments ||
			!Array.isArray(assignments) ||
			assignments.length === 0
		) {
			return NextResponse.json(
				{
					success: false,
					error: 'Assignments array is required and must not be empty',
				},
				{ status: 400 }
			);
		}

		// Membership is checked for every target before the first write. A
		// non-member blocks the whole batch and no team row is touched.
		const targets = assignments
			.filter(
				(assignment) =>
					assignment &&
					assignment.user_id !== null &&
					assignment.user_id !== undefined &&
					assignment.user_id !== ''
			)
			.map((assignment) => ({ userId: assignment.user_id }));
		const nonMember = await firstNonMember(
			db,
			access.project,
			targets
		);
		if (nonMember) return assigneeConflict(nonMember.name);

		const project = access.project;
		const assignmentIds = [];
		const errors = [];

		// Process each assignment
		for (let i = 0; i < assignments.length; i++) {
			const assignment = assignments[i];

			try {
				// Validate required fields
				if (!assignment.user_id) {
					errors.push({ index: i, error: 'user_id is required' });
					continue;
				}

				if (!assignment.activity_name) {
					errors.push({ index: i, error: 'activity_name is required' });
					continue;
				}

				// Verify user exists and is active
				const [userCheck] = await db.execute(
					'SELECT id, username FROM users WHERE id = ? AND is_active = 1',
					[assignment.user_id]
				);

				if (userCheck.length === 0) {
					errors.push({
						index: i,
						error: `User ${assignment.user_id} not found or inactive`,
					});
					continue;
				}

				// Check if similar assignment already exists (same user, project, activity)
				const [existingCheck] = await db.execute(
					`SELECT id FROM user_activity_assignments 
           WHERE user_id = ? AND project_id = ? AND activity_name = ? 
           AND status NOT IN ('Completed', 'Cancelled')`,
					[assignment.user_id, projectId, assignment.activity_name]
				);

				if (existingCheck.length > 0) {
					errors.push({
						index: i,
						error: `Active assignment already exists for user ${assignment.user_id} and activity "${assignment.activity_name}"`,
						existing_id: existingCheck[0].id,
					});
					continue;
				}

				// Create the assignment
				const assignmentId = randomUUID();

				await db.execute(
					`
          INSERT INTO user_activity_assignments (
            id, user_id, employee_id, project_id, activity_id, activity_name,
            discipline_id, discipline_name, assigned_by, due_date, priority,
            estimated_hours, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
					[
						assignmentId,
						assignment.user_id,
						assignment.employee_id || null,
						projectId,
						assignment.activity_id || null,
						assignment.activity_name,
						assignment.discipline_id || null,
						assignment.discipline_name || null,
						currentUser.id,
						assignment.due_date || null,
						assignment.priority || 'Medium',
						assignment.estimated_hours || null,
						assignment.notes || null,
					]
				);

				// Log the assignment in activity_updates
				const updateId = randomUUID();
				await db.execute(
					`
          INSERT INTO activity_updates (
            id, activity_assignment_id, updated_by, update_type, new_value, comment
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
					[
						updateId,
						assignmentId,
						currentUser.id,
						'assigned',
						JSON.stringify({
							activity_name: assignment.activity_name,
							due_date: assignment.due_date,
							priority: assignment.priority || 'Medium',
							project_title: project.project_title,
						}),
						`Assigned from project ${project.project_title}`,
					]
				);

				assignmentIds.push(assignmentId);
			} catch (error) {
				console.error(`Error processing assignment ${i}:`, error);
				errors.push({
					index: i,
					error: error.message || 'Unknown error occurred',
				});
			}
		}

		const successCount = assignmentIds.length;
		const errorCount = errors.length;

		if (successCount === 0 && errorCount > 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'All assignments failed',
					errors,
					assigned: 0,
					failed: errorCount,
				},
				{ status: 400 }
			);
		}

		return NextResponse.json(
			{
				success: true,
				message: `Successfully assigned ${successCount} activities`,
				data: { assignment_ids: assignmentIds },
				assigned: successCount,
				failed: errorCount,
				errors: errorCount > 0 ? errors : undefined,
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('POST assign activities error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to assign activities',
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db);
	}
}

/**
 * GET /api/projects/[id]/assign-activities
 * Get all activity assignments for a project
 * Useful for viewing who is assigned to what in the project
 */
export async function GET(request, { params }) {
	let db;
	try {
		const auth = await ensurePermission(
			request,
			RESOURCES.PROJECTS,
			PERMISSIONS.READ
		);
		if (!auth.authorized)
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);

		const { id } = await params;
		const projectId = parseInt(id);

		db = await dbConnect();

		const [assignments] = await db.execute(
			`
      SELECT 
        uaa.*,
        u.username,
        u.full_name,
        e.first_name,
        e.last_name,
        e.position,
        assignedBy.username as assigned_by_username,
        assignedBy.full_name as assigned_by_full_name
      FROM user_activity_assignments uaa
      LEFT JOIN users u ON uaa.user_id = u.id
      LEFT JOIN employees e ON uaa.employee_id = e.id
      LEFT JOIN users assignedBy ON uaa.assigned_by = assignedBy.id
      WHERE uaa.project_id = ?
      ORDER BY uaa.due_date ASC, u.full_name ASC
    `,
			[projectId]
		);

		// Group by user for easier display
		const groupedByUser = assignments.reduce((acc, assignment) => {
			const userId = assignment.user_id;
			if (!acc[userId]) {
				acc[userId] = {
					user_id: userId,
					username: assignment.username,
					full_name: assignment.full_name,
					position: assignment.position,
					assignments: [],
				};
			}
			acc[userId].assignments.push(assignment);
			return acc;
		}, {});

		return NextResponse.json({
			success: true,
			data: {
				assignments,
				grouped_by_user: Object.values(groupedByUser),
				total: assignments.length,
			},
		});
	} catch (error) {
		console.error('GET project assignments error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch project assignments',
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db);
	}
}

/**
 * PUT /api/projects/[id]/assign-activities
 * Reassign or update existing assignments in bulk
 */
export async function PUT(request, { params }) {
	let db;
	try {
		db = await dbConnect();
		const { id } = await params;
		const access = await requireProjectAccess(request, id, { db });
		if ('response' in access) return access.response;
		if (!access.rights.canAssignActivity) return forbidden();

		const projectId = projectKey(access.project);
		const currentUser = access.user;
		const data = await request.json();

		const { updates } = data;

		if (!updates || !Array.isArray(updates) || updates.length === 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'Updates array is required',
				},
				{ status: 400 }
			);
		}

		// Every new target assignee must already be on the team before any
		// assignment changes.
		const targets = updates
			.filter(
				(update) =>
					update &&
					update.user_id !== null &&
					update.user_id !== undefined &&
					update.user_id !== ''
			)
			.map((update) => ({ userId: update.user_id }));
		const nonMember = await firstNonMember(
			db,
			access.project,
			targets
		);
		if (nonMember) return assigneeConflict(nonMember.name);

		const updateCount = [];
		const errors = [];

		for (let i = 0; i < updates.length; i++) {
			const update = updates[i];

			try {
				if (!update.assignment_id) {
					errors.push({ index: i, error: 'assignment_id is required' });
					continue;
				}

				const updateFields = [];
				const values = [];

				if (update.user_id) {
					updateFields.push('user_id = ?');
					values.push(update.user_id);
				}
				if (update.due_date !== undefined) {
					updateFields.push('due_date = ?');
					values.push(update.due_date);
				}
				if (update.priority) {
					updateFields.push('priority = ?');
					values.push(update.priority);
				}
				if (update.estimated_hours !== undefined) {
					updateFields.push('estimated_hours = ?');
					values.push(update.estimated_hours);
				}
				if (update.notes !== undefined) {
					updateFields.push('notes = ?');
					values.push(update.notes);
				}

				if (updateFields.length === 0) {
					errors.push({ index: i, error: 'No fields to update' });
					continue;
				}

				updateFields.push('updated_at = CURRENT_TIMESTAMP');
				values.push(update.assignment_id, projectId);

				const [result] = await db.execute(
					`UPDATE user_activity_assignments 
           SET ${updateFields.join(', ')} 
           WHERE id = ? AND project_id = ?`,
					values
				);

				if (result.affectedRows > 0) {
					// Log the update
					const updateId = randomUUID();
					await db.execute(
						`
            INSERT INTO activity_updates (
              id, activity_assignment_id, updated_by, update_type, new_value
            ) VALUES (?, ?, ?, ?, ?)
          `,
						[
							updateId,
							update.assignment_id,
							currentUser.id,
							'reassigned',
							JSON.stringify(update),
						]
					);

					updateCount.push(update.assignment_id);
				} else {
					errors.push({
						index: i,
						error: 'Assignment not found or not in this project',
					});
				}
			} catch (error) {
				errors.push({ index: i, error: error.message });
			}
		}

		return NextResponse.json({
			success: true,
			message: `Updated ${updateCount.length} assignments`,
			updated: updateCount.length,
			failed: errors.length,
			errors: errors.length > 0 ? errors : undefined,
		});
	} catch (error) {
		console.error('PUT update assignments error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update assignments',
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db);
	}
}

/**
 * DELETE /api/projects/[id]/assign-activities?assignment_id=xxx
 * Remove an activity assignment from a project
 */
export async function DELETE(request, { params }) {
	let db;
	try {
		db = await dbConnect();
		const { id } = await params;
		const access = await requireProjectAccess(request, id, { db });
		if ('response' in access) return access.response;
		if (!access.rights.canAssignActivity) return forbidden();

		const projectId = projectKey(access.project);
		const { searchParams } = new URL(request.url);
		const assignmentId = searchParams.get('assignment_id');

		if (!assignmentId) {
			return NextResponse.json(
				{
					success: false,
					error: 'assignment_id query parameter is required',
				},
				{ status: 400 }
			);
		}

		const [result] = await db.execute(
			'DELETE FROM user_activity_assignments WHERE id = ? AND project_id = ?',
			[assignmentId, projectId]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'Assignment not found or not in this project',
				},
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Assignment removed successfully',
		});
	} catch (error) {
		console.error('DELETE assignment error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete assignment',
			},
			{ status: 500 }
		);
	} finally {
		releaseQuietly(db);
	}
}
