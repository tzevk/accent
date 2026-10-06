/**
 * Per-employee project breakdown for the Employee Utilization report (#299).
 *
 * The month's Logged Hours bucketed by the assignment's project:
 * - Every non-cancelled `user_activity_assignments` row is resolved to its
 *   employee through the shared Logged Hours resolver
 *   (`@/lib/logged-hours-source`) — the one rule the payroll and attendance
 *   readers use, never a second fallback.
 * - The assignment's month hours come from the canonical reader
 *   (`sumLoggedHoursForMonth`), so the buckets foot exactly to the row's
 *   Logged Hours.
 * - A project group carries the project's code/name/client and the
 *   activity/discipline pairs the hours were logged under — each pair summed
 *   and sorted descending, the display name falling back
 *   `project_title → projects.name → project_code → Project #<id>`.
 * - The payload shows the top `PROJECT_BREAKDOWN_TOP_N` project groups
 *   (hours descending, ties by project id ascending so the boundary is
 *   stable) and an `other` bucket (hours + spilled project count) for the
 *   rest.
 * - Hours whose assignment carries no project — or whose project row no
 *   longer resolves — land in an explicit `no_project` bucket, never merged
 *   into `other`.
 *
 * The route queries for itself (the base month payload stays untouched; the
 * breakdown is fetched lazily on row expansion); the pure builders below are
 * exercised by the colocated unit suite and re-derived independently in the
 * E2E spec.
 */

import { R, add, toNumber } from '@/lib/money';
import { sumLoggedHoursForMonth } from '@/lib/logged-hours';
import {
	buildLoggedHoursIdentifierMap,
	resolveLoggedHoursEmployeeId,
} from '@/lib/logged-hours-source';
import { isValidUtilizationMonth } from '@/app/reports/employee-utilization/data-source';
import { query } from '@/utils/database';
import { dbNum, dbStr, type DbRow } from './db-values';

/** How many project groups the breakdown shows before the "Other" bucket. */
export const PROJECT_BREAKDOWN_TOP_N = 5;

/** One activity/discipline pair inside a bucket: the hours logged under it. */
export interface ProjectBreakdownActivity {
	activity_name: string;
	/** Null when the assignment carries no discipline. */
	discipline_name: string | null;
	hours: number;
}

/**
 * One bucket of the breakdown: a project, or the No-project bucket whose
 * `project_id`/`project_code`/`project_name`/`client_name` are all null.
 */
export interface ProjectBreakdownBucket {
	/** `projects.project_id`; null = the No-project bucket. */
	project_id: number | null;
	project_code: string | null;
	/** `project_title` → `projects.name` → `project_code` → `Project #<id>`. */
	project_name: string | null;
	client_name: string | null;
	hours: number;
	/** Distinct activity/discipline pairs, hours descending; empty for `other`. */
	activities: ProjectBreakdownActivity[];
}

/** Everything beyond the top N: its hours and how many project groups spilled. */
export interface ProjectBreakdownOther {
	hours: number;
	project_count: number;
}

/** One employee's month breakdown — the projects route's `data` payload. */
export interface ProjectBreakdown {
	month: string;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	/** Σ of every bucket — must equal the row's Logged Hours for the month. */
	logged_hours: number;
	top_n: number;
	/** Top-N project groups, hours descending. */
	projects: ProjectBreakdownBucket[];
	/** The spilled project groups, always present (0/0 when nothing spilled). */
	other: ProjectBreakdownOther;
	/** The month's project-less hours; null when there are none. */
	no_project: ProjectBreakdownBucket | null;
}

/**
 * One assignment already resolved to the employee and summed for the month.
 * `resolved_project_id` is `projects.project_id` from the join: null means the
 * row did not resolve (soft-deleted or missing project) → No-project bucket.
 */
export interface BreakdownAssignment {
	project_id: number | null;
	resolved_project_id: number | null;
	project_code: string | null;
	project_title: string | null;
	/** `projects.name` — the fallback when `project_title` is empty. */
	project_name: string | null;
	client_name: string | null;
	activity_name: string | null;
	discipline_name: string | null;
	/** The assignment's Logged Hours for the month (already summed). */
	hours: number;
}

