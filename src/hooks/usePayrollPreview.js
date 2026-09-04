import { useMemo } from 'react';
import { calculatePayroll } from '@/utils/payroll-calculation';

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
