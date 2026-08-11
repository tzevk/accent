import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { randomUUID } from 'crypto';
import { isUserInProjectTeam } from '@/utils/project-access';
import {
	fetchExistingDayHours,
	validateDayHours,
} from '@/utils/activity-daily-hours';

async function generateTicketNumber(connection) {
	const year = new Date().getFullYear();
	const month = String(new Date().getMonth() + 1).padStart(2, '0');
	const prefix = `TKT-${year}${month}-`;
	const [rows] = await connection.execute(
		`SELECT ticket_number FROM support_tickets
     WHERE ticket_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
		[`${prefix}%`]
	);

	let nextNum = 1;
	if (rows.length > 0) {
		const lastNum = parseInt(
			String(rows[0].ticket_number).split('-').pop(),
			10
		);
		nextNum = Number.isFinite(lastNum) ? lastNum + 1 : 1;
	}

	return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

async function resolveProjectManager(connection, projectManagerValue) {
	if (!projectManagerValue) return null;
	const raw = String(projectManagerValue).trim();
	if (!raw) return null;

	if (/^\d+$/.test(raw)) {
		const [rowsById] = await connection.execute(
			'SELECT id, full_name, email FROM users WHERE id = ? LIMIT 1',
			[parseInt(raw, 10)]
		);
		if (rowsById.length > 0) return rowsById[0];
	}

	const [rowsByEmail] = await connection.execute(
		'SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
		[raw]
	);
	if (rowsByEmail.length > 0) return rowsByEmail[0];

	const [rowsByName] = await connection.execute(
		'SELECT id, full_name, email FROM users WHERE LOWER(full_name) = LOWER(?) OR LOWER(username) = LOWER(?) LIMIT 1',
		[raw, raw]
	);
	if (rowsByName.length > 0) return rowsByName[0];

	return null;
}

async function getSafeTicketCategory(connection) {
	// Prefer modern value, then common legacy value; fallback to first enum entry.
	const preferred = ['general_request', 'general', 'policy', 'payroll'];
	try {
		const [rows] = await connection.execute(
			`SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'support_tickets'
         AND COLUMN_NAME = 'category'
       LIMIT 1`
		);

		const columnType = rows?.[0]?.COLUMN_TYPE;
		if (!columnType || typeof columnType !== 'string') {
			return 'general_request';
		}

		const enumValues = [...columnType.matchAll(/'([^']+)'/g)].map((m) => m[1]);
		if (enumValues.length === 0) return 'general_request';

		const match = preferred.find((value) => enumValues.includes(value));
		return match || enumValues[0];
	} catch {
		return 'general_request';
	}
}

/**
 * GET /api/users/[id]/activity-assignments
 * Fetch all activity assignments for a user from project_activities_list
 */
export async function GET(request, { params }) {
	let db;
	try {
		const { id } = await params;
		const requestedUserId = parseInt(id);

		const currentUser = await getCurrentUser(request);

		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Users can view their own assignments.
		// Admin/super-admin users can view others for monitoring.
		const isOwnData = requestedUserId === currentUser.id;
		const isAdminViewer =
			currentUser.is_super_admin ||
			currentUser.role?.code === 'admin' ||
			currentUser.role?.name === 'Admin';
		if (!isOwnData && !isAdminViewer) {
			return NextResponse.json(
				{
					success: false,
					error: 'Forbidden',
				},
				{ status: 403 }
			);
		}

		db = await dbConnect();

		// Query user_activity_assignments directly instead of parsing JSON blob
		const [rows] = await db.execute(
			`
      SELECT
        uaa.*,
        p.name AS project_name,
        p.project_code,
        p.status AS project_status,
        p.start_date AS project_start_date,
        p.end_date AS project_end_date
      FROM user_activity_assignments uaa
      LEFT JOIN projects p ON uaa.project_id = p.project_id
      WHERE uaa.user_id = ?
      ORDER BY p.start_date DESC, uaa.created_at ASC
    `,
			[requestedUserId]
		);

		const assignments = [];
		for (const row of rows) {
			// Parse daily_entries from JSON string
			let dailyEntries = [];
			if (row.daily_entries) {
				try {
					dailyEntries =
						typeof row.daily_entries === 'string'
							? JSON.parse(row.daily_entries)
							: row.daily_entries;
				} catch {
					dailyEntries = [];
				}
			}
			if (!Array.isArray(dailyEntries)) dailyEntries = [];

			const derivedQty = dailyEntries.reduce(
				(s, e) => s + (parseFloat(e.qty_done) || 0),
				0
			);
			const derivedHours = dailyEntries.reduce(
				(s, e) => s + (parseFloat(e.hours) || 0),
				0
			);

			assignments.push({
				project_id: row.project_id,
				project_name: row.project_name || '',
				project_code: row.project_code || '',
				project_status: row.project_status || '',
				project_start_date: row.project_start_date || null,
				project_end_date: row.project_end_date || null,
				activity_id: row.activity_id,
				activity_name: row.activity_name || 'Unnamed Activity',
				activity_description: row.description || '',
				discipline: row.discipline_name || 'General',
				sub_activity_name: row.sub_activity_name || '',
				default_manhours: parseFloat(row.default_manhours) || 0,
				description: row.description || '',
				qty_assigned: parseFloat(row.qty_assigned) || 0,
				qty_completed: parseFloat(row.qty_completed) || derivedQty,
				planned_hours: parseFloat(row.estimated_hours) || 0,
				actual_hours: parseFloat(row.actual_hours) || derivedHours,
				start_date: row.start_date || null,
				due_date: row.due_date || null,
				status: row.status || 'Not Started',
				notes: row.notes || '',
				remarks: row.remarks || '',
				progress_percentage: parseFloat(row.progress_percentage) || 0,
				daily_entries: dailyEntries,
			});
		}

		// Calculate stats
		const stats = {
			totalAssignments: assignments.length,
			totalProjects: [...new Set(assignments.map((a) => a.project_id))].length,
			totalQtyAssigned: assignments.reduce(
				(sum, a) => sum + (parseFloat(a.qty_assigned) || 0),
				0
			),
			totalQtyCompleted: assignments.reduce(
				(sum, a) => sum + (parseFloat(a.qty_completed) || 0),
				0
			),
			totalPlannedHours: assignments.reduce(
				(sum, a) => sum + (parseFloat(a.planned_hours) || 0),
				0
			),
			totalActualHours: assignments.reduce(
				(sum, a) => sum + (parseFloat(a.actual_hours) || 0),
				0
			),
			completedCount: assignments.filter((a) => a.status === 'Completed')
				.length,
			inProgressCount: assignments.filter((a) => a.status === 'In Progress')
				.length,
			notStartedCount: assignments.filter((a) => a.status === 'Not Started')
				.length,
			onHoldCount: assignments.filter((a) => a.status === 'On Hold').length,
		};

		// Keep project visibility independent from activity-row existence.
		const projectIdsWithActivities = new Set(
			assignments.map((a) => String(a.project_id))
		);
		const emptyProjects = [];
		const accessibleProjects = [];
		const accessibleProjectById = new Map();
		const projectSummary = (project) => ({
			project_id: project.project_id,
			project_name: project.project_name || '',
			project_code: project.project_code || '',
			project_status: project.project_status || '',
			project_start_date:
				project.project_start_date ?? project.start_date ?? null,
			project_end_date: project.project_end_date ?? project.end_date ?? null,
		});
		const addAccessibleProject = (project) => {
			const projectId = String(project.project_id ?? '').trim();
			if (!projectId) return;
			const summary = projectSummary(project);
			const existing = accessibleProjectById.get(projectId);
			if (existing) {
				for (const key of [
					'project_name',
					'project_code',
					'project_status',
					'project_start_date',
					'project_end_date',
				]) {
					if (!existing[key] && summary[key]) existing[key] = summary[key];
				}
				return;
			}
			accessibleProjectById.set(projectId, summary);
			accessibleProjects.push(summary);
		};

		assignments.forEach(addAccessibleProject);

		let requestedUserEmail =
			String(requestedUserId) === String(currentUser.id)
				? currentUser.email || null
				: null;
		if (!requestedUserEmail) {
			try {
				const [requestedUsers] = await db.execute(
					'SELECT email FROM users WHERE id = ? LIMIT 1',
					[requestedUserId]
				);
				requestedUserEmail = requestedUsers?.[0]?.email || null;
			} catch {
				requestedUserEmail = null;
			}
		}

		try {
			const [teamProjects] = await db.execute(
				`SELECT project_id, name as project_name, project_code, status as project_status,
                start_date, end_date, project_team
         FROM projects
         WHERE project_team IS NOT NULL AND project_team != '' AND project_team != '[]'
         ORDER BY start_date DESC`
			);

			for (const project of teamProjects) {
				const isMember = isUserInProjectTeam(
					project.project_team,
					requestedUserId,
					requestedUserEmail
				);
				if (!isMember) continue;

				const summary = projectSummary(project);
				addAccessibleProject(summary);
				if (!projectIdsWithActivities.has(String(project.project_id))) {
					emptyProjects.push(summary);
				}
			}
		} catch (err) {
			console.error('Failed to load team projects:', err.message);
		}

		db.release();

		const response = NextResponse.json({
			success: true,
			data: {
				assignments,
				emptyProjects,
				accessibleProjects,
				stats,
			},
		});

		// Cache for 30 seconds since this data changes infrequently
		response.headers.set(
			'Cache-Control',
			'private, max-age=30, stale-while-revalidate=60'
		);

		return response;
	} catch (error) {
		console.error('Error fetching user activity assignments:', error);
		if (db) {
			try {
				db.release();
			} catch {}
		}
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch activity assignments',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}

/**
 * PUT /api/users/[id]/activity-assignments
 * Update a user's progress on an activity
 */
export async function PUT(request, { params }) {
	let db;
	try {
		const { id } = await params;
		const requestedUserId = parseInt(id);

		const currentUser = await getCurrentUser(request);

		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Users can update their own assignments
		// Super admins can edit any user's assignments
		const isOwnData = requestedUserId === currentUser.id;
		if (!isOwnData && !currentUser.is_super_admin) {
			return NextResponse.json(
				{
					success: false,
					error:
						"Forbidden - Only super admins can edit other users' assignments",
				},
				{ status: 403 }
			);
		}

		const body = await request.json();
		const {
			project_id,
			activity_id,
			qty_assigned,
			status,
			remarks,
			description,
			start_date,
			due_date,
			notes,
			progress_percentage,
			daily_entries,
			discipline_name,
			activity_name,
			sub_activity_name,
			planned_hours,
		} = body;

		console.log(
			'[Activity Assignment Update] User:',
			currentUser.username,
			'(super_admin:',
			currentUser.is_super_admin,
			') updating user:',
			requestedUserId
		);
		console.log(
			'[Activity Assignment Update] project_id:',
			project_id,
			'activity_id:',
			activity_id
		);
		console.log(
			'[Activity Assignment Update] daily_entries count:',
			daily_entries?.length || 0
		);

		if (!project_id || !activity_id) {
			return NextResponse.json(
				{
					success: false,
					error: 'project_id and activity_id are required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// Find the existing assignment row
		const [existing] = await db.execute(
			'SELECT * FROM user_activity_assignments WHERE user_id = ? AND project_id = ? AND activity_id = ?',
			[requestedUserId, project_id, activity_id]
		);

		if (existing.length === 0) {
			db.release();
			return NextResponse.json(
				{ success: false, error: 'User is not assigned to this activity' },
				{ status: 404 }
			);
		}

		// Build dynamic UPDATE with only the fields present in the request
		const setClauses = [];
		const updateParams = [];
		let normalizedEntries = null;

		if (qty_assigned !== undefined) {
			setClauses.push('qty_assigned = ?');
			updateParams.push(parseFloat(qty_assigned) || 0);
		}
		if (planned_hours !== undefined) {
			setClauses.push('estimated_hours = ?');
			updateParams.push(parseFloat(planned_hours) || 0);
		}
		if (status !== undefined) {
			setClauses.push('status = ?');
			updateParams.push(status);
		}
		if (remarks !== undefined) {
			setClauses.push('remarks = ?');
			updateParams.push(remarks);
		}
		if (description !== undefined) {
			setClauses.push('description = ?');
			updateParams.push(description);
		}
		if (start_date !== undefined) {
			setClauses.push('start_date = ?');
			updateParams.push(start_date || null);
		}
		if (due_date !== undefined) {
			setClauses.push('due_date = ?');
			updateParams.push(due_date || null);
		}
		if (notes !== undefined) {
			setClauses.push('notes = ?');
			updateParams.push(notes);
		}
		if (progress_percentage !== undefined) {
			setClauses.push('progress_percentage = ?');
			updateParams.push(parseFloat(progress_percentage) || 0);
		}
		if (daily_entries !== undefined) {
			setClauses.push('daily_entries = ?');
			normalizedEntries = Array.isArray(daily_entries)
				? daily_entries.map((e) => {
						if (!e || typeof e !== 'object') return {};
						// Normalize the known numeric/text fields but keep
						// every other flag (isLocked, …) intact — the old
						// mapping silently dropped them on round-trip.
						return {
							...e,
							date: e.date || '',
							qty_done: parseFloat(e.qty_done) || 0,
							hours: parseFloat(e.hours) || 0,
							remarks: e.remarks || '',
						};
					})
				: [];
			updateParams.push(JSON.stringify(normalizedEntries));
		}
		// Activity-level fields
		if (discipline_name !== undefined) {
			setClauses.push('discipline_name = ?');
			updateParams.push(discipline_name);
		}
		if (activity_name !== undefined) {
			setClauses.push('activity_name = ?');
			updateParams.push(activity_name);
		}
		if (sub_activity_name !== undefined) {
			setClauses.push('sub_activity_name = ?');
			updateParams.push(sub_activity_name);
		}

		if (setClauses.length === 0) {
			db.release();
			return NextResponse.json({
				success: true,
				message: 'No fields to update',
				affected_rows: 0,
			});
		}

		// Daily-hour cap: the replacement entries must not push any calendar
		// date over MAX_DAY_HOURS once the user's other assignments for that
		// date are counted (this assignment's old entries are being replaced).
		if (normalizedEntries !== null) {
			const existingByDate = await fetchExistingDayHours(db, requestedUserId, {
				excludeAssignmentIds: [existing[0].id],
			});
			const violation = validateDayHours(normalizedEntries, existingByDate);
			if (violation) {
				db.release();
				return NextResponse.json(
					{ success: false, error: violation },
					{ status: 400 }
				);
			}
		}

		setClauses.push('updated_at = NOW()');
		updateParams.push(requestedUserId, project_id, activity_id);

		const [updateResult] = await db.execute(
			`UPDATE user_activity_assignments SET ${setClauses.join(', ')}
       WHERE user_id = ? AND project_id = ? AND activity_id = ?`,
			updateParams
		);

		db.release();

		return NextResponse.json({
			success: true,
			message: 'Assignment updated successfully',
			affected_rows: updateResult.affectedRows,
		});
	} catch (error) {
		console.error('[Activity Assignment Update] Error:', error);
		if (db) {
			try {
				db.release();
			} catch {}
		}
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update assignment',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}

/**
 * POST /api/users/[id]/activity-assignments
 * Create OT approval request for an assigned activity and route to project manager
 */
export async function POST(request, { params }) {
	let db;
	try {
		const { id } = await params;
		const requestedUserId = parseInt(id, 10);

		const currentUser = await getCurrentUser(request);
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const isOwnData = requestedUserId === currentUser.id;
		if (!isOwnData && !currentUser.is_super_admin) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		const body = await request.json();
		const {
			project_id,
			activity_id,
			activity_name,
			project_name,
			project_code,
			ot_hours,
			remarks,
		} = body || {};

		const overtimeHours = parseFloat(ot_hours);
		if (
			!project_id ||
			!activity_id ||
			!Number.isFinite(overtimeHours) ||
			overtimeHours <= 0
		) {
			return NextResponse.json(
				{
					success: false,
					error:
						'project_id, activity_id and valid ot_hours (> 0) are required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [projectRows] = await db.execute(
			`SELECT project_id, name, project_code, project_manager
       FROM projects
       WHERE project_id = ?
       LIMIT 1`,
			[project_id]
		);

		if (projectRows.length === 0) {
			db.release();
			return NextResponse.json(
				{ success: false, error: 'Project not found' },
				{ status: 404 }
			);
		}

		const project = projectRows[0];
		// Check assignment via normalized table instead of JSON blob
		const [assignments] = await db.execute(
			'SELECT id FROM user_activity_assignments WHERE user_id = ? AND project_id = ? AND activity_id = ?',
			[requestedUserId, project_id, activity_id]
		);
		const hasAssignment = assignments.length > 0;

		if (!hasAssignment) {
			db.release();
			return NextResponse.json(
				{ success: false, error: 'You are not assigned to this activity' },
				{ status: 403 }
			);
		}

		const managerUser = await resolveProjectManager(
			db,
			project.project_manager
		);
		const managerLabel =
			managerUser?.full_name ||
			managerUser?.email ||
			project.project_manager ||
			'Project Manager';
		const safeCategory = await getSafeTicketCategory(db);

		const ticketNumber = await generateTicketNumber(db);
		const finalProjectName = project_name || project.name || 'Unknown Project';
		const finalProjectCode = project_code || project.project_code || 'N/A';
		const finalActivityName = activity_name || 'Activity';

		const descriptionLines = [
			'OT approval request from user dashboard.',
			`Project: ${finalProjectName} (${finalProjectCode})`,
			`Activity: ${finalActivityName}`,
			`Requested OT Hours: ${overtimeHours}`,
			`Requested By: ${currentUser.full_name || currentUser.username || currentUser.email || `User ${requestedUserId}`}`,
			`Project Manager: ${managerLabel}`,
		];

		if (remarks && String(remarks).trim()) {
			descriptionLines.push(`Remarks: ${String(remarks).trim()}`);
		}

		const [insertResult] = await db.execute(
			`INSERT INTO support_tickets (
        ticket_number, user_id, title, description, category, priority, assigned_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				ticketNumber,
				requestedUserId,
				`OT Approval - ${finalProjectCode} - ${finalActivityName}`,
				descriptionLines.join('\n'),
				safeCategory,
				'medium',
				managerUser?.id || null,
			]
		);

		db.release();
		return NextResponse.json({
			success: true,
			message: managerUser
				? `OT approval request sent to ${managerLabel}`
				: 'OT approval request submitted (manager assignment pending)',
			data: {
				ticket_id: insertResult.insertId,
				ticket_number: ticketNumber,
				assigned_to: managerUser?.id || null,
				assigned_to_name: managerLabel,
				ot_hours: overtimeHours,
			},
		});
	} catch (error) {
		console.error('Error creating OT approval request:', error);
		if (db) {
			try {
				db.release();
			} catch {}
		}
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to create OT approval request',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}

/**
 * PATCH /api/users/[id]/activity-assignments
 * Self-service: add a new activity entry (Discipline / Activity / Sub-Activity)
 * to a project's activity list, assigned to the requesting user.
 */
export async function PATCH(request, { params }) {
	let db;
	try {
		const { id } = await params;
		const requestedUserId = parseInt(id);

		const currentUser = await getCurrentUser(request);
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const isOwnData = requestedUserId === currentUser.id;
		if (!isOwnData && !currentUser.is_super_admin) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		const body = await request.json();
		const {
			project_id,
			discipline_name,
			activity_name,
			sub_activity_name,
			manhours_assigned,
			due_date,
			default_manhours,
			qty_completed,
			status,
			remarks,
		} = body || {};

		if (!project_id || !discipline_name || !activity_name) {
			return NextResponse.json(
				{
					success: false,
					error: 'project_id, discipline_name and activity_name are required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [projects] = await db.execute(
			'SELECT project_id, project_activities_list FROM projects WHERE project_id = ?',
			[project_id]
		);

		if (projects.length === 0) {
			db.release();
			return NextResponse.json(
				{ success: false, error: 'Project not found' },
				{ status: 404 }
			);
		}

		const project = projects[0];
		let activitiesList = project.project_activities_list;
		if (typeof activitiesList === 'string') {
			try {
				activitiesList = activitiesList ? JSON.parse(activitiesList) : [];
			} catch {
				activitiesList = [];
			}
		}
		if (!Array.isArray(activitiesList)) activitiesList = [];

		const newActivity = {
			id: randomUUID(),
			activity_name,
			function_name: discipline_name,
			discipline: discipline_name,
			sub_activity_name: sub_activity_name || '',
			default_manhours: parseFloat(default_manhours) || 0,
			activity_description: '',
			assigned_users: [
				{
					user_id: requestedUserId,
					qty_assigned: 0,
					qty_completed: parseFloat(qty_completed) || 0,
					planned_hours: parseFloat(manhours_assigned) || 0,
					actual_hours: 0,
					status: status || 'Not Started',
					due_date: due_date || null,
					remarks: remarks || '',
					notes: '',
					progress_percentage: 100,
					daily_entries: [
						{
							date: due_date || new Date().toISOString().split('T')[0],
							qty_done: parseFloat(qty_completed) || 0,
							hours: parseFloat(manhours_assigned) || 0,
							remarks: '',
						},
					],
				},
			],
		};

		activitiesList.push(newActivity);

		await db.execute(
			'UPDATE projects SET project_activities_list = ? WHERE project_id = ?',
			[JSON.stringify(activitiesList), project.project_id]
		);

		// Also insert into normalized user_activity_assignments table. The
		// entered manhours/quantity are logged as that day's entry so they
		// surface in the timesheet/man-hours reports; planned hours also go
		// to estimated_hours. employee_id is carried over from the login
		// account so reports that key on it can resolve the row directly.
		try {
			const [userRows] = await db.execute(
				'SELECT employee_id FROM users WHERE id = ?',
				[requestedUserId]
			);
			const employeeId = userRows[0]?.employee_id ?? null;
			const dailyEntry = {
				date: due_date || new Date().toISOString().split('T')[0],
				qty_done: parseFloat(qty_completed) || 0,
				hours: parseFloat(manhours_assigned) || 0,
				remarks: '',
			};
			// Daily-hour cap: the new entry must not push the user's total
			// for that date over MAX_DAY_HOURS across all their assignments.
			const existingByDate = await fetchExistingDayHours(db, requestedUserId);
			const violation = validateDayHours([dailyEntry], existingByDate);
			if (violation) {
				db.release();
				return NextResponse.json(
					{ success: false, error: violation },
					{ status: 400 }
				);
			}
			await db.execute(
				`INSERT INTO user_activity_assignments
         (id, user_id, employee_id, project_id, activity_id, activity_name,
          discipline_name, sub_activity_name, description, due_date, start_date,
          status, estimated_hours, actual_hours, qty_assigned, qty_completed,
          notes, remarks, default_manhours, progress_percentage,
          daily_entries, assigned_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
				[
					randomUUID(),
					requestedUserId,
					employeeId,
					project_id,
					newActivity.id,
					activity_name,
					discipline_name,
					sub_activity_name || null,
					'',
					due_date || null,
					null,
					status || 'Not Started',
					parseFloat(manhours_assigned) || 0,
					0,
					0,
					parseFloat(qty_completed) || 0,
					'',
					remarks || '',
					parseFloat(default_manhours) || 0,
					100,
					JSON.stringify([dailyEntry]),
				]
			);
		} catch (insertErr) {
			console.error(
				'Failed to insert into user_activity_assignments:',
				insertErr
			);
			// Non-fatal — the JSON blob update already succeeded
		}

		db.release();

		return NextResponse.json({
			success: true,
			message: 'Activity added successfully',
			data: { activity_id: newActivity.id },
		});
	} catch (error) {
		console.error('Error adding self-service activity:', error);
		if (db) {
			try {
				db.release();
			} catch {}
		}
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to add activity',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/users/[id]/activity-assignments
 * Remove a user's activity assignment
 */
export async function DELETE(request, { params }) {
	let db;
	try {
		const { id } = await params;
		const requestedUserId = parseInt(id);

		const currentUser = await getCurrentUser(request);

		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Users can delete their own assignments
		// Super admins can delete any user's assignments
		const isOwnData = requestedUserId === currentUser.id;
		if (!isOwnData && !currentUser.is_super_admin) {
			return NextResponse.json(
				{
					success: false,
					error:
						"Forbidden - Only super admins can delete other users' assignments",
				},
				{ status: 403 }
			);
		}

		const body = await request.json();
		const { project_id, activity_id } = body || {};

		if (!project_id || !activity_id) {
			return NextResponse.json(
				{
					success: false,
					error: 'project_id and activity_id are required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [deleteResult] = await db.execute(
			'DELETE FROM user_activity_assignments WHERE user_id = ? AND project_id = ? AND activity_id = ?',
			[requestedUserId, project_id, activity_id]
		);

		if (deleteResult.affectedRows === 0) {
			db.release();
			return NextResponse.json(
				{ success: false, error: 'Assignment not found' },
				{ status: 404 }
			);
		}

		// Also drop the user from the project_activities_list blob so a later
		// project save (which re-syncs assignments from the blob) does not
		// resurrect the deleted assignment.
		try {
			const [projects] = await db.execute(
				'SELECT project_activities_list FROM projects WHERE project_id = ?',
				[project_id]
			);
			let list = projects[0]?.project_activities_list;
			if (typeof list === 'string') {
				try {
					list = list ? JSON.parse(list) : [];
				} catch {
					list = [];
				}
			}
			if (Array.isArray(list)) {
				const cleaned = list
					.map((activity) => {
						if (!activity || activity.id !== activity_id) return activity;
						const users = Array.isArray(activity.assigned_users)
							? activity.assigned_users.filter(
									(u) => String(u?.user_id) !== String(requestedUserId)
								)
							: activity.assigned_users;
						return { ...activity, assigned_users: users };
					})
					.filter(
						(activity) =>
							!activity ||
							activity.id !== activity_id ||
							!Array.isArray(activity.assigned_users) ||
							activity.assigned_users.length > 0
					);
				if (JSON.stringify(cleaned) !== JSON.stringify(list)) {
					await db.execute(
						'UPDATE projects SET project_activities_list = ? WHERE project_id = ?',
						[JSON.stringify(cleaned), project_id]
					);
				}
			}
		} catch (blobErr) {
			// Non-fatal: the normalized row is gone either way.
			console.error(
				'Failed to remove assignment from project activities blob:',
				blobErr
			);
		}

		db.release();

		return NextResponse.json({
			success: true,
			message: 'Assignment deleted successfully',
		});
	} catch (error) {
		console.error('[Activity Assignment Delete] Error:', error);
		if (db) {
			try {
				db.release();
			} catch {}
		}
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete assignment',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}