function round2(value: number): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/** The display name rule: title → name → code → `Project #<id>`. */
export function projectDisplayName(input: {
	project_id: number;
	project_title: string | null;
	project_name: string | null;
	project_code: string | null;
}): string {
	const title = (input.project_title ?? '').trim();
	const name = (input.project_name ?? '').trim();
	const code = (input.project_code ?? '').trim();
	return title || name || code || `Project #${input.project_id}`;
}

interface BucketAccumulator {
	bucket: ProjectBreakdownBucket;
	activities: Map<string, ProjectBreakdownActivity>;
}

/**
 * Group the month's assignments by project (and project-less hours into the
 * No-project bucket), summing hours and activity/discipline detail. Zero and
 * negative hours are ignored — an assignment with nothing logged this month
 * never creates an empty group.
 */
export function buildProjectBuckets(assignments: BreakdownAssignment[]): {
	projects: ProjectBreakdownBucket[];
	noProject: ProjectBreakdownBucket | null;
	loggedHours: number;
} {
	const accumulators = new Map<string, BucketAccumulator>();
	let total = R(0);

	for (const assignment of assignments) {
		const hours = Number(assignment.hours);
		if (!Number.isFinite(hours) || hours <= 0) continue;
		total = add(total, R(hours));

		const resolved =
			assignment.project_id !== null && assignment.resolved_project_id !== null;
		const key = resolved ? `project:${assignment.project_id}` : 'no_project';
		let accumulator = accumulators.get(key);
		if (!accumulator) {
			accumulator = {
				bucket: {
					project_id: resolved ? Number(assignment.project_id) : null,
					project_code: resolved ? (assignment.project_code ?? null) : null,
					project_name: resolved
						? projectDisplayName({
								project_id: Number(assignment.project_id),
								project_title: assignment.project_title,
								project_name: assignment.project_name,
								project_code: assignment.project_code,
							})
						: null,
					client_name: resolved ? (assignment.client_name ?? null) : null,
					hours: 0,
					activities: [],
				},
				activities: new Map(),
			};
			accumulators.set(key, accumulator);
		}

		accumulator.bucket.hours = toNumber(
			add(R(accumulator.bucket.hours), R(hours))
		);

		const activityName =
			(assignment.activity_name ?? '').trim() || 'Unspecified activity';
		const discipline = assignment.discipline_name ?? null;
		const activityKey = `${activityName}\u0000${discipline ?? ''}`;
		const activity = accumulator.activities.get(activityKey) ?? {
			activity_name: activityName,
			discipline_name: discipline,
			hours: 0,
		};
		activity.hours = toNumber(add(R(activity.hours), R(hours)));
		accumulator.activities.set(activityKey, activity);
	}

	const projects: ProjectBreakdownBucket[] = [];
	let noProject: ProjectBreakdownBucket | null = null;
	for (const { bucket, activities } of accumulators.values()) {
		bucket.hours = round2(bucket.hours);
		bucket.activities = [...activities.values()]
			.map((activity) => ({ ...activity, hours: round2(activity.hours) }))
			.sort(
				(a, b) =>
					b.hours - a.hours ||
					a.activity_name.localeCompare(b.activity_name) ||
					(a.discipline_name ?? '').localeCompare(b.discipline_name ?? '')
			);
		if (bucket.project_id === null) noProject = bucket;
		else projects.push(bucket);
	}

	// Hours descending; the project id tie-break keeps the top-N boundary
	// stable when two projects log the same hours.
	projects.sort(
		(a, b) => b.hours - a.hours || Number(a.project_id) - Number(b.project_id)
	);

	return { projects, noProject, loggedHours: round2(toNumber(total)) };
}

/** Split the project groups into the top N and the "Other" bucket. */
export function splitProjectBuckets(
	groups: ProjectBreakdownBucket[],
	topN: number = PROJECT_BREAKDOWN_TOP_N
): { projects: ProjectBreakdownBucket[]; other: ProjectBreakdownOther } {
	const limit = Math.max(0, Math.floor(topN));
	const top = groups.slice(0, limit);
	const rest = groups.slice(limit);
	return {
		projects: top,
		other: {
			hours: round2(
				toNumber(rest.reduce((sum, bucket) => add(sum, R(bucket.hours)), R(0)))
			),
			project_count: rest.length,
		},
	};
}

