import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import CommercialTab from '@/app/projects/[id]/edit/tabs/CommercialTab';

const baseForm = {
	project_value: '',
	currency: 'INR',
	payment_terms: '',
	invoicing_status: '',
	cost_to_company: '',
	profitability_estimate: '',
	budget: '',
	subcontractors_vendors: '',
};

describe('CommercialTab', () => {
	it('renders all fields with correct initial values', () => {
		const form = {
			project_value: '50000',
			currency: 'USD',
			payment_terms: 'Net 30',
			invoicing_status: 'Invoiced',
			cost_to_company: '40000',
			profitability_estimate: '20',
			budget: '45000',
			subcontractors_vendors: 'Vendor XYZ',
		};
		const { container } = render(
			<CommercialTab form={form} handleChange={vi.fn()} />
		);

		expect(container.querySelector('input[name="project_value"]')).toHaveValue(
			50000
		);
		expect(container.querySelector('select[name="currency"]')).toHaveValue(
			'USD'
		);
		expect(container.querySelector('select[name="payment_terms"]')).toHaveValue(
			'Net 30'
		);
		expect(
			container.querySelector('select[name="invoicing_status"]')
		).toHaveValue('Invoiced');
		expect(
			container.querySelector('input[name="cost_to_company"]')
		).toHaveValue(40000);
		expect(
			container.querySelector('input[name="profitability_estimate"]')
		).toHaveValue(20);
		expect(container.querySelector('input[name="budget"]')).toHaveValue(45000);
		expect(
			container.querySelector('textarea[name="subcontractors_vendors"]')
		).toHaveValue('Vendor XYZ');
	});

	it('triggers handleChange on field changes', async () => {
		const user = userEvent.setup();
		const handleChange = vi.fn();
		const { container } = render(
			<CommercialTab form={baseForm} handleChange={handleChange} />
		);

		const budgetInput = container.querySelector('input[name="budget"]')!;
		await user.type(budgetInput, '1000');

		expect(handleChange).toHaveBeenCalled();
	});
});
