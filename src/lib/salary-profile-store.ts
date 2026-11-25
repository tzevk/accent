/**
 * Transactional Salary Profile store contracts — caller-owned connections.
 *
 * The cross-feature per-Employee mutex is the `employees.id` row. Lock order is
 * `payroll_runs` (held by Generate/Finalize) -> `employees` ascending -> salary
 * timeline/profile/use rows. Salary write transactions run at MariaDB READ
 * COMMITTED (`beginSalaryWriteTransaction` / `SALARY_WRITE_ISOLATION`), which
 * removes the REPEATABLE READ gap locks that deadlocked independent Employees.
 * The write path still reads profiles/legacy profiles/use evidence with
 * `{ forUpdate: true }` (or after `lockSalaryEmployees`): those reads are
 * current reads that take exclusive row locks under the per-Employee mutex, so
 * a waiter sees every commit that completed before it acquired the mutex.
 *
 * These helpers never begin, commit, roll back or release a connection and
 * never touch Payroll Slips or Runs. A failed statement leaves the caller's
 * transaction to roll back, including evidence and version changes.
 *
 * Use evidence is durable and source-qualified: canonical
 * `employee_salary_profile` id 7 and legacy `salary_structures` id 7 are
 * different agreements. Evidence is never edited or deleted by cancellation,
 * slip deletion, run reopen or a salary correction.
 */

import {
	normalizeSalaryMonth,
	type SalaryAgreementSource,
	type SalaryProfileRow,
} from './salary-profile-timeline';

export type SalaryStoreDb = {
	/**
	 * mysql2 `execute` result tuple. For a read the first element is the rows
	 * array; for a write it is a `ResultSetHeader`. The second element is the
	 * field list, which these helpers never need.
	 *
	 * `params` is a mutable array because mysql2 `execute` takes
	 * `ExecuteValues[]`; a `readonly` array would make a real `PoolConnection`
	 * unassignable. Every helper builds its own parameter array.
	 */
	execute(
		sql: string,
		params?: Array<string | number | boolean | null>
	): Promise<[unknown, unknown]>;
};

export interface SalaryEmployeeLock {
	employee_id: number;
	timeline_version: number;
	/** false when no employee_salary_timelines row exists yet (version is 0). */
	timeline_exists: boolean;
	joining_date: string | null;
	hire_date: string | null;
	is_delete: boolean;
}

export type SalaryTimelineVersionResult =
	| { ok: true; employee_id: number; version: number }
	| {
			ok: false;
			code: 'stale_version';
			employee_id: number;
			expected_version: number;
			actual_version: number;
	  };

export type SalaryUseSource =
	| 'payroll_generation'
	| 'payroll_finalization'
	| 'legacy_slip'
	| 'legacy_audit'
	| 'legacy_roster';

export interface SalaryUseEvidence {
	id: number;
	employee_id: number;
	month: string | null;
	agreement_id: number | null;
	agreement_source: SalaryAgreementSource | null;
	evidence: SalaryUseSource;
	is_ambiguous: boolean;
	evidence_context: Record<string, unknown> | null;
	first_used_by: number | null;
	first_used_at: string | null;
}

export interface SalaryUseStatus {
	used: boolean;
	ambiguous: boolean;
	unknown_history: boolean;
	months: string[];
	/** Distinct exact agreement identities; id alone is ambiguous across sources. */
	agreements: Array<{
		agreement_id: number;
		agreement_source: SalaryAgreementSource;
	}>;
	evidence: SalaryUseEvidence[];
}

export interface SalaryUseReadOptions {
	month?: string;
	/** Required together: canonical/legacy id namespaces may collide. */
	agreementId?: number;
	agreementSource?: SalaryAgreementSource;
	forUpdate?: boolean;
}

export interface SalaryAgreementReadOptions {
	source?: SalaryAgreementSource;
	forUpdate?: boolean;
}

const AGREEMENT_SOURCES: readonly SalaryAgreementSource[] = [
	'employee_salary_profile',
	'salary_structures',
];

const USE_SOURCES: readonly SalaryUseSource[] = [
	'payroll_generation',
	'payroll_finalization',
	'legacy_slip',
	'legacy_audit',
	'legacy_roster',
];

const USE_COLUMNS = `id, employee_id, month, agreement_id, agreement_source,
  evidence, is_ambiguous, evidence_context, first_used_by, first_used_at`;

