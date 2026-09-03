import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePayrollPreview } from '@/hooks/usePayrollPreview';
import { calculatePayroll } from '@/utils/payroll-calculation';

describe('usePayrollPreview', () => {
	it('matches the shared payroll calculation for normalized inputs', () => {
		const input = {
			employeeId: 7,
			month: '2025-06-01',
			salaryProfile: {
				gross_salary: 50000,
				pf_applicable: true,
				esic_applicable: false,
				pt_applicable: true,
				mlwf_applicable: true,
			},
			payrollSchedule: {
				components: {
					da: { type: 'fixed', amount: 1000 },
					pt: { type: 'fixed', amount: 200 },
					mlwf: { type: 'fixed', amount: 25 },
				},
			},
		};
		const { result } = renderHook(() => usePayrollPreview(input));

		expect(result.current.preview).toEqual(calculatePayroll(input));
		expect(result.current.preview.gross).toBe(50000);
		expect(result.current.preview.da).toBe(1000);
		expect(result.current.preview.pt).toBe(200);
		expect(result.current.preview.mlwf).toBe(25);
		expect(result.current.preview.net_pay).toBe(
			result.current.preview.total_earnings -
				result.current.preview.total_deductions
		);
	});

	it('returns no preview until gross is entered', () => {
		const { result } = renderHook(() =>
			usePayrollPreview({ salaryProfile: { gross_salary: '' } })
		);

		expect(result.current.preview).toBeNull();
	});
});
