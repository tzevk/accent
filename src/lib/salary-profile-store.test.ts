import { describe, expect, it } from 'vitest';
import {
	advanceSalaryTimelineVersion,
	lockSalaryEmployees,
	readSalaryAgreements,
	readSalaryTimelineVersion,
	readSalaryUseEvidence,
	readSalaryUseStatus,
	recordSalaryAgreementUse,
	recordSalaryUseAmbiguity,
	summarizeSalaryUseEvidence,
	type SalaryStoreDb,
} from './salary-profile-store';

interface FakeEmployee {
	id: number;
	joining_date: string | null;
	hire_date: string | null;
	isDelete: number;
}

interface FakeTimeline {
	employee_id: number;
	version: number;
	updated_by: number | null;
	updated_at: string;
}

interface FakeProfile {
	id: number;
	employee_id: number;
	effective_from: string;
	effective_to: string | null;
	is_active: number;
	cancelled_at: string | null;
	salary_type: string | null;
	employer_cost: number | string | null;
	gross_salary: number | string | null;
	gross: number | string | null;
}

interface FakeUse {
	id: number;
	employee_id: number;
	month: string | null;
	agreement_id: number | null;
	agreement_source: string | null;
	evidence: string;
	is_ambiguous: number;
	evidence_context: string | null;
	first_used_by: number | null;
	first_used_at: string;
}

interface FakeOptions {
	employees?: FakeEmployee[];
	timelines?: FakeTimeline[];
	profiles?: FakeProfile[];
	legacyProfiles?: FakeProfile[];
	uses?: FakeUse[];
}

interface Call {
	sql: string;
	params: Array<string | number | boolean | null>;
}

const MONTH_SENTINEL = '1000-01-01';

function monthKey(month: string | null): string {
	return month ?? MONTH_SENTINEL;
}

class FakeSalaryDb implements SalaryStoreDb {
	employees: FakeEmployee[];
	timelines: FakeTimeline[];
	profiles: FakeProfile[];
	legacyProfiles: FakeProfile[];
	uses: FakeUse[];
	calls: Call[] = [];
	failNextUseInsert = false;
	private nextUseId = 1;

	constructor(options: FakeOptions = {}) {
		this.employees = options.employees ?? [];
		this.timelines = options.timelines ?? [];
		this.profiles = options.profiles ?? [];
		this.legacyProfiles = options.legacyProfiles ?? [];
		this.uses = options.uses ?? [];
		this.nextUseId =
			this.uses.reduce((max, row) => Math.max(max, row.id), 0) + 1;
	}

