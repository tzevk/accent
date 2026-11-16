/**
 * Salary Profile command core (#437).
 *
 * Distinct operations replace the legacy same-date upsert and hard delete:
 * create-initial, correct an unused agreement in place, create a dated
 * revision, or cancel an unused scheduled revision. The caller owns the
 * transaction; this module never begins/commits/rolls back/releases it.
 *
 * A required-audit failure rejects, so the caller's transaction rolls the
 * agreement, range, version and audit changes back together.
 */

import {
	previousSalaryDay,
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
	type SalaryProfileRow,
} from '@/lib/salary-profile-timeline';
import { advanceSalaryTimelineVersion } from '@/lib/salary-profile-store';
import {
	PAYROLL_AUDIT_ACTION,
	PAYROLL_AUDIT_ENTITY,
	auditSnapshot,
	recordPayrollAudit,
} from '@/app/api/payroll/_lib/payroll-audit';
import {
	agreementEnd,
	agreementIdOf,
	agreementStart,
	ambiguousCandidates,
	asRows,
	classificationOfRow,
	copiedSettings,
	currentMonthStart,
	formatDate,
	isEligibleAgreement,
	LEGACY_REFERENCE_FIELDS,
	LIVE_USAGE_FIELDS,
	monthOf,
	parseEffectiveFrom,
	parseProvidedSettings,
	positiveInteger,
	readCommandState,
	selectingIds,
	serverPayrollDate,
	sortAgreements,
	sqlFailure,
	textValue,
	validateRequiredCtc,
	validateRequiredDailyHours,
	validateSalaryType,
	type SalaryCommandState,
} from './internal';
import type {
	SalaryCommandContext,
	SalaryCommandDb,
	SalaryCommandFailure,
	SalaryCommandInput,
	SalaryCommandOperation,
	SalaryCommandOutcome,
} from './types';

type Value = string | number | boolean | null;
type Values = Record<string, Value>;

interface ParsedCommand {
	operation: SalaryCommandOperation;
	employeeId: number;
	expectedVersion: number;
	agreementId: number | null;
	effectiveFrom: string | null;
	salaryType: string | null;
	/** Numeric monthly CTC for in-memory rows and audit snapshots. */
	ctc: number;
	/** Canonical two-decimal CTC for DECIMAL(12,2) write parameters. */
	ctcText: string;
	hours: number;
	settings: Values;
	cancellationReason: string | null;
}

function parseCommandInput(
	input: SalaryCommandInput
):
	| { ok: true; command: ParsedCommand }
	| { ok: false; failure: SalaryCommandFailure } {
	const record = input as unknown as Record<string, unknown>;
	const operation = record.operation;
	if (
		operation !== 'create-initial' &&
		operation !== 'correct' &&
		operation !== 'revise' &&
		operation !== 'cancel'
	) {
		return {
			ok: false,
			failure: sqlFailure(
				'invalid_input',
				400,
				'operation must be create-initial, correct, revise or cancel'
			),
		};
	}

	const employeeId = positiveInteger(record.employee_id);
	if (employeeId === null) {
		return {
			ok: false,
			failure: sqlFailure(
				'invalid_input',
				400,
				'employee_id must be a positive integer'
			),
		};
	}
	const expectedVersion = positiveIntegerOrZero(
		record.expected_timeline_version
	);
	if (expectedVersion === null) {
		return {
			ok: false,
			failure: sqlFailure(
				'invalid_input',
				400,
				'expected_timeline_version must be a non-negative integer'
			),
		};
	}

	for (const field of LEGACY_REFERENCE_FIELDS) {
		const raw = record[field];
		if (
			Object.hasOwn(record, field) &&
			raw !== undefined &&
			raw !== null &&
			String(raw).trim() !== ''
		) {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					`${field} is a read-only legacy reference amount, not a CTC-first pay input`
				),
			};
		}
	}
	for (const field of LIVE_USAGE_FIELDS) {
		if (Object.hasOwn(record, field) && record[field] !== undefined) {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					`${field} is live attendance usage and is read-only`
				),
			};
		}
	}

	const agreementId =
		record.agreement_id === undefined || record.agreement_id === null
			? null
			: positiveInteger(record.agreement_id);
	if (
		operation !== 'create-initial' &&
		(agreementId === null || record.agreement_id === undefined)
	) {
		return {
			ok: false,
			failure: sqlFailure(
				'invalid_input',
				400,
				'agreement_id is required for correct, revise and cancel'
			),
		};
	}

	const effectiveRaw = record.effective_from;
	if (
		operation !== 'cancel' &&
		(operation !== 'correct' ||
			(effectiveRaw !== undefined && effectiveRaw !== null)) &&
		(typeof effectiveRaw !== 'string' || effectiveRaw.trim() === '')
	) {
		return {
			ok: false,
			failure: sqlFailure(
				'invalid_input',
				400,
				'effective_from is required for this operation'
			),
		};
	}
	if (
		operation !== 'cancel' &&
		typeof effectiveRaw === 'string' &&
		effectiveRaw.trim() !== '' &&
		parseEffectiveFrom(effectiveRaw, true) === null
	) {
		return {
			ok: false,
			failure: sqlFailure(
				'invalid_input',
				400,
				'effective_from must be a valid date'
			),
		};
	}

	let salaryType: string | null = null;
	if (record.salary_type !== undefined && record.salary_type !== null) {
		const validation = validateSalaryType(record.salary_type);
		if (!validation.ok) {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					'salary_type is not supported'
				),
			};
		}
		salaryType = validation.value;
	}

	// Cancellation carries no amounts; every other operation replaces these
	// placeholders with the validated canonical values before any write.
	let ctcText = '0.00';
	let hours = 0;
	if (operation !== 'cancel') {
		const ctcValidation = validateRequiredCtc(record.employer_cost);
		if (!ctcValidation.ok) {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					`employer_cost is invalid (${ctcValidation.reason})`
				),
			};
		}
		const hoursValidation = validateRequiredDailyHours(
			record.std_hours_per_day
		);
		if (!hoursValidation.ok) {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					`std_hours_per_day is invalid (${hoursValidation.reason})`
				),
			};
		}
		ctcText = ctcValidation.text;
		hours = hoursValidation.value;
	}
	const ctc = Number(ctcText);

	const parsedSettings = parseProvidedSettings(record);
	if (parsedSettings.errors.length > 0) {
		return {
			ok: false,
			failure: sqlFailure('invalid_input', 400, 'Invalid pay settings', {
				fields: parsedSettings.errors,
			}),
		};
	}

	let cancellationReason: string | null = null;
	if (
		record.cancellation_reason !== undefined &&
		record.cancellation_reason !== null
	) {
		if (typeof record.cancellation_reason !== 'string') {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					'cancellation_reason must be text'
				),
			};
		}
		const reason = record.cancellation_reason.trim();
		if (reason.length > 255) {
			return {
				ok: false,
				failure: sqlFailure(
					'invalid_input',
					400,
					'cancellation_reason must be 255 characters or fewer'
				),
			};
		}
		cancellationReason = reason === '' ? null : reason;
	}

	return {
		ok: true,
		command: {
			operation,
			employeeId,
			expectedVersion,
			agreementId,
			effectiveFrom:
				typeof effectiveRaw === 'string' && effectiveRaw.trim() !== ''
					? effectiveRaw.trim()
					: null,
			salaryType,
			ctc,
			ctcText,
			hours,
			settings: parsedSettings.values,
			cancellationReason,
		},
	};
}

