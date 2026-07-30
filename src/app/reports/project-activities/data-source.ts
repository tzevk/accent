/**
 * Server-side data fetch for the Project Activities report.
 *
 * Shared by:
 *   - GET /api/reports/project-activities         (JSON, existing route.js)
 *   - GET /api/reports/project-activities/download (PDF, server-rendered)
 *
 * Returns ApiProject[] from report-utils. Date-range filtering is applied
 * by the consumer via buildTree() + applyDateRange().
 */

import { query } from '@/utils/database';
import type { ApiProject, ApiMember, ApiActivity } from './report-utils';

export interface FetchOptions {
	startDate?: string;
	endDate?: string;
}

// mysql2 returns rows as objects keyed by column name. We model the unvalidated
// raw shape and read fields through narrow accessors so we never reach for `any`.
type DbRow = Record<string, unknown>;

function s(row: DbRow, key: string, fallback = ''): string {
	const v = row[key];
	if (v == null) return fallback;
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return fallback;
}

function n(row: DbRow, key: string, fallback = 0): number {
	const v = row[key];
	if (v == null || v === '') return fallback;
	const num = typeof v === 'number' ? v : parseFloat(String(v));
	return Number.isFinite(num) ? num : fallback;
}

function arr<T = unknown>(v: unknown): T[] {
	return Array.isArray(v) ? (v as T[]) : [];
}

