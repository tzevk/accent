import { render, renderHook, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import MonthlySalaryPreview from '@/components/MonthlySalaryPreview';
import { usePayrollPreview } from '@/hooks/usePayrollPreview';
import {
	SALARY_CTC_MAX,
	resolveSalaryCtc,
	validateDailyHours,
	validateSalaryCtc,
} from '@/lib/salary-ctc';
import type { SalaryCtcResolution } from '@/lib/salary-ctc';
import { calculatePayroll } from '@/utils/payroll-calculation';

/**
 * Behavior contract for explicit monthly CTC (issue #436): one presence-based
 * resolver, the unchanged Decimal pay formula, the preview hook, and the
 * estimate surface. Money expectations are worked examples, not a mirror of
 * the implementation.
 */

const attendance = {
	standardWorkingDays: 26,
	daysPresent: 26,
	daysAbsent: 0,
	daysLeave: 0,
	weeklyOff: 4,
	holidays: 0,
	halfDays: 0,
	payableDays: 26,
	lopDays: 0,
	totalOvertimeHours: 0,
	hasAttendanceData: true,
};

const noStatutory = {
	pf_applicable: 0,
	esic_applicable: 0,
	pt_applicable: 0,
	mlwf_applicable: 0,
	retention_applicable: 0,
	bonus_applicable: 0,
	incentive_applicable: 0,
	insurance_applicable: 0,
};

const resolvedAmount = (resolution: SalaryCtcResolution): number | null =>
	resolution.status === 'resolved' ? resolution.amount.toNumber() : null;

describe('resolveSalaryCtc', () => {
	it('uses the canonical employer_cost ahead of a different legacy gross and Contract amount', () => {
		const resolution = resolveSalaryCtc({
			employer_cost: '26000.00',
			gross_salary: '20000.00',
			gross: '18000.00',
			contract_amount: '50000.00',
		});

		expect(resolution.status).toBe('resolved');
		expect(resolution.source).toBe('employer_cost');
		expect(resolution.legacyFallback).toBe(false);
		expect(resolvedAmount(resolution)).toBe(26_000);
	});

	it('preserves an explicitly stored zero CTC instead of falling through to legacy gross', () => {
		const resolution = resolveSalaryCtc({
			employer_cost: 0,
			gross_salary: 25_000,
			gross: 30_000,
		});

		expect(resolution.status).toBe('resolved');
		expect(resolution.source).toBe('employer_cost');
		expect(resolution.legacyFallback).toBe(false);
		expect(resolvedAmount(resolution)).toBe(0);
	});

	it('reports missing when neither canonical CTC nor a legacy gross is stored', () => {
		const resolution = resolveSalaryCtc({
			employer_cost: null,
			gross_salary: null,
			gross: undefined,
		});

		expect(resolution.status).toBe('missing');
		expect(resolution.amount).toBeNull();
		expect(resolution.source).toBe('none');
	});

	it('discloses the established legacy gross fallback when canonical CTC is absent', () => {
		const grossSalary = resolveSalaryCtc({
			employer_cost: null,
			gross_salary: '20000.00',
			gross: '18000.00',
			contract_amount: '50000.00',
		});
		expect(grossSalary.status).toBe('resolved');
		expect(grossSalary.source).toBe('gross_salary');
		expect(grossSalary.legacyFallback).toBe(true);
		expect(resolvedAmount(grossSalary)).toBe(20_000);

		const gross = resolveSalaryCtc({ gross: '18000.00' });
		expect(gross.status).toBe('resolved');
		expect(gross.source).toBe('gross');
		expect(gross.legacyFallback).toBe(true);
		expect(resolvedAmount(gross)).toBe(18_000);
	});

	it('keeps the established positive-only legacy chain', () => {
		const resolution = resolveSalaryCtc({ gross_salary: 0, gross: '18000.00' });

		expect(resolution.status).toBe('resolved');
		expect(resolution.source).toBe('gross');
		expect(resolvedAmount(resolution)).toBe(18_000);
	});

	it('rejects an invalid canonical CTC instead of silently using a legacy gross', () => {
		const negative = resolveSalaryCtc({
			employer_cost: '-1.00',
			gross_salary: '20000.00',
		});
		expect(negative.status).toBe('invalid');
		expect(negative.amount).toBeNull();
		expect(negative.source).toBe('employer_cost');
		expect(negative.status === 'invalid' && negative.reason).toBe('negative');

		const notFinite = resolveSalaryCtc({ employer_cost: 'not-a-number' });
		expect(notFinite.status).toBe('invalid');
		expect(notFinite.status === 'invalid' && notFinite.reason).toBe(
			'not-finite'
		);

		const outOfRange = resolveSalaryCtc({ employer_cost: 10_000_000_000 });
		expect(outOfRange.status).toBe('invalid');
		expect(outOfRange.status === 'invalid' && outOfRange.reason).toBe(
			'out-of-range'
		);
	});
});

describe('salary CTC and daily-hours validation', () => {
	it('accepts an explicit zero and the database maximum', () => {
		const zero = validateSalaryCtc(0);
		expect(zero.valid).toBe(true);
		expect(zero.valid && zero.amount.toNumber()).toBe(0);

		expect(validateSalaryCtc(SALARY_CTC_MAX).valid).toBe(true);
		expect(validateSalaryCtc('9999999999.99').valid).toBe(true);
	});

	it('rejects missing, negative, non-finite and out-of-range CTC', () => {
		expect(validateSalaryCtc('')).toEqual({ valid: false, reason: 'missing' });
		expect(validateSalaryCtc(null)).toEqual({
			valid: false,
			reason: 'missing',
		});
		expect(validateSalaryCtc(-0.01)).toEqual({
			valid: false,
			reason: 'negative',
		});
		expect(validateSalaryCtc('not-a-number')).toEqual({
			valid: false,
			reason: 'not-finite',
		});
		expect(validateSalaryCtc(Number.POSITIVE_INFINITY)).toEqual({
			valid: false,
			reason: 'not-finite',
		});
		expect(validateSalaryCtc(10_000_000_000)).toEqual({
			valid: false,
			reason: 'out-of-range',
		});
	});

	it('requires daily hours to be finite and positive', () => {
		const valid = validateDailyHours('6.5');
		expect(valid.valid).toBe(true);
		expect(valid.valid && valid.hours.toNumber()).toBe(6.5);

		expect(validateDailyHours(0)).toEqual({
			valid: false,
			reason: 'nonpositive',
		});
		expect(validateDailyHours(-1)).toEqual({
			valid: false,
			reason: 'nonpositive',
		});
		expect(validateDailyHours('')).toEqual({ valid: false, reason: 'missing' });
		expect(validateDailyHours('Infinity')).toEqual({
			valid: false,
			reason: 'not-finite',
		});
	});
});

describe('calculatePayroll with explicit CTC', () => {
	it('prices from explicit CTC, not a different legacy gross or Contract amount', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				salary_type: 'contract',
				employer_cost: 26_000,
				gross_salary: 20_000,
				gross: 18_000,
				contract_amount: 50_000,
				...noStatutory,
			},
			payrollSchedule: {
				components: { da: { value_type: 'fixed', value: 3_000 } },
			},
			attendance,
		});

		expect(result.ctc_used).toBe(26_000);
		expect(result.basis_hours).toBe(208);
		expect(result.hourly_rate).toBe(125);
		expect(result.gross).toBe(26_000);
		expect(result.full_month.gross).toBe(26_000);
		// Component Rate behavior is untouched: fixed DA still shapes the heads.
		expect(result.da).toBe(3_000);
		expect(result.basic).toBe(12_600);
		expect(result.hra).toBe(5_200);
		expect(result.total_earnings).toBe(26_000);
	});

	it('pays zero for an explicit zero CTC, never the legacy gross', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				employer_cost: 0,
				gross_salary: 25_000,
				...noStatutory,
			},
			attendance,
		});

		expect(result.ctc_used).toBe(0);
		expect(result.hourly_rate).toBe(0);
		expect(result.gross).toBe(0);
		expect(result.total_earnings).toBe(0);
		expect(result.net_pay).toBe(0);
	});

	it('accepts a CTC-only agreement with missing legacy gross and keeps employer contributions out of the agreed CTC', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				employer_cost: '26000.00',
				gross_salary: null,
				gross: null,
				...noStatutory,
				pf_applicable: 1,
			},
			attendance,
		});

		expect(result.ctc_used).toBe(26_000);
		expect(result.gross).toBe(26_000);
		expect(result.total_earnings).toBe(26_000);
		// The computed slip employer cost carries contributions; the agreed CTC does not.
		expect(result.total_employer_contributions).toBeGreaterThan(0);
		expect(result.employer_cost).toBe(
			26_000 + result.total_employer_contributions
		);
		expect(result.employer_cost).toBeGreaterThan(result.ctc_used);
	});

	it('supports a positive fractional standard day', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				employer_cost: 26_000,
				std_hours_per_day: 6.5,
				...noStatutory,
			},
			attendance,
		});

		expect(result.basis_hours).toBe(169);
		expect(result.hourly_rate).toBe(153.85);
		expect(result.gross).toBe(26_000);
		expect(result.full_month.gross).toBe(26_000);
	});

	it('rejects invalid stored amounts instead of repricing them silently', () => {
		expect(() =>
			calculatePayroll({
				month: '2026-01-01',
				salaryProfile: {
					employer_cost: -1,
					gross_salary: 25_000,
					...noStatutory,
				},
				attendance,
			})
		).toThrow(RangeError);

		expect(() =>
			calculatePayroll({
				month: '2026-01-01',
				salaryProfile: {
					employer_cost: 26_000,
					std_hours_per_day: 0,
					...noStatutory,
				},
				attendance,
			})
		).toThrow(RangeError);
	});
});