function positiveIntegerOrZero(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value >= 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number >= 0 ? number : null;
	}
	return null;
}

function staleFailure(expected: number, actual: number): SalaryCommandFailure {
	return sqlFailure(
		'stale_version',
		409,
		'Salary timeline changed since it was loaded',
		{ expected_version: expected, actual_version: actual }
	);
}

function findAgreement(
	state: SalaryCommandState,
	agreementId: number
): SalaryProfileRow | null {
	const row = state.canonical.find(
		(candidate) => agreementIdOf(candidate) === agreementId
	);
	return row ?? null;
}

function exactUseMonths(state: SalaryCommandState): Set<string> {
	const months = new Set<string>();
	for (const row of state.evidence) {
		if (!row.is_ambiguous && row.month !== null) months.add(row.month);
	}
	return months;
}

function agreementHasExactUse(
	state: SalaryCommandState,
	agreementId: number
): boolean {
	return state.evidence.some(
		(row) =>
			!row.is_ambiguous &&
			row.agreement_source === 'employee_salary_profile' &&
			row.agreement_id === agreementId
	);
}

/** A period that resolves to competing agreements is an affected-range conflict. */
function ambiguousTimelineFailure(
	state: SalaryCommandState,
	agreementId: number,
	employeeId: number,
	now: string
): SalaryCommandFailure | null {
	const target = findAgreement(state, agreementId);
	if (target === null) return null;
	const start = agreementStart(target);
	if (start === null) {
		return sqlFailure(
			'overlap',
			409,
			'Salary history contains an invalid effective date; review it before changing the timeline'
		);
	}
	const resolution = resolveSalaryAgreementAt(state.canonical, start, {
		source: 'employee_salary_profile',
		employeeId,
		asOf: now,
	});
	if (resolution.state === 'ambiguous') {
		return sqlFailure(
			'overlap',
			409,
			'This agreement period resolves to more than one agreement; review the overlapping history',
			{ agreement_ids: resolution.conflict_ids }
		);
	}
	return null;
}

function knownAmbiguousRows(state: SalaryCommandState) {
	return state.evidence.filter((row) => row.is_ambiguous && row.month !== null);
}

/**
 * Existing malformed or duplicate eligible starts are a review conflict, not a
 * reason to guess which row the operator meant.
 */
function historyConflict(
	state: SalaryCommandState
): SalaryCommandFailure | null {
	const starts = new Set<string>();
	for (const row of state.canonical) {
		const start = agreementStart(row);
		if (start === null) {
			return sqlFailure(
				'overlap',
				409,
				'Salary history contains an invalid effective date; review it before changing the timeline'
			);
		}
		const rawEnd = row.effective_to;
		if (
			rawEnd !== undefined &&
			rawEnd !== null &&
			String(rawEnd).trim() !== '' &&
			agreementEnd(row) === null
		) {
			return sqlFailure(
				'overlap',
				409,
				'Salary history contains an invalid effective end date; review it before changing the timeline'
			);
		}
		if (!isEligibleAgreement(row)) continue;
		if (starts.has(start)) {
			return sqlFailure(
				'overlap',
				409,
				'Salary history has more than one non-cancelled agreement starting on the same date'
			);
		}
		starts.add(start);
	}
	return null;
}

/**
 * A plausible candidate of a known-month ambiguity stays protected from
 * in-place correction/cancellation, even when its dates would not move.
 */