/**
 * `month_key` generated-column sentinel for unknown-month (NULL) evidence;
 * mirrors `IFNULL(month, '1000-01-01')` in
 * `drizzle/history/20261115140000_salary_profile_revisions.ts`.
 */
const UNKNOWN_MONTH_KEY = '1000-01-01';

function asRow(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Read the rows from a destructured mysql2 result. `execute()` returns
 * `[rows, fields]`, so callers pass the already-unwrapped rows array (plain
 * objects keyed by column name).
 */
function rowsOf(rows: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(rows)) return [];
	return rows
		.map(asRow)
		.filter((row): row is Record<string, unknown> => row !== null);
}

/** Read `affectedRows` from a destructured mysql2 `ResultSetHeader`. */
function affectedRowsOf(header: unknown): number {
	const value = asRow(header)?.affectedRows;
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number > 0 ? number : null;
	}
	return null;
}

function nonNegativeInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value >= 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number >= 0 ? number : null;
	}
	return null;
}

function dateText(value: unknown): string | null {
	if (typeof value === 'string') {
		const text = value.trim();
		return text === '' ? null : text.slice(0, 10);
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime())
			? null
			: value.toISOString().slice(0, 10);
	}
	return null;
}

function dateTimeText(value: unknown): string | null {
	if (typeof value === 'string') {
		const text = value.trim();
		return text === '' ? null : text;
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	return null;
}

function flagValue(value: unknown): boolean {
	return value === 1 || value === '1' || value === true;
}

function isAgreementSource(value: unknown): value is SalaryAgreementSource {
	return (
		typeof value === 'string' &&
		AGREEMENT_SOURCES.includes(value as SalaryAgreementSource)
	);
}

function isUseSource(value: unknown): value is SalaryUseSource {
	return (
		typeof value === 'string' && USE_SOURCES.includes(value as SalaryUseSource)
	);
}

function contextJson(
	value: Record<string, unknown> | null | undefined
): string | null {
	if (value === null || value === undefined) return null;
	const serialized = JSON.stringify(value);
	return serialized === undefined ? null : serialized;
}

function contextValue(value: unknown): Record<string, unknown> | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return asRow(parsed);
	} catch {
		return null;
	}
}

function employeeIdsForLock(employeeIds: readonly number[]): number[] {
	const ids = new Set<number>();
	for (const value of employeeIds) {
		const id = positiveInteger(value);
		if (id === null) {
			throw new RangeError(`Invalid Employee id "${String(value)}"`);
		}
		ids.add(id);
	}
	return [...ids].sort((left, right) => left - right);
}

/**
 * Lock the cross-feature per-Employee mutex, then the timeline version rows.
 *
 * Generation/Finalize call this after the Payroll Run row lock and before
 * re-reading selected agreement terms. Salary commands call it before any
 * timeline/use read. Ids are deduped and locked ascending; missing Employees
 * are returned rather than silently treated as locked.
 */
export async function lockSalaryEmployees(
	db: SalaryStoreDb,
	employeeIds: readonly number[]
): Promise<{ locks: SalaryEmployeeLock[]; missing_employee_ids: number[] }> {
	const ids = employeeIdsForLock(employeeIds);
	if (ids.length === 0) {
		return { locks: [], missing_employee_ids: [] };
	}
	const placeholders = ids.map(() => '?').join(', ');
	const [employeeRows] = await db.execute(
		`SELECT id, joining_date, hire_date, isDelete
       FROM employees
      WHERE id IN (${placeholders})
      ORDER BY id
      FOR UPDATE`,
		ids
	);
	const [timelineRows] = await db.execute(
		`SELECT employee_id, version
       FROM employee_salary_timelines
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id
      FOR UPDATE`,
		ids
	);
	const versions = new Map<number, number>();
	for (const row of rowsOf(timelineRows)) {
		const employeeId = positiveInteger(row.employee_id);
		const version = nonNegativeInteger(row.version);
		if (employeeId !== null && version !== null) {
			versions.set(employeeId, version);
		}
	}
	const locks: SalaryEmployeeLock[] = [];
	for (const row of rowsOf(employeeRows)) {
		const employeeId = positiveInteger(row.id);
		if (employeeId === null) continue;
		const version = versions.get(employeeId);
		locks.push({
			employee_id: employeeId,
			timeline_version: version ?? 0,
			timeline_exists: version !== undefined,
			joining_date: dateText(row.joining_date),
			hire_date: dateText(row.hire_date),
			is_delete: Number(row.isDelete ?? 0) !== 0,
		});
	}
	const locked = new Set(locks.map((lock) => lock.employee_id));
	return {
		locks,
		missing_employee_ids: ids.filter((id) => !locked.has(id)),
	};
}

