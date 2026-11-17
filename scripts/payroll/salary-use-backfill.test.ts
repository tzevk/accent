import { describe, expect, it } from 'vitest';
import {
	applySalaryUsePlan,
	buildSalaryUseAudit,
	type ExistingSalaryUseRow,
	type SalaryAgreementRecord,
	type SalaryUseAuditInput,
	type SalaryUseRecorder,
} from './salary-use-backfill';

function canonical(
	overrides: Partial<SalaryAgreementRecord> = {}
): SalaryAgreementRecord {
	return {
		id: 1,
		employee_id: 1,
		source: 'employee_salary_profile',
		effective_from: '2025-01-01',
		effective_to: null,
		is_active: true,
		cancelled_at: null,
		employer_cost: null,
		gross_salary: null,
		gross: null,
		salary_type: 'monthly',
		...overrides,
	};
}

function legacy(
	overrides: Partial<SalaryAgreementRecord> = {}
): SalaryAgreementRecord {
	return canonical({
		source: 'salary_structures',
		employer_cost: null,
		...overrides,
	});
}

function input(
	overrides: Partial<SalaryUseAuditInput> = {}
): SalaryUseAuditInput {
	return {
		agreements: [],
		employees: [],
		slips: [],
		rosters: [],
		payroll_audits: [],
		ignored_salary_mutation_audits: {
			salary_profile: 0,
			salary_structure: 0,
		},
		existing_use: [],
		...overrides,
	};
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === 'object') {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/**
 * Honest in-memory implementation of the durable use ledger's unique
 * Employee/month/source-qualified-agreement identity. It is deliberately not a
 * mock: repeated writes are no-ops, and the timeline version advances only for
 * a row that was actually created.
 */
class MemorySalaryUseRecorder implements SalaryUseRecorder {
	private readonly entries: Array<{
		employee_id: number;
		month: string | null;
		agreement_id: number | null;
		agreement_source: 'employee_salary_profile' | 'salary_structures' | null;
		is_ambiguous: boolean;
	}> = [];

	private readonly versions = new Map<number, number>();

	private key(input: {
		employee_id: number;
		month: string | null;
		agreement_id: number | null;
		agreement_source: string | null;
	}): string {
		return [
			input.employee_id,
			input.month ?? 'NULL',
			input.agreement_source ?? '',
			input.agreement_id ?? 0,
		].join('|');
	}

	private advance(employeeId: number): number {
		const version = (this.versions.get(employeeId) ?? 0) + 1;
		this.versions.set(employeeId, version);
		return version;
	}

	async recordExact(input: {
		employee_id: number;
		month: string;
		agreement_id: number;
		agreement_source: 'employee_salary_profile' | 'salary_structures';
		evidence: 'legacy_slip' | 'legacy_audit' | 'legacy_roster';
		evidence_context: Record<string, unknown>;
	}): Promise<{
		recorded: boolean;
		ambiguous_prior: boolean;
		timeline_version: number;
	}> {
		const ambiguousPrior = this.entries.some(
			(entry) =>
				entry.employee_id === input.employee_id &&
				entry.is_ambiguous &&
				(entry.month === null || entry.month === input.month) &&
				(entry.agreement_id === null || entry.is_ambiguous)
		);
		const key = this.key(input);
		if (this.entries.some((entry) => this.key(entry) === key)) {
			return {
				recorded: false,
				ambiguous_prior: ambiguousPrior,
				timeline_version: this.versions.get(input.employee_id) ?? 0,
			};
		}
		this.entries.push({
			employee_id: input.employee_id,
			month: input.month,
			agreement_id: input.agreement_id,
			agreement_source: input.agreement_source,
			is_ambiguous: false,
		});
		return {
			recorded: true,
			ambiguous_prior: ambiguousPrior,
			timeline_version: this.advance(input.employee_id),
		};
	}

	async recordAmbiguous(input: {
		employee_id: number;
		month: string | null;
		evidence: 'legacy_slip' | 'legacy_audit' | 'legacy_roster';
		evidence_context: Record<string, unknown>;
	}): Promise<{ recorded: boolean; timeline_version: number }> {
		const key = this.key({
			employee_id: input.employee_id,
			month: input.month,
			agreement_id: null,
			agreement_source: null,
		});
		if (this.entries.some((entry) => this.key(entry) === key)) {
			return {
				recorded: false,
				timeline_version: this.versions.get(input.employee_id) ?? 0,
			};
		}
		this.entries.push({
			employee_id: input.employee_id,
			month: input.month,
			agreement_id: null,
			agreement_source: null,
			is_ambiguous: true,
		});
		return {
			recorded: true,
			timeline_version: this.advance(input.employee_id),
		};
	}

	rows(): ExistingSalaryUseRow[] {
		return this.entries.map((entry) => ({
			employee_id: entry.employee_id,
			month: entry.month,
			agreement_id: entry.agreement_id,
			agreement_source: entry.agreement_source,
			is_ambiguous: entry.is_ambiguous,
		}));
	}
}

describe('salary-use backfill audit plan', () => {
	it('protects exact slip evidence and never counts salary-profile audit as use', () => {
		const frozen = deepFreeze(
			input({
				agreements: [canonical({ id: 7, employer_cost: '50000.00' })],
				slips: [
					{
						id: 11,
						employee_id: 1,
						month: '2025-02-01',
						salary_profile_id: 7,
						salary_profile_source: 'employee_salary_profile',
						created_at: '2025-02-03 10:00:00',
					},
				],
				ignored_salary_mutation_audits: {
					salary_profile: 4,
					salary_structure: 2,
				},
			})
		);

		const plan = buildSalaryUseAudit(frozen);

		expect(plan.evidence.units).toHaveLength(1);
		expect(plan.evidence.units[0]).toMatchObject({
			kind: 'exact',
			employee_id: 1,
			month: '2025-02-01',
			agreement_id: 7,
			agreement_source: 'employee_salary_profile',
			evidence: 'legacy_slip',
			already_protected: false,
		});
		expect(plan.evidence.units[0].evidence_context).toMatchObject({
			slip_ids: [11],
			candidate_agreements: [
				{ agreement_id: 7, agreement_source: 'employee_salary_profile' },
			],
		});
		expect(plan.evidence.source_counts.ignored_salary_mutation_audits).toEqual({
			salary_profile: 4,
			salary_structure: 2,
		});
		expect(plan.summary).toMatchObject({
			exact_units: 1,
			ambiguous_units: 0,
			already_protected_units: 0,
		});
	});

	it('records exact and ambiguous protection once through an honest recorder', async () => {
		const auditInput = input({
			agreements: [canonical({ id: 7, employer_cost: '50000.00' })],
			slips: [
				{
					id: 11,
					employee_id: 1,
					month: '2025-02-01',
					salary_profile_id: 7,
					salary_profile_source: 'employee_salary_profile',
					created_at: '2025-02-03 10:00:00',
				},
				{
					id: 12,
					employee_id: 2,
					month: '2025-03-01',
					salary_profile_id: null,
					salary_profile_source: null,
					created_at: '2025-03-02 09:00:00',
				},
			],
		});
		const plan = buildSalaryUseAudit(auditInput);
		expect(plan.summary).toMatchObject({
			exact_units: 1,
			ambiguous_units: 1,
		});

		const recorder = new MemorySalaryUseRecorder();
		const first = await applySalaryUsePlan(plan, recorder);

		expect(first.units.map((unit) => unit.recorded)).toEqual([true, true]);
		expect(recorder.rows()).toEqual([
			{
				employee_id: 1,
				month: '2025-02-01',
				agreement_id: 7,
				agreement_source: 'employee_salary_profile',
				is_ambiguous: false,
			},
			{
				employee_id: 2,
				month: '2025-03-01',
				agreement_id: null,
				agreement_source: null,
				is_ambiguous: true,
			},
		]);

		const second = await applySalaryUsePlan(plan, recorder);
		expect(second.units.every((unit) => unit.recorded === false)).toBe(true);
		expect(recorder.rows()).toHaveLength(2);

		const replayPlan = buildSalaryUseAudit({
			...auditInput,
			existing_use: recorder.rows(),
		});
		expect(
			replayPlan.evidence.units.every((unit) => unit.already_protected)
		).toBe(true);
	});

	it('reports conflicting source-qualified slip provenance as ambiguity instead of guessing', () => {
		const plan = buildSalaryUseAudit(
			input({
				agreements: [
					canonical({ id: 7 }),
					legacy({ id: 7, gross_salary: '50000.00' }),
				],
				slips: [
					{
						id: 11,
						employee_id: 1,
						month: '2025-02-01',
						salary_profile_id: 7,
						salary_profile_source: 'employee_salary_profile',
						created_at: '2025-02-03 10:00:00',
					},
					{
						id: 12,
						employee_id: 1,
						month: '2025-02-01',
						salary_profile_id: 7,
						salary_profile_source: 'salary_structures',
						created_at: '2025-02-04 10:00:00',
					},
				],
			})
		);

		expect(plan.evidence.units).toHaveLength(1);
		expect(plan.evidence.units[0]).toMatchObject({
			kind: 'ambiguous',
			employee_id: 1,
			month: '2025-02-01',
			evidence: 'legacy_slip',
			reason: 'conflicting_legacy_provenance',
		});
		const context = plan.evidence.units[0].evidence_context;
		expect(context.slip_ids).toEqual([11, 12]);
		expect(context.candidate_agreements).toEqual([
			{ agreement_id: 7, agreement_source: 'employee_salary_profile' },
			{ agreement_id: 7, agreement_source: 'salary_structures' },
		]);
	});

	it('keeps unknown-month payroll audit evidence as blocking ambiguity and reads deleted-slip provenance', () => {
		const plan = buildSalaryUseAudit(
			input({
				agreements: [canonical({ id: 9 })],
				payroll_audits: [
					{
						id: 21,
						employee_id: 2,
						action: 'delete',
						month: null,
						year: null,
						old_values: null,
						new_values: null,
						performed_at: '2025-01-05 09:00:00',
					},
					{
						id: 22,
						employee_id: 3,
						action: 'delete',
						month: 4,
						year: 2025,
						old_values: {
							salary_profile_id: 9,
							salary_profile_source: 'employee_salary_profile',
						},
						new_values: null,
						performed_at: '2025-04-02 12:00:00',
					},
				],
			})
		);

		expect(plan.evidence.units).toHaveLength(2);
		expect(plan.evidence.units[0]).toMatchObject({
			kind: 'ambiguous',
			employee_id: 2,
			month: null,
			evidence: 'legacy_audit',
			reason: 'unproven_legacy_month',
		});
		expect(plan.evidence.units[0].evidence_context).toMatchObject({
			audit_log_ids: [21],
			audit_actions: ['delete'],
		});
		expect(plan.evidence.units[1]).toMatchObject({
			kind: 'exact',
			employee_id: 3,
			month: '2025-04-01',
			agreement_id: 9,
			agreement_source: 'employee_salary_profile',
			evidence: 'legacy_audit',
		});
		expect(plan.evidence.source_counts).toMatchObject({
			payroll_slip_audits: 2,
			deleted_slip_audits: 2,
		});
	});

	it('reports overlap, missing canonical CTC and explicit zero against positive legacy gross without changing terms', () => {
		const frozen = deepFreeze(
			input({
				agreements: [
					canonical({
						id: 7,
						effective_from: '2025-01-01',
						effective_to: '2025-05-31',
						employer_cost: '0.00',
						gross_salary: '50000.00',
					}),
					canonical({
						id: 8,
						effective_from: '2025-06-01',
						effective_to: '2025-12-31',
						employer_cost: null,
						gross_salary: '60000.00',
					}),
					canonical({
						id: 9,
						effective_from: '2025-07-01',
						effective_to: '2025-09-30',
						employer_cost: null,
					}),
					canonical({
						id: 10,
						effective_from: '2025-07-01',
						effective_to: '2025-09-30',
						is_active: false,
						cancelled_at: '2025-06-20 08:00:00',
					}),
				],
			})
		);

		const plan = buildSalaryUseAudit(frozen);

		expect(plan.agreements.overlaps).toEqual([
			{
				employee_id: 1,
				left: {
					employee_id: 1,
					agreement_id: 8,
					agreement_source: 'employee_salary_profile',
					effective_from: '2025-06-01',
					effective_to: '2025-12-31',
				},
				right: {
					employee_id: 1,
					agreement_id: 9,
					agreement_source: 'employee_salary_profile',
					effective_from: '2025-07-01',
					effective_to: '2025-09-30',
				},
				same_source: true,
			},
		]);
		expect(plan.agreements.missing_canonical_ctc).toMatchObject([
			{
				employee_id: 1,
				agreement_id: 8,
				effective_from: '2025-06-01',
				effective_to: '2025-12-31',
				legacy_fallback: { source: 'gross_salary', amount: '60000.00' },
			},
			{
				employee_id: 1,
				agreement_id: 9,
				effective_from: '2025-07-01',
				effective_to: '2025-09-30',
				legacy_fallback: null,
			},
		]);
		expect(plan.agreements.zero_ctc_with_positive_legacy_gross).toEqual([
			{
				employee_id: 1,
				agreement_id: 7,
				agreement_source: 'employee_salary_profile',
				effective_from: '2025-01-01',
				effective_to: '2025-05-31',
				employer_cost: '0.00',
				legacy_amounts: [{ field: 'gross_salary', amount: '50000.00' }],
			},
		]);
	});

	it('keeps canonical and legacy agreements with the same id distinct', () => {
		const plan = buildSalaryUseAudit(
			input({
				agreements: [
					canonical({ id: 7, employee_id: 1 }),
					legacy({ id: 7, employee_id: 2 }),
				],
				slips: [
					{
						id: 11,
						employee_id: 1,
						month: '2025-02-01',
						salary_profile_id: 7,
						salary_profile_source: 'employee_salary_profile',
						created_at: '2025-02-03 10:00:00',
					},
				],
				rosters: [
					{
						run_id: 31,
						month: '2025-02-01',
						version: 1,
						members: [
							{
								employee_id: 2,
								profile_id: 7,
								profile_source: 'salary_structures',
							},
						],
						frozen_at: '2025-02-01 18:00:00',
					},
				],
			})
		);

		expect(plan.evidence.units).toEqual([
			expect.objectContaining({
				kind: 'exact',
				employee_id: 1,
				agreement_id: 7,
				agreement_source: 'employee_salary_profile',
				evidence: 'legacy_slip',
			}),
			expect.objectContaining({
				kind: 'exact',
				employee_id: 2,
				agreement_id: 7,
				agreement_source: 'salary_structures',
				evidence: 'legacy_roster',
			}),
		]);
	});
});
