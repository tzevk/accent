import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MonthlySalaryPreview from '@/components/MonthlySalaryPreview';

const breakdown = {
	basic: 15000,
	da: 3000,
	hra: 6000,
	conveyance: 3000,
	call_allowance: 3000,
	incentive: 0,
	other_allowances: 0,
	total_earnings: 30000,
	pf_employee: 1800,
	esic_employee: 0,
	pt: 200,
	mlwf: 25,
	retention: 100,
	tds: 1500,
	lwf: 0,
	loan_recovery: 0,
	advance_deduction: 0,
	total_deductions: 3625,
	net_pay: 26375,
	pf_employer: 1950,
	esic_employer: 0,
	mlwf_employer: 75,
	bonus: 500,
	insurance: 125,
	gratuity: 722,
	pf_admin: 75,
	edli: 75,
	total_employer_contributions: 3522,
	employer_cost: 33522,
};

describe('MonthlySalaryPreview', () => {
	it('allows an authorized operator to override and reset a component', () => {
		const onOverrideChange = vi.fn();
		const onOverrideReset = vi.fn();

		render(
			<MonthlySalaryPreview
				profile={{}}
				breakdown={breakdown}
				canOverride
				overrideMode
				overrides={{ basic: 14000 }}
				onOverrideChange={onOverrideChange}
				onOverrideReset={onOverrideReset}
			/>
		);

		expect(screen.getByText('Overridden')).toBeVisible();
		fireEvent.change(screen.getByLabelText('Basic override value'), {
			target: { value: '14500' },
		});
		expect(onOverrideChange).toHaveBeenCalledWith('basic', '14500');
		fireEvent.click(
			screen.getByRole('button', { name: 'Reset Basic to derived value' })
		);
		expect(onOverrideReset).toHaveBeenCalledWith('basic');
	});

	it('renders calculation results and sends applicability changes upward', () => {
		const onApplicabilityChange = vi.fn();

		render(
			<MonthlySalaryPreview
				profile={{ pf_applicable: false }}
				breakdown={breakdown}
				onApplicabilityChange={onApplicabilityChange}
			/>
		);

		expect(
			screen.getByText('Derived from the effective payroll schedule')
		).toBeVisible();
		expect(screen.getByText('₹30,000.00')).toBeVisible();
		expect(screen.getByText('₹26,375.00')).toBeVisible();
		fireEvent.click(screen.getByRole('checkbox', { name: 'PF' }));
		expect(onApplicabilityChange).toHaveBeenCalledWith('pf_applicable', true);
	});
});
