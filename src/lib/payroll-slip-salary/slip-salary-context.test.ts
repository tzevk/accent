import { describe, expect, it } from 'vitest';
import {
	readSlipSalaryContexts,
	slipMatchesSalaryTypeFilter,
	type SlipSalaryIdentity,
} from './index';
import type { SalaryStoreDb } from '@/lib/salary-profile-store';
import type { SalaryProfileRow } from '@/lib/salary-profile-timeline';

/**
 * Public reader regressions for #441. The fake connection answers only the
 * reader's two agreement reads, so every case proves the context is derived
 * from recorded provenance or the slip's own period — never from a route's
 * current-profile join and never from row order.
 */
type Row = SalaryProfileRow;

function fakeDb(
	canonical: readonly Row[],
	legacy: readonly Row[] = []
): SalaryStoreDb & { queries: string[] } {
	const queries: string[] = [];
	return {
		queries,
		execute: async (sql: string): Promise<[unknown, unknown]> => {
			queries.push(sql);
			if (sql.includes('FROM employee_salary_profile')) {
				return [canonical, undefined];
			}
			if (sql.includes('FROM salary_structures')) {
				return [legacy, undefined];
			}
			throw new Error(`Unexpected reader SQL: ${sql}`);
		},
	};
}

function profile(overrides: Row = {}): Row {
	return {
		id: 1,
		employee_id: 7,
		effective_from: '2026-04-01',
		effective_to: null,
		is_active: 1,
		cancelled_at: null,
		salary_type: 'monthly',
		basic: null,
		basic_plus_da: null,
		...overrides,
	};
}

function legacyStructure(overrides: Row = {}): Row {
	return {
		id: 21,
		employee_id: 7,
		effective_from: '2026-04-01',
		effective_to: null,
		is_active: 1,
		pay_type: 'monthly',
		basic_salary: '18000.00',
		...overrides,
	};
}

function slip(overrides: Partial<SlipSalaryIdentity> = {}): SlipSalaryIdentity {
	return {
		id: 11,
		employee_id: 7,
		month: '2026-07-01',
		joining_date: '2024-04-01',
		salary_profile_id: null,
		salary_profile_source: null,
		salary_type: null,
		...overrides,
	};
}

