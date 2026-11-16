import { describe, expect, it, vi } from 'vitest';
import {
	readSalaryTimeline,
	runSalaryCommand,
} from '@/lib/salary-profile-commands';

// The read contract composes this existing helper; its own calendar logic is
// covered by the payroll calculator suite. A fixed month keeps the basis
// assertion deterministic and avoids loading database-backed payroll modules.
vi.mock('@/utils/payroll-calculator', () => ({
	getWorkingDaysForMonth: vi.fn(async () => ({ workingDays: 25 })),
}));

/**
 * Behaviour tests for the salary command/read core. The core is the public
 * seam the HTTP route and the contention harness both drive, so every
 * assertion here is consumer-visible: returned identity/code/version, the rows
 * the caller-owned transaction was asked to write, audit rows, or the read DTO.
 */

const NOW = '2026-11-15';
const EMPLOYEE_ID = 11;
const AGREEMENT_ID = 71;

type Row = Record<string, unknown>;

interface FakeState {
	employee: Row | null;
	timelineExists: boolean;
	timelineVersion: number;
	canonical: Row[];
	legacy: Row[];
	use: Row[];
	attendance: Row[];
	audit: Array<{
		entityType: string;
		entityId: number;
		employeeId: number | null;
		action: string;
		oldValues: Row | null;
		newValues: Row | null;
		performedBy: number;
	}>;
	updates: Array<{ sql: string; params: unknown[] }>;
	inserts: Array<{ sql: string; params: unknown[] }>;
	failAudit: boolean;
	nextInsertId: number;
}

const EMPLOYEE: Row = {
	id: EMPLOYEE_ID,
	employee_id: 'EMP011',
	first_name: 'Asha',
	last_name: 'Rao',
	department: 'Payroll',
	position: 'Analyst',
	employee_type: 'Payroll',
	status: 'active',
	joining_date: '2024-01-01',
	hire_date: null,
	isDelete: 0,
};

const unusedAgreement = (overrides: Row = {}): Row => ({
	id: AGREEMENT_ID,
	employee_id: EMPLOYEE_ID,
	effective_from: '2026-11-01',
	effective_to: null,
	is_active: 1,
	cancelled_at: null,
	salary_type: 'monthly',
	employer_cost: '26000.00',
	gross_salary: '25000.00',
	gross: '25000.00',
	contract_amount: '50000.00',
	std_hours_per_day: '8.0',
	other_allowances: '0.00',
	remarks: 'original note',
	is_manual_override: 0,
	pl_total: 21,
	basic: '12000.00',
	pf_applicable: 1,
	esic_applicable: 1,
	...overrides,
});

function createState(overrides: Partial<FakeState> = {}): FakeState {
	return {
		employee: { ...EMPLOYEE },
		timelineExists: true,
		timelineVersion: 4,
		canonical: [unusedAgreement()],
		legacy: [],
		use: [],
		attendance: [],
		audit: [],
		updates: [],
		inserts: [],
		failAudit: false,
		nextInsertId: 101,
		...overrides,
	};
}

function salaryUseRow(overrides: Row = {}): Row {
	const row: Row = {
		id: 1,
		employee_id: EMPLOYEE_ID,
		month: '2026-11-01',
		agreement_id: AGREEMENT_ID,
		agreement_source: 'employee_salary_profile',
		evidence: 'payroll_generation',
		is_ambiguous: 0,
		evidence_context: null,
		first_used_by: 9,
		first_used_at: '2026-11-10 10:00:00',
		...overrides,
	};
	if (
		row.evidence_context != null &&
		typeof row.evidence_context !== 'string'
	) {
		row.evidence_context = JSON.stringify(row.evidence_context);
	}
	return row;
}

function insertRow(sql: string, params: readonly unknown[]): Row {
	const match =
		/INSERT INTO employee_salary_profile \(([^)]*)\)\s*VALUES \(([^)]*)\)/s.exec(
			sql
		);
	if (match === null) return {};
	const columns = match[1].split(',').map((column) => column.trim());
	const row: Row = {};
	columns.forEach((column, index) => {
		row[column] = params[index];
	});
	return row;
}

