import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

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
	default_manhours: number; // Default Manhours (activity-level)
	planned_hours: number; // Planned Hours (assignment-level)
	qty_completed: number; // Completed quantity (assignment-level)
	hours: number; // Actual Manhours (that day's hours)
	qty_done: number; // Unit/Qty (that day's quantity)
}

interface EmployeeReportItem {
	user_id: string;
	user_name: string;
	email: string;
	rows: DailyRow[];
}

interface ReportUser {
	is_super_admin?: boolean | number;
	field_permissions?: unknown;
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

/** Raw row from `user_activity_assignments` table. */
interface UaaRow {
	user_id: number | string;
	project_id: number | string;
	activity_id: string;
	activity_name?: string;
	discipline_name?: string;
	sub_activity_name?: string;
	default_manhours?: number | string;
	estimated_hours?: number | string;
	actual_hours?: number | string;
	qty_assigned?: number | string;
	qty_completed?: number | string;
	due_date?: string | null;
	status?: string;
	remarks?: string;
	daily_entries?: string | DailyEntry[];
	created_at?: string;
	[key: string]: unknown;
}

/** Shape of a single daily entry in an assignment's `daily_entries`. */
interface DailyEntry {
	date?: string | null;
	qty_done?: number | string;
	hours?: number | string;
	[key: string]: unknown;
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

		// ── 2. Load projects for name/code lookup ────────────────────────────
		const [projectsRaw] = await query(`
			SELECT project_id, name, project_code, project_title
			FROM projects
			ORDER BY project_id DESC
		`);
		const projects = (projectsRaw as ProjectRow[]).map((p) => {
			if (!p.project_name && p.name) p.project_name = p.name;
			if (!p.project_name && p.project_title) p.project_name = p.project_title;
			return p;
		});

		// Build project lookup map
		const projectMap = new Map<
			string,
			{ project_name: string; project_code: string }
		>();
		for (const p of projects) {
			projectMap.set(String(p.project_id), {
				project_name: (p.project_name as string) || '',
				project_code: (p.project_code as string) || '',
			});
		}

		// ── 3. Load assignments from normalized table ────────────────────────
		const rowsByUser = new Map<string, DailyRow[]>();

		try {
			const [assignments] = await query(`
				SELECT * FROM user_activity_assignments
				ORDER BY project_id, created_at ASC
			`);

			for (const row of assignments as UaaRow[]) {
				const userId = String(row.user_id);
				const projectId = String(row.project_id);
				const projInfo = projectMap.get(projectId) || {
					project_name: '',
					project_code: '',
				};

				const activityName = row.activity_name || 'Unnamed';
				const subActivityName = row.sub_activity_name || '';
				const assignmentId = `${projectId}-${row.activity_id}-${userId}`;
				const defaultManhours = parseFloat(String(row.default_manhours)) || 0;
				const plannedHours =
					parseFloat(String(row.estimated_hours || '0')) || 0;
				const qtyCompleted = parseFloat(String(row.qty_completed || '0')) || 0;

				// Parse daily_entries
				let dailyEntries: DailyEntry[] = [];
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
							(e: DailyEntry) => e != null && typeof e === 'object'
						)
					: [];

				if (dailyEntries.length === 0) {
					const rows = rowsByUser.get(userId) || [];
					rows.push({
						date: row.due_date || null,
						project_id: row.project_id,
						project_code: projInfo.project_code,
						project_name: projInfo.project_name,
						activity_name: activityName,
						sub_activity_name: subActivityName,
						assignment_id: assignmentId,
						default_manhours: defaultManhours,
						planned_hours: plannedHours,
						qty_completed: qtyCompleted,
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
						project_id: row.project_id,
						project_code: projInfo.project_code,
						project_name: projInfo.project_name,
						activity_name: activityName,
						sub_activity_name: subActivityName,
						assignment_id: assignmentId,
						default_manhours: defaultManhours,
						planned_hours: plannedHours,
						qty_completed: qtyCompleted,
						hours: parseFloat(String(entry.hours || '0')) || 0,
						qty_done: parseFloat(String(entry.qty_done || '0')) || 0,
					});
				}
				rowsByUser.set(userId, rows);
			}
		} catch {
			/* table may not exist */
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