/** Read the Employee's salary-timeline version (missing row = 0). */
export async function readSalaryTimelineVersion(
	db: SalaryStoreDb,
	employeeId: number,
	options: { forUpdate?: boolean } = {}
): Promise<number> {
	const id = positiveInteger(employeeId);
	if (id === null) {
		throw new RangeError(`Invalid Employee id "${employeeId}"`);
	}
	const [result] = await db.execute(
		`SELECT version
       FROM employee_salary_timelines
      WHERE employee_id = ?
      LIMIT 1${options.forUpdate ? ' FOR UPDATE' : ''}`,
		[id]
	);
	const row = rowsOf(result)[0];
	return nonNegativeInteger(row?.version) ?? 0;
}

/**
 * Optimistically advance the timeline version under the Employee lock.
 * Expected 0 creates version 1; matching versions increment by one. A stale
 * expectation returns the actual version and writes nothing.
 */
export async function advanceSalaryTimelineVersion(
	db: SalaryStoreDb,
	employeeId: number,
	expectedVersion: number,
	updatedBy: number | null = null
): Promise<SalaryTimelineVersionResult> {
	const id = positiveInteger(employeeId);
	if (id === null) {
		throw new RangeError(`Invalid Employee id "${employeeId}"`);
	}
	const expected = nonNegativeInteger(expectedVersion);
	if (expected === null) {
		throw new RangeError(`Invalid expected version "${expectedVersion}"`);
	}
	const actor = updatedBy === null ? null : positiveInteger(updatedBy);
	if (updatedBy !== null && actor === null) {
		throw new RangeError(`Invalid actor id "${updatedBy}"`);
	}

	const locked = await lockSalaryEmployees(db, [id]);
	const lock = locked.locks[0];
	if (lock === undefined) {
		throw new Error(`Employee ${id} does not exist`);
	}
	if (lock.timeline_version !== expected) {
		return {
			ok: false,
			code: 'stale_version',
			employee_id: id,
			expected_version: expected,
			actual_version: lock.timeline_version,
		};
	}

	if (lock.timeline_exists) {
		const [result] = await db.execute(
			`UPDATE employee_salary_timelines
          SET version = version + 1,
              updated_by = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ? AND version = ?`,
			[actor, id, expected]
		);
		if (affectedRowsOf(result) !== 1) {
			return {
				ok: false,
				code: 'stale_version',
				employee_id: id,
				expected_version: expected,
				actual_version: lock.timeline_version,
			};
		}
		return { ok: true, employee_id: id, version: expected + 1 };
	}

	const [result] = await db.execute(
		`INSERT INTO employee_salary_timelines
        (employee_id, version, updated_by)
       VALUES (?, ?, ?)`,
		[id, 1, actor]
	);
	if (affectedRowsOf(result) !== 1) {
		throw new Error(`Employee ${id} salary timeline was not created`);
	}
	return { ok: true, employee_id: id, version: 1 };
}

/** Read retained Salary Profile agreements for one Employee (all states). */
export async function readSalaryAgreements(
	db: SalaryStoreDb,
	employeeId: number,
	options: SalaryAgreementReadOptions = {}
): Promise<SalaryProfileRow[]> {
	const id = positiveInteger(employeeId);
	if (id === null) {
		throw new RangeError(`Invalid Employee id "${employeeId}"`);
	}
	const source = options.source ?? 'employee_salary_profile';
	if (!isAgreementSource(source)) {
		throw new RangeError(`Invalid salary agreement source "${source}"`);
	}
	const table =
		source === 'salary_structures'
			? 'salary_structures'
			: 'employee_salary_profile';
	const [result] = await db.execute(
		`SELECT *
       FROM ${table}
      WHERE employee_id = ?
      ORDER BY effective_from ASC, id ASC${options.forUpdate ? ' FOR UPDATE' : ''}`,
		[id]
	);
	return rowsOf(result) as SalaryProfileRow[];
}

