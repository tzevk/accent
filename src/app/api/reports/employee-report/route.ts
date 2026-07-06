import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

/**
 * GET /api/reports/employee-report
 *
 * Returns all employees (users + employees table) with the sub-activities
 * they performed across projects. One row per daily entry.
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit) — same gate as
 * the Project Activities report, reusing the existing permission scheme.
 *
 * Uses pool.execute (via query()) — no long-held connection.
 */

interface DailyRow {
	date: string | null;
	project_id: number | string;
	project_code: string;
	project_name: string;
	activity_name: string;
	sub_activity_name: string;
	assignment_id: string;
	planned_hours: number; // Assign Manhours (assignment-level)
	hours: number; // Actual Manhours (that day's hours)
	qty_done: number; // Unit/Qty (that day's quantity)
}

interface EmployeeReportItem {
	user_id: string;
	user_name: string;
	email: string;
	rows: DailyRow[];
}

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: Record<string, { permission?: string } | undefined>;
				};
			};
		};
	};
}

interface ReportUser {
	is_super_admin?: boolean | number;
	field_permissions?: FieldPermissionsShape | string | null;
}

/** Raw row shape from `SELECT ... FROM users`. */
interface UserRow {
	id: number | string;
	full_name?: string;
	username?: string;
	email?: string;
}

/** Raw row shape from `SELECT ... FROM employees`. */
interface EmployeeRow {
	id: number | string;
	first_name?: string;
	last_name?: string;
	email?: string;
}

/** Any row from `SELECT * FROM projects`. */
interface ProjectRow {
	project_id: number | string;
	project_name?: string;
	name?: string;
	project_title?: string;
	project_code?: string;
	project_activities_list?: string | unknown[];
	[key: string]: unknown;
}

/** Shape of an activity item inside `project_activities_list` JSON. */
interface ActivityItem {
	id?: string | number;
	activity_name?: string;
	name?: string;
	sub_activity_name?: string;
	sub_activity?: string;
	assigned_users?: Array<string | AssignmentData>;
	[key: string]: unknown;
}

/** Shape of a single user assignment inside an activity's `assigned_users`. */
interface AssignmentData {
	user_id?: number | string;
	planned_hours?: number | string;
	due_date?: string | null;
	daily_entries?: string | DailyEntry[];
	[key: string]: unknown;
}

/** Shape of a single daily entry in an assignment's `daily_entries`. */
interface DailyEntry {
	date?: string | null;
	qty_done?: number | string;
	hours?: number | string;
	[key: string]: unknown;
}

function hasProjectActivitiesFieldPermission(
	user: ReportUser | null | undefined
): boolean {
	if (!user) return false;
	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms) as FieldPermissionsShape;
		} catch {
			fieldPerms = null;
		}
	}
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	if (!section?.enabled) return false;
	const perm = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return (
		perm === 'view' || perm === 'edit' || legacy === 'view' || legacy === 'edit'
	);
}

