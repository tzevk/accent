/**
 * Recorded Work Period persistence — caller-owned transactions.
 *
 * Every function runs on the supplied Drizzle/mysql2 connection. The caller
 * owns begin/commit/rollback and connection release. A mutation must first
 * lock the affected Employee with lockWorkPeriodEmployee(), then perform the
 * overlap check and mutation on that same transaction. Locking reads below are
 * current reads, so a REPEATABLE READ snapshot cannot make that check stale.
 *
 * work_periods is authoritative. refreshWorkPeriodEntries() only rebuilds the
 * derived work_period_entries projection; it never changes daily_entries,
 * actual_hours, estimates, or assignment metadata.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { istDate, workPeriodDailyEntries } from '@/lib/work-periods';

export type WorkPeriodStoreDb = Pick<
	MySql2Database<Record<string, never>>,
	'execute'
>;

export interface WorkPeriodRecord {
	id: string;
	assignmentId: string;
	employeeId: number;
	startMs: number;
	endMs: number;
	quantity: string;
	dateCompleted: string;
	remarks: string | null;
}

export interface WorkPeriodListingRecord extends WorkPeriodRecord {
	projectId: number | null;
	activityId: string | null;
	userId: number;
	projectCode: string | null;
	projectName: string | null;
	discipline: string | null;
	activityName: string;
	subActivityName: string | null;
	employeeName: string | null;
}

export interface WorkPeriodWriteData {
	id: string;
	assignmentId: string;
	employeeId: number;
	startMs: number;
	endMs: number;
	quantity: string | number;
	dateCompleted: string;
	remarks: string | null;
}

export interface ReadWorkPeriodsOptions {
	employeeId?: number;
	projectId?: number;
	/** Epoch milliseconds, inclusive lower bound for overlap. */
	weekStart?: number;
	/** Epoch milliseconds, exclusive upper bound for overlap. */
	weekEnd?: number;
}

type SqlRow = Record<string, unknown>;

const WORK_PERIOD_COLUMNS = `id, assignment_id, employee_id, start_ms, end_ms,
  quantity, date_completed, remarks`;

/** Normalize Drizzle/mysql2's row-or-header result tuple for this store. */
async function execute(
	db: WorkPeriodStoreDb,
	query: SQL
): Promise<[unknown, unknown]> {
	return (await db.execute(query)) as unknown as [unknown, unknown];
}

function rowsOf(value: unknown): SqlRow[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is SqlRow =>
			row !== null && typeof row === 'object' && !Array.isArray(row)
	);
}

function requiredInteger(value: unknown, field: string): number {
	const number =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(number)) {
		throw new Error(`Invalid Work Period ${field}`);
	}
	return number;
}

function requiredText(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new Error(`Invalid Work Period ${field}`);
	}
	return value;
}

function optionalText(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}

/** mysql2 parses DATE in the session's local zone; local getters recover it. */
function requiredDateText(value: unknown): string {
	if (typeof value === 'string') {
		const text = value.trim().slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
	}
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		const year = value.getFullYear();
		const month = String(value.getMonth() + 1).padStart(2, '0');
		const day = String(value.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
	throw new Error('Invalid Work Period date_completed');
}

function decimalText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value.toFixed(2);
	}
	throw new Error('Invalid Work Period quantity');
}

function workPeriodRecord(row: SqlRow): WorkPeriodRecord {
	return {
		id: requiredText(row.id, 'id'),
		assignmentId: requiredText(row.assignment_id, 'assignment_id'),
		employeeId: requiredInteger(row.employee_id, 'employee_id'),
		startMs: requiredInteger(row.start_ms, 'start_ms'),
		endMs: requiredInteger(row.end_ms, 'end_ms'),
		quantity: decimalText(row.quantity),
		dateCompleted: requiredDateText(row.date_completed),
		remarks: optionalText(row.remarks),
	};
}

function listingRecord(row: SqlRow): WorkPeriodListingRecord {
	const record = workPeriodRecord(row);
	const employeeName = optionalText(row.employee_name)?.trim() || null;
	return {
		...record,
		projectId:
			row.project_id === null || row.project_id === undefined
				? null
				: requiredInteger(row.project_id, 'project_id'),
		activityId: optionalText(row.activity_id),
		userId: requiredInteger(row.user_id, 'user_id'),
		projectCode: optionalText(row.project_code),
		projectName: optionalText(row.project_name),
		discipline: optionalText(row.discipline),
		activityName: requiredText(row.activity_name, 'activity_name'),
		subActivityName: optionalText(row.sub_activity_name),
		employeeName,
	};
}

function affectedRowsOf(value: unknown): number {
	const header =
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? (value as SqlRow)
			: null;
	return typeof header?.affectedRows === 'number' ? header.affectedRows : 0;
}

