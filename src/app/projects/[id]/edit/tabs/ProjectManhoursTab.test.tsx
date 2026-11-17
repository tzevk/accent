import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProjectManhoursTab from '@/app/projects/[id]/edit/tabs/ProjectManhoursTab';

interface ManhourRow {
	id: number;
	employee_id: string;
	employee_name: string;
	salary_type: string;
	rate_employee: string | number;
	rate_client: string | number;
	monthly_hours: Record<string, string | number>;
	source_employee_id?: string;
}

interface EmployeeWithRate {
	id: number;
	name: string;
	employee_id: string;
	email: string;
	department: string;
	workplace: string;
	rate: string | number;
	salary_type: string;
}

const EMPLOYEES: EmployeeWithRate[] = [
	{
		id: 901,
		name: 'Zero CTC',
		employee_id: 'E901',
		email: 'zero@example.com',
		department: 'Engineering',
		workplace: 'Office',
		rate: 0,
		salary_type: 'monthly',
	},
	{
		id: 902,
		name: 'Priced CTC',
		employee_id: 'E902',
		email: 'priced@example.com',
		department: 'Engineering',
		workplace: 'Office',
		rate: 100,
		salary_type: 'monthly',
	},
	{
		id: 903,
		name: 'Unavailable CTC',
		employee_id: 'E903',
		email: 'unavailable@example.com',
		department: 'Engineering',
		workplace: 'Office',
		rate: '',
		salary_type: 'monthly',
	},
];

const TEAM = [
	{ id: 1, employee_id: 901, name: 'Zero CTC' },
	{ id: 2, employee_id: 902, name: 'Priced CTC' },
	{ id: 3, employee_id: 903, name: 'Unavailable CTC' },
];

function manhourRow(
	overrides: Pick<ManhourRow, 'id' | 'employee_name'> & Partial<ManhourRow>
): ManhourRow {
	return {
		employee_id: '',
		salary_type: 'monthly',
		rate_employee: '',
		rate_client: '',
		monthly_hours: {},
		...overrides,
	};
}

function Harness({ initialRows }: { initialRows: ManhourRow[] }) {
	const [rows, setRows] = useState<ManhourRow[]>(initialRows);
	return (
		<ProjectManhoursTab
			projectManhours={rows}
			setProjectManhours={setRows}
			employeesLoading={false}
			employeesWithRates={EMPLOYEES}
			projectTeamMembers={TEAM}
			fetchAttendanceHours={vi.fn(async () => null)}
		/>
	);
}

function rowFor(name: string): HTMLElement {
	const row = screen.getByText(name).closest('tr');
	if (!(row instanceof HTMLElement)) {
		throw new Error(`No table row rendered for ${name}`);
	}
	return row;
}

function employeeRateInput(row: HTMLElement): HTMLInputElement {
	return within(row).getAllByRole('spinbutton')[0] as HTMLInputElement;
}

describe('ProjectManhoursTab salary rate disclosure', () => {
	it('shows an explicit zero rate as zero and unavailable pay as unavailable', () => {
		render(
			<Harness
				initialRows={[
					manhourRow({
						id: 1,
						employee_id: '901',
						employee_name: 'Zero CTC',
						rate_employee: 0,
						rate_client: 150,
						monthly_hours: { apr: '10' },
					}),
					manhourRow({
						id: 2,
						employee_id: '903',
						employee_name: 'Unavailable CTC',
						rate_employee: '',
						rate_client: 150,
						monthly_hours: { apr: '10' },
					}),
				]}
			/>
		);

		const zeroRow = rowFor('Zero CTC');
		expect(employeeRateInput(zeroRow)).toHaveValue(0);
		expect(within(zeroRow).getByText('₹0.00')).toBeInTheDocument();

		const unavailableRow = rowFor('Unavailable CTC');
		expect(employeeRateInput(unavailableRow)).toHaveValue(null);
		expect(within(unavailableRow).getByText('—')).toBeInTheDocument();
		expect(within(unavailableRow).queryByText('₹0.00')).not.toBeInTheDocument();
	});

	it('keeps a resolved zero distinct from missing pay when a team member is selected', async () => {
		const user = userEvent.setup();
		render(
			<Harness
				initialRows={[
					manhourRow({
						id: 1,
						employee_name: '',
						rate_client: 150,
						monthly_hours: { apr: '10' },
					}),
				]}
			/>
		);

		await user.click(screen.getByTitle('Edit row'));
		const row = screen.getByTitle('Done editing').closest('tr');
		if (!(row instanceof HTMLElement)) {
			throw new Error('Editing row was not rendered');
		}
		const select = within(row).getByRole('combobox');

		await user.selectOptions(select, '901');
		await waitFor(() => expect(employeeRateInput(row)).toHaveValue(0));
		expect(within(row).getByText('₹0.00')).toBeInTheDocument();

		await user.selectOptions(select, '903');
		await waitFor(() => expect(employeeRateInput(row)).toHaveValue(null));
		expect(within(row).getByText('—')).toBeInTheDocument();
		expect(within(row).queryByText('₹0.00')).not.toBeInTheDocument();
	});

	it('marks the employee-cost total partial instead of counting unavailable pay as zero', () => {
		render(
			<Harness
				initialRows={[
					manhourRow({
						id: 1,
						employee_id: '901',
						employee_name: 'Zero CTC',
						rate_employee: 0,
						rate_client: 150,
						monthly_hours: { apr: '10' },
					}),
					manhourRow({
						id: 2,
						employee_id: '902',
						employee_name: 'Priced CTC',
						rate_employee: 100,
						rate_client: 150,
						monthly_hours: { apr: '10' },
					}),
					manhourRow({
						id: 3,
						employee_id: '903',
						employee_name: 'Unavailable CTC',
						rate_employee: '',
						rate_client: 150,
						monthly_hours: { apr: '10' },
					}),
				]}
			/>
		);

		const totalRow = rowFor('Grand Total');
		expect(within(totalRow).getByText('₹1,000.00')).toBeInTheDocument();
		expect(within(totalRow).getByText('Partial')).toBeInTheDocument();
		const disclosure = screen.getByText(/1 row has no usable salary rate/);
		expect(disclosure).toHaveTextContent(/Employee Cost is partial/);
		expect(disclosure).toHaveTextContent(/not zero/);
	});

	it('does not call a fully known employee-cost total partial', () => {
		render(
			<Harness
				initialRows={[
					manhourRow({
						id: 1,
						employee_id: '901',
						employee_name: 'Zero CTC',
						rate_employee: 0,
						monthly_hours: { apr: '10' },
					}),
					manhourRow({
						id: 2,
						employee_id: '902',
						employee_name: 'Priced CTC',
						rate_employee: 100,
						monthly_hours: { apr: '10' },
					}),
				]}
			/>
		);

		const totalRow = rowFor('Grand Total');
		expect(within(totalRow).getByText('₹1,000.00')).toBeInTheDocument();
		expect(within(totalRow).queryByText('Partial')).not.toBeInTheDocument();
		expect(
			screen.queryByText(/Employee Cost is partial/)
		).not.toBeInTheDocument();
	});
});