export async function GET(request: Request) {
	try {
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
		const hasFieldPermission = hasProjectActivitiesFieldPermission(user);

		if (!isSuperAdmin && !hasReportsPermission && !hasFieldPermission) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view the employee report',
				},
				{ status: 403 }
			);
		}

		// ── 1. Build employee roster (users ∪ employees) ────────────────────
		// Use a Map keyed by String(id) so duplicates don't create duplicates.
		const roster = new Map<
			string,
			{ user_id: string; user_name: string; email: string }
		>();

		try {
			const [users] = await query(
				`SELECT id, full_name, username, email FROM users`
			);
			for (const u of users as UserRow[]) {
				const id = String(u.id);
				if (!roster.has(id)) {
					roster.set(id, {
						user_id: id,
						user_name: u.full_name || u.username || u.email || `User ${id}`,
						email: u.email || '',
					});
				}
			}
		} catch {
			/* ignore */
		}
		try {
			const [employees] = await query(
				`SELECT id, first_name, last_name, email FROM employees`
			);
			for (const emp of employees as EmployeeRow[]) {
				const id = String(emp.id);
				if (!roster.has(id)) {
					roster.set(id, {
						user_id: id,
						user_name:
							[emp.first_name, emp.last_name].filter(Boolean).join(' ') ||
							emp.email ||
							`Employee ${id}`,
						email: emp.email || '',
					});
				}
			}
		} catch {
			/* employees table may not exist */
		}

		// ── 2. Load projects ────────────────────────────────────────────────
		const [projectsRaw] = await query(`
			SELECT * FROM projects
			ORDER BY project_id DESC
		`);
		const projects = (projectsRaw as ProjectRow[]).map((p) => {
			if (!p.project_name && p.name) p.project_name = p.name;
			if (!p.project_name && p.project_title) p.project_name = p.project_title;
			return p;
		});

		// ── 3. Build work rows per user ─────────────────────────────────────
		// rowsByUser: user_id -> DailyRow[]
		const rowsByUser = new Map<string, DailyRow[]>();

		for (const project of projects) {
			const projectId = project.project_id;
			const projectCode = project.project_code || '';

			let activitiesList: ActivityItem[] = [];
			try {
				if (project.project_activities_list) {
					const raw =
						typeof project.project_activities_list === 'string'
							? JSON.parse(project.project_activities_list)
							: project.project_activities_list;
					activitiesList = Array.isArray(raw) ? raw : [];
				}
			} catch {
				activitiesList = [];
			}
			if (!Array.isArray(activitiesList)) activitiesList = [];

			for (const activity of activitiesList) {
				const activityName =
					activity.activity_name || activity.name || 'Unnamed';
				const subActivityName =
					activity.sub_activity_name || activity.sub_activity || '';
				const assignedUsers = Array.isArray(activity.assigned_users)
					? activity.assigned_users
					: [];

				for (const assignment of assignedUsers) {
					const data =
						typeof assignment === 'object'
							? assignment
							: ({ user_id: assignment } as AssignmentData);
					const userId = String(data.user_id);
					if (!userId || userId === 'undefined') continue;

					const plannedHours = parseFloat(String(data.planned_hours)) || 0;

					// Parse daily_entries
					let dailyEntries: DailyEntry[] = [];
					if (data.daily_entries) {
						if (typeof data.daily_entries === 'string') {
							try {
								dailyEntries = JSON.parse(data.daily_entries);
							} catch {
								dailyEntries = [];
							}
						} else if (Array.isArray(data.daily_entries)) {
							dailyEntries = data.daily_entries;
						}
					}
					dailyEntries = dailyEntries.filter(
						(e) => e != null && typeof e === 'object'
					);

					const assignmentId = `${projectId}-${activity.id || activityName}-${userId}`;

					if (dailyEntries.length === 0) {
						// Even when no daily entries, emit a single placeholder row so the
						// assignment shows up with its planned manhours (no actual work yet).
						const rows = rowsByUser.get(userId) || [];
						rows.push({
							date: data.due_date || null,
							project_id: projectId,
							project_code: projectCode,
							project_name: (project.project_name as string) || '',
							activity_name: activityName,
							sub_activity_name: subActivityName,
							assignment_id: assignmentId,
							planned_hours: plannedHours,
							hours: 0,
							qty_done: 0,
						});
						rowsByUser.set(userId, rows);
						continue;
					}

					const rows = rowsByUser.get(userId) || [];
					for (const entry of dailyEntries) {
						rows.push({
							date: entry.date || null,
							project_id: projectId,
							project_code: projectCode,
							project_name: (project.project_name as string) || '',
							activity_name: activityName,
							sub_activity_name: subActivityName,
							assignment_id: assignmentId,
							planned_hours: plannedHours,
							hours: parseFloat(String(entry.hours || '0')) || 0,
							qty_done: parseFloat(String(entry.qty_done || '0')) || 0,
						});
					}
					rowsByUser.set(userId, rows);
				}
			}
		}

		// ── 4. Assemble the result (every roster employee, even with rows: []) ─
		const data: EmployeeReportItem[] = Array.from(roster.values()).map(
			(emp) => ({
				user_id: emp.user_id,
				user_name: emp.user_name,
				email: emp.email,
				rows: (rowsByUser.get(emp.user_id) || []).slice(),
			})
		);

		// Sort: employees that actually have work first, then by name.
		data.sort((a, b) => {
			if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length;
			return a.user_name.localeCompare(b.user_name);
		});

		return NextResponse.json({
			success: true,
			data,
			meta: {
				total_employees: data.length,
				employees_with_work: data.filter((d) => d.rows.length > 0).length,
				total_rows: data.reduce((s, d) => s + d.rows.length, 0),
			},
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error('Employee report error:', error);
		return NextResponse.json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
}