function applyUpdate(
	sql: string,
	params: readonly unknown[],
	rows: Row[]
): number {
	const setSql = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
	const assignments = setSql
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	let paramIndex = 0;
	const values: Row = {};
	for (const assignment of assignments) {
		const [columnRaw, valueRaw] = assignment.split('=');
		const column = columnRaw.trim();
		const value = valueRaw.trim();
		if (value.includes('?')) {
			values[column] = params[paramIndex];
			paramIndex += 1;
		} else if (/CURRENT_TIMESTAMP/i.test(value)) {
			values[column] = '2026-11-15 10:00:00';
		} else if (/^-?\d+(\.\d+)?$/.test(value)) {
			values[column] = Number(value);
		} else if (/^NULL$/i.test(value)) {
			values[column] = null;
		}
	}
	const whereParams = params.slice(paramIndex);
	const id = Number(whereParams[0]);
	const index = rows.findIndex((candidate) => Number(candidate.id) === id);
	if (index < 0) return 0;
	// Replace the stored row; the command still holds the pre-update object for
	// its audit snapshot, exactly as mysql2 would for a fresh SELECT.
	rows[index] = { ...rows[index], ...values };
	return 1;
}

function fakeDb(state: FakeState) {
	return {
		execute: async (sql: string, params: readonly unknown[] = []) => {
			const text = String(sql);
			if (text.includes('FROM employees') && text.includes('FOR UPDATE')) {
				return [state.employee === null ? [] : [state.employee], undefined];
			}
			if (text.includes('SELECT id, employee_id, first_name')) {
				return [state.employee === null ? [] : [state.employee], undefined];
			}
			if (
				text.includes('FROM employee_salary_timelines') &&
				text.includes('FOR UPDATE')
			) {
				return [
					state.timelineExists
						? [{ employee_id: EMPLOYEE_ID, version: state.timelineVersion }]
						: [],
					undefined,
				];
			}
			if (
				text.includes('SELECT version') &&
				text.includes('employee_salary_timelines')
			) {
				return [
					state.timelineExists ? [{ version: state.timelineVersion }] : [],
					undefined,
				];
			}
			if (text.startsWith('INSERT INTO employee_salary_profile')) {
				state.inserts.push({ sql: text, params: [...params] });
				const row = insertRow(text, params);
				row.id = state.nextInsertId;
				state.nextInsertId += 1;
				state.canonical.push(row);
				return [{ insertId: row.id, affectedRows: 1 }, undefined];
			}
			if (text.startsWith('UPDATE employee_salary_profile')) {
				state.updates.push({ sql: text, params: [...params] });
				return [
					{ affectedRows: applyUpdate(text, params, state.canonical) },
					undefined,
				];
			}
			if (text.includes('SELECT cancelled_at')) {
				const id = Number(params[0]);
				const row = state.canonical.find(
					(candidate) => Number(candidate.id) === id
				);
				return [
					row === undefined ? [] : [{ cancelled_at: row.cancelled_at }],
					undefined,
				];
			}
			if (text.includes('FROM employee_salary_profile')) {
				return [state.canonical, undefined];
			}
			if (text.includes('FROM salary_structures')) {
				return [state.legacy, undefined];
			}
			if (text.includes('FROM employee_salary_payroll_use')) {
				return [state.use, undefined];
			}
			if (text.includes('FROM employee_attendance_summary')) {
				return [state.attendance, undefined];
			}
			if (text.includes('FROM holiday_master')) {
				return [[], undefined];
			}
			if (text.includes('UPDATE employee_salary_timelines')) {
				state.timelineVersion += 1;
				return [{ affectedRows: 1 }, undefined];
			}
			if (text.includes('INSERT INTO employee_salary_timelines')) {
				state.timelineExists = true;
				state.timelineVersion = 1;
				return [{ affectedRows: 1 }, undefined];
			}
			if (text.includes('INSERT INTO payroll_audit_logs')) {
				if (state.failAudit) throw new Error('audit unavailable');
				const [
					entityType,
					entityId,
					employeeId,
					action,
					oldValues,
					newValues,
					,
					,
					,
					performedBy,
				] = params;
				state.audit.push({
					entityType: String(entityType),
					entityId: Number(entityId),
					employeeId: employeeId == null ? null : Number(employeeId),
					action: String(action),
					oldValues:
						oldValues == null ? null : (JSON.parse(String(oldValues)) as Row),
					newValues:
						newValues == null ? null : (JSON.parse(String(newValues)) as Row),
					performedBy: Number(performedBy),
				});
				return [{ insertId: 1 }, undefined];
			}
			return [[], undefined];
		},
	};
}

