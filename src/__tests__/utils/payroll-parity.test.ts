import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn(),
}));

import { computePayroll } from '@/utils/payroll-calculator';
import { calculatePayroll } from '@/utils/payroll-calculation';

const profile = {
	gross_salary: 50000,
	pf_applicable: true,
	esic_applicable: false,
	pt_applicable: true,
	mlwf_applicable: true,
	retention_applicable: false,
	bonus_applicable: false,
	incentive_applicable: false,
	insurance_applicable: false,
};

const schedule = {
	components: {
		da: { type: 'fixed', amount: 1000 },
		pt: { type: 'fixed', amount: 200 },
		mlwf: { type: 'fixed', amount: 25 },
	},
};

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

describe('payroll preview/parity', () => {
	it('server orchestration matches the shared boundary for identical inputs', () => {
		const expected = calculatePayroll({
			employeeId: 7,
			month: '2026-06-01',
			salaryProfile: profile,
			payrollSchedule: schedule,
			attendance,
		});
		const actual = computePayroll(
			7,
			'2026-06-01',
			profile,
			undefined,
			attendance,
			false,
			schedule,
			{}
		);

		for (const key of [
			'basic',
			'da',
			'hra',
			'conveyance',
			'call_allowance',
			'total_earnings',
			'pf_employee',
			'esic_employee',
			'pt',
			'mlwf',
			'total_deductions',
			'net_pay',
			'pf_employer',
			'esic_employer',
			'total_employer_contributions',
			'employer_cost',
			'tds',
			'tds_percentage',
		] as const) {
			expect(actual[key]).toBe(expected[key]);
		}
		expect(actual.total_earnings - actual.total_deductions).toBe(
			actual.net_pay
		);
	});

	it('preserves explicit overrides through both entry points', () => {
		const overrides = { hra: 8000, tds_percentage: 5 };
		const expected = calculatePayroll({
			employeeId: 7,
			month: '2026-06-01',
			salaryProfile: profile,
			payrollSchedule: schedule,
			attendance,
			overrides,
		});
		const actual = computePayroll(
			7,
			'2026-06-01',
			profile,
			undefined,
			attendance,
			false,
			schedule,
			overrides
		);

		expect(actual.hra).toBe(8000);
		expect(actual.tds_percentage).toBe(5);
		expect(actual).toEqual(expected);
	});
});
