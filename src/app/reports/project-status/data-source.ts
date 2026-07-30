/**
 * Server-side data fetch for the Project Status report.
 *
 * Shared by:
 *   - GET /api/reports/project-status
 *
 * Returns one flat row per non-deleted project with the roll-up of
 * people, target/actual quantity, and remaining balance. No date filter
 * is applied — this is a current-snapshot report.
 */

import { query } from '@/utils/database';

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
