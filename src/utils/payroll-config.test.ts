import { describe, it, expect } from 'vitest';
import {
	calculatePF,
	calculateESIC,
	calculateProfessionalTax,
	calculateSalaryFromGross,
} from '@/utils/payroll-config';

// ── calculatePF ──────────────────────────────────────────────────────

describe('calculatePF', () => {
	it('returns all zeros when PF not applicable', () => {
		const result = calculatePF(20000, false);
		expect(result).toEqual({
			wageBase: 0,
			employeeContribution: 0,
			employerEPF: 0,
			employerEPS: 0,
			employerTotal: 0,
			pfAdmin: 0,
		});
	});

	it('caps wage base at ₹15,000 ceiling (default)', () => {
		const result = calculatePF(25000, true, '15000');
		expect(result.wageBase).toBe(15000);
	});

	it('uses actual basic when ceiling is "actual"', () => {
		const result = calculatePF(25000, true, 'actual');
		expect(result.wageBase).toBe(25000);
	});

	it('calculates employee PF = 12% of wage base', () => {
		// 15000 * 12% = 1800
		const result = calculatePF(20000, true, '15000');
		expect(result.employeeContribution).toBe(1800);
	});

	it('calculates employer EPF = 3.67% of wage base', () => {
		// 15000 * 3.67% = 550.5 → 551 (rounded)
		const result = calculatePF(20000, true, '15000');
		expect(result.employerEPF).toBe(551);
	});

	it('calculates employer EPS = 8.33% of wage base (capped)', () => {
		// 15000 * 8.33% = 1249.5 → 1250 (rounded)
		const result = calculatePF(20000, true, '15000');
		expect(result.employerEPS).toBe(1250);
	});

	it('employerTotal = employerEPF + employerEPS', () => {
		const result = calculatePF(20000, true, '15000');
		expect(result.employerTotal).toBe(result.employerEPF + result.employerEPS);
	});

	it('calculates PF admin = 0.5% of wage base', () => {
		// 15000 * 0.5% = 75
		const result = calculatePF(20000, true, '15000');
		expect(result.pfAdmin).toBe(75);
	});

	it('produces exact integer outputs (no float error)', () => {
		// Specifically verifying no off-by-one-paisa due to float rounding
		const result = calculatePF(18000, true, '15000');
		expect(result.employeeContribution).toBe(1800); // 15000 * 12% / 100
		expect(result.pfAdmin).toBe(75); // 15000 * 0.5% / 100
		expect(result.employerTotal).toBe(result.employerEPF + result.employerEPS);
	});

	it('handles string salary input', () => {
		const result = calculatePF('15000', true, '15000');
		expect(result.wageBase).toBe(15000);
		expect(result.employeeContribution).toBe(1800);
	});
});

// ── calculateESIC ────────────────────────────────────────────────────

describe('calculateESIC', () => {
	it('returns not eligible when esicApplicable is false', () => {
		const result = calculateESIC(15000, false);
		expect(result.eligible).toBe(false);
		expect(result.employeeContribution).toBe(0);
		expect(result.employerContribution).toBe(0);
	});

	it('returns not eligible when gross exceeds ceiling', () => {
		const result = calculateESIC(25000, true);
		expect(result.eligible).toBe(false);
	});

	it('returns eligible when gross ≤ ₹21,000 and applicable', () => {
		const result = calculateESIC(21000, true);
		expect(result.eligible).toBe(true);
	});

	it('calculates employee ESIC = 0.75% of gross', () => {
		// 20000 * 0.75% = 150
		const result = calculateESIC(20000, true);
		expect(result.eligible).toBe(true);
		expect(result.employeeContribution).toBe(150);
	});

	it('calculates employer ESIC = 3.25% of gross', () => {
		// 20000 * 3.25% = 650
		const result = calculateESIC(20000, true);
		expect(result.employerContribution).toBe(650);
	});

	it('handles exact ceiling boundary', () => {
		// Exactly 21000 should be eligible
		expect(calculateESIC(21000, true).eligible).toBe(true);
		// 21000.01 should NOT be eligible
		expect(calculateESIC(21000.01, true).eligible).toBe(false);
	});

	it('handles string salary input', () => {
		const result = calculateESIC('18000', true);
		expect(result.eligible).toBe(true);
		expect(result.employeeContribution).toBe(135); // 18000 * 0.75%
	});
});

// ── calculateProfessionalTax ─────────────────────────────────────────

describe('calculateProfessionalTax', () => {
	it('returns ₹0 for salary ≤ 5000', () => {
		expect(calculateProfessionalTax(5000)).toBe(0);
		expect(calculateProfessionalTax(3000)).toBe(0);
	});

	it('returns ₹150 for salary 5001–7500', () => {
		expect(calculateProfessionalTax(5001)).toBe(150);
		expect(calculateProfessionalTax(7500)).toBe(150);
	});

	it('returns ₹175 for salary 7501–10000', () => {
		expect(calculateProfessionalTax(7501)).toBe(175);
		expect(calculateProfessionalTax(10000)).toBe(175);
	});

	it('returns ₹200 for salary > 10000', () => {
		expect(calculateProfessionalTax(10001)).toBe(200);
		expect(calculateProfessionalTax(50000)).toBe(200);
	});

	it('returns 0 for zero salary', () => {
		// Note: 0 > 5000 is false, so falls through to DEFAULT (0)
		expect(calculateProfessionalTax(0)).toBe(0);
	});
});

// ── calculateSalaryFromGross ─────────────────────────────────────────

describe('calculateSalaryFromGross', () => {
	it('returns null for zero gross', () => {
		expect(calculateSalaryFromGross(0)).toBeNull();
	});

	it('returns null for falsy gross', () => {
		expect(calculateSalaryFromGross('')).toBeNull();
	});

	it('calculates components from ₹30,000 gross', () => {
		const result = calculateSalaryFromGross(30000);
		expect(result).not.toBeNull();
		expect(result!.gross).toBe(30000);
		expect(result!.basicDA).toBe(18000); // 60% of 30000
		expect(result!.hra).toBe(6000); // 20% of 30000
		expect(result!.conveyance).toBe(3000); // 10% of 30000 (no fixed amount)
		expect(result!.callAllowance).toBe(3000); // 10% of 30000
	});

	it('uses CONVEYANCE_FIXED_AMOUNT when set', () => {
		const result = calculateSalaryFromGross(30000, {
			CONVEYANCE_FIXED_AMOUNT: 1600,
		});
		expect(result!.conveyance).toBe(1600);
	});

	it('respects percentage overrides', () => {
		const result = calculateSalaryFromGross(50000, {
			BASIC_DA_PERCENT: 50,
			HRA_PERCENT: 25,
		});
		expect(result!.basicDA).toBe(25000); // 50% of 50000
		expect(result!.hra).toBe(12500); // 25% of 50000
	});

	it('produces exact integer outputs', () => {
		const result = calculateSalaryFromGross(45000);
		// 60% = 27000, 20% = 9000, 10% = 4500, 10% = 4500
		// Sum: 27000 + 9000 + 4500 + 4500 = 45000
		const sum =
			result!.basicDA +
			result!.hra +
			result!.conveyance +
			result!.callAllowance;
		expect(sum).toBe(45000);
	});
});