function ambiguousCandidateFailure(
	state: SalaryCommandState,
	agreementId: number
): SalaryCommandFailure | null {
	for (const row of knownAmbiguousRows(state)) {
		const anchor = salaryMonthAnchor(row.month as string, state.employeeStart);
		const candidates = ambiguousCandidates(row);
		if (candidates.length === 0) {
			for (const candidateId of selectingIds(state.canonical, anchor)) {
				candidates.push({
					agreement_id: candidateId,
					agreement_source: 'employee_salary_profile',
				});
			}
			for (const candidateId of selectingIds(state.legacyTimeline, anchor)) {
				candidates.push({
					agreement_id: candidateId,
					agreement_source: 'salary_structures',
				});
			}
		}
		if (
			candidates.some(
				(candidate) =>
					candidate.agreement_source === 'employee_salary_profile' &&
					candidate.agreement_id === agreementId
			)
		) {
			return sqlFailure(
				'used',
				409,
				'Known ambiguous payroll use protects this agreement from correction or cancellation',
				{ reason: 'ambiguous_use', month: row.month }
			);
		}
	}
	return null;
}

function coverageSignature(
	rows: readonly SalaryProfileRow[],
	anchor: string,
	source: 'employee_salary_profile' | 'salary_structures',
	employeeId: number,
	asOf: string
): string {
	const resolution = resolveSalaryAgreementAt(rows, anchor, {
		source,
		employeeId,
		asOf,
	});
	const ids =
		resolution.state === 'selected' && resolution.agreement_id !== null
			? [resolution.agreement_id]
			: resolution.state === 'ambiguous'
				? resolution.conflict_ids
				: [];
	return `${resolution.state}:${ids.join(',')}`;
}

/** Known-month ambiguity protects only its month's coverage, not untouched history. */
function ambiguousCoverageFailure(
	state: SalaryCommandState,
	postCanonical: readonly SalaryProfileRow[],
	employeeId: number,
	now: string
): SalaryCommandFailure | null {
	for (const row of knownAmbiguousRows(state)) {
		const anchor = salaryMonthAnchor(row.month as string, state.employeeStart);
		const before = [
			coverageSignature(
				state.canonical,
				anchor,
				'employee_salary_profile',
				employeeId,
				now
			),
			coverageSignature(
				state.legacyTimeline,
				anchor,
				'salary_structures',
				employeeId,
				now
			),
		].join('|');
		const after = [
			coverageSignature(
				postCanonical,
				anchor,
				'employee_salary_profile',
				employeeId,
				now
			),
			coverageSignature(
				state.legacyTimeline,
				anchor,
				'salary_structures',
				employeeId,
				now
			),
		].join('|');
		if (before !== after) {
			return sqlFailure(
				'protected',
				409,
				'This change would alter the coverage of a month with ambiguous payroll use',
				{ reason: 'ambiguous_month_coverage', month: row.month }
			);
		}
	}
	return null;
}

/** Exact use (including future generated payroll) can never be displaced. */
function exactUseFailure(
	state: SalaryCommandState,
	postCanonical: readonly SalaryProfileRow[],
	employeeId: number,
	now: string
): SalaryCommandFailure | null {
	for (const row of state.evidence) {
		if (row.is_ambiguous || row.month === null) continue;
		if (row.agreement_id === null || row.agreement_source === null) {
			return sqlFailure(
				'protected',
				409,
				'Payroll use evidence has no provable agreement identity',
				{ month: row.month }
			);
		}
		const anchor = salaryMonthAnchor(row.month, state.employeeStart);
		if (row.agreement_source === 'employee_salary_profile') {
			const resolution = resolveSalaryAgreementAt(postCanonical, anchor, {
				source: 'employee_salary_profile',
				employeeId,
				asOf: now,
			});
			if (
				resolution.state !== 'selected' ||
				resolution.agreement_id !== row.agreement_id
			) {
				return sqlFailure(
					'protected',
					409,
					'This change would displace an agreement used by payroll',
					{
						month: row.month,
						agreement_id: row.agreement_id,
						agreement_source: row.agreement_source,
					}
				);
			}
			continue;
		}
		const canonical = resolveSalaryAgreementAt(postCanonical, anchor, {
			source: 'employee_salary_profile',
			employeeId,
			asOf: now,
		});
		if (canonical.state !== 'unavailable') {
			return sqlFailure(
				'protected',
				409,
				'This change would replace a legacy agreement used by payroll',
				{
					month: row.month,
					agreement_id: row.agreement_id,
					agreement_source: row.agreement_source,
				}
			);
		}
		const legacy = resolveSalaryAgreementAt(state.legacyTimeline, anchor, {
			source: 'salary_structures',
			employeeId,
			asOf: now,
		});
		if (
			legacy.state !== 'selected' ||
			legacy.agreement_id !== row.agreement_id
		) {
			return sqlFailure(
				'protected',
				409,
				'This change would displace a legacy agreement used by payroll',
				{
					month: row.month,
					agreement_id: row.agreement_id,
					agreement_source: row.agreement_source,
				}
			);
		}
	}
	return null;
}

function postUseFailure(
	state: SalaryCommandState,
	postCanonical: readonly SalaryProfileRow[],
	employeeId: number,
	now: string
): SalaryCommandFailure | null {
	return (
		ambiguousCoverageFailure(state, postCanonical, employeeId, now) ??
		exactUseFailure(state, postCanonical, employeeId, now)
	);
}