/**
 * Read durable payroll-use evidence. A month filter also returns
 * `month IS NULL` ambiguous history, because unknown prior use blocks every
 * month. Agreement filtering requires both id and source (their namespaces
 * collide) and preserves Employee-level ambiguous rows so an agreement read
 * never hides month-level ambiguity.
 */
export async function readSalaryUseEvidence(
	db: SalaryStoreDb,
	employeeId: number,
	options: SalaryUseReadOptions = {}
): Promise<SalaryUseEvidence[]> {
	const id = positiveInteger(employeeId);
	if (id === null) {
		throw new RangeError(`Invalid Employee id "${employeeId}"`);
	}
	const hasAgreementId = options.agreementId !== undefined;
	const hasAgreementSource = options.agreementSource !== undefined;
	if (hasAgreementId !== hasAgreementSource) {
		throw new RangeError(
			'agreementId and agreementSource must be supplied together'
		);
	}
	const agreementId = hasAgreementId
		? positiveInteger(options.agreementId)
		: null;
	if (hasAgreementId && agreementId === null) {
		throw new RangeError(`Invalid agreement id "${options.agreementId}"`);
	}
	if (
		options.agreementSource !== undefined &&
		!isAgreementSource(options.agreementSource)
	) {
		throw new RangeError(
			`Invalid salary agreement source "${String(options.agreementSource)}"`
		);
	}
	const agreementSource: SalaryAgreementSource | null = hasAgreementSource
		? (options.agreementSource as SalaryAgreementSource)
		: null;
	const month =
		options.month === undefined ? null : normalizeSalaryMonth(options.month);

	const where = ['employee_id = ?'];
	const params: Array<string | number | boolean | null> = [id];
	if (month !== null) {
		where.push('(month_key = ? OR (month IS NULL AND is_ambiguous = 1))');
		params.push(month);
	}
	if (agreementId !== null && agreementSource !== null) {
		where.push(
			'((agreement_id = ? AND agreement_source = ?) OR is_ambiguous = 1)'
		);
		params.push(agreementId, agreementSource);
	}
	const [result] = await db.execute(
		`SELECT ${USE_COLUMNS}
       FROM employee_salary_payroll_use
      WHERE ${where.join(' AND ')}
      ORDER BY first_used_at ASC, id ASC${options.forUpdate ? ' FOR UPDATE' : ''}`,
		params
	);

	return rowsOf(result).map((row) => {
		const source = isAgreementSource(row.agreement_source)
			? row.agreement_source
			: null;
		const agreementId =
			source === null ? null : positiveInteger(row.agreement_id);
		const evidence = row.evidence;
		if (!isUseSource(evidence)) {
			throw new Error(
				`Unknown salary use evidence source "${String(evidence)}"`
			);
		}
		return {
			id: positiveInteger(row.id) ?? 0,
			employee_id: positiveInteger(row.employee_id) ?? 0,
			month: dateText(row.month),
			agreement_id: agreementId,
			agreement_source: source,
			evidence,
			is_ambiguous: flagValue(row.is_ambiguous),
			evidence_context: contextValue(row.evidence_context),
			first_used_by: positiveInteger(row.first_used_by),
			first_used_at: dateTimeText(row.first_used_at),
		};
	});
}

/** Summarize evidence without collapsing canonical/legacy id namespaces. */
export function summarizeSalaryUseEvidence(
	evidence: readonly SalaryUseEvidence[]
): SalaryUseStatus {
	const months = new Set<string>();
	const agreements = new Map<
		string,
		{ agreement_id: number; agreement_source: SalaryAgreementSource }
	>();
	let ambiguous = false;
	let unknownHistory = false;
	for (const row of evidence) {
		if (row.is_ambiguous || row.agreement_id === null) {
			ambiguous = true;
		}
		if (row.month === null) {
			if (row.is_ambiguous) unknownHistory = true;
		} else {
			months.add(row.month);
		}
		if (
			!row.is_ambiguous &&
			row.agreement_id !== null &&
			row.agreement_source !== null
		) {
			agreements.set(`${row.agreement_source}:${row.agreement_id}`, {
				agreement_id: row.agreement_id,
				agreement_source: row.agreement_source,
			});
		}
	}
	return {
		used: evidence.length > 0,
		ambiguous,
		unknown_history: unknownHistory,
		months: [...months].sort(),
		agreements: [...agreements.values()].sort(
			(left, right) =>
				left.agreement_source.localeCompare(right.agreement_source) ||
				left.agreement_id - right.agreement_id
		),
		evidence: [...evidence],
	};
}