	async execute(
		sql: string,
		params: ReadonlyArray<string | number | boolean | null> = []
	): Promise<[unknown, unknown]> {
		const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();
		const values = [...params];
		this.calls.push({ sql, params: values });

		if (text.startsWith('select') && text.includes('from employees')) {
			const ids = values.filter(
				(value): value is number => typeof value === 'number'
			);
			const rows = this.employees
				.filter((employee) => ids.includes(employee.id))
				.sort((a, b) => a.id - b.id)
				.map((employee) => ({
					id: employee.id,
					joining_date: employee.joining_date,
					hire_date: employee.hire_date,
					isDelete: employee.isDelete,
				}));
			return [rows, []];
		}

		if (
			text.startsWith('select') &&
			text.includes('from employee_salary_timelines')
		) {
			if (text.includes('where employee_id in')) {
				const ids = values.filter(
					(value): value is number => typeof value === 'number'
				);
				const rows = this.timelines
					.filter((row) => ids.includes(row.employee_id))
					.sort((a, b) => a.employee_id - b.employee_id)
					.map((row) => ({
						employee_id: row.employee_id,
						version: row.version,
					}));
				return [rows, []];
			}
			const employeeId = Number(values[0]);
			const row = this.timelines.find(
				(timeline) => timeline.employee_id === employeeId
			);
			return [row ? [{ version: row.version }] : [], []];
		}

		if (text.startsWith('insert into employee_salary_timelines')) {
			const employeeId = Number(values[0]);
			if (!this.timelines.some((row) => row.employee_id === employeeId)) {
				this.timelines.push({
					employee_id: employeeId,
					version: Number(values[1] ?? 0),
					updated_by: typeof values[2] === 'number' ? values[2] : null,
					updated_at: '2026-11-15 00:00:00',
				});
			}
			return [{ affectedRows: 1 }, []];
		}

		if (text.startsWith('update employee_salary_timelines')) {
			const employeeId = Number(values[1]);
			const expected = Number(values[2]);
			const row = this.timelines.find(
				(timeline) => timeline.employee_id === employeeId
			);
			if (!row || row.version !== expected) {
				return [{ affectedRows: 0 }, []];
			}
			row.version += 1;
			row.updated_by = typeof values[0] === 'number' ? values[0] : null;
			row.updated_at = '2026-11-15 00:00:00';
			return [{ affectedRows: 1 }, []];
		}

		if (
			text.startsWith('select') &&
			text.includes('from employee_salary_profile')
		) {
			const employeeId = Number(values[0]);
			const rows = this.profiles
				.filter((row) => row.employee_id === employeeId)
				.sort(
					(a, b) =>
						a.effective_from.localeCompare(b.effective_from) || a.id - b.id
				);
			return [rows, []];
		}

		if (text.startsWith('select') && text.includes('from salary_structures')) {
			const employeeId = Number(values[0]);
			const rows = this.legacyProfiles
				.filter((row) => row.employee_id === employeeId)
				.sort(
					(a, b) =>
						a.effective_from.localeCompare(b.effective_from) || a.id - b.id
				);
			return [rows, []];
		}

		if (
			text.startsWith('select 1') &&
			text.includes('from employee_salary_payroll_use')
		) {
			const employeeId = Number(values[0]);
			const month = text.includes('month_key = ?') ? String(values[1]) : null;
			const match = this.uses.find(
				(row) =>
					row.employee_id === employeeId &&
					(month === null ||
						monthKey(row.month) === month ||
						(row.month === null && row.is_ambiguous === 1)) &&
					(row.agreement_id === null || row.is_ambiguous === 1)
			);
			return [match ? [{ '1': 1 }] : [], []];
		}

		if (
			text.startsWith('select') &&
			text.includes('from employee_salary_payroll_use') &&
			text.includes('agreement_source_key = ?')
		) {
			const [employeeId, month, agreementSource, agreementId] = values;
			const match = this.uses.find(
				(row) =>
					row.employee_id === Number(employeeId) &&
					monthKey(row.month) === String(month) &&
					(row.agreement_source ?? '') === String(agreementSource) &&
					(row.agreement_id ?? 0) === Number(agreementId)
			);
			return [match ? [{ id: match.id }] : [], []];
		}

		if (
			text.startsWith('select') &&
			text.includes('from employee_salary_payroll_use')
		) {
			const employeeId = Number(values[0]);
			let index = 1;
			let month: string | null = null;
			let agreementId: number | null = null;
			let agreementSource: string | null = null;
			if (text.includes('month_key = ?')) {
				month = String(values[index]);
				index += 1;
			}
			if (text.includes('agreement_id = ?')) {
				agreementId = Number(values[index]);
				agreementSource = String(values[index + 1]);
			}
			const rows = this.uses
				.filter((row) => {
					if (row.employee_id !== employeeId) return false;
					if (
						agreementId !== null &&
						agreementSource !== null &&
						!(
							(row.agreement_id === agreementId &&
								row.agreement_source === agreementSource) ||
							row.is_ambiguous === 1
						)
					)
						return false;
					if (month === null) return true;
					return (
						monthKey(row.month) === month ||
						(row.month === null && row.is_ambiguous === 1)
					);
				})
				.sort(
					(a, b) =>
						a.first_used_at.localeCompare(b.first_used_at) || a.id - b.id
				);
			return [rows, []];
		}

		if (text.startsWith('insert into employee_salary_payroll_use')) {
			if (this.failNextUseInsert) {
				this.failNextUseInsert = false;
				throw new Error('simulated insert failure');
			}
			const employeeId = Number(values[0]);
			const month = values[1] === null ? null : String(values[1]);
			const agreementId = values[2] === null ? null : Number(values[2]);
			const agreementSource = values[3] === null ? null : String(values[3]);
			const evidence = String(values[4]);
			const isAmbiguous = Number(values[5]);
			const context = values[6] === null ? null : String(values[6]);
			const actorId = typeof values[7] === 'number' ? values[7] : null;
			const duplicate = this.uses.some(
				(row) =>
					row.employee_id === employeeId &&
					monthKey(row.month) === monthKey(month) &&
					(row.agreement_id ?? 0) === (agreementId ?? 0) &&
					(row.agreement_source ?? '') === (agreementSource ?? '')
			);
			if (duplicate) {
				// MariaDB 10.11.15 through mysql2 (which connects with
				// CLIENT_FOUND_ROWS) reports an unchanged duplicate
				// `INSERT ... ON DUPLICATE KEY UPDATE` as the matched row:
				// affectedRows 1 with the OK packet's insertId left at 0.
				// A plain INSERT instead raises the unique-key error.
				if (!text.includes('on duplicate key update')) {
					throw Object.assign(
						new Error(`Duplicate entry for employee ${employeeId} salary use`),
						{ code: 'ER_DUP_ENTRY', errno: 1062 }
					);
				}
				return [{ affectedRows: 1, insertId: 0 }, []];
			}
			this.uses.push({
				id: this.nextUseId++,
				employee_id: employeeId,
				month,
				agreement_id: agreementId,
				agreement_source: agreementSource,
				evidence,
				is_ambiguous: isAmbiguous,
				evidence_context: context,
				first_used_by: actorId,
				first_used_at: '2026-11-15 00:00:00',
			});
			return [{ affectedRows: 1 }, []];
		}

		throw new Error(`FakeSalaryDb does not understand: ${sql}`);
	}
}