/** The proposed period must resolve to exactly the row this command writes. */
function periodResolutionFailure(
	postCanonical: readonly SalaryProfileRow[],
	start: string,
	expectedId: number,
	employeeId: number,
	now: string
): SalaryCommandFailure | null {
	const resolution = resolveSalaryAgreementAt(postCanonical, start, {
		source: 'employee_salary_profile',
		employeeId,
		asOf: now,
	});
	if (resolution.state === 'ambiguous') {
		return sqlFailure(
			'overlap',
			409,
			'The proposed effective period would resolve to more than one agreement',
			{ agreement_ids: resolution.conflict_ids }
		);
	}
	if (
		resolution.state !== 'selected' ||
		resolution.agreement_id !== expectedId
	) {
		return sqlFailure(
			'overlap',
			409,
			'The proposed effective period is covered by another agreement'
		);
	}
	return null;
}

function eligibleRows(rows: readonly SalaryProfileRow[]): SalaryProfileRow[] {
	return sortAgreements(rows.filter(isEligibleAgreement));
}

function hasStartConflict(
	rows: readonly SalaryProfileRow[],
	start: string,
	excludeId: number | null
): boolean {
	return rows.some(
		(row) =>
			isEligibleAgreement(row) &&
			agreementIdOf(row) !== excludeId &&
			agreementStart(row) === start
	);
}

interface RangePlan {
	postCanonical: SalaryProfileRow[];
	target: SalaryProfileRow;
	rangeUpdates: Array<{ id: number; effective_to: string | null }>;
}

/**
 * Place one inserted/corrected row in the chronological timeline. Rows outside
 * the immediate neighbourhood keep their recorded ranges.
 */
function planRange(
	canonical: readonly SalaryProfileRow[],
	targetId: number,
	start: string,
	excludeId: number | null
): RangePlan {
	const others = eligibleRows(canonical).filter(
		(row) => agreementIdOf(row) !== excludeId
	);
	const predecessor = [...others]
		.reverse()
		.find((row) => (agreementStart(row) ?? '') < start);
	const successor = others.find((row) => (agreementStart(row) ?? '') > start);
	const newEnd = successor
		? previousSalaryDay(agreementStart(successor) as string)
		: null;

	const rangeUpdates: Array<{ id: number; effective_to: string | null }> = [];
	const postCanonical = canonical.map((row) => ({ ...row }));
	const setEnd = (id: number, end: string | null) => {
		const index = postCanonical.findIndex((row) => agreementIdOf(row) === id);
		if (index < 0) return;
		postCanonical[index] = {
			...postCanonical[index],
			effective_to: end,
		};
	};
	if (predecessor !== null && predecessor !== undefined) {
		const predecessorId = agreementIdOf(predecessor);
		if (predecessorId !== null) {
			const end = previousSalaryDay(start);
			if (agreementEnd(predecessor) !== end) {
				rangeUpdates.push({ id: predecessorId, effective_to: end });
			}
			setEnd(predecessorId, end);
		}
	}
	const target: SalaryProfileRow = {
		id: targetId,
		effective_to: newEnd,
	};
	setEnd(targetId, newEnd);
	return { postCanonical, target, rangeUpdates };
}

function buildInsert(values: Values): {
	sql: string;
	params: Value[];
} {
	const columns = Object.keys(values).filter(
		(column) => values[column] !== undefined
	);
	return {
		sql: `INSERT INTO employee_salary_profile (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})`,
		params: columns.map((column) => values[column]),
	};
}

function buildUpdate(
	values: Values,
	agreementId: number,
	employeeId: number
): { sql: string; params: Value[] } {
	const columns = Object.keys(values).filter(
		(column) => values[column] !== undefined
	);
	return {
		sql: `UPDATE employee_salary_profile
      SET ${columns.map((column) => `${column} = ?`).join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND employee_id = ?`,
		params: [
			...columns.map((column) => values[column]),
			agreementId,
			employeeId,
		],
	};
}

async function agreementExists(
	db: SalaryCommandDb,
	agreementId: number,
	employeeId: number
): Promise<boolean> {
	const [rows] = await db.execute(
		`SELECT id FROM employee_salary_profile
      WHERE id = ? AND employee_id = ? LIMIT 1`,
		[agreementId, employeeId]
	);
	return asRows(rows).length > 0;
}

async function writeRangeUpdates(
	db: SalaryCommandDb,
	updates: readonly { id: number; effective_to: string | null }[],
	employeeId: number
): Promise<void> {
	for (const update of updates) {
		const [result] = await db.execute(
			`UPDATE employee_salary_profile
          SET effective_to = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND employee_id = ?`,
			[update.effective_to, update.id, employeeId]
		);
		const affected = asRows([result])[0]?.affectedRows;
		if (
			typeof affected !== 'number' ||
			(affected === 0 && !(await agreementExists(db, update.id, employeeId)))
		) {
			throw new Error(
				`Salary agreement ${update.id} disappeared while adjusting ranges`
			);
		}
	}
}

async function advanceVersion(
	db: SalaryCommandDb,
	state: SalaryCommandState,
	actorId: number
): Promise<number> {
	const advanced = await advanceSalaryTimelineVersion(
		db,
		state.lock.employee_id,
		state.lock.timeline_version,
		actorId
	);
	if (!advanced.ok) {
		throw new Error(
			`Salary timeline version changed unexpectedly for Employee ${state.lock.employee_id}`
		);
	}
	return advanced.version;
}

function maxAgreementId(rows: readonly SalaryProfileRow[]): number {
	return rows.reduce((max, row) => Math.max(max, agreementIdOf(row) ?? 0), 0);
}