const correctionInput = {
	operation: 'correct' as const,
	employee_id: EMPLOYEE_ID,
	agreement_id: AGREEMENT_ID,
	expected_timeline_version: 4,
	effective_from: '2026-11-01',
	salary_type: 'monthly',
	employer_cost: 27500,
	std_hours_per_day: 8,
	other_allowances: 500,
	is_manual_override: true,
	remarks: 'corrected note',
};

describe('salary command core — unused correction (issue #437)', () => {
	it('corrects an unused agreement in place and keeps its agreement identity', async () => {
		const state = createState();

		const outcome = await runSalaryCommand(fakeDb(state), correctionInput, {
			actorId: 9,
			now: NOW,
		});

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		expect(outcome.agreement_id).toBe(AGREEMENT_ID);
		expect(outcome.operation).toBe('correct');
		expect(outcome.timeline_version).toBe(5);

		expect(state.inserts).toHaveLength(0);
		expect(state.canonical).toHaveLength(1);
		expect(state.canonical[0].id).toBe(AGREEMENT_ID);
		expect(Number(state.canonical[0].employer_cost)).toBe(27500);
		expect(Number(state.canonical[0].other_allowances)).toBe(500);
		expect(state.canonical[0].remarks).toBe('corrected note');
		expect(Number(state.canonical[0].is_manual_override)).toBe(1);

		expect(state.audit).toHaveLength(1);
		expect(state.audit[0]).toMatchObject({
			entityType: 'salary_profile',
			entityId: AGREEMENT_ID,
			employeeId: EMPLOYEE_ID,
			action: 'correct',
			performedBy: 9,
		});
		expect(state.audit[0].oldValues?.employer_cost).toBe('26000.00');
		expect(state.audit[0].newValues?.employer_cost).toBe(27500);

		// In-place correction preserves recorded legacy references exactly.
		expect(state.canonical[0].gross_salary).toBe('25000.00');
		expect(state.canonical[0].gross).toBe('25000.00');
		expect(state.canonical[0].contract_amount).toBe('50000.00');
	});

	it('rejects an agreement already used by payroll without writing anything', async () => {
		const state = createState({ use: [salaryUseRow()] });

		const outcome = await runSalaryCommand(fakeDb(state), correctionInput, {
			actorId: 9,
			now: NOW,
		});

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected a conflict');
		expect(outcome.code).toBe('used');
		expect(state.updates).toHaveLength(0);
		expect(state.audit).toHaveLength(0);
	});

	it('rejects Previous agreements as read-only', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					effective_from: '2026-09-01',
					effective_to: '2026-09-30',
				}),
			],
		});

		const outcome = await runSalaryCommand(fakeDb(state), correctionInput, {
			actorId: 9,
			now: NOW,
		});

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected a lifecycle conflict');
		expect(outcome.code).toBe('invalid_lifecycle');
		expect(state.updates).toHaveLength(0);
	});

	it('rejects a stale expected timeline version', async () => {
		const state = createState();
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{ ...correctionInput, expected_timeline_version: 3 },
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected a stale conflict');
		expect(outcome.code).toBe('stale_version');
		expect(outcome.details).toEqual({
			expected_version: 3,
			actual_version: 4,
		});
		expect(state.updates).toHaveLength(0);
		expect(state.audit).toHaveLength(0);
	});

	it('rejects live attendance PL usage and legacy gross as write inputs', async () => {
		const state = createState();
		for (const field of [
			'pl_used',
			'pl_balance',
			'gross_salary',
			'contract_amount',
		]) {
			const outcome = await runSalaryCommand(
				fakeDb(state),
				{ ...correctionInput, [field]: 10 },
				{ actorId: 9, now: NOW }
			);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) throw new Error('expected invalid input');
			expect(outcome.code).toBe('invalid_input');
		}
		expect(state.updates).toHaveLength(0);
	});

	it('rejects a missing or foreign agreement instead of succeeding on zero rows', async () => {
		const state = createState();
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{ ...correctionInput, agreement_id: 999 },
			{ actorId: 9, now: NOW }
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected missing agreement');
		expect(outcome.code).toBe('agreement_not_found');
		expect(state.updates).toHaveLength(0);
		expect(state.audit).toHaveLength(0);
	});
});