function profile(overrides: Partial<FakeProfile> = {}): FakeProfile {
	return {
		id: 10,
		employee_id: 1,
		effective_from: '2026-01-01',
		effective_to: null,
		is_active: 1,
		cancelled_at: null,
		salary_type: 'monthly',
		employer_cost: 30_000,
		gross_salary: null,
		gross: null,
		...overrides,
	};
}

describe('salary Employee locks', () => {
	it('dedupes and locks Employee rows first, then timeline rows, ascending', async () => {
		const db = new FakeSalaryDb({
			employees: [
				{ id: 3, joining_date: '2020-01-01', hire_date: null, isDelete: 0 },
				{ id: 1, joining_date: '2026-11-15', hire_date: null, isDelete: 0 },
				{ id: 2, joining_date: null, hire_date: '2021-02-01', isDelete: 0 },
			],
			timelines: [
				{ employee_id: 3, version: 7, updated_by: null, updated_at: '' },
				{ employee_id: 1, version: 4, updated_by: null, updated_at: '' },
			],
		});

		const result = await lockSalaryEmployees(db, [3, 1, 3, 2, 99]);

		expect(result.locks.map((lock) => lock.employee_id)).toEqual([1, 2, 3]);
		expect(result.locks.map((lock) => lock.timeline_version)).toEqual([
			4, 0, 7,
		]);
		expect(result.locks.map((lock) => lock.timeline_exists)).toEqual([
			true,
			false,
			true,
		]);
		expect(result.locks[1]).toMatchObject({
			joining_date: null,
			hire_date: '2021-02-01',
			is_delete: false,
		});
		expect(result.missing_employee_ids).toEqual([99]);
		expect(db.calls[0].sql).toMatch(/from employees/i);
		expect(db.calls[0].sql).toMatch(/order by id/i);
		expect(db.calls[0].sql).toMatch(/for update/i);
		expect(db.calls[1].sql).toMatch(/employee_salary_timelines/i);
		expect(db.calls[1].sql).toMatch(/for update/i);
	});

	it('rejects invalid Employee ids instead of locking an arbitrary row', async () => {
		const db = new FakeSalaryDb();
		await expect(lockSalaryEmployees(db, [0])).rejects.toThrow(RangeError);
		await expect(lockSalaryEmployees(db, [1.5])).rejects.toThrow(RangeError);
	});
});

describe('timeline versions', () => {
	it('reads a missing timeline as version 0 and supports a locking current read', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		expect(await readSalaryTimelineVersion(db, 1)).toBe(0);
		expect(await readSalaryTimelineVersion(db, 1, { forUpdate: true })).toBe(0);
		expect(db.calls[0].sql).not.toMatch(/for update/i);
		expect(db.calls[1].sql).toMatch(/for update/i);
	});

	it('creates version 1 on an expected zero and fails stale requests without writing', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		expect(await advanceSalaryTimelineVersion(db, 1, 0, 9)).toEqual({
			ok: true,
			employee_id: 1,
			version: 1,
		});
		expect(await advanceSalaryTimelineVersion(db, 1, 1, 9)).toEqual({
			ok: true,
			employee_id: 1,
			version: 2,
		});
		const stale = await advanceSalaryTimelineVersion(db, 1, 1, 9);
		expect(stale).toEqual({
			ok: false,
			code: 'stale_version',
			employee_id: 1,
			expected_version: 1,
			actual_version: 2,
		});
		expect(db.timelines[0].version).toBe(2);
	});

	it('refuses an expected version for a missing timeline without creating one', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		expect(await advanceSalaryTimelineVersion(db, 1, 3, 9)).toEqual({
			ok: false,
			code: 'stale_version',
			employee_id: 1,
			expected_version: 3,
			actual_version: 0,
		});
		expect(db.timelines).toEqual([]);
	});

	it('throws when asked to version a missing Employee', async () => {
		const db = new FakeSalaryDb();
		await expect(advanceSalaryTimelineVersion(db, 404, 0, 9)).rejects.toThrow(
			/404/
		);
	});
});

