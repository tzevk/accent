/**

 * Server-side data fetchers for the Project Status report.
 *
 * The page is an "Activity Status Report" — a printable matrix of
 * (person × day) hours and quantities for a chosen project, activity,
 * and date range. The data flows from:
 *
 *   - GET /api/reports/project-status          → project picker list
 *   - GET /api/reports/project-status/[id]     → activity list + matrix
 */

import { query } from '@/utils/database';
import { div } from '@/lib/money';

// ── Shared row shape ────────────────────────────────────────────────

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

function toNumberOrZero(v: unknown): number {
	if (v == null || v === '') return 0;
	const num = typeof v === 'number' ? v : parseFloat(String(v));
	return Number.isFinite(num) ? Math.max(0, num) : 0;
}

// ── Project picker ──────────────────────────────────────────────────

export interface ProjectStatusRow {
	project_id: number;
	project_name: string;
	project_code: string;
	client_name: string;
	people_assigned: number;
	target_qty: number; // decimal as number; 0 when not set
	actual_qty: number; // decimal as number; 0 when no assignments
	balance: number; // target_qty - actual_qty (may be negative)
}

/**
 * One row per non-deleted project, with the roll-up of people, target/actual
 * quantity, and remaining balance. Used to populate the project picker on
 * the page (we only need {project_id, project_name, project_code} there, but
 * the extra columns are cheap and keep the data-source general).
 */
export async function fetchProjectStatusData(): Promise<ProjectStatusRow[]> {
	const [rows] = (await query(
		`SELECT
			p.project_id,
			COALESCE(NULLIF(p.project_title, ''), p.name, CONCAT('Project #', p.project_id)) AS project_name,
			COALESCE(p.project_code, '')  AS project_code,
			COALESCE(p.client_name, '')   AS client_name,
			COALESCE(p.unit_qty, 0)       AS target_qty,
			COALESCE(ua.cnt_users, 0)     AS people_assigned,
			COALESCE(ua.sum_completed, 0) AS actual_qty
		FROM projects p
		LEFT JOIN (
			SELECT project_id,
			       COUNT(DISTINCT user_id)         AS cnt_users,
			       SUM(COALESCE(qty_completed, 0)) AS sum_completed
			FROM user_activity_assignments
			WHERE project_id IS NOT NULL
			GROUP BY project_id
		) ua ON ua.project_id = p.project_id
		WHERE COALESCE(p.isDelete, 0) = 0
		ORDER BY p.start_date DESC, p.project_id DESC`
	)) as [DbRow[], unknown];

	const result: ProjectStatusRow[] = [];
	for (const row of rows) {
		const idStr = s(row, 'project_id');
		const id = idStr ? parseInt(idStr, 10) : NaN;
		if (!Number.isFinite(id)) continue;

		const target = toNumberOrZero(row.target_qty);
		const actual = toNumberOrZero(row.actual_qty);
		const balance = target - actual;

		result.push({
			project_id: id,
			project_name: s(row, 'project_name', `Project #${id}`),
			project_code: s(row, 'project_code'),
			client_name: s(row, 'client_name'),
			people_assigned: toNumberOrZero(row.people_assigned),
			target_qty: target,
			actual_qty: actual,
			balance,
		});
	}

	return result;
}

// ── Project meta (header) ───────────────────────────────────────────

export interface ProjectMeta {
	project_id: number;
	project_name: string;
	project_code: string;
	client_name: string;
	start_date: string | null;
	end_date: string | null;
}

export async function fetchProjectMeta(
	projectId: number
): Promise<ProjectMeta | null> {
	const [rows] = (await query(
		`SELECT
			project_id,
			COALESCE(NULLIF(project_title, ''), name, CONCAT('Project #', project_id)) AS project_name,
			COALESCE(project_code, '') AS project_code,
			COALESCE(client_name, '')  AS client_name,
			start_date,
			end_date
		FROM projects
		WHERE project_id = ? AND COALESCE(isDelete, 0) = 0
		LIMIT 1`,
		[projectId]
	)) as [DbRow[], unknown];

	const row = rows[0];
	if (!row) return null;
	const id = parseInt(s(row, 'project_id'), 10);
	if (!Number.isFinite(id)) return null;

	return {
		project_id: id,
		project_name: s(row, 'project_name', `Project #${id}`),
		project_code: s(row, 'project_code'),
		client_name: s(row, 'client_name'),
		start_date: s(row, 'start_date') || null,
		end_date: s(row, 'end_date') || null,
	};
}

// ── Activity list (filter dropdown) ─────────────────────────────────

