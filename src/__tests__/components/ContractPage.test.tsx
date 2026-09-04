import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/Navbar', () => ({
	default: () => <nav>Navbar</nav>,
}));

import ContractPage from '@/components/employees/ContractPage';

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ContractPage />
		</QueryClientProvider>
	);
}

const contractEmployees = [
	{
		id: 3,
		employee_id: 'ATS003',
		first_name: 'Carol',
		last_name: 'Contract',
		email: 'carol@example.com',
		department: 'Operations',
		position: 'Contractor',
		workplace: 'Pune',
		hire_date: '2024-03-10T00:00:00.000Z',
		status: 'active',
		employee_type: 'Contract',
	},
	{
		id: 4,
		employee_id: 'ATS004',
		first_name: 'Dave',
		last_name: 'Contract',
		email: 'dave@example.com',
		department: 'Operations',
		position: 'Contractor',
		workplace: 'Pune',
		hire_date: '2024-05-01T00:00:00.000Z',
		status: 'active',
		employee_type: 'Contract',
	},
	{
		id: 5,
		employee_id: 'ATS005',
		first_name: 'Eve',
		last_name: 'Contract',
		email: 'eve@example.com',
		department: 'Operations',
		position: 'Contractor',
		workplace: 'Pune',
		hire_date: '2024-06-01T00:00:00.000Z',
		status: 'active',
		employee_type: 'Contract',
	},
];
const carolContractProfile = {
	id: 21,
	employee_id: 3,
	salary_type: 'contract',
	contract_amount: 30000,
	contract_duration: 'monthly',
	contract_end_date: '2026-12-31T00:00:00.000Z',
	tds_percentage: null,
	gross_salary: 30000,
	net_pay: 27000,
	employer_cost: 30000,
	effective_from: '2026-01-01T00:00:00.000Z',
	effective_to: null,
	std_in_time: '09:00:00',
	std_out_time: '17:30:00',
	std_working_days: 26,
	pl_total: 0,
	pl_used: 0,
	pl_balance: 0,
	loan_amount: 0,
	loan_amount_per_month: 0,
	loan_no_of_months: 0,
	loan_total_amount: 0,
	loan_active: 0,
	advance_amount: 0,
	advance_active: 0,
	is_manual_override: 0,
	lumpsum_description: null,
};

const eveContractProfile = {
	...carolContractProfile,
	id: 22,
	employee_id: 5,
	contract_amount: 20000,
	contract_duration: 'quarterly',
	contract_end_date: '2026-09-30T00:00:00.000Z',
	tds_percentage: 5,
	net_pay: 19000,
	effective_from: '2026-02-01T00:00:00.000Z',
};

const davePayrollProfile = {
	id: 23,
	employee_id: 4,
	salary_type: 'monthly',
	gross_salary: 45000,
	net_pay: 38000,
	effective_from: '2025-01-01T00:00:00.000Z',
	effective_to: null,
	is_manual_override: 0,
	lumpsum_description: null,
};

function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