describe('usePayrollPreview', () => {
	it('previews a CTC-only agreement without a legacy gross', () => {
		const { result } = renderHook(() =>
			usePayrollPreview({
				month: '2026-01-01',
				salaryProfile: { employer_cost: 26_000, ...noStatutory },
				attendance,
			})
		);

		expect(result.current.preview).not.toBeNull();
		expect(result.current.preview?.ctc_used).toBe(26_000);
		expect(result.current.preview?.gross).toBe(26_000);
		expect(result.current.preview?.full_month.gross).toBe(26_000);
	});

	it('previews an explicit zero CTC as zero instead of suppressing it or using gross', () => {
		const { result } = renderHook(() =>
			usePayrollPreview({
				month: '2026-01-01',
				salaryProfile: {
					employer_cost: 0,
					gross_salary: 25_000,
					...noStatutory,
				},
				attendance,
			})
		);

		expect(result.current.preview).not.toBeNull();
		expect(result.current.preview?.ctc_used).toBe(0);
		expect(result.current.preview?.gross).toBe(0);
	});

	it('returns no preview for a missing CTC or invalid stored amounts', () => {
		const missing = renderHook(() =>
			usePayrollPreview({
				salaryProfile: { employer_cost: null },
				attendance,
			})
		);
		expect(missing.result.current.preview).toBeNull();

		const invalidCtc = renderHook(() =>
			usePayrollPreview({
				salaryProfile: { employer_cost: -1 },
				attendance,
			})
		);
		expect(invalidCtc.result.current.preview).toBeNull();

		const invalidHours = renderHook(() =>
			usePayrollPreview({
				salaryProfile: { employer_cost: 26_000, std_hours_per_day: 0 },
				attendance,
			})
		);
		expect(invalidHours.result.current.preview).toBeNull();
	});
});