describe('recorded/confirmed slip salary context (#441)', () => {
	it('returns one context per slip when two historical agreements cover the month', async () => {
		const db = fakeDb([
			profile({ id: 4, effective_from: '2026-01-01', basic: '40000.00' }),
			profile({ id: 9, effective_from: '2026-05-01', basic: '45000.00' }),
		]);

		const contexts = await readSlipSalaryContexts(db, [slip()]);

		expect(contexts).toHaveLength(1);
		expect(contexts[0]).toMatchObject({
			slip_id: 11,
			state: 'ambiguous',
			agreement_id: null,
			agreement_source: null,
			salary_type: null,
			stream: null,
			figure_basic: null,
		});
		expect(contexts[0].conflicts).toEqual([
			{ agreement_id: 4, agreement_source: 'employee_salary_profile' },
			{ agreement_id: 9, agreement_source: 'employee_salary_profile' },
		]);
		expect(contexts[0].disclosures).toContain('ambiguous_covering_agreements');
		// Two reads for the whole batch, never one per slip/agreement.
		expect(db.queries).toHaveLength(2);
	});

	it('keeps recorded provenance and Salary Type even when a newer agreement covers the month', async () => {
		const recorded = profile({
			id: 3,
			effective_from: '2024-01-01',
			effective_to: '2024-12-31',
			salary_type: 'contract',
			basic: '10000.00',
		});
		const newer = profile({
			id: 9,
			effective_from: '2026-05-01',
			salary_type: 'monthly',
			basic: '50000.00',
			basic_plus_da: '55000.00',
		});
		const db = fakeDb([recorded, newer]);

		const [context] = await readSlipSalaryContexts(db, [
			slip({
				salary_profile_id: 3,
				salary_profile_source: 'employee_salary_profile',
				salary_type: 'contract',
			}),
		]);

		expect(context).toMatchObject({
			state: 'recorded',
			salary_profile_id: 3,
			salary_profile_source: 'employee_salary_profile',
			agreement_id: 3,
			agreement_source: 'employee_salary_profile',
			salary_type: 'contract',
			salary_type_source: 'recorded_slip',
			stream: 'contract',
			figure_basic: 10000,
			figure_basic_source: 'canonical_basic',
		});
		expect(context.profile?.id).toBe(3);
		expect(context.disclosures).toEqual([]);
	});

	it('never substitutes another agreement when the recorded row is missing or owned by someone else', async () => {
		const otherEmployee = profile({
			id: 3,
			employee_id: 99,
			effective_from: '2026-01-01',
			basic: '90000.00',
		});
		const covering = profile({
			id: 9,
			effective_from: '2026-05-01',
			basic: '50000.00',
		});

		const [missing] = await readSlipSalaryContexts(fakeDb([covering]), [
			slip({
				salary_profile_id: 3,
				salary_profile_source: 'employee_salary_profile',
				salary_type: 'monthly',
			}),
		]);
		expect(missing).toMatchObject({
			state: 'unavailable',
			agreement_id: null,
			salary_type: 'monthly',
			salary_type_source: 'recorded_slip',
			stream: 'payroll',
			figure_basic: null,
		});
		expect(missing.disclosures).toContain('recorded_agreement_missing');

		const [mismatch] = await readSlipSalaryContexts(
			fakeDb([otherEmployee, covering]),
			[
				slip({
					salary_profile_id: 3,
					salary_profile_source: 'employee_salary_profile',
				}),
			]
		);
		expect(mismatch).toMatchObject({
			state: 'unavailable',
			agreement_id: null,
			figure_basic: null,
		});
		expect(mismatch.disclosures).toContain(
			'recorded_agreement_employee_mismatch'
		);
	});

	it('uses the unique covering agreement at the slip month for legacy NULL provenance', async () => {
		const db = fakeDb([
			profile({
				id: 4,
				effective_from: '2026-04-01',
				basic: '0.00',
				basic_plus_da: '52000.00',
			}),
		]);

		const [context] = await readSlipSalaryContexts(db, [slip()]);

		expect(context).toMatchObject({
			state: 'confirmed',
			agreement_id: 4,
			agreement_source: 'employee_salary_profile',
			salary_type: 'monthly',
			salary_type_source: 'period_agreement',
			stream: 'payroll',
			figure_basic: 52000,
			figure_basic_source: 'canonical_basic_plus_da',
		});
		expect(context.disclosures).toEqual([]);
	});

	it('uses the joining-date anchor for a mid-month joiner without arming a future agreement', async () => {
		const db = fakeDb([
			profile({
				id: 1,
				effective_from: '2026-03-01',
				effective_to: '2026-03-19',
				basic: '30000.00',
			}),
			profile({
				id: 2,
				effective_from: '2026-03-20',
				basic: '31000.00',
			}),
		]);

		const [context] = await readSlipSalaryContexts(db, [
			slip({ month: '2026-03-01', joining_date: '2026-03-20' }),
		]);

		expect(context.anchor).toBe('2026-03-20');
		expect(context).toMatchObject({
			state: 'confirmed',
			agreement_id: 2,
			figure_basic: 31000,
		});

		const [futureOnly] = await readSlipSalaryContexts(
			fakeDb([
				profile({
					id: 8,
					effective_from: '2026-04-01',
					basic: '40000.00',
				}),
			]),
			[slip({ month: '2026-02-01', joining_date: '2026-04-05' })]
		);
		expect(futureOnly).toMatchObject({
			state: 'unavailable',
			agreement_id: null,
			figure_basic: null,
		});
		expect(futureOnly.disclosures).toContain('joining_after_slip_month');
	});

	it('does not repair a gap from a later/future agreement', async () => {
		const db = fakeDb([
			profile({ id: 9, effective_from: '2026-08-01', basic: '50000.00' }),
		]);

		const [context] = await readSlipSalaryContexts(db, [slip()]);

		expect(context).toMatchObject({
			state: 'unavailable',
			agreement_id: null,
			profile: null,
			figure_basic: null,
		});
		expect(context.disclosures).toContain('no_covering_agreement');
	});

	it('reports ambiguous legacy structures instead of taking the first row', async () => {
		const db = fakeDb(
			[],
			[
				legacyStructure({ id: 21, effective_from: '2026-01-01' }),
				legacyStructure({
					id: 22,
					effective_from: '2026-06-01',
					basic_salary: '22000.00',
				}),
			]
		);

		const [context] = await readSlipSalaryContexts(db, [slip()]);

		expect(context.state).toBe('ambiguous');
		expect(context.conflicts).toEqual([
			{ agreement_id: 21, agreement_source: 'salary_structures' },
			{ agreement_id: 22, agreement_source: 'salary_structures' },
		]);
		expect(context.figure_basic).toBeNull();
	});

	it('fills a missing canonical Basic from a unique covering legacy structure', async () => {
		const db = fakeDb(
			[profile({ id: 4, basic: null, basic_plus_da: null })],
			[legacyStructure()]
		);

		const [context] = await readSlipSalaryContexts(db, [slip()]);

		expect(context).toMatchObject({
			state: 'confirmed',
			agreement_id: 4,
			agreement_source: 'employee_salary_profile',
			figure_basic: 18000,
			figure_basic_source: 'legacy_basic',
		});
	});

	it('discloses a component the legacy context cannot establish instead of inventing zero', async () => {
		const db = fakeDb([
			profile({ id: 4, basic: '0.00', basic_plus_da: '0.00' }),
		]);

		const [context] = await readSlipSalaryContexts(db, [slip()]);

		expect(context.state).toBe('confirmed');
		expect(context.figure_basic).toBeNull();
		expect(context.figure_basic_source).toBeNull();
		expect(context.disclosures).toContain('component_basic_unavailable');
	});

	it('classifies a confirmed legacy structure type through its pay_type', async () => {
		const db = fakeDb([], [legacyStructure({ pay_type: 'daily' })]);

		const [context] = await readSlipSalaryContexts(db, [slip()]);

		expect(context).toMatchObject({
			state: 'confirmed',
			agreement_source: 'salary_structures',
			salary_type: 'daily',
			salary_type_source: 'period_agreement',
			stream: 'payroll',
			figure_basic: 18000,
			figure_basic_source: 'legacy_basic',
		});
	});

	it('classifies streams from recorded or confirmed types, keeping unresolved legacy slips in Payroll', async () => {
		const [contract] = await readSlipSalaryContexts(
			fakeDb([
				profile({
					id: 3,
					effective_from: '2024-01-01',
					salary_type: 'contract',
				}),
			]),
			[slip()]
		);
		expect(slipMatchesSalaryTypeFilter(contract, 'contract')).toBe(true);
		expect(slipMatchesSalaryTypeFilter(contract, 'payroll')).toBe(false);

		const [unresolved] = await readSlipSalaryContexts(fakeDb([]), [slip()]);
		expect(slipMatchesSalaryTypeFilter(unresolved, 'payroll')).toBe(true);
		expect(slipMatchesSalaryTypeFilter(unresolved, 'contract')).toBe(false);
		expect(slipMatchesSalaryTypeFilter(unresolved, 'monthly')).toBe(false);

		const [daily] = await readSlipSalaryContexts(
			fakeDb([profile({ id: 4, salary_type: 'daily' })]),
			[slip()]
		);
		expect(slipMatchesSalaryTypeFilter(daily, 'daily')).toBe(true);
		expect(slipMatchesSalaryTypeFilter(daily, 'monthly')).toBe(false);
		expect(slipMatchesSalaryTypeFilter(daily, null)).toBe(true);
	});
});
