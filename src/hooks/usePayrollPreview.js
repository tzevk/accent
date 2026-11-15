import { useMemo } from 'react';
import { calculatePayroll } from '@/utils/payroll-calculation';
import {
	isSalaryCtcPresent,
	resolveSalaryCtc,
	validateDailyHours,
} from '@/lib/salary-ctc';

/**
 * @param {{
 *   employeeId?: number | string,
 *   month?: string,
 *   salaryProfile?: Record<string, unknown> | null,
 *   payrollSchedule?: Record<string, unknown>,
 *   attendance?: Record<string, unknown>,
 *   overrides?: Record<string, unknown>,
 *   includeBonus?: boolean,
 * }} options
 */
export function usePayrollPreview(options = {}) {
	const {
		employeeId,
		month,
		salaryProfile,
		payrollSchedule = {},
		attendance = {},
		overrides = {},
		includeBonus = false,
	} = options;
	const preview = useMemo(() => {
		if (!salaryProfile) return null;
		// A valid preview needs an explicit (possibly zero) CTC or the disclosed
		// legacy gross fallback. Never manufacture a gross amount to pass a guard.
		if (resolveSalaryCtc(salaryProfile).status !== 'resolved') return null;

		const dailyHours =
			salaryProfile.std_hours_per_day ?? salaryProfile.standard_hours_per_day;
		if (
			isSalaryCtcPresent(dailyHours) &&
			!validateDailyHours(dailyHours).valid
		) {
			return null;
		}

		return calculatePayroll({
			employeeId,
			month,
			salaryProfile,
			payrollSchedule,
			attendance,
			overrides,
			includeBonus,
		});
	}, [
		employeeId,
		month,
		salaryProfile,
		payrollSchedule,
		attendance,
		overrides,
		includeBonus,
	]);

	return { preview };
}

export default usePayrollPreview;
