import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ProcurementTab from '@/app/projects/[id]/edit/tabs/ProcurementTab';

const baseForm = {
	procurement_status: '',
	material_delivery_schedule: '',
	vendor_management: '',
};

describe('ProcurementTab', () => {
	it('renders procurement fields correctly', () => {
		const form = {
			procurement_status: 'In Progress',
			material_delivery_schedule: 'Next week delivery details',
			vendor_management: 'Vendor A, B, C contact info',
		};
		const { container } = render(
			<ProcurementTab form={form} handleChange={vi.fn()} />
		);

		expect(
			container.querySelector('select[name="procurement_status"]')
		).toHaveValue('In Progress');
		expect(
			container.querySelector('textarea[name="material_delivery_schedule"]')
		).toHaveValue('Next week delivery details');
		expect(
			container.querySelector('textarea[name="vendor_management"]')
		).toHaveValue('Vendor A, B, C contact info');
	});

	it('triggers handleChange when inputs change', async () => {
		const user = userEvent.setup();
		const handleChange = vi.fn();
		const { container } = render(
			<ProcurementTab form={baseForm} handleChange={handleChange} />
		);

		const select = container.querySelector(
			'select[name="procurement_status"]'
		)!;
		await user.selectOptions(select, 'Completed');

		expect(handleChange).toHaveBeenCalled();
	});
});
