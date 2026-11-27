import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { parseDailyEntries } from '@/lib/logged-hours';
import {
	getProjectTeamMembership,
	isUserInProjectTeam,
} from '@/utils/project-access';
import {
	ASSIGNEE_NOT_PROJECT_MEMBER,
	assigneeNotMemberMessage,
} from '@/lib/project-rights';

/** The one 409 body shared with the project assignment route. */
function membershipConflict(name) {
	return NextResponse.json(
		{
			success: false,
			code: ASSIGNEE_NOT_PROJECT_MEMBER,
			error: assigneeNotMemberMessage(name),
		},
		{ status: 409 }
	);
}

function userLabel(user) {
	return user?.full_name || user?.username || user?.email || 'This person';
}

/** Decode one JSON-array payload without letting a second payload affect it. */
function parseDailyEntriesPayload(value) {
	if (!value) return [];
	try {
		const parsed = typeof value === 'string' ? JSON.parse(value) : value;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * Every self-service mutation requires the acting user, and the target user
 * when different, to be a current member of the target project's team. The
 * stored `project_team` list is the only membership source, so an assignment
 * can never attach a person to a project.
 */
async function requireAssignmentMembership(
	db,
	project,
	currentUser,
	targetUserId
) {
	const actorIsMember = getProjectTeamMembership(
		project.project_team,
		currentUser.id,
		currentUser.email
	).isMember;
	if (!actorIsMember) {
		return membershipConflict(userLabel(currentUser));
	}

	if (String(targetUserId) === String(currentUser.id)) return null;

	const [rows] = await db.execute(
		'SELECT id, full_name, username, email FROM users WHERE id = ? LIMIT 1',
		[targetUserId]
	);
	const target = rows?.[0] || null;
	const targetIsMember = getProjectTeamMembership(
		project.project_team,
		targetUserId,
		target?.email
	).isMember;
	if (!targetIsMember) {
		return membershipConflict(userLabel(target));
	}

	return null;
}

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

/** Length of a projects JSON list column (`documents_received_list` …). */
function jsonListLength(value) {
	if (!value) return 0;
	try {
		const parsed = typeof value === 'string' ? JSON.parse(value) : value;
		return Array.isArray(parsed) ? parsed.length : 0;
	} catch {
		return 0;
	}
}

/**
 * Per-project document count across the three stores the Project page reads:
 * uploaded files (`entity_documents`), library documents (`project_documents`)
 * and the listed received/issued documents held in the projects JSON columns.
 * Returns `{ [projectId]: count }` with every requested project present, so a
 * project with no documents counts zero instead of going missing.
 */
async function fetchProjectDocumentCounts(db, projectIds) {
	const counts = {};
	const ids = [
		...new Set(
			(projectIds || [])
				.map((value) => Number(value))
				.filter((value) => Number.isFinite(value) && value > 0)
		),
	];
	for (const id of ids) counts[id] = 0;
	if (ids.length === 0) return counts;

	const placeholders = ids.map(() => '?').join(', ');
	const readRows = async (sql) => {
		const result = await db.execute(sql, ids);
		return result?.[0] || [];
	};
	const add = (projectId, count) => {
		const key = Number(projectId);
		if (key in counts) counts[key] += Number(count) || 0;
	};

	for (const row of await readRows(
		`SELECT entity_id AS project_id, COUNT(*) AS n
       FROM entity_documents
       WHERE entity_type = 'project' AND entity_id IN (${placeholders})
       GROUP BY entity_id`
	)) {
		add(row.project_id, row.n);
	}

	// The library store is counted the way the Project page lists it —
	// every `project_documents` row for the project, no status filter (the
	// table has no `isDelete` column either).
	for (const row of await readRows(
		`SELECT project_id, COUNT(*) AS n
       FROM project_documents
       WHERE project_id IN (${placeholders})
       GROUP BY project_id`
	)) {
		add(row.project_id, row.n);
	}

	for (const row of await readRows(
		`SELECT project_id, documents_received_list, documents_issued_list
       FROM projects
       WHERE isDelete = 0 AND project_id IN (${placeholders})`
	)) {
		add(
			row.project_id,
			jsonListLength(row.documents_received_list) +
				jsonListLength(row.documents_issued_list)
		);
	}

	return counts;
}

const PROJECT_ACTIVITY_SAVE_RESOURCE = 'project_activity_save';

/**
 * Latest self-service activity-save evidence for a user: the newest
 * `user_activity_logs` row the user recorded by saving Work Periods. Manager
 * edits to another user's assignments move assignment `updated_at` but never
 * write this marker, so rows without dedicated evidence read as unknown (null)
 * rather than inferring a save time. Numeric epoch ms or null. Throws on
 * read failure — a logging outage must fail the request, never be
 * misreported as "no saves".
 */
async function readLastActivitySaveMs(connection, userId) {
	const [rows] = await connection.execute(
		`SELECT UNIX_TIMESTAMP(MAX(created_at)) * 1000 AS last_activity_logged_at
       FROM user_activity_logs
       WHERE user_id = ?
         AND resource_type = ?
         AND action_type IN ('create', 'update')
         AND status = 'success'`,
		[userId, PROJECT_ACTIVITY_SAVE_RESOURCE]
	);
	const raw = rows?.[0]?.last_activity_logged_at;
	if (raw === null || raw === undefined || raw === '') return null;
	const savedAtMs = Number(raw);
	return Number.isFinite(savedAtMs) && savedAtMs > 0 ? savedAtMs : null;
}

/**
 * GET /api/users/[id]/activity-assignments
 * Fetch all activity assignments for a user through the read-only Logged Hours
 * projection. `daily_entries` combines legacy duration records with Work Period
 * attribution; `legacy_daily_entries` remains the independently decoded raw
 * history for readers that must not invent Start or End values.
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

		// The view is read-only: writes belong to the normalized assignment table
		// or the dedicated Work Period routes, never to this projection.
		const [rows] = await db.execute(
			`
      SELECT
        uaa.*,
        p.name AS project_name,
        p.project_code,
        p.status AS project_status,
        p.start_date AS project_start_date,
        p.end_date AS project_end_date
      FROM logged_activity_assignments uaa
      LEFT JOIN projects p ON uaa.project_id = p.project_id
      WHERE uaa.user_id = ?
      ORDER BY p.start_date DESC, uaa.created_at ASC
    `,
			[requestedUserId]
		);

		// Latest self-service save evidence. The epoch comes from the database
		// so the app never interprets the SQL wallclock in local time. Only
		// self-recorded saves in user_activity_logs count — assignment
		// updated_at also moves on manager edits, so it must never seed this.
		const lastActivityLoggedAt = await readLastActivitySaveMs(
			db,
			requestedUserId
		);

		const assignments = [];
		for (const row of rows) {
			// Effective entries drive the reminder. A Work Period projection also
			// overrides the stale stored duration aggregate; without one, preserve
			// the preexisting legacy-only aggregate display. Legacy history is
			// decoded independently so malformed data cannot hide the other side.
			const dailyEntries = parseDailyEntriesPayload(row.daily_entries);
			const legacyDailyEntries = parseDailyEntriesPayload(
				row.legacy_daily_entries
			);

			const derivedQty = dailyEntries.reduce(
				(s, e) => s + (parseFloat(e?.qty_done) || 0),
				0
			);
			const derivedHours = parseDailyEntries(row.daily_entries).reduce(
				(s, e) => s + e.hours,
				0
			);
			const hasWorkPeriodProjection =
				row.work_period_entries !== null &&
				row.work_period_entries !== undefined;

			assignments.push({
				id: row.id,
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
				qty_completed: hasWorkPeriodProjection
					? derivedQty
					: parseFloat(row.qty_completed) || derivedQty,
				planned_hours: parseFloat(row.estimated_hours) || 0,
				actual_hours: hasWorkPeriodProjection
					? derivedHours
					: parseFloat(row.actual_hours) || derivedHours,
				start_date: row.start_date || null,
				due_date: row.due_date || null,
				status: row.status || 'Not Started',
				notes: row.notes || '',
				remarks: row.remarks || '',
				progress_percentage: parseFloat(row.progress_percentage) || 0,
				daily_entries: dailyEntries,
				legacy_daily_entries: legacyDailyEntries,
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

		// Per-project document counts from all three stores. Auxiliary to the
		// payload: a count that cannot be read leaves the project icon-free,
		// it never fails the assignment list.
		let documentCounts = {};
		try {
			documentCounts = await fetchProjectDocumentCounts(db, [
				...assignments.map((a) => a.project_id),
				...accessibleProjects.map((p) => p.project_id),
			]);
		} catch (err) {
			console.error('Failed to count project documents:', err.message);
		}

		db.release();

		const response = NextResponse.json({
			success: true,
			data: {
				assignments,
				emptyProjects,
				accessibleProjects,
				documentCounts,
				stats,
				lastActivityLoggedAt,
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
			`SELECT project_id, name, project_code, project_manager, project_team
       FROM projects
       WHERE project_id = ? AND isDelete = 0
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

		const membershipFailure = await requireAssignmentMembership(
			db,
			project,
			currentUser,
			requestedUserId
		);
		if (membershipFailure) {
			db.release();
			return membershipFailure;
		}
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
