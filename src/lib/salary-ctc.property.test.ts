import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import Decimal from 'decimal.js';
import {
	SALARY_CTC_MAX,
	resolveSalaryCtc,
	type SalaryCtcResolution,
} from '@/lib/salary-ctc';

/**
 * Properties of the one presence-based CTC resolver (ADR-0001, #436).
 * They pin the precedence and the explicit-zero rule independently of the
 * worked examples in salary-ctc.test.ts.
 */

const maxCents = 999_999_999_999;
const amountArb = fc
	.integer({ min: 0, max: maxCents })
	.map((cents) => new Decimal(cents).div(100));
const positiveAmountArb = fc
	.integer({ min: 1, max: maxCents })
	.map((cents) => new Decimal(cents).div(100));
const absentOrZeroArb = fc.constantFrom(null, undefined, 0, '0', '0.00');
const absentArb = fc.constantFrom(null, undefined);
const invalidCanonicalArb = fc.oneof(
	fc
		.integer({ min: -1_000_000_000, max: -1 })
		.map((cents) => new Decimal(cents).div(100).toString()),
	fc.integer({ min: 10_000_000_000, max: 20_000_000_000 }),
	fc.constantFrom('not-a-number', Number.NaN, Number.POSITIVE_INFINITY)
);

const resolvedAmount = (resolution: SalaryCtcResolution): Decimal | null =>
	resolution.status === 'resolved' ? resolution.amount : null;

describe('salary CTC properties', () => {
	it('lets a valid canonical employer_cost win over every legacy gross', () => {
		fc.assert(
			fc.property(
				amountArb,
				amountArb,
				amountArb,
				(canonical, grossSalary, gross) => {
					const resolution = resolveSalaryCtc({
						employer_cost: canonical.toString(),
						gross_salary: grossSalary.toString(),
						gross: gross.toString(),
					});

					expect(resolution.status).toBe('resolved');
					if (resolution.status !== 'resolved') return;
					expect(resolution.source).toBe('employer_cost');
					expect(resolution.legacyFallback).toBe(false);
					expect(resolution.amount.equals(canonical)).toBe(true);
				}
			),
			{ numRuns: 300 }
		);
	});

	it('never substitutes a legacy gross for an invalid canonical value', () => {
		fc.assert(
			fc.property(
				invalidCanonicalArb,
				positiveAmountArb,
				(canonical, gross) => {
					const resolution = resolveSalaryCtc({
						employer_cost: canonical,
						gross_salary: gross.toString(),
						gross: gross.toString(),
					});

					expect(resolution.status).toBe('invalid');
					if (resolution.status !== 'invalid') return;
					expect(resolution.source).toBe('employer_cost');
					expect(resolution.legacyFallback).toBe(false);
					expect(resolution.amount).toBeNull();
				}
			),
			{ numRuns: 300 }
		);
	});

	it('uses the first positive legacy gross only when canonical CTC is absent', () => {
		fc.assert(
			fc.property(
				absentArb,
				fc.oneof(absentOrZeroArb, positiveAmountArb),
				fc.oneof(absentOrZeroArb, positiveAmountArb),
				(employerCost, grossSalary, gross) => {
					const resolution = resolveSalaryCtc({
						employer_cost: employerCost,
						gross_salary: grossSalary,
						gross,
					});
					const salary = grossSalary instanceof Decimal ? grossSalary : null;
					const fallback = gross instanceof Decimal ? gross : null;

					if (salary !== null && salary.gt(0)) {
						expect(resolution.status).toBe('resolved');
						if (resolution.status !== 'resolved') return;
						expect(resolution.source).toBe('gross_salary');
						expect(resolution.legacyFallback).toBe(true);
						expect(resolution.amount.equals(salary)).toBe(true);
						return;
					}
					if (fallback !== null && fallback.gt(0)) {
						expect(resolution.status).toBe('resolved');
						if (resolution.status !== 'resolved') return;
						expect(resolution.source).toBe('gross');
						expect(resolution.legacyFallback).toBe(true);
						expect(resolution.amount.equals(fallback)).toBe(true);
						return;
					}
					expect(resolution.status).toBe('missing');
					expect(resolution.source).toBe('none');
					expect(resolution.amount).toBeNull();
				}
			),
			{ numRuns: 300 }
		);
	});

	it('keeps every resolved amount inside the database range', () => {
		fc.assert(
			fc.property(
				fc.oneof(invalidCanonicalArb, amountArb, absentOrZeroArb),
				fc.oneof(invalidCanonicalArb, amountArb, absentOrZeroArb),
				fc.oneof(invalidCanonicalArb, amountArb, absentOrZeroArb),
				(employerCost, grossSalary, gross) => {
					const resolution = resolveSalaryCtc({
						employer_cost: employerCost,
						gross_salary: grossSalary,
						gross,
					});
					const amount = resolvedAmount(resolution);
					if (amount === null) return;

					expect(amount.gte(0)).toBe(true);
					expect(amount.lte(SALARY_CTC_MAX)).toBe(true);
				}
			),
			{ numRuns: 300 }
		);
	});
});