function success(
	operation: SalaryCommandOperation,
	row: SalaryProfileRow,
	timelineVersion: number,
	now: string
): SalaryCommandOutcome {
	const start = agreementStart(row) ?? '';
	return {
		ok: true,
		operation,
		agreement_id: agreementIdOf(row) ?? 0,
		timeline_version: timelineVersion,
		classification:
			operation === 'cancel' ? 'cancelled' : classificationOfRow(row, now),
		effective_from: start,
		effective_to: agreementEnd(row),
	};
}

async function createInitial(
	db: SalaryCommandDb,
	state: SalaryCommandState,
	command: ParsedCommand,
	now: string,
	actorId: number
): Promise<SalaryCommandOutcome> {
	const employeeId = command.employeeId;
	const history =
		state.canonical.length > 0 ||
		state.legacy.length > 0 ||
		state.evidence.length > 0;
	if (eligibleRows(state.canonical).length > 0) {
		const conflictProbe = parseEffectiveFrom(command.effectiveFrom, true);
		if (
			conflictProbe !== null &&
			hasStartConflict(state.canonical, conflictProbe.start, null)
		) {
			return sqlFailure(
				'date_conflict',
				409,
				'Another non-cancelled agreement already starts on this date'
			);
		}
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'An agreement already exists; use correct or revise'
		);
	}
	const parsed = parseEffectiveFrom(command.effectiveFrom, !history);
	if (parsed === null) {
		return sqlFailure(
			'invalid_input',
			400,
			history
				? 'Prospective canonical setup must start on the first day of a month'
				: 'effective_from must be a valid date'
		);
	}
	const start = parsed.start;
	if (state.employeeStart !== null && start < state.employeeStart) {
		return sqlFailure(
			'invalid_input',
			400,
			'effective_from cannot precede the employment start date'
		);
	}
	if (!history) {
		if (state.employeeStart === null && start < currentMonthStart(now)) {
			return sqlFailure(
				'earlier_month',
				409,
				'No verified joining date is available, so an initial agreement cannot be backdated'
			);
		}
		if (
			parsed.midMonth &&
			(state.employeeStart === null || start !== state.employeeStart)
		) {
			return sqlFailure(
				'invalid_input',
				400,
				'A mid-month initial agreement must start on the verified joining date'
			);
		}
	} else {
		if (start < currentMonthStart(now)) {
			return sqlFailure(
				'earlier_month',
				409,
				'Existing salary history prevents backdating an initial agreement'
			);
		}
		if (exactUseMonths(state).has(monthOf(start))) {
			return sqlFailure(
				'used',
				409,
				'Payroll already used this month; choose an unused month'
			);
		}
	}
	if (hasStartConflict(state.canonical, start, null)) {
		return sqlFailure(
			'date_conflict',
			409,
			'Another non-cancelled agreement already starts on this date'
		);
	}

	const tempId = maxAgreementId(state.canonical) + 1;
	const salaryType = command.salaryType ?? 'monthly';
	const settings: Values = { ...command.settings };
	if (settings.da_year === undefined) {
		settings.da_year = Number(now.slice(0, 4));
	}
	const newRow: SalaryProfileRow = {
		id: tempId,
		employee_id: employeeId,
		effective_from: start,
		effective_to: null,
		is_active: 1,
		cancelled_at: null,
		employer_cost: command.ctc,
		std_hours_per_day: command.hours,
		salary_type: salaryType,
		...settings,
	};
	const plan = planRange(state.canonical, tempId, start, null);
	newRow.effective_to = plan.target.effective_to;
	const postCanonical = state.canonical
		.filter((row) => agreementIdOf(row) !== tempId)
		.map((row) => ({ ...row }));
	postCanonical.push(newRow);
	const useFailure = postUseFailure(state, postCanonical, employeeId, now);
	if (useFailure !== null) return useFailure;
	const periodFailure = periodResolutionFailure(
		postCanonical,
		start,
		tempId,
		employeeId,
		now
	);
	if (periodFailure !== null) return periodFailure;

	const values: Values = {
		employee_id: employeeId,
		effective_from: start,
		effective_to: newRow.effective_to ?? null,
		is_active: 1,
		employer_cost: command.ctcText,
		std_hours_per_day: command.hours,
		salary_type: salaryType,
		...settings,
	};
	const insert = buildInsert(values);
	const [result] = await db.execute(insert.sql, insert.params);
	const inserted = asRows([result])[0];
	const insertId = positiveInteger(inserted?.insertId);
	if (insertId === null) {
		throw new Error('Salary agreement insert did not return an id');
	}
	await writeRangeUpdates(db, plan.rangeUpdates, employeeId);
	const version = await advanceVersion(db, state, actorId);
	const finalRow = { ...newRow, id: insertId };
	await recordPayrollAudit(db, {
		entityType: PAYROLL_AUDIT_ENTITY.SALARY_PROFILE,
		entityId: insertId,
		action: PAYROLL_AUDIT_ACTION.CREATE,
		employeeId,
		performedBy: actorId,
		oldValues: null,
		newValues: auditSnapshot(finalRow),
		required: true,
	});
	return success('create-initial', finalRow, version, now);
}