describe('MonthlySalaryPreview', () => {
	const previewFor = (profile: Record<string, unknown>) =>
		calculatePayroll({
			month: '2026-01-01',
			salaryProfile: profile,
			attendance,
		});

	it('labels the estimate and explains CTC, Basis Hours and Logged Hours', () => {
		const profile = { employer_cost: 26_000, ...noStatutory };
		const breakdown = previewFor(profile);
		render(createElement(MonthlySalaryPreview, { profile, breakdown }));

		expect(screen.getByText(/estimated/i)).toBeVisible();
		expect(screen.getByText(/Monthly CTC/)).toBeVisible();
		expect(screen.getByText(/Basis Hours/)).toBeVisible();
		expect(screen.getByText(/Logged Hours/)).toBeVisible();
	});

	it('discloses when the estimate uses the legacy gross salary as the CTC basis', () => {
		const profile = { gross_salary: 20_000, ...noStatutory };
		const breakdown = previewFor(profile);
		render(createElement(MonthlySalaryPreview, { profile, breakdown }));

		expect(screen.getByText(/legacy gross salary/i)).toBeVisible();
	});

	it('shows the missing state when no monthly CTC is stored', () => {
		render(
			createElement(MonthlySalaryPreview, {
				profile: { employer_cost: null },
				breakdown: null,
			})
		);

		expect(screen.getByText(/No monthly CTC is stored/i)).toBeVisible();
	});

	it('renders an explicit zero CTC as zero rather than as missing', () => {
		const profile = { employer_cost: 0, ...noStatutory };
		const breakdown = previewFor(profile);
		render(createElement(MonthlySalaryPreview, { profile, breakdown }));

		expect(screen.queryByText(/No monthly CTC is stored/i)).toBeNull();
		expect(screen.getByText(/Monthly CTC ₹0\.00/)).toBeVisible();
	});
});