describe('salary command core — revision and range maintenance (#437)', () => {
	it('refuses a second initial agreement when one already exists', async () => {
		const state = createState();
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'create-initial',
				employee_id: EMPLOYEE_ID,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected lifecycle conflict');
		expect(outcome.code).toBe('invalid_lifecycle');
		expect(state.inserts).toHaveLength(0);
	});

	it('rejects a revision into an earlier month', async () => {
		const state = createState({
			canonical: [unusedAgreement({ effective_from: '2026-09-01' })],
		});
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-10-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected earlier-month conflict');
		expect(outcome.code).toBe('earlier_month');
	});

	it('rejects a scheduled correction moved into an earlier month or a mid-month start', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					effective_from: '2026-12-01',
					employer_cost: '30000.00',
				}),
			],
		});
		const earlier = await runSalaryCommand(
			fakeDb(state),
			{ ...correctionInput, effective_from: '2026-10-01' },
			{ actorId: 9, now: NOW }
		);
		expect(earlier.ok).toBe(false);
		if (earlier.ok) throw new Error('expected earlier-month conflict');
		expect(earlier.code).toBe('earlier_month');

		const midMonth = await runSalaryCommand(
			fakeDb(state),
			{ ...correctionInput, effective_from: '2026-12-15' },
			{ actorId: 9, now: NOW }
		);
		expect(midMonth.ok).toBe(false);
		if (midMonth.ok) throw new Error('expected mid-month conflict');
		expect(midMonth.code).toBe('invalid_input');
	});

	it('creates a successor, preserves the predecessor and leaves legacy references unset', async () => {
		const state = createState();

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
				other_allowances: 750,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		expect(outcome.agreement_id).toBe(101);
		expect(outcome.classification).toBe('scheduled');
		expect(state.canonical).toHaveLength(2);
		const predecessor = state.canonical.find(
			(row) => Number(row.id) === AGREEMENT_ID
		);
		const successor = state.canonical.find((row) => Number(row.id) === 101);
		expect(predecessor?.effective_to).toBe('2026-11-30');
		expect(predecessor?.employer_cost).toBe('26000.00');
		expect(successor?.employer_cost).toBe('30000.00');
		expect(Number(successor?.other_allowances)).toBe(750);
		// Copied supported setting, but no legacy amount or contract amount.
		expect(successor?.remarks).toBe('original note');
		expect(successor?.gross_salary).toBeUndefined();
		expect(successor?.gross).toBeUndefined();
		expect(successor?.contract_amount).toBeUndefined();
		expect(state.audit[0].action).toBe('revise');
		expect(state.audit[0].oldValues?.id).toBe(AGREEMENT_ID);
		expect(state.audit[0].newValues?.id).toBe(101);
	});

	it('rejects a revision starting on an existing non-cancelled date', async () => {
		const state = createState();
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-11-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected a date conflict');
		expect(outcome.code).toBe('date_conflict');
		expect(state.inserts).toHaveLength(0);
	});

	it('rejects a revision that would displace an exact future payroll use', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					effective_from: '2026-10-01',
				}),
			],
			use: [
				salaryUseRow({
					month: '2026-12-01',
					evidence: 'payroll_generation',
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-11-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected protected use');
		expect(outcome.code).toBe('protected');
		expect(state.inserts).toHaveLength(0);
		expect(state.audit).toHaveLength(0);
	});

	it('rejects a revision into an exact used month', async () => {
		const state = createState({
			use: [salaryUseRow({ month: '2026-12-01' })],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected used');
		expect(outcome.code).toBe('used');
	});

	it('moves an unused scheduled agreement to another future month and reconnects its neighbours', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					id: 70,
					effective_from: '2026-11-01',
					effective_to: '2026-11-30',
				}),
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-12-01',
					effective_to: null,
					employer_cost: '30000.00',
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				...correctionInput,
				effective_from: '2027-01-01',
				employer_cost: 31000,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		expect(outcome.classification).toBe('scheduled');
		const moved = state.canonical.find(
			(row) => Number(row.id) === AGREEMENT_ID
		);
		const predecessor = state.canonical.find((row) => Number(row.id) === 70);
		expect(moved?.effective_from).toBe('2027-01-01');
		expect(moved?.effective_to).toBeNull();
		expect(Number(moved?.employer_cost)).toBe(31000);
		expect(predecessor?.effective_to).toBe('2026-12-31');
	});

	it('inserts a revision before an existing scheduled successor', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-10-01',
					effective_to: null,
				}),
				unusedAgreement({
					id: 72,
					effective_from: '2026-12-01',
					effective_to: null,
					employer_cost: '32000.00',
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-11-01',
				salary_type: 'monthly',
				employer_cost: 28000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		const predecessor = state.canonical.find(
			(row) => Number(row.id) === AGREEMENT_ID
		);
		const successor = state.canonical.find((row) => Number(row.id) === 72);
		const inserted = state.canonical.find((row) => Number(row.id) === 101);
		expect(predecessor?.effective_to).toBe('2026-10-31');
		expect(inserted?.effective_from).toBe('2026-11-01');
		expect(inserted?.effective_to).toBe('2026-11-30');
		expect(successor?.effective_from).toBe('2026-12-01');
	});

	it('refuses a revision that skips an existing scheduled successor', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-10-01',
					effective_to: null,
				}),
				unusedAgreement({
					id: 72,
					effective_from: '2026-12-01',
					effective_to: null,
					employer_cost: '32000.00',
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2027-01-01',
				salary_type: 'monthly',
				employer_cost: 28000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected lifecycle conflict');
		expect(outcome.code).toBe('invalid_lifecycle');
		expect(state.inserts).toHaveLength(0);
	});

	it('allows a used current agreement to gain a successor in an unused month', async () => {
		const state = createState({
			use: [salaryUseRow({ month: '2026-11-01' })],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		// The used month still resolves to the same agreement; only the future
		// period moved to the successor.
		const predecessor = state.canonical.find(
			(row) => Number(row.id) === AGREEMENT_ID
		);
		expect(predecessor?.effective_to).toBe('2026-11-30');
		expect(state.canonical).toHaveLength(2);
	});
});