async function correctUnused(
	db: SalaryCommandDb,
	state: SalaryCommandState,
	command: ParsedCommand,
	now: string,
	actorId: number
): Promise<SalaryCommandOutcome> {
	const employeeId = command.employeeId;
	const agreementId = command.agreementId as number;
	const target = findAgreement(state, agreementId);
	if (target === null) {
		return sqlFailure(
			'agreement_not_found',
			404,
			`Salary agreement ${agreementId} does not belong to Employee ${employeeId}`
		);
	}
	if (!isEligibleAgreement(target)) {
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'Cancelled or inactive agreements are read-only'
		);
	}
	const overlapFailure = ambiguousTimelineFailure(
		state,
		agreementId,
		employeeId,
		now
	);
	if (overlapFailure !== null) return overlapFailure;
	const targetClassification = classificationOfRow(target, now);
	if (
		targetClassification !== 'current' &&
		targetClassification !== 'scheduled'
	) {
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'Previous agreements are read-only; use a new revision'
		);
	}
	if (agreementHasExactUse(state, agreementId)) {
		return sqlFailure(
			'used',
			409,
			'Payroll already used this agreement; corrections are no longer allowed'
		);
	}
	const targetStart = agreementStart(target) as string;
	if (exactUseMonths(state).has(monthOf(targetStart))) {
		return sqlFailure(
			'used',
			409,
			'Payroll already used this month; corrections are no longer allowed'
		);
	}
	const ambiguousFailure = ambiguousCandidateFailure(state, agreementId);
	if (ambiguousFailure !== null) return ambiguousFailure;

	const parsed = parseEffectiveFrom(command.effectiveFrom ?? targetStart, true);
	if (parsed === null) {
		return sqlFailure(
			'invalid_input',
			400,
			'effective_from must be a valid date'
		);
	}
	const start = parsed.start;
	if (state.employeeStart !== null && start < state.employeeStart) {
		return sqlFailure(
			'invalid_input',
			400,
			'effective_from cannot precede the employment start date'
		);
	}
	if (parsed.midMonth && start !== targetStart) {
		const earliest = eligibleRows(state.canonical)[0];
		if (
			state.employeeStart === null ||
			start !== state.employeeStart ||
			earliest === undefined ||
			agreementIdOf(earliest) !== agreementId
		) {
			return sqlFailure(
				'invalid_input',
				400,
				'Only the earliest initial agreement may use the verified joining date'
			);
		}
	}
	if (start !== targetStart) {
		const targetMonth = monthOf(targetStart);
		const newMonth = monthOf(start);
		if (targetClassification === 'current') {
			if (targetMonth < currentMonthStart(now)) {
				return sqlFailure(
					'earlier_month',
					409,
					'A current agreement that started in an earlier month cannot be moved'
				);
			}
			if (newMonth !== currentMonthStart(now)) {
				return sqlFailure(
					'invalid_lifecycle',
					422,
					'A current agreement can only be corrected within the current month'
				);
			}
		} else {
			if (parsed.midMonth) {
				return sqlFailure(
					'invalid_input',
					400,
					'A scheduled agreement must start on the first day of a month'
				);
			}
			if (newMonth < currentMonthStart(now)) {
				return sqlFailure(
					'earlier_month',
					409,
					'A scheduled agreement cannot move into an earlier month'
				);
			}
		}
		if (hasStartConflict(state.canonical, start, agreementId)) {
			return sqlFailure(
				'date_conflict',
				409,
				'Another non-cancelled agreement already starts on this date'
			);
		}
		if (exactUseMonths(state).has(monthOf(start))) {
			return sqlFailure('used', 409, 'Payroll already used the target month');
		}
	}

	const plan = planRange(state.canonical, agreementId, start, agreementId);
	const updatedRow: SalaryProfileRow = {
		...target,
		...command.settings,
		employer_cost: command.ctc,
		std_hours_per_day: command.hours,
		effective_from: start,
		effective_to: plan.target.effective_to,
	};
	if (command.salaryType !== null) {
		updatedRow.salary_type = command.salaryType;
	}
	const postCanonical = plan.postCanonical.map((row) =>
		agreementIdOf(row) === agreementId ? updatedRow : row
	);
	const useFailure = postUseFailure(state, postCanonical, employeeId, now);
	if (useFailure !== null) return useFailure;
	const periodFailure = periodResolutionFailure(
		postCanonical,
		start,
		agreementId,
		employeeId,
		now
	);
	if (periodFailure !== null) return periodFailure;

	const values: Values = {
		...command.settings,
		employer_cost: command.ctcText,
		std_hours_per_day: command.hours,
		effective_from: start,
		effective_to: plan.target.effective_to ?? null,
	};
	if (command.salaryType !== null) values.salary_type = command.salaryType;
	const update = buildUpdate(values, agreementId, employeeId);
	const [result] = await db.execute(update.sql, update.params);
	const affected = asRows([result])[0]?.affectedRows;
	if (typeof affected !== 'number') {
		throw new Error(
			`Salary agreement ${agreementId} write returned no affected-row count`
		);
	}
	if (affected === 0 && !(await agreementExists(db, agreementId, employeeId))) {
		return sqlFailure(
			'agreement_not_found',
			404,
			`Salary agreement ${agreementId} no longer exists`
		);
	}
	await writeRangeUpdates(db, plan.rangeUpdates, employeeId);
	const version = await advanceVersion(db, state, actorId);
	await recordPayrollAudit(db, {
		entityType: PAYROLL_AUDIT_ENTITY.SALARY_PROFILE,
		entityId: agreementId,
		action: PAYROLL_AUDIT_ACTION.CORRECT,
		employeeId,
		performedBy: actorId,
		oldValues: auditSnapshot(target),
		newValues: auditSnapshot(updatedRow),
		required: true,
	});
	return success('correct', updatedRow, version, now);
}

