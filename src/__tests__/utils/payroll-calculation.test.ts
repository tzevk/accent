import { describe, expect, it } from 'vitest';
import {
	calculatePayroll,
	normalizeSalaryProfile,
} from '@/utils/payroll-calculation';

const attendance = {
	standardWorkingDays: 26,
	daysPresent: 25,
	daysAbsent: 1,
	daysLeave: 0,
	weeklyOff: 4,
	holidays: 0,
	halfDays: 0,
	payableDays: 25,
	lopDays: 1,
	totalOvertimeHours: 0,
	hasAttendanceData: true,
};

describe('calculatePayroll', () => {
	it('calculates the complete breakdown from normalized inputs', () => {
		const result = calculatePayroll({
			employeeId: 7,
			month: '2026-06-01',
			salaryProfile: {
				gross_salary: 30_000,
				pf_applicable: 0,
				esic_applicable: 0,
				pt_applicable: 0,
				mlwf_applicable: 1,
				mlwf: null,
				retention_applicable: 0,
				bonus_applicable: 0,
				incentive_applicable: 0,
				insurance_applicable: 1,
				insurance: null,
			},
			payrollSchedule: {
				components: {
					da: { value_type: 'fixed', value: 3_000 },
					mlwf: { value_type: 'fixed', value: 25 },
					mlwf_employer: { value_type: 'fixed', value: 75 },
					insurance: { value_type: 'fixed', value: 125 },
					tds: { value_type: 'percentage', value: 10 },
				},
			},
			attendance,
		});

		expect(result).toMatchObject({
			employee_id: 7,
			month: '2026-06-01',
			gross: 30_000,
			basic: 15_000,
			da: 3_000,
			basic_plus_da: 18_000,
			hra: 6_000,
			conveyance: 3_000,
			call_allowance: 3_000,
			total_earnings: 30_000,
			mlwf: 25,
			mlwf_employer: 75,
			tds: 3_000,
			insurance: 125,
			total_deductions: 3_025,
			net_pay: 26_975,
		});
		expect(result.attendance).toMatchObject({
			standard_working_days: 26,
			days_present: 25,
			days_absent: 1,
			payable_days: 25,
		});
		expect(result.total_earnings - result.total_deductions).toBe(
			result.net_pay
		);
	});

	it('prefers the Salary Profile TDS rate over the effective schedule', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				gross_salary: 20_000,
				tds_percentage: 5,
			},
			payrollSchedule: { tds: { value_type: 'percentage', value: 10 } },
			attendance,
		});

		expect(result.tds_percentage).toBe(5);
		expect(result.tds).toBe(1_000);
	});

	it('keeps the existing Contract TDS fallback without adding a monthly default', () => {
		const contract = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: { salary_type: 'contract', gross_salary: 10_000 },
			attendance,
		});
		const monthly = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: { salary_type: 'monthly', gross_salary: 10_000 },
			attendance,
		});

		expect(contract.tds_percentage).toBe(10);
		expect(contract.tds).toBe(1_000);
		expect(monthly.tds).toBe(0);
		expect(monthly.tds_percentage).toBeNull();
	});

	it('rounds money consistently and preserves the payroll invariant', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				gross_salary: '33333.33',
				pf_applicable: 0,
				tds_percentage: '2.5',
			},
			attendance,
		});

		expect(result.basic).toBe(20_000);
		expect(result.hra).toBe(6_667);
		expect(result.tds).toBe(833);
		expect(result.total_earnings - result.total_deductions).toBe(
			result.net_pay
		);
	});

	it('uses explicit amount overrides and keeps CTC out of the earnings base', () => {
		const result = calculatePayroll({
			month: '2026-01-01',
			salaryProfile: {
				gross_salary: 30_000,
				ctc: 100_000,
				pf_applicable: 0,
				tds_percentage: 10,
			},
			attendance,
			overrides: { basic: 14_000, tds: 2_000 },
		});

		expect(result.gross).toBe(30_000);
		expect(result.basic).toBe(14_000);
		expect(result.tds).toBe(2_000);
	});
});

describe('normalizeSalaryProfile', () => {
	it('keeps canonical values and fills only missing fields from legacy data', () => {
		const result = normalizeSalaryProfile(
			{
				gross_salary: 30_000,
				basic: 15_000,
				hra: 6_000,
				pf_applicable: 0,
			},
			{
				gross_salary: 90_000,
				basic_salary: 54_000,
				basic: 45_000,
				hra: 18_000,
				conveyance: 9_000,
				pay_type: 'monthly',
			}
		);

		expect(result.gross_salary).toBe(30_000);
		expect(result.basic).toBe(15_000);
		expect(result.hra).toBe(6_000);
		expect(result.conveyance).toBe(9_000);
		expect(result.pf_applicable).toBe(0);
		expect(result.gross).not.toBe(90_000);
	});
});
