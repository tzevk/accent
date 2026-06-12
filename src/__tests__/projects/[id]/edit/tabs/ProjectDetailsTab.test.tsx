import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ProjectDetailsTab from '@/app/projects/[id]/edit/tabs/ProjectDetailsTab';

const baseForm = {
	project_code: '',
	name: '',
	client_name: '',
	contract_type: '',
	start_date: '',
	end_date: '',
	estimated_manhours: '',
	list_of_deliverables: '',
};

describe('ProjectDetailsTab', () => {
	it('renders project details fields correctly', () => {
		const form = {
			...baseForm,
			project_code: 'PRJ-101',
			name: 'Accent Build',
			client_name: 'Google',
			contract_type: 'EPC',
			start_date: '2026-05-25',
			end_date: '2026-12-31',
		};
		const openSections = {
			basic: true,
			deliverables: true,
		};
		const { container } = render(
			<ProjectDetailsTab
				form={form}
				handleChange={vi.fn()}
				toggleSection={vi.fn()}
				openSections={openSections}
				TYPE_OPTIONS={['ONGOING', 'CONSULTANCY', 'EPC', 'PMC']}
				docMaster={[]}
				newInputDocument=""
				setNewInputDocument={vi.fn()}
				addInputDocument={vi.fn()}
			/>
		);

		expect(container.querySelector('input[name="project_code"]')).toHaveValue(
			'PRJ-101'
		);
		expect(container.querySelector('input[name="name"]')).toHaveValue(
			'Accent Build'
		);
		expect(container.querySelector('input[name="client_name"]')).toHaveValue(
			'Google'
		);
		expect(container.querySelector('select[name="contract_type"]')).toHaveValue(
			'EPC'
		);
	});

	it('triggers handleChange when text is entered', async () => {
		const user = userEvent.setup();
		const handleChange = vi.fn();
		const openSections = { basic: true };
		const { container } = render(
			<ProjectDetailsTab
				form={baseForm}
				handleChange={handleChange}
				toggleSection={vi.fn()}
				openSections={openSections}
				TYPE_OPTIONS={[]}
				docMaster={[]}
				newInputDocument=""
				setNewInputDocument={vi.fn()}
				addInputDocument={vi.fn()}
			/>
		);

		const nameInput = container.querySelector('input[name="name"]')!;
		await user.type(nameInput, 'New Name');

		expect(handleChange).toHaveBeenCalled();
	});
});