async function createRevision(
	db: SalaryCommandDb,
	state: SalaryCommandState,
	command: ParsedCommand,
	now: string,
	actorId: number
): Promise<SalaryCommandOutcome> {
	const employeeId = command.employeeId;
	const agreementId = command.agreementId as number;
	const target = findAgreement(state, agreementId);
	if (target === null) {
		return sqlFailure(
			'agreement_not_found',
			404,
			`Salary agreement ${agreementId} does not belong to Employee ${employeeId}`
		);
	}
	if (!isEligibleAgreement(target)) {
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'Cancelled or inactive agreements cannot be revised'
		);
	}
	const overlapFailure = ambiguousTimelineFailure(
		state,
		agreementId,
		employeeId,
		now
	);
	if (overlapFailure !== null) return overlapFailure;
	const eligible = eligibleRows(state.canonical);
	const parsed = parseEffectiveFrom(command.effectiveFrom, false);
	if (parsed === null) {
		return sqlFailure(
			'invalid_input',
			400,
			'A salary revision must start on the first day of a month'
		);
	}
	const start = parsed.start;
	const targetStart = agreementStart(target) as string;
	if (start <= targetStart) {
		return start === targetStart
			? sqlFailure(
					'date_conflict',
					409,
					'Another non-cancelled agreement already starts on this date'
				)
			: sqlFailure(
					'earlier_month',
					409,
					'A revision cannot start before its predecessor'
				);
	}
	if (start < currentMonthStart(now)) {
		return sqlFailure(
			'earlier_month',
			409,
			'A salary revision cannot be backdated into an earlier month'
		);
	}
	if (state.employeeStart !== null && start < state.employeeStart) {
		return sqlFailure(
			'invalid_input',
			400,
			'effective_from cannot precede the employment start date'
		);
	}
	if (hasStartConflict(state.canonical, start, agreementId)) {
		return sqlFailure(
			'date_conflict',
			409,
			'Another non-cancelled agreement already starts on this date'
		);
	}
	const successor = eligible.find(
		(row) => (agreementStart(row) ?? '') > targetStart
	);
	const successorStart =
		successor === undefined ? null : agreementStart(successor);
	if (successorStart !== null && start > successorStart) {
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'A revision cannot skip a scheduled successor; revise the latest agreement'
		);
	}
	if (exactUseMonths(state).has(monthOf(start))) {
		return sqlFailure(
			'used',
			409,
			'Payroll already used this month; choose an unused month'
		);
	}

	const settings = copiedSettings(target, command.settings);
	const tempId = maxAgreementId(state.canonical) + 1;
	const salaryType =
		command.salaryType ?? textValue(target.salary_type) ?? 'monthly';
	const newRow: SalaryProfileRow = {
		id: tempId,
		employee_id: employeeId,
		effective_from: start,
		effective_to: null,
		is_active: 1,
		cancelled_at: null,
		employer_cost: command.ctc,
		std_hours_per_day: command.hours,
		salary_type: salaryType,
		...settings,
	};
	const plan = planRange(state.canonical, tempId, start, null);
	newRow.effective_to = plan.target.effective_to;
	const postCanonical = plan.postCanonical.map((row) => ({ ...row }));
	postCanonical.push(newRow);
	const useFailure = postUseFailure(state, postCanonical, employeeId, now);
	if (useFailure !== null) return useFailure;
	const periodFailure = periodResolutionFailure(
		postCanonical,
		start,
		tempId,
		employeeId,
		now
	);
	if (periodFailure !== null) return periodFailure;

	const values: Values = {
		employee_id: employeeId,
		effective_from: start,
		effective_to: newRow.effective_to ?? null,
		is_active: 1,
		employer_cost: command.ctcText,
		std_hours_per_day: command.hours,
		salary_type: salaryType,
		...settings,
	};
	const insert = buildInsert(values);
	const [result] = await db.execute(insert.sql, insert.params);
	const inserted = asRows([result])[0];
	const insertId = positiveInteger(inserted?.insertId);
	if (insertId === null) {
		throw new Error('Salary revision insert did not return an id');
	}
	await writeRangeUpdates(db, plan.rangeUpdates, employeeId);
	const version = await advanceVersion(db, state, actorId);
	const finalRow = { ...newRow, id: insertId };
	await recordPayrollAudit(db, {
		entityType: PAYROLL_AUDIT_ENTITY.SALARY_PROFILE,
		entityId: insertId,
		action: PAYROLL_AUDIT_ACTION.REVISE,
		employeeId,
		performedBy: actorId,
		oldValues: auditSnapshot(target),
		newValues: auditSnapshot(finalRow),
		required: true,
	});
	return success('revise', finalRow, version, now);
}

