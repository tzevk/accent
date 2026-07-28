import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

/**
 * GET /api/reports/project-activities
 * Returns all projects with their activities and per-user daily entries for admin report view.
 * Access: super admins or users with reports:read permission.
 *
 * Uses pool.execute (via query()) so NO connection is held open for the entire request.
 */
export async function GET(request) {
	try {
		// Check permissions
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		const hasReportsPermission = hasPermission(
			user,
			RESOURCES.REPORTS,
			PERMISSIONS.READ
		);
		let hasProjectActivitiesFieldPermission = false;

		let fieldPerms = user.field_permissions;
		if (typeof fieldPerms === 'string') {
			try {
				fieldPerms = JSON.parse(fieldPerms);
			} catch {
				fieldPerms = null;
			}
		}

		const reportAccessSection =
			fieldPerms?.modules?.reports?.sections?.report_access;
		if (reportAccessSection?.enabled) {
			const projectActivitiesPerm =
				reportAccessSection.fields?.project_activities?.permission;
			const legacyPerm =
				reportAccessSection.fields?.project_reports?.permission;
			hasProjectActivitiesFieldPermission =
				projectActivitiesPerm === 'view' ||
				projectActivitiesPerm === 'edit' ||
				legacyPerm === 'view' ||
				legacyPerm === 'edit';
		}

		if (
			!isSuperAdmin &&
			!hasReportsPermission &&
			!hasProjectActivitiesFieldPermission
		) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view project activities report',
				},
				{ status: 403 }
			);
		}

		// --- All queries below use pool.execute() — no long-held connection ---

		const [projects] = await query(`
      SELECT *
      FROM projects p
      ORDER BY
        CASE WHEN p.start_date IS NULL THEN 1 ELSE 0 END,
        p.start_date DESC,
        p.project_id DESC
    `);

		// Normalise name field
		projects.forEach((p) => {
			if (!p.project_name && p.name) p.project_name = p.name;
			if (!p.project_name && p.project_title) p.project_name = p.project_title;
		});

		// Build user name map
		const userMap = {};
		try {
			const [users] = await query(
				`SELECT id, full_name, username, email FROM users`
			);
			for (const u of users)
				userMap[String(u.id)] = u.full_name || u.username || u.email;
		} catch {
			/* ignore */
		}
		try {
			const [employees] = await query(
				`SELECT id, first_name, last_name, email FROM employees`
			);
			for (const emp of employees) {
				if (!userMap[String(emp.id)]) {
					userMap[String(emp.id)] =
						[emp.first_name, emp.last_name].filter(Boolean).join(' ') ||
						emp.email;
				}
			}
		} catch {
			/* ignore */
		}

		// Bulk-fetch all project_activities in one query instead of per-project
		let tableActivitiesByProject = {};
		try {
			const [allTableActivities] = await query(`
        SELECT id, project_id, activity_name, discipline_name,
               start_date, end_date, manhours_planned, manhours_actual,
               status, progress_percentage, notes
        FROM project_activities
        ORDER BY created_at DESC
      `);
			for (const ta of allTableActivities) {
				const pid = ta.project_id;
				if (!tableActivitiesByProject[pid]) tableActivitiesByProject[pid] = [];
				tableActivitiesByProject[pid].push(ta);
			}
		} catch {
			/* table may not exist */
		}

		// Collect all project IDs for bulk query
		const allProjectIds = projects.map((p) => p.project_id);

		// Bulk-fetch user_activity_assignments for all projects
		let uaaByProject = {};
		if (allProjectIds.length > 0) {
			try {
				const placeholders = allProjectIds.map(() => '?').join(',');
				const [allAssignments] = await query(
					`SELECT * FROM user_activity_assignments WHERE project_id IN (${placeholders})`,
					allProjectIds
				);
				for (const row of allAssignments) {
					const pid = row.project_id;
					if (!uaaByProject[pid]) uaaByProject[pid] = [];
					uaaByProject[pid].push(row);
				}
			} catch {
				/* table may not exist */
			}
		}

		const result = [];

		for (const project of projects) {
			const projectAssignments = uaaByProject[project.project_id] || [];

			// Build activities from normalized table, grouped by activity_id
			const activityMap = new Map();
			for (const row of projectAssignments) {
				const actId = String(row.activity_id);
				if (!activityMap.has(actId)) {
					activityMap.set(actId, {
						id: row.activity_id,
						activity_name: row.activity_name || 'Unnamed',
						activity_description: row.description || '',
						discipline: row.discipline_name || 'General',
						members: [],
						source: 'json',
					});
				}
				const activityEntry = activityMap.get(actId);

				// Parse daily_entries
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
				dailyEntries = Array.isArray(dailyEntries)
					? dailyEntries.filter(
							(e) =>
								e && typeof e === 'object' && (e.date || e.qty_done || e.hours)
						)
					: [];

				const totalQtyDone = dailyEntries.reduce(
					(sum, e) => sum + (parseFloat(e.qty_done) || 0),
					0
				);
				const totalHours = dailyEntries.reduce(
					(sum, e) => sum + (parseFloat(e.hours) || 0),
					0
				);

				activityEntry.members.push({
					user_id: String(row.user_id),
					user_name: userMap[String(row.user_id)] || `User ${row.user_id}`,
					description: row.description || '',
					qty_assigned: parseFloat(row.qty_assigned) || 0,
					qty_completed: parseFloat(row.qty_completed) || totalQtyDone,
					planned_hours: parseFloat(row.estimated_hours) || 0,
					actual_hours: parseFloat(row.actual_hours) || totalHours,
					start_date: row.start_date || null,
					due_date: row.due_date || null,
					status: row.status || 'Not Started',
					remarks: row.remarks || '',
					daily_entries: dailyEntries,
				});
			}

			let activities = Array.from(activityMap.values());

			// 2. Merge activities from project_activities table (pre-fetched)
			const tableActivities =
				tableActivitiesByProject[project.project_id] || [];
			for (const ta of tableActivities) {
				const existsInJson = activities.some(
					(a) =>
						a.id === ta.id ||
						(a.activity_name === ta.activity_name &&
							a.discipline === ta.discipline_name)
				);
				if (!existsInJson) {
					activities.push({
						id: ta.id,
						activity_name: ta.activity_name,
						activity_description: ta.notes || '',
						discipline: ta.discipline_name || 'General',
						members: [],
						source: 'table',
						start_date: ta.start_date,
						end_date: ta.end_date,
						manhours_planned: ta.manhours_planned || 0,
						manhours_actual: ta.manhours_actual || 0,
						status: ta.status || 'Not Started',
						progress_percentage: ta.progress_percentage || 0,
					});
				}
			}

			result.push({
				project_id: project.project_id,
				project_name: project.project_name,
				project_code: project.project_code,
				project_status: project.status || project.project_status,
				client_name: project.client_name || project.client || '',
				project_manager: project.project_manager || '',
				start_date: project.start_date,
				end_date: project.end_date,
				activities,
			});
		}

		return NextResponse.json({
			success: true,
			data: result,
			meta: { total_in_db: projects.length, total_returned: result.length },
		});
	} catch (error) {
		console.error('Project activities report error:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	}
	// No finally needed — query() uses pool.execute(), connection is auto-released per query
}