describe('ContractPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', fetchMock);
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/employees/list')) {
					return response({
						success: true,
						employees: contractEmployees,
						departments: ['Operations'],
						workplaces: ['Pune'],
						pagination: { total: 1, totalRecords: 3, limit: 100 },
					});
				}
				if (url.startsWith('/api/roles-master')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/users')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/companies')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/payroll/salary-profile?employee_id=')) {
					const employeeId = new URL(url, 'http://localhost').searchParams.get(
						'employee_id'
					);
					return response({
						success: true,
						data:
							employeeId === '3'
								? [carolContractProfile]
								: employeeId === '5'
									? [eveContractProfile]
									: employeeId === '4'
										? [davePayrollProfile]
										: [],
					});
				}
				if (url.startsWith('/api/employees?id=') && init?.method === 'PUT') {
					const employeeId = Number(
						new URL(url, 'http://localhost').searchParams.get('id')
					);
					return response({
						success: true,
						data:
							contractEmployees.find(
								(employee) => employee.id === employeeId
							) || contractEmployees[0],
					});
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);
	});

	it('lists only Contract employees with no payroll or hub actions', async () => {
		renderPage();

		expect(
			await screen.findByRole('heading', { name: 'Contract Employees' })
		).toBeVisible();
		expect(await screen.findByText('Carol Contract')).toBeVisible();
		expect(await screen.findByText('Eve Contract')).toBeVisible();

		await waitFor(() => {
			const listCalls = fetchMock.mock.calls.filter(([url]) =>
				String(url).startsWith('/api/employees/list')
			);
			expect(listCalls.length).toBeGreaterThan(0);
			expect(
				listCalls.every(([url]) =>
					String(url).includes('employee_type=Contract')
				)
			).toBe(true);
		});

		expect(
			screen.queryByRole('button', { name: 'Generate Payroll' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Salary Slip (PDF)' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Salary Sheet (Excel)' })
		).not.toBeInTheDocument();
		expect(screen.queryByText('Add Employee')).not.toBeInTheDocument();
	});
	it('loads the saved contract agreement with its stored TDS rate', async () => {
		renderPage();
		await screen.findByText('Carol Contract');

		fireEvent.click(screen.getByRole('button', { name: /Edit Eve Contract/ }));
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Contract Pay' }));

		const amountInput = await screen.findByLabelText('Amount (₹) *');
		await waitFor(() => expect(amountInput).toHaveValue(20000));
		expect(screen.getByLabelText('Duration')).toHaveValue('quarterly');
		expect(screen.getByLabelText('End Date')).toHaveValue('2026-09-30');
		expect(screen.getByText(/TDS @ 5% = ₹1,000/)).toBeVisible();
		expect(screen.getByText(/In-Hand CTC: ₹19,000/)).toBeVisible();

		// Payroll-only Salary Profile controls stay off the Contract page.
		expect(screen.queryByLabelText('Gross Salary *')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('checkbox', { name: 'Enable overrides' })
		).not.toBeInTheDocument();
		expect(screen.queryByText('Basic')).not.toBeInTheDocument();
	});

	it('falls back to 10% TDS and persists the edited contract agreement', async () => {
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/employees/list')) {
					return response({
						success: true,
						employees: contractEmployees,
						departments: ['Operations'],
						workplaces: ['Pune'],
						pagination: { total: 1, totalRecords: 3, limit: 100 },
					});
				}
				if (url.startsWith('/api/roles-master')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/users')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/companies')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/attendance/summary')) {
					return response({
						success: true,
						data: [{ total_privilege_leave: 2 }],
						dayDetails: [],
					});
				}
				if (url.startsWith('/api/payroll/salary-profile?employee_id=')) {
					const employeeId = new URL(url, 'http://localhost').searchParams.get(
						'employee_id'
					);
					return response({
						success: true,
						data: employeeId === '3' ? [carolContractProfile] : [],
					});
				}
				if (url === '/api/payroll/salary-profile' && init?.method === 'POST') {
					return response({ success: true, data: { id: 24 } });
				}
				if (url.startsWith('/api/employees?id=') && init?.method === 'PUT') {
					const employeeId = Number(
						new URL(url, 'http://localhost').searchParams.get('id')
					);
					return response({
						success: true,
						data:
							contractEmployees.find(
								(employee) => employee.id === employeeId
							) || contractEmployees[0],
					});
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);

		renderPage();
		await screen.findByText('Carol Contract');

		fireEvent.click(
			screen.getByRole('button', { name: /Edit Carol Contract/ })
		);
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Contract Pay' }));

		const amountInput = await screen.findByLabelText('Amount (₹) *');
		await waitFor(() => expect(amountInput).toHaveValue(30000));
		// No explicit rate stored: the documented Contract fallback applies.
		expect(screen.getByText(/TDS @ 10% = ₹3,000/)).toBeVisible();
		expect(screen.getByText(/In-Hand CTC: ₹27,000/)).toBeVisible();

		// Representative pay edit: new amount and duration persist as contract.
		fireEvent.change(amountInput, { target: { value: '40000' } });
		fireEvent.change(screen.getByLabelText('Duration'), {
			target: { value: 'yearly' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Update' }));

		await waitFor(() => {
			const saveCall = fetchMock.mock.calls.find(
				([url, init]) =>
					String(url) === '/api/payroll/salary-profile' &&
					init?.method === 'POST'
			);
			expect(saveCall).toBeTruthy();
			expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
				id: 21,
				employee_id: 3,
				salary_type: 'contract',
				contract_amount: 40000,
				contract_duration: 'yearly',
				contract_end_date: '2026-12-31',
				tds_percentage: 10,
				gross_salary: 40000,
				net_pay: 36000,
				employer_cost: 40000,
				// PL usage is synced from attendance before the save, as before.
				pl_used: 2,
			});
		});
		expect(await screen.findByText('✓ Salary profile updated!')).toBeVisible();
	});

	it('shows non-contract agreements read-only and resets contract state between employees', async () => {
		renderPage();
		await screen.findByText('Carol Contract');

		// Load Carol's agreement, then switch employees: no value leak.
		fireEvent.click(
			screen.getByRole('button', { name: /Edit Carol Contract/ })
		);
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Contract Pay' }));
		await waitFor(() =>
			expect(screen.getByLabelText('Amount (₹) *')).toHaveValue(30000)
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Select Dave Contract' })
		);
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Contract Pay' }));
		const amountInput = await screen.findByLabelText('Amount (₹) *');
		expect((amountInput as HTMLInputElement).value).toBe('');
		expect(screen.getByLabelText('Duration')).toHaveValue('monthly');

		// Dave's Payroll agreement is displayed as stored, without payroll
		// editing controls on the Contract page.
		expect(await screen.findByText('Payroll (Monthly)')).toBeVisible();
		expect(
			await screen.findByText(
				'Payroll Salary Profile — managed on the Payroll route'
			)
		).toBeVisible();
		expect(await screen.findByText('₹45,000.00')).toBeVisible();
		expect(
			screen.queryByRole('button', { name: 'Edit' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Delete' })
		).not.toBeInTheDocument();
	});

	it('surfaces save failures scoped to the contract workflow', async () => {
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/employees/list')) {
					return response({
						success: true,
						employees: contractEmployees,
						departments: ['Operations'],
						workplaces: ['Pune'],
						pagination: { total: 1, totalRecords: 3, limit: 100 },
					});
				}
				if (url.startsWith('/api/roles-master')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/users')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/companies')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/payroll/salary-profile?employee_id=')) {
					const employeeId = new URL(url, 'http://localhost').searchParams.get(
						'employee_id'
					);
					return response({
						success: true,
						data: employeeId === '3' ? [carolContractProfile] : [],
					});
				}
				if (url === '/api/payroll/salary-profile' && init?.method === 'POST') {
					return response(
						{ success: false, error: 'Duplicate effective date' },
						false
					);
				}
				if (url.startsWith('/api/employees?id=') && init?.method === 'PUT') {
					const employeeId = Number(
						new URL(url, 'http://localhost').searchParams.get('id')
					);
					return response({
						success: true,
						data:
							contractEmployees.find(
								(employee) => employee.id === employeeId
							) || contractEmployees[0],
					});
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);

		renderPage();
		await screen.findByText('Carol Contract');

		fireEvent.click(
			screen.getByRole('button', { name: /Edit Carol Contract/ })
		);
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Contract Pay' }));
		await waitFor(() =>
			expect(screen.getByLabelText('Amount (₹) *')).toHaveValue(30000)
		);

		fireEvent.click(screen.getByRole('button', { name: 'Update' }));

		expect(
			await screen.findByText(/Failed to save: Duplicate effective date/)
		).toBeVisible();
		expect(
			screen.queryByText('✓ Salary profile updated!')
		).not.toBeInTheDocument();
	});
});