export async function fetchProjectActivitiesData(
	options: FetchOptions = {}
): Promise<ApiProject[]> {
	// Date filtering is applied by the consumer via buildTree() in report-utils.
	void options;
	// All queries use pool.execute() via query() — no long-held connection.
	const [projectRows] = (await query(
		`SELECT *
		 FROM projects p
		 ORDER BY
			 CASE WHEN p.start_date IS NULL THEN 1 ELSE 0 END,
			 p.start_date DESC,
			 p.project_id DESC`
	)) as [DbRow[], unknown];

	// Build user name map (users + employees fallback)
	const userMap: Record<string, string> = {};
	try {
		const [userRows] = (await query(
			`SELECT id, full_name, username, email FROM users`
		)) as [DbRow[], unknown];
		for (const u of userRows) {
			const id = s(u, 'id');
			if (!id) continue;
			userMap[id] = s(u, 'full_name') || s(u, 'username') || s(u, 'email');
		}
	} catch {
		/* ignore */
	}
	try {
		const [empRows] = (await query(
			`SELECT id, first_name, last_name, email FROM employees`
		)) as [DbRow[], unknown];
		for (const emp of empRows) {
			const id = s(emp, 'id');
			if (!id || userMap[id]) continue;
			const first = s(emp, 'first_name');
			const last = s(emp, 'last_name');
			userMap[id] = [first, last].filter(Boolean).join(' ') || s(emp, 'email');
		}
	} catch {
		/* ignore */
	}

	// Bulk-fetch all project_activities
	const tableActivitiesByProject: Record<string, DbRow[]> = {};
	try {
		const [taRows] = (await query(
			`SELECT id, project_id, activity_name, discipline_name,
				start_date, end_date, manhours_planned, manhours_actual,
				status, progress_percentage, notes
			FROM project_activities
			ORDER BY created_at DESC`
		)) as [DbRow[], unknown];
		for (const ta of taRows) {
			const pid = s(ta, 'project_id');
			if (!pid) continue;
			if (!tableActivitiesByProject[pid]) tableActivitiesByProject[pid] = [];
			tableActivitiesByProject[pid].push(ta);
		}
	} catch {
		/* table may not exist */
	}

	// Bulk-fetch user_activity_assignments
	const allProjectIds = projectRows
		.map((p) => s(p, 'project_id'))
		.filter((id): id is string => !!id);
	const uaaByProject: Record<string, DbRow[]> = {};
	if (allProjectIds.length > 0) {
		try {
			const placeholders = allProjectIds.map(() => '?').join(',');
			const [assignRows] = (await query(
				`SELECT * FROM user_activity_assignments WHERE project_id IN (${placeholders})`,
				allProjectIds
			)) as [DbRow[], unknown];
			for (const row of assignRows) {
				const pid = s(row, 'project_id');
				if (!pid) continue;
				if (!uaaByProject[pid]) uaaByProject[pid] = [];
				uaaByProject[pid].push(row);
			}
		} catch {
			/* table may not exist */
		}
	}

	const result: ApiProject[] = [];

	for (const project of projectRows) {
		const pid = s(project, 'project_id');
		if (!pid) continue;
		const projectAssignments = uaaByProject[pid] || [];

		// Group assignments by activity_id
		const activityMap = new Map<string, ApiActivity>();
		for (const row of projectAssignments) {
			const actId = s(row, 'activity_id');
			if (!actId) continue;
			if (!activityMap.has(actId)) {
				activityMap.set(actId, {
					id: n(row, 'activity_id'),
					activity_name: s(row, 'activity_name', 'Unnamed'),
					activity_description: s(row, 'description'),
					discipline: s(row, 'discipline_name', 'General'),
					members: [],
				});
			}
			const activityEntry = activityMap.get(actId)!;

			// Parse daily_entries JSON
			let dailyEntries: ApiMember['daily_entries'] = [];
			const rawDE = row.daily_entries;
			if (rawDE != null) {
				try {
					dailyEntries = Array.isArray(rawDE)
						? (rawDE as ApiMember['daily_entries'])
						: typeof rawDE === 'string'
							? (JSON.parse(rawDE) as ApiMember['daily_entries'])
							: [];
				} catch {
					dailyEntries = [];
				}
			}
			dailyEntries = arr(dailyEntries).filter(
				(e): e is NonNullable<ApiMember['daily_entries']>[number] =>
					!!e && typeof e === 'object' && 'date' in e
			);

			const totalQtyDone = dailyEntries.reduce(
				(sum, e) => sum + (parseFloat(String(e.qty_done ?? '')) || 0),
				0
			);
			const totalHours = dailyEntries.reduce(
				(sum, e) => sum + (parseFloat(String(e.hours ?? '')) || 0),
				0
			);

			const userId = s(row, 'user_id');
			const member: ApiMember = {
				user_id: userId,
				user_name: userMap[userId] || `User ${userId}`,
				description: s(row, 'description'),
				qty_assigned: n(row, 'qty_assigned'),
				qty_completed: n(row, 'qty_completed') || totalQtyDone,
				planned_hours: n(row, 'estimated_hours'),
				actual_hours: n(row, 'actual_hours') || totalHours,
				start_date: row.start_date as string | null,
				due_date: row.due_date as string | null,
				status: s(row, 'status', 'Not Started'),
				remarks: s(row, 'remarks'),
				daily_entries: dailyEntries,
			};
			activityEntry.members!.push(member);
		}

		const activities: ApiActivity[] = Array.from(activityMap.values());

		for (const ta of tableActivitiesByProject[pid] || []) {
			const taId = n(ta, 'id');
			const taName = s(ta, 'activity_name');
			const taDiscipline = s(ta, 'discipline_name');
			const exists = activities.some(
				(a) =>
					a.id === taId ||
					(a.activity_name === taName && a.discipline === taDiscipline)
			);
			if (!exists) {
				activities.push({
					id: taId,
					activity_name: taName,
					activity_description: s(ta, 'notes'),
					discipline: s(ta, 'discipline_name', 'General'),
					members: [],
					start_date: ta.start_date as string | undefined,
					end_date: ta.end_date as string | undefined,
					manhours_planned: n(ta, 'manhours_planned'),
					manhours_actual: n(ta, 'manhours_actual'),
					status: s(ta, 'status', 'Not Started'),
					progress_percentage: n(ta, 'progress_percentage'),
				});
			}
		}

		// Normalise name field: project_name > name > project_title > fallback
		const projectName =
			s(project, 'project_name') ||
			s(project, 'name') ||
			s(project, 'project_title') ||
			`Project #${pid}`;

		result.push({
			project_id: n(project, 'project_id'),
			project_name: projectName,
			project_code: s(project, 'project_code'),
			project_status:
				s(project, 'status') || s(project, 'project_status', 'Active'),
			client_name: s(project, 'client_name') || s(project, 'client'),
			project_manager: s(project, 'project_manager'),
			start_date: (project.start_date as string | null) || null,
			end_date: (project.end_date as string | null) || null,
			activities,
		});
	}

	return result;
}