describe('salary command core — known-month ambiguity (#437)', () => {
	const ambiguous = (month: string, overrides: Row = {}) =>
		salaryUseRow({
			month,
			agreement_id: null,
			agreement_source: null,
			evidence: 'legacy_slip',
			is_ambiguous: 1,
			evidence_context: {
				candidate_agreements: [
					{
						agreement_id: AGREEMENT_ID,
						agreement_source: 'employee_salary_profile',
					},
				],
			},
			...overrides,
		});

	it('allows a clean future revision while October coverage stays unchanged', async () => {
		const state = createState({
			canonical: [unusedAgreement({ effective_from: '2026-10-01' })],
			use: [ambiguous('2026-10-01')],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		expect(state.canonical).toHaveLength(2);
		// The ambiguous month is still covered by the same confirmed candidate.
		expect(
			state.canonical.find((row) => Number(row.id) === AGREEMENT_ID)
				?.effective_to
		).toBe('2026-11-30');
	});

	it('rejects a change that captures an ambiguous month into a new agreement', async () => {
		const state = createState({
			canonical: [unusedAgreement({ effective_from: '2026-09-01' })],
			use: [ambiguous('2026-10-01')],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-10-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: '2026-10-15' }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected protected ambiguity');
		expect(outcome.code).toBe('protected');
		expect(outcome.details?.reason).toBe('ambiguous_month_coverage');
	});

	it('forbids an in-place correction of a plausible ambiguous candidate', async () => {
		const state = createState({
			canonical: [unusedAgreement({ effective_from: '2026-10-01' })],
			use: [ambiguous('2026-10-01')],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{ ...correctionInput, effective_from: '2026-10-01' },
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected protected ambiguity');
		expect(outcome.code).toBe('used');
		expect(outcome.details?.reason).toBe('ambiguous_use');
	});

	it('blocks every timeline write when prior use has no provable month', async () => {
		const state = createState({
			use: [
				salaryUseRow({
					month: null,
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_slip',
					is_ambiguous: 1,
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'revise',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				effective_from: '2026-12-01',
				salary_type: 'monthly',
				employer_cost: 30000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected unknown-history conflict');
		expect(outcome.code).toBe('ambiguous_history');
		expect(state.inserts).toHaveLength(0);
	});
});

describe('salary command core — cancellation and initial setup (#437)', () => {
	it('cancels a scheduled revision, retains it and reconnects predecessor coverage', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					id: 70,
					effective_from: '2026-11-01',
					effective_to: '2026-11-30',
				}),
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-12-01',
					effective_to: null,
					employer_cost: '30000.00',
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'cancel',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
				cancellation_reason: 'hike withdrawn',
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		expect(outcome.classification).toBe('cancelled');
		const cancelled = state.canonical.find(
			(row) => Number(row.id) === AGREEMENT_ID
		);
		const predecessor = state.canonical.find((row) => Number(row.id) === 70);
		expect(Number(cancelled?.is_active)).toBe(0);
		expect(cancelled?.cancelled_at).toBe('2026-11-15 10:00:00');
		expect(Number(cancelled?.cancelled_by)).toBe(9);
		expect(cancelled?.cancelled_reason).toBe('hike withdrawn');
		expect(predecessor?.effective_to).toBeNull();
		expect(state.audit[0].action).toBe('cancel');
	});

	it('reconnects the predecessor directly to the successor when cancelling a middle schedule', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					id: 70,
					effective_from: '2026-11-01',
					effective_to: '2026-11-30',
				}),
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-12-01',
					effective_to: '2026-12-31',
					employer_cost: '30000.00',
				}),
				unusedAgreement({
					id: 73,
					effective_from: '2027-01-01',
					effective_to: null,
					employer_cost: '32000.00',
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'cancel',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		const predecessor = state.canonical.find((row) => Number(row.id) === 70);
		const successor = state.canonical.find((row) => Number(row.id) === 73);
		expect(predecessor?.effective_to).toBe('2026-12-31');
		expect(successor?.effective_from).toBe('2027-01-01');
	});

	it('refuses to cancel a scheduled agreement already used by generated payroll', async () => {
		const state = createState({
			canonical: [
				unusedAgreement({
					id: 70,
					effective_from: '2026-11-01',
					effective_to: '2026-11-30',
				}),
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-12-01',
					effective_to: null,
					employer_cost: '30000.00',
				}),
			],
			use: [
				salaryUseRow({
					month: '2026-12-01',
					agreement_id: AGREEMENT_ID,
				}),
			],
		});

		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'cancel',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
			},
			{ actorId: 9, now: NOW }
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected used');
		expect(outcome.code).toBe('used');
		expect(state.audit).toHaveLength(0);
	});

	it('refuses to cancel a current agreement', async () => {
		const state = createState();
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'cancel',
				employee_id: EMPLOYEE_ID,
				agreement_id: AGREEMENT_ID,
				expected_timeline_version: 4,
			},
			{ actorId: 9, now: NOW }
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected lifecycle conflict');
		expect(outcome.code).toBe('invalid_lifecycle');
	});

	it('allows mid-month initial setup only at the verified joining date', async () => {
		const state = createState({
			employee: { ...EMPLOYEE, joining_date: '2026-11-10' },
			canonical: [],
			use: [],
		});
		const input = {
			operation: 'create-initial' as const,
			employee_id: EMPLOYEE_ID,
			expected_timeline_version: 4,
			effective_from: '2026-11-10',
			salary_type: 'monthly',
			employer_cost: 26000,
			std_hours_per_day: 8,
		};

		const accepted = await runSalaryCommand(fakeDb(state), input, {
			actorId: 9,
			now: NOW,
		});
		expect(accepted.ok).toBe(true);
		if (!accepted.ok) throw new Error(accepted.message);
		expect(accepted.classification).toBe('current');

		const rejectedState = createState({
			employee: { ...EMPLOYEE, joining_date: '2026-11-10' },
			canonical: [],
			use: [],
		});
		const rejected = await runSalaryCommand(
			fakeDb(rejectedState),
			{ ...input, effective_from: '2026-11-12' },
			{ actorId: 9, now: NOW }
		);
		expect(rejected.ok).toBe(false);
		if (rejected.ok) throw new Error('expected invalid joining date');
		expect(rejected.code).toBe('invalid_input');
		expect(rejectedState.inserts).toHaveLength(0);
	});

	it('refuses to backdate a history-free initial agreement without a verified start date', async () => {
		const state = createState({
			employee: { ...EMPLOYEE, joining_date: null, hire_date: null },
			canonical: [],
			use: [],
		});
		const outcome = await runSalaryCommand(
			fakeDb(state),
			{
				operation: 'create-initial',
				employee_id: EMPLOYEE_ID,
				expected_timeline_version: 4,
				effective_from: '2026-10-01',
				salary_type: 'monthly',
				employer_cost: 26000,
				std_hours_per_day: 8,
			},
			{ actorId: 9, now: NOW }
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error('expected earlier-month conflict');
		expect(outcome.code).toBe('earlier_month');
	});

	it('onboards a legacy-only employee prospectively without inventing legacy references', async () => {
		const legacy = {
			id: 5,
			employee_id: EMPLOYEE_ID,
			effective_from: '2026-09-01',
			effective_to: null,
			is_active: 1,
			pay_type: 'monthly',
			gross_salary: '20000.00',
			standard_hours_per_day: '8.00',
		};
		const state = createState({
			canonical: [],
			legacy: [legacy],
			use: [
				salaryUseRow({
					month: '2026-09-01',
					agreement_id: 5,
					agreement_source: 'salary_structures',
					evidence: 'legacy_slip',
				}),
			],
		});
		const input = {
			operation: 'create-initial' as const,
			employee_id: EMPLOYEE_ID,
			expected_timeline_version: 4,
			effective_from: '2026-11-01',
			salary_type: 'monthly',
			employer_cost: 26000,
			std_hours_per_day: 8,
		};

		const outcome = await runSalaryCommand(fakeDb(state), input, {
			actorId: 9,
			now: NOW,
		});
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) throw new Error(outcome.message);
		const created = state.canonical.find((row) => Number(row.id) === 101);
		expect(created?.gross_salary).toBeUndefined();
		expect(created?.gross).toBeUndefined();
		expect(created?.contract_amount).toBeUndefined();

		const backdatedState = createState({
			canonical: [],
			legacy: [legacy],
			use: state.use,
		});
		const backdated = await runSalaryCommand(
			fakeDb(backdatedState),
			{ ...input, effective_from: '2026-09-01' },
			{ actorId: 9, now: NOW }
		);
		expect(backdated.ok).toBe(false);
		if (backdated.ok) throw new Error('expected earlier-month conflict');
		expect(backdated.code).toBe('earlier_month');
	});

	it('rolls a required-audit failure back to the caller by rejecting', async () => {
		const state = createState({ failAudit: true });

		await expect(
			runSalaryCommand(fakeDb(state), correctionInput, {
				actorId: 9,
				now: NOW,
			})
		).rejects.toThrow('audit unavailable');
	});
});