async function cancelScheduled(
	db: SalaryCommandDb,
	state: SalaryCommandState,
	command: ParsedCommand,
	now: string,
	actorId: number
): Promise<SalaryCommandOutcome> {
	const employeeId = command.employeeId;
	const agreementId = command.agreementId as number;
	const target = findAgreement(state, agreementId);
	if (target === null) {
		return sqlFailure(
			'agreement_not_found',
			404,
			`Salary agreement ${agreementId} does not belong to Employee ${employeeId}`
		);
	}
	if (!isEligibleAgreement(target)) {
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'This agreement is already cancelled or inactive'
		);
	}
	const overlapFailure = ambiguousTimelineFailure(
		state,
		agreementId,
		employeeId,
		now
	);
	if (overlapFailure !== null) return overlapFailure;
	const targetStart = agreementStart(target) as string;
	const classification = classificationOfRow(target, now);
	if (classification !== 'scheduled') {
		return sqlFailure(
			'invalid_lifecycle',
			422,
			'Only an unused Scheduled agreement can be cancelled'
		);
	}
	if (agreementHasExactUse(state, agreementId)) {
		return sqlFailure(
			'used',
			409,
			'Payroll already used this agreement; it cannot be cancelled'
		);
	}
	if (exactUseMonths(state).has(monthOf(targetStart))) {
		return sqlFailure('used', 409, 'Payroll already used this scheduled month');
	}
	const ambiguousFailure = ambiguousCandidateFailure(state, agreementId);
	if (ambiguousFailure !== null) return ambiguousFailure;

	const others = eligibleRows(state.canonical).filter(
		(row) => agreementIdOf(row) !== agreementId
	);
	const predecessor = [...others]
		.reverse()
		.find((row) => (agreementStart(row) ?? '') < targetStart);
	const successor = others.find(
		(row) => (agreementStart(row) ?? '') > targetStart
	);
	const rangeUpdates: Array<{ id: number; effective_to: string | null }> = [];
	let postCanonical = state.canonical.map((row) => ({ ...row }));
	if (predecessor !== undefined) {
		const predecessorId = agreementIdOf(predecessor);
		if (predecessorId !== null) {
			const end =
				successor === undefined
					? null
					: previousSalaryDay(agreementStart(successor) as string);
			if (agreementEnd(predecessor) !== end) {
				rangeUpdates.push({ id: predecessorId, effective_to: end });
			}
			postCanonical = postCanonical.map((row) =>
				agreementIdOf(row) === predecessorId
					? { ...row, effective_to: end }
					: row
			);
		}
	}
	postCanonical = postCanonical.map((row) =>
		agreementIdOf(row) === agreementId
			? {
					...row,
					cancelled_at: 'CURRENT_TIMESTAMP',
					is_active: 0,
				}
			: row
	);
	const useFailure = postUseFailure(state, postCanonical, employeeId, now);
	if (useFailure !== null) return useFailure;

	const [result] = await db.execute(
		`UPDATE employee_salary_profile
        SET cancelled_at = CURRENT_TIMESTAMP,
            cancelled_by = ?,
            cancelled_reason = ?,
            is_active = 0,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND employee_id = ?`,
		[actorId, command.cancellationReason, agreementId, employeeId]
	);
	const affected = asRows([result])[0]?.affectedRows;
	if (typeof affected !== 'number') {
		throw new Error(
			`Salary agreement ${agreementId} write returned no affected-row count`
		);
	}
	if (affected === 0 && !(await agreementExists(db, agreementId, employeeId))) {
		return sqlFailure(
			'agreement_not_found',
			404,
			`Salary agreement ${agreementId} no longer exists`
		);
	}
	await writeRangeUpdates(db, rangeUpdates, employeeId);
	const version = await advanceVersion(db, state, actorId);
	const [cancelledRows] = await db.execute(
		`SELECT cancelled_at FROM employee_salary_profile
      WHERE id = ? AND employee_id = ? LIMIT 1`,
		[agreementId, employeeId]
	);
	const cancelledAt = asRows(cancelledRows)[0]?.cancelled_at ?? null;
	const cancelledRow: SalaryProfileRow = {
		...target,
		cancelled_at:
			typeof cancelledAt === 'string' ? cancelledAt : 'CURRENT_TIMESTAMP',
		cancelled_by: actorId,
		cancelled_reason: command.cancellationReason,
		is_active: 0,
	};
	await recordPayrollAudit(db, {
		entityType: PAYROLL_AUDIT_ENTITY.SALARY_PROFILE,
		entityId: agreementId,
		action: PAYROLL_AUDIT_ACTION.CANCEL,
		employeeId,
		performedBy: actorId,
		oldValues: auditSnapshot(target),
		newValues: auditSnapshot(cancelledRow),
		required: true,
	});
	return success('cancel', cancelledRow, version, now);
}

/**
 * Run one explicit salary operation in the caller's transaction.
 *
 * Business conflicts resolve to `ok: false` with no writes. Database failures
 * (including a rejected required audit row) reject; the caller must roll back.
 */
export async function runSalaryCommand(
	db: SalaryCommandDb,
	input: SalaryCommandInput,
	context: SalaryCommandContext
): Promise<SalaryCommandOutcome> {
	const actorId = positiveInteger(context.actorId);
	if (actorId === null) {
		throw new RangeError('Authenticated salary actor is required');
	}
	const now =
		context.now === undefined ? serverPayrollDate() : formatDate(context.now);
	if (now === null) {
		throw new RangeError(`Invalid command date "${String(context.now)}"`);
	}
	const parsed = parseCommandInput(input);
	if (!parsed.ok) return parsed.failure;
	const command = parsed.command;
	const read = await readCommandState(db, command.employeeId);
	if (!read.ok) return read.failure;
	const state = read.state;
	if (state.lock.timeline_version !== command.expectedVersion) {
		return staleFailure(command.expectedVersion, state.lock.timeline_version);
	}
	if (
		state.use.unknown_history ||
		state.evidence.some((row) => row.month === null)
	) {
		return sqlFailure(
			'ambiguous_history',
			409,
			'Known prior payroll use has no provable month; salary timeline changes are blocked until it is reviewed'
		);
	}
	const historyFailure = historyConflict(state);
	if (historyFailure !== null) return historyFailure;
	switch (command.operation) {
		case 'create-initial':
			return createInitial(db, state, command, now, actorId);
		case 'correct':
			return correctUnused(db, state, command, now, actorId);
		case 'revise':
			return createRevision(db, state, command, now, actorId);
		case 'cancel':
			return cancelScheduled(db, state, command, now, actorId);
	}
	return sqlFailure(
		'invalid_input',
		400,
		`Unsupported salary operation "${String(command.operation)}"`
	);
}