/** Read and summarize use evidence; same source-qualified rules as above. */
export async function readSalaryUseStatus(
	db: SalaryStoreDb,
	employeeId: number,
	options: SalaryUseReadOptions = {}
): Promise<SalaryUseStatus> {
	return summarizeSalaryUseEvidence(
		await readSalaryUseEvidence(db, employeeId, options)
	);
}

function validateUseSource(evidence: SalaryUseSource): void {
	if (!isUseSource(evidence)) {
		throw new RangeError(`Invalid salary use source "${String(evidence)}"`);
	}
}

function validateAgreementSource(
	source: SalaryAgreementSource | null | undefined
): void {
	if (source !== null && source !== undefined && !isAgreementSource(source)) {
		throw new RangeError(`Invalid salary agreement source "${String(source)}"`);
	}
}

/**
 * Lock one durable-use identity and report whether that row already exists.
 *
 * mysql2 connects with `CLIENT_FOUND_ROWS`, so MariaDB answers an unchanged
 * duplicate `INSERT ... ON DUPLICATE KEY UPDATE` with the *matched* row
 * (`affectedRows` 1, `insertId` 0). `affectedRows` therefore cannot tell a
 * created row from an existing one. Every writer holds the cross-feature
 * Employee lock first, so this locking read of the unique key
 * (employee + month + source-qualified agreement) is the authoritative
 * "already recorded" answer for both recording helpers below.
 */
async function lockSalaryUseIdentity(
	db: SalaryStoreDb,
	input: {
		employeeId: number;
		month: string | null;
		agreementSource: SalaryAgreementSource | null;
		agreementId: number | null;
	}
): Promise<boolean> {
	const [result] = await db.execute(
		`SELECT id
       FROM employee_salary_payroll_use
      WHERE employee_id = ?
        AND month_key = ?
        AND agreement_source_key = ?
        AND agreement_key = ?
      LIMIT 1
      FOR UPDATE`,
		[
			input.employeeId,
			input.month ?? UNKNOWN_MONTH_KEY,
			input.agreementSource ?? '',
			input.agreementId ?? 0,
		]
	);
	return rowsOf(result).length > 0;
}

/**
 * Record durable payroll use for one exact source-qualified agreement/month.
 * Runs after a successful slip insert or committed finalization, in the same
 * transaction, after the Employee lock. Duplicate evidence is a no-op; the
 * timeline version advances only when a new evidence row was created.
 */
