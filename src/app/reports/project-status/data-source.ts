/**

 * Server-side data fetchers for the Project Status report.
 *
 * The page is an "Activity Status Report" — a printable matrix of
 * (person × day) hours and quantities for a chosen project and date
 * range, aggregated across every activity the project has. The data
 * flows from:
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

// ── Project roster (employee filter) ────────────────────────────────

export interface RosterMember {
	user_id: string;
	user_name: string;
}

/**
 * The people who can appear on the report: project_team/team_members first,
 * plus any user with assignments on the project. Names for users outside
 * the team list are resolved in bulk (users table, then employees).
 */
export async function fetchProjectRoster(
	projectId: number
): Promise<RosterMember[]> {
	const roster = new Map<string, string>(); // user_id → user_name

	// Primary name source: the project's project_team JSON column
	// (actively managed by addTeamMember/removeTeamMember in EditProjectForm).
	// Falls back to team_members (older column) when project_team is empty.
	try {
		const [projRows] = await query(
			`SELECT project_team, team_members FROM projects WHERE project_id = ?`,
			[projectId]
		);
		const raw = (projRows as DbRow[])[0];
		if (raw) {
			const parseMembers = (v: unknown): Array<Record<string, unknown>> => {
				if (v == null) return [];
				const parsed = typeof v === 'string' ? JSON.parse(v) : v;
				return Array.isArray(parsed) ? parsed : [];
			};
			const members =
				parseMembers(raw.project_team).length > 0
					? parseMembers(raw.project_team)
					: parseMembers(raw.team_members);
			for (const m of members) {
				const uid = s(m, 'id');
				if (!uid) continue;
				roster.set(
					String(uid),
					s(m, 'name') || s(m, 'full_name') || `User ${uid}`
				);
			}
		}
	} catch {
		/* ignore */
	}

	// Users with assignments but no team entry (covers employees-table users).
	const unknownIds = new Set<string>();
	try {
		const [rows] = await query(
			`SELECT DISTINCT user_id
			 FROM user_activity_assignments
			 WHERE project_id = ?`,
			[projectId]
		);
		for (const row of rows as DbRow[]) {
			const uid = s(row, 'user_id');
			if (uid && !roster.has(String(uid))) unknownIds.add(String(uid));
		}
	} catch {
		/* table may not exist */
	}

	if (unknownIds.size > 0) {
		const names = await resolveUserNames(unknownIds);
		for (const [id, name] of names) roster.set(id, name);
	}

	return Array.from(roster, ([user_id, user_name]) => ({
		user_id,
		user_name,
	})).sort((a, b) => a.user_name.localeCompare(b.user_name));
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
	activity: string; // constant label — the matrix aggregates every activity
	from: string; // YYYY-MM-DD
	to: string; // YYYY-MM-DD
	dates: string[]; // inclusive, YYYY-MM-DD
	rows: ReportRow[];
}

interface FetchReportOptions {
	projectId: number;
	from: string; // YYYY-MM-DD inclusive
	to: string; // YYYY-MM-DD inclusive
	userIds?: string[]; // restrict the matrix to these users (employee filter)
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
 * Best-effort name lookup for users not present in the project roster.
 * One query per table (users, then employees) for the whole batch — avoids
 * the N+1 of per-user lookups.
 */
async function resolveUserNames(
	ids: Set<string>
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	const idList = Array.from(ids);

	try {
		const [userRows] = await query(
			`SELECT id, COALESCE(NULLIF(full_name, ''), username, email) AS user_name
			 FROM users WHERE id IN (${idList.map(() => '?').join(', ')})`,
			idList
		);
		for (const u of userRows as DbRow[]) {
			const id = s(u, 'id');
			if (id) names.set(id, s(u, 'user_name') || `User ${id}`);
		}
	} catch {
		/* ignore */
	}

	const stillMissing = idList.filter((id) => !names.has(id));
	if (stillMissing.length > 0) {
		try {
			const [empRows] = await query(
				`SELECT id,
				        COALESCE(NULLIF(first_name, ''), '') AS first_name,
				        COALESCE(NULLIF(last_name, ''), '')  AS last_name,
				        COALESCE(email, '')                  AS email
				 FROM employees WHERE id IN (${stillMissing.map(() => '?').join(', ')})`,
				stillMissing
			);
			for (const emp of empRows as DbRow[]) {
				const id = s(emp, 'id');
				if (!id) continue;
				const full = [s(emp, 'first_name'), s(emp, 'last_name')]
					.filter(Boolean)
					.join(' ');
				names.set(id, full || s(emp, 'email') || `User ${id}`);
			}
		} catch {
			/* employees table may not exist */
		}
	}

	return names;
}

/**
 * Build the (person × day) matrix for a project + date range.
 * Pulls every assignment row for the project (daily_entries is a JSON blob,
 * so aggregation happens in JS) and sums hours / qty_done per (user, day)
 * across ALL activities — one cell per person per day.
 */
export async function fetchActivityStatusReport(
	options: FetchReportOptions
): Promise<ActivityStatusReport | null> {
	const { projectId, from, to, userIds } = options;
	const project = await fetchProjectMeta(projectId);
	if (!project) return null;

	const dates = expandDateRange(from, to);
	if (dates.length === 0) {
		return {
			project,
			activity: 'All Activities',
			from,
			to,
			dates: [],
			rows: [],
		};
	}

	// ── 1. Roster: team members ∪ assignment users (names resolved in bulk) ─
	const roster = new Map<string, RosterMember>(
		(await fetchProjectRoster(projectId)).map((m) => [m.user_id, m])
	);

	// ── 2. Walk every assignment (all activities) and aggregate ──
	const rowsByUser = new Map<string, ReportRow>();

	try {
		const [assignments] = await query(
			`SELECT user_id, daily_entries
			 FROM user_activity_assignments
			 WHERE project_id = ?`,
			[projectId]
		);

		for (const row of assignments as DbRow[]) {
			const userId = s(row, 'user_id');
			if (!userId) continue;
			const id = String(userId);

			// Safety net: assignment users missing from the roster still get a row.
			if (!roster.has(id)) {
				roster.set(id, { user_id: id, user_name: `User ${id}` });
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

	// ── 3. Finalize: ratio + sort by name ─────────────────────────
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

	// ── 4. Employee filter (optional) ────────────────────────────
	const filteredRows =
		userIds && userIds.length > 0
			? rows.filter((r) => userIds.includes(r.user_id))
			: rows;

	return {
		project,
		activity: 'All Activities',
		from,
		to,
		dates,
		rows: filteredRows,
	};
}