describe('salary timeline read (#437)', () => {
	const readState = () =>
		createState({
			timelineVersion: 7,
			canonical: [
				unusedAgreement({
					id: 70,
					effective_from: '2026-09-01',
					effective_to: '2026-09-30',
					employer_cost: '24000.00',
				}),
				unusedAgreement({
					id: AGREEMENT_ID,
					effective_from: '2026-11-01',
					effective_to: null,
					remarks: 'current note',
					is_manual_override: 1,
				}),
				unusedAgreement({
					id: 72,
					effective_from: '2026-12-01',
					effective_to: null,
					employer_cost: '30000.00',
				}),
				unusedAgreement({
					id: 74,
					effective_from: '2026-08-01',
					effective_to: '2026-08-31',
					is_active: 0,
					cancelled_at: '2026-08-05 10:00:00',
					cancelled_by: 9,
					cancelled_reason: 'withdrawn',
				}),
			],
			legacy: [
				{
					id: 5,
					employee_id: EMPLOYEE_ID,
					effective_from: '2025-01-01',
					effective_to: '2025-12-31',
					is_active: 1,
					pay_type: 'monthly',
					gross_salary: '20000.00',
					standard_hours_per_day: '8.00',
				},
			],
			use: [
				salaryUseRow({ month: '2026-11-01' }),
				salaryUseRow({
					id: 2,
					month: '2026-10-01',
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_slip',
					is_ambiguous: 1,
					evidence_context: {
						candidate_agreements: [
							{
								agreement_id: AGREEMENT_ID,
								agreement_source: 'employee_salary_profile',
							},
						],
					},
				}),
			],
			attendance: [
				{
					month: '2026-03',
					total_privilege_leave: 2,
				},
				{
					month: '2026-11',
					total_privilege_leave: 1,
				},
			],
		});

	it('returns the payroll-only timeline, CTC disclosure, basis and leave usage', async () => {
		const result = await readSalaryTimeline(fakeDb(readState()), EMPLOYEE_ID, {
			serverDate: NOW,
			month: '2026-11',
			permissions: { update: true, delete: true },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		const timeline = result.timeline;
		expect(timeline.employee).toMatchObject({
			id: EMPLOYEE_ID,
			employee_code: 'EMP011',
			full_name: 'Asha Rao',
		});
		expect(timeline.timeline_version).toBe(7);
		expect(timeline.month).toBe('2026-11-01');
		expect(timeline.use.months).toContain('2026-11-01');
		expect(timeline.use.ambiguous_months).toEqual(['2026-10-01']);
		expect(timeline.current).toMatchObject({
			state: 'selected',
			agreement_id: AGREEMENT_ID,
			agreement_source: 'employee_salary_profile',
		});
		expect(timeline.legacy_current.state).toBe('unavailable');

		const byId = new Map(
			timeline.agreements.map((agreement) => [
				`${agreement.agreement_source}:${agreement.agreement_id}`,
				agreement,
			])
		);
		const current = byId.get(`employee_salary_profile:${AGREEMENT_ID}`);
		expect(current?.classification).toBe('current');
		expect(current?.used).toBe(true);
		expect(current?.read_only).toBe(true);
		expect(current?.ctc).toMatchObject({
			status: 'resolved',
			amount: 26000,
			source: 'employer_cost',
			legacy_fallback: false,
		});
		expect(current?.settings.remarks).toBe('current note');
		expect(Number(current?.settings.is_manual_override)).toBe(1);
		expect(current?.actions).not.toContain('correct');
		expect(current?.actions).not.toContain('cancel');

		const scheduled = byId.get('employee_salary_profile:72');
		expect(scheduled?.classification).toBe('scheduled');
		expect(scheduled?.actions).toEqual(
			expect.arrayContaining(['correct', 'revise', 'cancel'])
		);

		const previous = byId.get('employee_salary_profile:70');
		expect(previous?.classification).toBe('previous');
		expect(previous?.read_only).toBe(true);
		expect(previous?.actions).toEqual([]);

		const cancelled = byId.get('employee_salary_profile:74');
		expect(cancelled?.classification).toBe('cancelled');
		expect(cancelled?.cancelled_reason).toBe('withdrawn');
		expect(cancelled?.read_only).toBe(true);

		const legacy = byId.get('salary_structures:5');
		expect(legacy?.read_only).toBe(true);
		expect(legacy?.ctc).toMatchObject({
			status: 'resolved',
			amount: 20000,
			source: 'gross_salary',
			legacy_fallback: true,
		});

		expect(timeline.basis.working_days).toBeGreaterThan(0);
		expect(timeline.basis.std_hours_per_day).toBe(8);
		expect(timeline.basis.basis_hours).toBe(timeline.basis.working_days * 8);
		expect(timeline.leave_usage).toMatchObject({
			year: 2026,
			month: '2026-11-01',
			pl_total: 21,
			used: 3,
			month_used: 1,
			balance: 18,
			source: 'employee_attendance_summary',
		});
		expect(timeline.permissions).toEqual({
			can_read: true,
			can_update: true,
			can_delete: true,
		});
	});

	it('presents no write actions to a payroll read-only caller', async () => {
		const result = await readSalaryTimeline(fakeDb(readState()), EMPLOYEE_ID, {
			serverDate: NOW,
			month: '2026-11',
			permissions: { update: false, delete: false },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		const scheduled = result.timeline.agreements.find(
			(agreement) =>
				agreement.agreement_source === 'employee_salary_profile' &&
				agreement.agreement_id === 72
		);
		expect(scheduled?.actions).toEqual([]);
		expect(scheduled?.action_blockers).toContain('permission');
	});

	it('returns 404 for a soft-deleted Employee and 400 for a malformed month', async () => {
		const deleted = createState({
			employee: { ...EMPLOYEE, isDelete: 1 },
		});
		const missing = await readSalaryTimeline(fakeDb(deleted), EMPLOYEE_ID, {
			serverDate: NOW,
		});
		expect(missing.ok).toBe(false);
		if (missing.ok) throw new Error('expected missing employee');
		expect(missing.status).toBe(404);
		expect(missing.code).toBe('employee_not_found');

		const invalid = await readSalaryTimeline(fakeDb(readState()), EMPLOYEE_ID, {
			serverDate: NOW,
			month: '2026-13',
		});
		expect(invalid.ok).toBe(false);
		if (invalid.ok) throw new Error('expected invalid month');
		expect(invalid.status).toBe(400);
		expect(invalid.code).toBe('invalid_input');
	});
});