/** Assemble the payload: top-N projects + Other + No project, footing to the month. */
export function buildProjectBreakdown(input: {
	month: string;
	employee: { id: number; code: string; name: string };
	assignments: BreakdownAssignment[];
}): ProjectBreakdown {
	const { projects, noProject, loggedHours } = buildProjectBuckets(
		input.assignments
	);
	const { projects: top, other } = splitProjectBuckets(projects);
	return {
		month: input.month,
		employee_id: input.employee.id,
		employee_code: input.employee.code,
		employee_name: input.employee.name,
		logged_hours: loggedHours,
		top_n: PROJECT_BREAKDOWN_TOP_N,
		projects: top,
		other,
		no_project: noProject,
	};
}

// ─── Server fetch (route-backed) ─────────────────────────────────────

/**
 * One month's breakdown for one employee, queried for itself: the employee
 * record, the shared identifier map, then every non-cancelled assignment
 * resolved through the shared rule and summed for the month with the
 * canonical reader. Returns null for an invalid month or an employee that
 * does not exist — the route turns those into 400/404.
 */
export async function fetchProjectBreakdown(
	month: string,
	employeeId: number
): Promise<ProjectBreakdown | null> {
	if (!isValidUtilizationMonth(month)) return null;
	const [employeeRows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name
		 FROM employees
		 WHERE id = ? AND isDelete = 0`,
		[employeeId]
	)) as [DbRow[], unknown];
	if (!employeeRows.length) return null;
	const employee = {
		id: dbNum(employeeRows[0], 'id'),
		code: dbStr(employeeRows[0], 'employee_id'),
		name: dbStr(employeeRows[0], 'name') || `Employee ${employeeId}`,
	};

	// The shared resolution rule's identifier map: employee records first,
	// then user records; the first claim on a key wins.
	const [directoryRows] = (await query(
		`SELECT id, email, username FROM employees WHERE isDelete = 0`
	)) as [DbRow[], unknown];
	const [userRows] = (await query(
		`SELECT employee_id, email, username FROM users WHERE isDelete = 0`
	)) as [DbRow[], unknown];
	const identifiers = buildLoggedHoursIdentifierMap(
		directoryRows.map((row) => ({
			id: dbNum(row, 'id'),
			email: dbStr(row, 'email') || null,
			username: dbStr(row, 'username') || null,
		})),
		userRows.map((row) => ({
			employee_id: dbNum(row, 'employee_id', 0) || null,
			email: dbStr(row, 'email') || null,
			username: dbStr(row, 'username') || null,
		}))
	);

	const [assignmentRows] = (await query(
		`SELECT uaa.employee_id, uaa.user_id, uaa.daily_entries,
		        uaa.project_id, uaa.activity_name, uaa.discipline_name,
		        u.email AS user_email, u.username AS user_username,
		        u.employee_id AS user_employee_id,
		        p.project_id AS resolved_project_id, p.project_code,
		        p.project_title, p.name AS project_name, p.client_name
		 FROM user_activity_assignments uaa
		 LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
		 LEFT JOIN projects p ON p.project_id = uaa.project_id AND p.isDelete = 0
		 WHERE uaa.status <> 'Cancelled'
		   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
	)) as [DbRow[], unknown];

	const assignments: BreakdownAssignment[] = [];
	for (const row of assignmentRows) {
		const resolvedEmployeeId = resolveLoggedHoursEmployeeId(
			{
				employee_id: dbNum(row, 'employee_id', 0) || null,
				user_employee_id: dbNum(row, 'user_employee_id', 0) || null,
				user_email: dbStr(row, 'user_email') || null,
				user_username: dbStr(row, 'user_username') || null,
			},
			identifiers
		);
		if (resolvedEmployeeId !== employeeId) continue;

		const hours = sumLoggedHoursForMonth([dbStr(row, 'daily_entries')], month);
		if (hours <= 0) continue;

		const resolvedProjectId = dbNum(row, 'resolved_project_id', 0) || null;
		assignments.push({
			project_id: dbNum(row, 'project_id', 0) || null,
			resolved_project_id: resolvedProjectId,
			project_code: dbStr(row, 'project_code') || null,
			project_title: dbStr(row, 'project_title') || null,
			project_name: dbStr(row, 'project_name') || null,
			client_name: dbStr(row, 'client_name') || null,
			activity_name: dbStr(row, 'activity_name') || null,
			discipline_name: dbStr(row, 'discipline_name') || null,
			hours,
		});
	}

	return buildProjectBreakdown({ month, employee, assignments });
}
