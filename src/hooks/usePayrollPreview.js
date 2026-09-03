import { useMemo } from 'react';
import { calculatePayroll } from '@/utils/payroll-calculation';

/**
 * Client-safe salary preview boundary. Schedule loading stays in the caller;
 * all payroll arithmetic stays in the shared calculation module.
 */
export function usePayrollPreview({
	employeeId,
	month,
	salaryProfile,
	payrollSchedule = {},
	attendance = {},
	overrides = {},
	includeBonus = false,
} = {}) {
	const preview = useMemo(() => {
		if (
			!salaryProfile ||
			!String(salaryProfile.gross_salary ?? salaryProfile.gross ?? '')
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

	return { preview, breakdown: preview };
}

export default usePayrollPreview;