/**
 * Take the per-Employee mutex before any consistent read used by a write.
 * Returns false when the Employee does not exist.
 */
export async function lockWorkPeriodEmployee(
	db: WorkPeriodStoreDb,
	employeeId: number
): Promise<boolean> {
	const [result] = await execute(
		db,
		sql`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`
	);
	return rowsOf(result).length > 0;
}

/**
 * Current-read overlap check for the half-open interval [startMs, endMs).
 * The Employee lock serializes all Projects; the locking period read observes
 * commits that finished before this transaction acquired that lock.
 */
export async function assertNoWorkPeriodOverlap(
	db: WorkPeriodStoreDb,
	{
		employeeId,
		startMs,
		endMs,
		excludeId,
	}: {
		employeeId: number;
		startMs: number;
		endMs: number;
		excludeId?: string;
	}
): Promise<boolean> {
	if (!(await lockWorkPeriodEmployee(db, employeeId))) return false;

	const excludeSql =
		excludeId === undefined ? sql`` : sql` AND id <> ${excludeId}`;
	const [result] = await execute(
		db,
		sql`SELECT id FROM work_periods
		    WHERE employee_id = ${employeeId} AND start_ms < ${endMs} AND end_ms > ${startMs}${excludeSql}
		    LIMIT 1 FOR UPDATE`
	);
	return rowsOf(result).length === 0;
}

/**
 * List periods overlapping the optional epoch-ms bounds, with display joins.
 * A complete week also includes quantity-only rows whose Date Completed falls
 * in that IST week, even when their elapsed time belongs to another week.
 */
export async function readWorkPeriods(
	db: WorkPeriodStoreDb,
	options: ReadWorkPeriodsOptions = {}
): Promise<WorkPeriodListingRecord[]> {
	const filters: SQL[] = [];

	if (options.employeeId !== undefined) {
		filters.push(sql`wp.employee_id = ${options.employeeId}`);
	}
	if (options.projectId !== undefined) {
		filters.push(sql`uaa.project_id = ${options.projectId}`);
	}
	if (options.weekStart !== undefined && options.weekEnd !== undefined) {
		filters.push(sql`(
			(wp.end_ms > ${options.weekStart} AND wp.start_ms < ${options.weekEnd})
			OR (
				wp.quantity > 0
				AND wp.date_completed >= ${istDate(options.weekStart)}
				AND wp.date_completed < ${istDate(options.weekEnd)}
			)
		)`);
	} else {
		if (options.weekStart !== undefined) {
			filters.push(sql`wp.end_ms > ${options.weekStart}`);
		}
		if (options.weekEnd !== undefined) {
			filters.push(sql`wp.start_ms < ${options.weekEnd}`);
		}
	}

	const whereSql =
		filters.length === 0 ? sql`` : sql` WHERE ${sql.join(filters, sql` AND `)}`;
	const [result] = await execute(
		db,
		sql`SELECT
		   wp.id, wp.assignment_id, wp.employee_id, wp.start_ms, wp.end_ms,
		   wp.quantity, wp.date_completed, wp.remarks,
		   uaa.user_id, uaa.project_id, uaa.activity_id,
		   p.project_code, p.project_title AS project_name,
		   uaa.discipline_name AS discipline, uaa.activity_name,
		   uaa.sub_activity_name,
		   TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name
		 FROM work_periods AS wp
		 INNER JOIN user_activity_assignments AS uaa ON uaa.id = wp.assignment_id
		 INNER JOIN projects AS p
		   ON p.project_id = uaa.project_id AND (p.isDelete = 0 OR p.isDelete IS NULL)
		 LEFT JOIN employees AS e ON e.id = wp.employee_id${whereSql}
		 ORDER BY wp.start_ms ASC, wp.id ASC`
	);
	return rowsOf(result).map(listingRecord);
}

/** Current read used to authorize and validate a mutation in its transaction. */
export async function getWorkPeriod(
	db: WorkPeriodStoreDb,
	id: string
): Promise<WorkPeriodRecord | null> {
	const [result] = await execute(
		db,
		sql`SELECT ${sql.raw(WORK_PERIOD_COLUMNS)} FROM work_periods
		    WHERE id = ${id} FOR UPDATE`
	);
	const rows = rowsOf(result);
	return rows.length === 0 ? null : workPeriodRecord(rows[0]!);
}