/**
 * The unique (activity_name, sub_activity_name) pairs in use on a project.
 * `sub_activity_name` is the more specific label, so when present we prefer
 * it (matches the "ACTIVITY: MTO" granularity in the source document).
 */
export interface ProjectActivity {
	activity_name: string;
	sub_activity_name: string;
	label: string; // sub_activity_name || activity_name
}

export async function fetchProjectActivities(
	projectId: number
): Promise<ProjectActivity[]> {
	const [rows] = (await query(
		`SELECT
			COALESCE(NULLIF(activity_name, ''), 'Unnamed') AS activity_name,
			COALESCE(sub_activity_name, '')                AS sub_activity_name
		FROM user_activity_assignments
		WHERE project_id = ?
		GROUP BY activity_name, sub_activity_name
		ORDER BY activity_name ASC, sub_activity_name ASC`,
		[projectId]
	)) as [DbRow[], unknown];

	const seen = new Set<string>();
	const result: ProjectActivity[] = [];
	for (const row of rows) {
		const activityName = s(row, 'activity_name', 'Unnamed');
		const subActivityName = s(row, 'sub_activity_name');
		const label = subActivityName || activityName;
		const key = `${activityName}::${subActivityName}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({
			activity_name: activityName,
			sub_activity_name: subActivityName,
			label,
		});
	}
	return result;
}

// ── Activity Status Report (matrix) ─────────────────────────────────

export interface DailyCell {
	hours: number;
	qty_done: number;
}

export interface ReportRow {
	user_id: string;
	user_name: string;
	days: Record<string, DailyCell>; // keyed by YYYY-MM-DD
	total_hours: number;
	total_qty: number;
	hours_per_qty: number; // total_hours / total_qty (0 when qty=0)
}

export interface ActivityStatusReport {
	project: ProjectMeta;
	activity: string; // resolved label (sub_activity_name || activity_name)
	activity_name: string;
	sub_activity_name: string;
	from: string; // YYYY-MM-DD
	to: string; // YYYY-MM-DD
	dates: string[]; // inclusive, YYYY-MM-DD
	rows: ReportRow[];
}

interface FetchReportOptions {
	projectId: number;
	activity: string; // label to match (we resolve to the canonical pair)
	subActivityName?: string;
	activityName?: string;
	from: string; // YYYY-MM-DD inclusive
	to: string; // YYYY-MM-DD inclusive
}

interface DailyEntryShape {
	date?: string | null;
	hours?: number | string | null;
	qty_done?: number | string | null;
}

function parseDailyEntries(raw: unknown): DailyEntryShape[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(e): e is DailyEntryShape => !!e && typeof e === 'object' && 'date' in e
		);
	} catch {
		return [];
	}
}

/** Inclusive list of YYYY-MM-DD dates between [from, to]. */
export function expandDateRange(from: string, to: string): string[] {
	const start = new Date(`${from}T00:00:00Z`);
	const end = new Date(`${to}T00:00:00Z`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
	if (start > end) return [];
	const out: string[] = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		out.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
}

/**
 * Build the (person × day) matrix for a project + activity + date range.
 * Pulls every assignment row for the project, filters by activity match
 * in JS (daily_entries is a JSON blob, so SQL filtering is unreliable),
 * and aggregates hours / qty_done per (user, day).
 */
export async function fetchActivityStatusReport(
	options: FetchReportOptions
): Promise<ActivityStatusReport | null> {
	const { projectId, from, to } = options;
	const project = await fetchProjectMeta(projectId);
	if (!project) return null;

	const dates = expandDateRange(from, to);
	if (dates.length === 0) {
		return {
			project,
			activity: options.activity,
			activity_name: options.activityName || options.activity,
			sub_activity_name: options.subActivityName || '',
			from,
			to,
			dates: [],
			rows: [],
		};
	}

	// ── 1. Resolve the activity pair (best-effort) ─────────────────
	// We accept a free-form label and try to find a matching pair in the
	// project. If we can't, we fall back to the label as activity_name.
	const activities = await fetchProjectActivities(projectId);
	const match =
		activities.find(
			(a) =>
				a.sub_activity_name &&
				options.subActivityName &&
				a.sub_activity_name === options.subActivityName
		) ||
		activities.find(
			(a) => a.sub_activity_name && a.sub_activity_name === options.activity
		) ||
		activities.find((a) => a.activity_name === options.activityName) ||
		activities.find((a) => a.label === options.activity);

	const activityName =
		match?.activity_name || options.activityName || options.activity;
	const subActivityName =
		match?.sub_activity_name || options.subActivityName || '';
	const activityLabel = subActivityName || activityName;

	// ── 2. Build the user roster (so empty rows still show up) ─────
	const roster = new Map<string, { user_id: string; user_name: string }>();
	try {
		const [users] = await query(
			`SELECT id, COALESCE(NULLIF(full_name, ''), username, email) AS user_name
			 FROM users
			 WHERE COALESCE(isDelete, 0) = 0`
		);
		for (const u of users as DbRow[]) {
			const id = s(u, 'id');
			if (!id) continue;
			roster.set(String(id), {
				user_id: String(id),
				user_name: s(u, 'user_name', `User ${id}`),
			});
		}
	} catch {
		/* ignore */
	}

	// ── 3. Walk every assignment for the project, filter by activity ─
	const rowsByUser = new Map<string, ReportRow>();

	try {
		const [assignments] = await query(
			`SELECT user_id, activity_name, sub_activity_name, daily_entries
			 FROM user_activity_assignments
			 WHERE project_id = ?`,
			[projectId]
		);

		for (const row of assignments as DbRow[]) {
			const rowActivity = s(row, 'activity_name');
			const rowSub = s(row, 'sub_activity_name');
			// Match by (sub_activity_name, activity_name) when sub is set,
			// otherwise fall back to activity_name only.
			const matches =
				subActivityName && rowSub
					? rowActivity === activityName && rowSub === subActivityName
					: !subActivityName && rowActivity === activityName;

			if (!matches) continue;

			const userId = s(row, 'user_id');
			if (!userId) continue;
			const id = String(userId);

			// Make sure the user has a roster entry (covers employees table users too).
			if (!roster.has(id)) {
				roster.set(id, {
					user_id: id,
					user_name: `User ${id}`,
				});
				try {
					const [empRows] = await query(
						`SELECT COALESCE(NULLIF(first_name, ''), '') AS first_name,
						        COALESCE(NULLIF(last_name, ''), '')  AS last_name,
						        COALESCE(email, '')                  AS email
						 FROM employees WHERE id = ? LIMIT 1`,
						[id]
					);
					const emp = (empRows as DbRow[])[0];
					if (emp) {
						const full = [s(emp, 'first_name'), s(emp, 'last_name')]
							.filter(Boolean)
							.join(' ');
						roster.set(id, {
							user_id: id,
							user_name: full || s(emp, 'email') || `User ${id}`,
						});
					}
				} catch {
					/* employees table may not exist */
				}
			}

			const entries = parseDailyEntries(row.daily_entries);
			for (const entry of entries) {
				const entryDate = typeof entry.date === 'string' ? entry.date : '';
				if (!entryDate) continue;
				if (entryDate < from || entryDate > to) continue;

				let reportRow = rowsByUser.get(id);
				if (!reportRow) {
					reportRow = {
						user_id: id,
						user_name: roster.get(id)?.user_name || `User ${id}`,
						days: {},
						total_hours: 0,
						total_qty: 0,
						hours_per_qty: 0,
					};
					rowsByUser.set(id, reportRow);
				}

				const cell = reportRow.days[entryDate] || { hours: 0, qty_done: 0 };
				cell.hours += toNumberOrZero(entry.hours);
				cell.qty_done += toNumberOrZero(entry.qty_done);
				reportRow.days[entryDate] = cell;
				reportRow.total_hours += toNumberOrZero(entry.hours);
				reportRow.total_qty += toNumberOrZero(entry.qty_done);
			}
		}
	} catch {
		/* table may not exist */
	}

	// ── 4. Finalize: ratio + sort by name ─────────────────────────
	const rows: ReportRow[] = Array.from(roster.values())
		.map((emp) => {
			const existing = rowsByUser.get(emp.user_id);
			if (existing) {
				const ratio = div(existing.total_hours, existing.total_qty);
				const ratioNum = ratio.toNumber();
				const safeRatio = Number.isFinite(ratioNum)
					? Math.round(ratioNum * 10) / 10
					: 0;
				return {
					...existing,
					user_name: existing.user_name || emp.user_name,
					hours_per_qty: safeRatio,
				};
			}
			// Empty row for users with no work in the window.
			return {
				user_id: emp.user_id,
				user_name: emp.user_name,
				days: {},
				total_hours: 0,
				total_qty: 0,
				hours_per_qty: 0,
			};
		})
		.sort((a, b) => a.user_name.localeCompare(b.user_name));

	return {
		project,
		activity: activityLabel,
		activity_name: activityName,
		sub_activity_name: subActivityName,
		from,
		to,
		dates,
		rows,
	};
}