describe('agreement reads', () => {
	it('returns every historical canonical row and locks them when requested', async () => {
		const db = new FakeSalaryDb({
			profiles: [
				profile({ id: 21, effective_from: '2026-04-01' }),
				profile({
					id: 20,
					effective_from: '2026-01-01',
					effective_to: '2026-03-31',
					is_active: 0,
				}),
			],
		});

		const rows = await readSalaryAgreements(db, 1, { forUpdate: true });

		expect(rows.map((row) => row.id)).toEqual([20, 21]);
		expect(db.calls[0].sql).toMatch(/for update/i);
	});

	it('reads the legacy fallback table only when its source is requested', async () => {
		const db = new FakeSalaryDb({
			legacyProfiles: [profile({ id: 31, effective_from: '2025-01-01' })],
		});

		const rows = await readSalaryAgreements(db, 1, {
			source: 'salary_structures',
		});

		expect(rows.map((row) => row.id)).toEqual([31]);
		expect(db.calls[0].sql).toMatch(/from salary_structures/i);
	});
});

describe('durable payroll use', () => {
	it('records use once, snapshots evidence, and advances the version', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		const first = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 10,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_generation',
			evidenceContext: { slip_id: 5 },
			actorId: 9,
		});

		expect(first).toEqual({
			recorded: true,
			ambiguous_prior: false,
			timeline_version: 1,
		});
		expect(db.uses[0]).toMatchObject({
			employee_id: 1,
			month: '2026-10-01',
			agreement_id: 10,
			agreement_source: 'employee_salary_profile',
			evidence: 'payroll_generation',
			is_ambiguous: 0,
			first_used_by: 9,
		});
		expect(JSON.parse(String(db.uses[0].evidence_context))).toEqual({
			slip_id: 5,
		});

		const duplicate = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 10,
			agreementSource: 'employee_salary_profile',
			month: '2026-10-01',
			evidence: 'payroll_generation',
			evidenceContext: { slip_id: 5 },
			actorId: 9,
		});

		expect(duplicate).toEqual({
			recorded: false,
			ambiguous_prior: false,
			timeline_version: 1,
		});
		expect(db.uses).toHaveLength(1);
	});

	it('reports a duplicate exact use as unrecorded and keeps the first evidence', async () => {
		// Production reality: mysql2 connects with CLIENT_FOUND_ROWS, so MariaDB
		// answers an unchanged duplicate with affectedRows 1 and insertId 0. The
		// consumer (`--apply` summary, generation/finalization writers) must not
		// read that as "recorded" or it advances the timeline twice.
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		const first = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 10,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_generation',
			evidenceContext: { slip_id: 5 },
			actorId: 9,
		});
		expect(first).toEqual({
			recorded: true,
			ambiguous_prior: false,
			timeline_version: 1,
		});

		const repeat = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 10,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_finalization',
			evidenceContext: { payroll_run_id: 77 },
			actorId: 44,
		});

		expect(repeat).toEqual({
			recorded: false,
			ambiguous_prior: false,
			timeline_version: 1,
		});
		expect(db.timelines).toHaveLength(1);
		expect(db.timelines[0].version).toBe(1);
		expect(db.uses).toHaveLength(1);
		expect(db.uses[0]).toMatchObject({
			evidence: 'payroll_generation',
			first_used_by: 9,
		});
		expect(JSON.parse(String(db.uses[0].evidence_context))).toEqual({
			slip_id: 5,
		});
	});

	it('does not advance or record anything when the slip insert fails first', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});
		db.failNextUseInsert = true;

		await expect(
			recordSalaryAgreementUse(db, {
				employeeId: 1,
				agreementId: 10,
				agreementSource: 'employee_salary_profile',
				month: '2026-10',
				evidence: 'payroll_generation',
			})
		).rejects.toThrow(/simulated insert failure/);

		expect(db.uses).toEqual([]);
		expect(db.timelines).toEqual([]);
	});

	it('reports prior ambiguous history for the same month', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
			uses: [
				{
					id: 1,
					employee_id: 1,
					month: '2026-10-01',
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_slip',
					is_ambiguous: 1,
					evidence_context: '{"candidate_agreement_ids":[10]}',
					first_used_by: null,
					first_used_at: '2026-10-31 00:00:00',
				},
			],
		});

		const result = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 10,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_finalization',
		});

		expect(result).toEqual({
			recorded: true,
			ambiguous_prior: true,
			timeline_version: 1,
		});
	});

	it('reports unknown-month prior use as ambiguous for a new exact record', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
			uses: [
				{
					id: 1,
					employee_id: 1,
					month: null,
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_audit',
					is_ambiguous: 1,
					evidence_context: '{"note":"month unprovable"}',
					first_used_by: null,
					first_used_at: '2026-01-01 00:00:00',
				},
			],
		});

		const result = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 10,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_generation',
		});

		expect(result).toMatchObject({
			recorded: true,
			ambiguous_prior: true,
		});
	});

	it('keeps canonical and legacy agreements with the same id distinct', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		const canonical = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 7,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_generation',
		});
		const legacy = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 7,
			agreementSource: 'salary_structures',
			month: '2026-10',
			evidence: 'payroll_generation',
		});

		expect(canonical).toMatchObject({ recorded: true, timeline_version: 1 });
		expect(legacy).toMatchObject({ recorded: true, timeline_version: 2 });
		expect(db.uses).toHaveLength(2);

		const duplicate = await recordSalaryAgreementUse(db, {
			employeeId: 1,
			agreementId: 7,
			agreementSource: 'employee_salary_profile',
			month: '2026-10',
			evidence: 'payroll_generation',
		});
		expect(duplicate).toMatchObject({
			recorded: false,
			timeline_version: 2,
		});
		expect(db.uses).toHaveLength(2);

		const evidence = await readSalaryUseEvidence(db, 1, {
			month: '2026-10',
			agreementId: 7,
			agreementSource: 'employee_salary_profile',
		});
		expect(evidence).toHaveLength(1);
		expect(evidence[0].agreement_source).toBe('employee_salary_profile');
		expect(summarizeSalaryUseEvidence(evidence).agreements).toEqual([
			{
				agreement_id: 7,
				agreement_source: 'employee_salary_profile',
			},
		]);

		const all = await readSalaryUseStatus(db, 1);
		expect(all.agreements).toEqual([
			{
				agreement_id: 7,
				agreement_source: 'employee_salary_profile',
			},
			{
				agreement_id: 7,
				agreement_source: 'salary_structures',
			},
		]);
	});

	it('preserves month-level ambiguity when reading one source-qualified agreement', async () => {
		const db = new FakeSalaryDb({
			uses: [
				{
					id: 1,
					employee_id: 1,
					month: '2026-10-01',
					agreement_id: 7,
					agreement_source: 'employee_salary_profile',
					evidence: 'payroll_generation',
					is_ambiguous: 0,
					evidence_context: null,
					first_used_by: null,
					first_used_at: '2026-10-31 00:00:00',
				},
				{
					id: 2,
					employee_id: 1,
					month: '2026-10-01',
					agreement_id: 7,
					agreement_source: 'salary_structures',
					evidence: 'legacy_slip',
					is_ambiguous: 0,
					evidence_context: null,
					first_used_by: null,
					first_used_at: '2026-10-31 00:00:00',
				},
				{
					id: 3,
					employee_id: 1,
					month: '2026-10-01',
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_slip',
					is_ambiguous: 1,
					evidence_context: '{"candidate_agreement_ids":[7]}',
					first_used_by: null,
					first_used_at: '2026-10-31 00:00:00',
				},
			],
		});

		const evidence = await readSalaryUseEvidence(db, 1, {
			month: '2026-10',
			agreementId: 7,
			agreementSource: 'employee_salary_profile',
		});

		expect(evidence.map((row) => row.id)).toEqual([1, 3]);
		const status = summarizeSalaryUseEvidence(evidence);
		expect(status.ambiguous).toBe(true);
		expect(status.agreements).toEqual([
			{
				agreement_id: 7,
				agreement_source: 'employee_salary_profile',
			},
		]);

		await expect(
			readSalaryUseEvidence(db, 1, { agreementId: 7 })
		).rejects.toThrow(RangeError);
	});

	it('treats unknown-month ambiguity as use for every requested month', async () => {
		const db = new FakeSalaryDb({
			uses: [
				{
					id: 1,
					employee_id: 1,
					month: null,
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_audit',
					is_ambiguous: 1,
					evidence_context: '{"note":"month unprovable"}',
					first_used_by: null,
					first_used_at: '2026-01-01 00:00:00',
				},
			],
		});

		const status = await readSalaryUseStatus(db, 1, { month: '2030-04' });

		expect(status).toMatchObject({
			used: true,
			ambiguous: true,
			unknown_history: true,
			months: [],
		});
		expect(status.evidence).toHaveLength(1);
	});

	it('summarizes exact agreement months without hiding ambiguity', async () => {
		const db = new FakeSalaryDb({
			uses: [
				{
					id: 1,
					employee_id: 1,
					month: '2026-10-01',
					agreement_id: 10,
					agreement_source: 'employee_salary_profile',
					evidence: 'payroll_generation',
					is_ambiguous: 0,
					evidence_context: null,
					first_used_by: 9,
					first_used_at: '2026-10-31 00:00:00',
				},
				{
					id: 2,
					employee_id: 1,
					month: '2026-11-01',
					agreement_id: null,
					agreement_source: null,
					evidence: 'legacy_slip',
					is_ambiguous: 1,
					evidence_context: null,
					first_used_by: null,
					first_used_at: '2026-11-30 00:00:00',
				},
			],
		});

		const evidence = await readSalaryUseEvidence(db, 1, {
			forUpdate: true,
		});
		expect(evidence).toHaveLength(2);
		expect(db.calls[0].sql).toMatch(/for update/i);

		const status = summarizeSalaryUseEvidence(evidence);
		expect(status).toEqual({
			used: true,
			ambiguous: true,
			unknown_history: false,
			months: ['2026-10-01', '2026-11-01'],
			agreements: [
				{
					agreement_id: 10,
					agreement_source: 'employee_salary_profile',
				},
			],
			evidence,
		});
	});

	it('records known prior use with no provable month as a durable ambiguity', async () => {
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		const result = await recordSalaryUseAmbiguity(db, {
			employeeId: 1,
			month: null,
			evidence: 'legacy_audit',
			evidenceContext: { note: 'month unprovable' },
			actorId: 9,
		});

		expect(result).toEqual({ recorded: true, timeline_version: 1 });
		expect(db.uses[0]).toMatchObject({
			employee_id: 1,
			month: null,
			agreement_id: null,
			agreement_source: null,
			is_ambiguous: 1,
			first_used_by: 9,
		});

		const again = await recordSalaryUseAmbiguity(db, {
			employeeId: 1,
			month: null,
			evidence: 'legacy_audit',
			evidenceContext: { note: 'month unprovable' },
			actorId: 9,
		});
		expect(again).toEqual({ recorded: false, timeline_version: 1 });
		expect(db.uses).toHaveLength(1);
	});

	it('reports a duplicate unknown-month ambiguity as unrecorded and keeps the first evidence', async () => {
		// Same found-rows trap as exact use: MariaDB reports the matched row
		// (affectedRows 1) for an unchanged duplicate, so a replay must not count
		// the ambiguity twice or advance the timeline version again.
		const db = new FakeSalaryDb({
			employees: [{ id: 1, joining_date: null, hire_date: null, isDelete: 0 }],
		});

		const first = await recordSalaryUseAmbiguity(db, {
			employeeId: 1,
			month: null,
			evidence: 'legacy_audit',
			evidenceContext: { note: 'month unprovable' },
			actorId: 9,
		});
		expect(first).toEqual({ recorded: true, timeline_version: 1 });

		const repeat = await recordSalaryUseAmbiguity(db, {
			employeeId: 1,
			month: null,
			evidence: 'legacy_audit',
			evidenceContext: { note: 'replayed' },
			actorId: 44,
		});

		expect(repeat).toEqual({ recorded: false, timeline_version: 1 });
		expect(db.timelines).toHaveLength(1);
		expect(db.timelines[0].version).toBe(1);
		expect(db.uses).toHaveLength(1);
		expect(db.uses[0]).toMatchObject({ first_used_by: 9 });
		expect(JSON.parse(String(db.uses[0].evidence_context))).toEqual({
			note: 'month unprovable',
		});
	});
});