/** Insert canonical data, then rebuild the assignment's derived projection. */
export async function insertWorkPeriod(
	db: WorkPeriodStoreDb,
	data: WorkPeriodWriteData
): Promise<WorkPeriodRecord> {
	const [result] = await execute(
		db,
		sql`INSERT INTO work_periods
		    (id, assignment_id, employee_id, start_ms, end_ms, date_completed, quantity, remarks)
		    VALUES (${data.id}, ${data.assignmentId}, ${data.employeeId}, ${data.startMs},
		            ${data.endMs}, ${data.dateCompleted}, ${data.quantity}, ${data.remarks})`
	);
	if (affectedRowsOf(result) !== 1) {
		throw new Error('Work Period insert did not affect one row');
	}
	await refreshWorkPeriodEntries(db, data.assignmentId);
	const record = await getWorkPeriod(db, data.id);
	if (record === null)
		throw new Error('Inserted Work Period could not be read');
	return record;
}

/** Correct canonical data, rebuilding both old and new assignment projections. */
export async function updateWorkPeriod(
	db: WorkPeriodStoreDb,
	data: WorkPeriodWriteData
): Promise<WorkPeriodRecord | null> {
	const existing = await getWorkPeriod(db, data.id);
	if (existing === null) return null;

	await execute(
		db,
		sql`UPDATE work_periods
		    SET assignment_id = ${data.assignmentId}, employee_id = ${data.employeeId},
		        start_ms = ${data.startMs}, end_ms = ${data.endMs},
		        date_completed = ${data.dateCompleted}, quantity = ${data.quantity},
		        remarks = ${data.remarks}
		    WHERE id = ${data.id}`
	);
	await refreshWorkPeriodEntries(db, existing.assignmentId);
	if (existing.assignmentId !== data.assignmentId) {
		await refreshWorkPeriodEntries(db, data.assignmentId);
	}
	return getWorkPeriod(db, data.id);
}

/** Delete only this canonical period, then rebuild its former projection. */
export async function deleteWorkPeriod(
	db: WorkPeriodStoreDb,
	id: string
): Promise<boolean> {
	const existing = await getWorkPeriod(db, id);
	if (existing === null) return false;

	const [result] = await execute(
		db,
		sql`DELETE FROM work_periods WHERE id = ${id}`
	);
	if (affectedRowsOf(result) !== 1) {
		throw new Error('Work Period delete did not affect one row');
	}
	await refreshWorkPeriodEntries(db, existing.assignmentId);
	return true;
}

interface ProjectedDay {
	date: string;
	hours: number;
	qty_done: number;
	remarks: string;
}

function projectedDays(periods: readonly WorkPeriodRecord[]): ProjectedDay[] {
	const byDate = new Map<string, ProjectedDay>();
	for (const period of periods) {
		const entries = workPeriodDailyEntries({
			startMs: period.startMs,
			endMs: period.endMs,
			quantity: Number(period.quantity),
			dateCompleted: period.dateCompleted,
			remarks: period.remarks ?? '',
		});
		for (const entry of entries) {
			const current = byDate.get(entry.date) ?? {
				date: entry.date,
				hours: 0,
				qty_done: 0,
				remarks: '',
			};
			current.hours += entry.hours;
			current.qty_done += entry.qty_done;
			if (entry.remarks) {
				current.remarks = current.remarks
					? `${current.remarks}; ${entry.remarks}`
					: entry.remarks;
			}
			byDate.set(entry.date, current);
		}
	}
	return [...byDate.values()]
		.sort((left, right) => left.date.localeCompare(right.date))
		.map((entry) => ({
			...entry,
			hours: Math.round(entry.hours * 1_000_000) / 1_000_000,
			qty_done: Math.round(entry.qty_done * 100) / 100,
		}));
}

/**
 * Rebuild work_period_entries from canonical periods. The caller must already
 * hold the assignment Employee's row lock. No periods means a NULL projection,
 * which leaves the legacy daily_entries payload wholly untouched. Locking
 * reads bypass an older REPEATABLE READ snapshot; the caller's transaction
 * makes the canonical change and projection atomic.
 */
export async function refreshWorkPeriodEntries(
	db: WorkPeriodStoreDb,
	assignmentId: string
): Promise<boolean> {
	const [assignmentResult] = await execute(
		db,
		sql`SELECT id FROM user_activity_assignments
		    WHERE id = ${assignmentId} FOR UPDATE`
	);
	if (rowsOf(assignmentResult).length === 0) return false;

	const [periodResult] = await execute(
		db,
		sql`SELECT ${sql.raw(WORK_PERIOD_COLUMNS)} FROM work_periods
		    WHERE assignment_id = ${assignmentId}
		    ORDER BY start_ms ASC, id ASC FOR UPDATE`
	);
	const periodRows = rowsOf(periodResult);

	const projection =
		periodRows.length === 0
			? null
			: JSON.stringify(projectedDays(periodRows.map(workPeriodRecord)));
	await execute(
		db,
		sql`UPDATE user_activity_assignments
		    SET work_period_entries = ${projection} WHERE id = ${assignmentId}`
	);
	return true;
}