export async function recordSalaryAgreementUse(
	db: SalaryStoreDb,
	input: {
		employeeId: number;
		agreementId: number;
		agreementSource: SalaryAgreementSource;
		month: string;
		evidence: SalaryUseSource;
		evidenceContext?: Record<string, unknown> | null;
		actorId?: number | null;
	}
): Promise<{
	recorded: boolean;
	ambiguous_prior: boolean;
	timeline_version: number;
}> {
	const employeeId = positiveInteger(input.employeeId);
	if (employeeId === null) {
		throw new RangeError(`Invalid Employee id "${input.employeeId}"`);
	}
	const agreementId = positiveInteger(input.agreementId);
	if (agreementId === null) {
		throw new RangeError(`Invalid agreement id "${input.agreementId}"`);
	}
	if (!isAgreementSource(input.agreementSource)) {
		throw new RangeError(
			`Invalid salary agreement source "${input.agreementSource}"`
		);
	}
	validateUseSource(input.evidence);
	const month = normalizeSalaryMonth(input.month);
	const actor =
		input.actorId === null || input.actorId === undefined
			? null
			: positiveInteger(input.actorId);
	if (input.actorId !== null && input.actorId !== undefined && actor === null) {
		throw new RangeError(`Invalid actor id "${input.actorId}"`);
	}

	const locked = await lockSalaryEmployees(db, [employeeId]);
	const lock = locked.locks[0];
	if (lock === undefined) {
		throw new Error(`Employee ${employeeId} does not exist`);
	}

	const recorded = !(await lockSalaryUseIdentity(db, {
		employeeId,
		month,
		agreementSource: input.agreementSource,
		agreementId,
	}));
	if (recorded) {
		await db.execute(
			`INSERT INTO employee_salary_payroll_use
        (employee_id, month, agreement_id, agreement_source, evidence,
         is_ambiguous, evidence_context, first_used_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				employeeId,
				month,
				agreementId,
				input.agreementSource,
				input.evidence,
				0,
				contextJson(input.evidenceContext),
				actor,
			]
		);
	}

	const [ambiguousRows] = await db.execute(
		`SELECT 1
       FROM employee_salary_payroll_use
      WHERE employee_id = ?
        AND (month_key = ? OR (month IS NULL AND is_ambiguous = 1))
        AND (agreement_id IS NULL OR is_ambiguous = 1)
      LIMIT 1`,
		[employeeId, month]
	);
	const ambiguousPrior = rowsOf(ambiguousRows).length > 0;

	if (!recorded) {
		return {
			recorded: false,
			ambiguous_prior: ambiguousPrior,
			timeline_version: lock.timeline_version,
		};
	}
	const advanced = await advanceSalaryTimelineVersion(
		db,
		employeeId,
		lock.timeline_version,
		actor
	);
	if (!advanced.ok) {
		throw new Error(
			`Salary timeline version changed while recording use for Employee ${employeeId}`
		);
	}
	return {
		recorded: true,
		ambiguous_prior: ambiguousPrior,
		timeline_version: advanced.version,
	};
}

/**
 * Record known prior use that cannot be tied to one exact agreement/month.
 * `month = null` means the month is unprovable and blocks every month until a
 * reviewer resolves it. Candidate ids belong in `evidenceContext`; this helper
 * never invents an exact agreement link.
 */
export async function recordSalaryUseAmbiguity(
	db: SalaryStoreDb,
	input: {
		employeeId: number;
		month?: string | null;
		agreementId?: number | null;
		agreementSource?: SalaryAgreementSource | null;
		evidence: SalaryUseSource;
		evidenceContext?: Record<string, unknown> | null;
		actorId?: number | null;
	}
): Promise<{ recorded: boolean; timeline_version: number }> {
	const employeeId = positiveInteger(input.employeeId);
	if (employeeId === null) {
		throw new RangeError(`Invalid Employee id "${input.employeeId}"`);
	}
	validateUseSource(input.evidence);
	const month =
		input.month === null || input.month === undefined
			? null
			: normalizeSalaryMonth(input.month);
	const hasAgreementId =
		input.agreementId !== null && input.agreementId !== undefined;
	const hasAgreementSource =
		input.agreementSource !== null && input.agreementSource !== undefined;
	if (hasAgreementId !== hasAgreementSource) {
		throw new RangeError(
			'agreementId and agreementSource must be supplied together'
		);
	}
	const agreementId = hasAgreementId
		? positiveInteger(input.agreementId)
		: null;
	if (hasAgreementId && agreementId === null) {
		throw new RangeError(`Invalid agreement id "${input.agreementId}"`);
	}
	validateAgreementSource(input.agreementSource);
	const agreementSource = hasAgreementSource
		? (input.agreementSource as SalaryAgreementSource)
		: null;
	const actor =
		input.actorId === null || input.actorId === undefined
			? null
			: positiveInteger(input.actorId);
	if (input.actorId !== null && input.actorId !== undefined && actor === null) {
		throw new RangeError(`Invalid actor id "${input.actorId}"`);
	}

	const locked = await lockSalaryEmployees(db, [employeeId]);
	const lock = locked.locks[0];
	if (lock === undefined) {
		throw new Error(`Employee ${employeeId} does not exist`);
	}

	const recorded = !(await lockSalaryUseIdentity(db, {
		employeeId,
		month,
		agreementSource,
		agreementId,
	}));
	if (recorded) {
		await db.execute(
			`INSERT INTO employee_salary_payroll_use
        (employee_id, month, agreement_id, agreement_source, evidence,
         is_ambiguous, evidence_context, first_used_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				employeeId,
				month,
				agreementId,
				agreementSource,
				input.evidence,
				1,
				contextJson(input.evidenceContext),
				actor,
			]
		);
	}
	if (!recorded) {
		return { recorded: false, timeline_version: lock.timeline_version };
	}
	const advanced = await advanceSalaryTimelineVersion(
		db,
		employeeId,
		lock.timeline_version,
		actor
	);
	if (!advanced.ok) {
		throw new Error(
			`Salary timeline version changed while recording ambiguous use for Employee ${employeeId}`
		);
	}
	return { recorded: true, timeline_version: advanced.version };
}
