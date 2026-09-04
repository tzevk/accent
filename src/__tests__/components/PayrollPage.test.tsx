import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/Navbar', () => ({
	default: () => <nav>Navbar</nav>,
}));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		user: { is_super_admin: 1 },
		can: () => false,
		RESOURCES: { PAYROLL: 'payroll', EMPLOYEES: 'employees' },
		PERMISSIONS: { UPDATE: 'update', READ: 'read' },
	}),
}));

import PayrollPage from '@/components/employees/PayrollPage';

function renderPage() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<PayrollPage />
		</QueryClientProvider>
	);
}

const employees = [
	{
		id: 1,
		employee_id: 'ATS001',
		first_name: 'Alice',
		last_name: 'Payroll',
		email: 'alice@example.com',
		department: 'Finance',
		position: 'Accountant',
		workplace: 'Mumbai',
		hire_date: '2024-01-15T00:00:00.000Z',
		status: 'active',
		employee_type: 'Payroll',
	},
	{
		id: 2,
		employee_id: 'ATS002',
		first_name: 'Bob',
		last_name: 'Payroll',
		email: 'bob@example.com',
		department: 'Finance',
		position: 'Clerk',
		workplace: 'Mumbai',
		hire_date: '2024-02-01T00:00:00.000Z',
		status: 'active',
		employee_type: 'Payroll',
	},
];

const savedProfile = {
	id: 11,
	employee_id: 1,
	salary_type: 'monthly',
	gross_salary: 50000,
	other_allowances: 0,
	pf_applicable: 1,
	esic_applicable: 0,
	pt_applicable: 1,
	mlwf_applicable: 0,
	retention_applicable: 0,
	bonus_applicable: 0,
	monthly_bonus: 0,
	incentive_applicable: 0,
	insurance_applicable: 0,
	effective_from: '2026-01-01T00:00:00.000Z',
	effective_to: null,
	std_in_time: '09:00:00',
	std_out_time: '17:30:00',
	std_working_days: 26,
	std_hours_per_day: 8,
	pl_total: 21,
	pl_used: 2,
	pl_balance: 19,
	loan_active: 1,
	loan_amount_per_month: 1000,
	loan_no_of_months: 10,
	loan_total_amount: 10000,
	advance_active: 0,
	advance_amount: 0,
	is_manual_override: 0,
	basic: null,
	da: null,
	hra: null,
	pf_employee: null,
	net_pay: 42750,
	total_earnings: 50000,
	total_deductions: 7250,
	employer_cost: 56000,
	lumpsum_description: null,
};

function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

let confirmMock: (prompt?: string) => boolean;

describe('PayrollPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		confirmMock = vi.fn(() => true);
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('confirm', confirmMock);
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
		window.URL.createObjectURL = vi.fn(() => 'blob:mock');
		window.URL.revokeObjectURL = vi.fn();
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/employees/list')) {
					return response({
						success: true,
						employees,
						departments: ['Finance'],
						workplaces: ['Mumbai'],
						pagination: { total: 1, totalRecords: 2, limit: 100 },
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
						data: employeeId === '1' ? [savedProfile] : [],
					});
				}
				if (url === '/api/payroll/salary-profile' && init?.method === 'POST') {
					return response({ success: true, data: savedProfile });
				}
				if (url.startsWith('/api/payroll/schedules/current')) {
					return response({ success: true, data: {} });
				}
				if (url.startsWith('/api/attendance/summary')) {
					return response({
						success: true,
						data: [{ total_privilege_leave: 2 }],
						dayDetails: [],
					});
				}
				if (url.startsWith('/api/employees?id=') && init?.method === 'PUT') {
					return response({ success: true, data: employees[0] });
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);
	});

	it('lists only Payroll employees with payroll actions and no add/contract controls', async () => {
		renderPage();

		expect(
			await screen.findByRole('heading', { name: 'Payroll Employees' })
		).toBeVisible();
		expect(await screen.findByText('Alice Payroll')).toBeVisible();
		expect(await screen.findByText('Bob Payroll')).toBeVisible();

		await waitFor(() => {
			const listCalls = fetchMock.mock.calls.filter(([url]) =>
				String(url).startsWith('/api/employees/list')
			);
			expect(listCalls.length).toBeGreaterThan(0);
			expect(
				listCalls.every(([url]) =>
					String(url).includes('employee_type=Payroll')
				)
			).toBe(true);
		});

		expect(
			screen.getByRole('button', { name: 'Generate Payroll' })
		).toBeVisible();
		expect(
			screen.getByRole('button', { name: 'Salary Slip (PDF)' })
		).toBeVisible();
		expect(
			screen.getByRole('button', { name: 'Salary Sheet (Excel)' })
		).toBeVisible();
		expect(screen.queryByText('Add Employee')).not.toBeInTheDocument();

		// Open the editor: contract pay controls and unrelated employee-hub
		// actions stay off the Payroll page.
		fireEvent.click(screen.getByRole('button', { name: /Edit Alice Payroll/ }));
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Work Details' }));
		await waitFor(() => {
			expect(screen.getByText('Employee Type')).toBeVisible();
		});
	});

	it('shows inline salary information from the persisted normalized profile', async () => {
		renderPage();
		await screen.findByText('Alice Payroll');

		fireEvent.click(
			screen.getByRole('button', { name: /View salary profile for Alice/ })
		);

		const panel = await screen.findByTestId('inline-salary-1');
		expect(within(panel).getByText('₹42,750.00')).toBeVisible(); // persisted net pay
		expect(within(panel).getByText('₹50,000.00')).toBeVisible(); // persisted earnings
		expect(within(panel).getAllByText('₹56,000.00').length).toBeGreaterThan(0); // persisted CTC (tile + employer column)
		expect(within(panel).getAllByText('₹1,000.00').length).toBeGreaterThan(0); // loan EMI
		expect(
			within(panel).getByText('Total Employer Contributions')
		).toBeVisible();
		expect(within(panel).getByText(/Effective:/)).toBeVisible();
		expect(within(panel).getByText(/Privilege Leave:/)).toBeVisible();
		// Bob has no profile: the panel offers the editor instead.
		fireEvent.click(
			screen.getByRole('button', { name: /View salary profile for Bob/ })
		);
		expect(
			await screen.findByText('No salary profile found for this employee.')
		).toBeVisible();
	});

	it('generates monthly payroll and reports skipped duplicates', async () => {
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/employees/list')) {
					return response({
						success: true,
						employees,
						departments: ['Finance'],
						workplaces: ['Mumbai'],
						pagination: { total: 1, totalRecords: 2, limit: 100 },
					});
				}
				if (url === '/api/payroll/generate' && init?.method === 'POST') {
					return response({
						success: true,
						results: { generated: 3, skipped: 1 },
					});
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);

		renderPage();
		fireEvent.click(
			await screen.findByRole('button', { name: 'Generate Payroll' })
		);

		await waitFor(() => {
			expect(screen.getByText(/3 slips created, 1 skipped/)).toBeVisible();
		});
		const generateCall = fetchMock.mock.calls.find(
			([url]) => String(url) === '/api/payroll/generate'
		);
		expect(JSON.parse(String(generateCall?.[1]?.body))).toEqual({
			month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
			all: true,
			salary_type: 'payroll',
		});
	});

	it('exports salary slips as PDF and salary sheet as Excel', async () => {
		const pdfBlob = { size: 10 } as Blob;
		const excelBlob = { size: 12 } as Blob;
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/employees/list')) {
				return response({
					success: true,
					employees,
					departments: ['Finance'],
					workplaces: ['Mumbai'],
					pagination: { total: 1, totalRecords: 2, limit: 100 },
				});
			}
			if (url.startsWith('/api/payroll/bulk-pdf')) {
				expect(url).toContain('salary_type=payroll');
				return Promise.resolve({
					ok: true,
					blob: async () => pdfBlob,
				});
			}
			if (url.startsWith('/api/payroll/export-sheet')) {
				expect(url).toContain('salary_type=payroll');
				return Promise.resolve({
					ok: true,
					blob: async () => excelBlob,
				});
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});

		renderPage();
		await screen.findByText('Alice Payroll');

		fireEvent.click(screen.getByRole('button', { name: 'Salary Slip (PDF)' }));
		expect(
			await screen.findByText('Salary slips PDF downloaded')
		).toBeVisible();

		fireEvent.click(
			screen.getByRole('button', { name: 'Salary Sheet (Excel)' })
		);
		expect(
			await screen.findByText('Salary sheet Excel downloaded')
		).toBeVisible();
	});

	it('loads the saved Salary Profile and derives the monthly breakdown through the shared boundary', async () => {
		renderPage();
		await screen.findByText('Alice Payroll');

		fireEvent.click(screen.getByRole('button', { name: /Edit Alice Payroll/ }));
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Salary Profile' }));

		// Saved profile loaded into the editor; derived values visible.
		const grossInput = await screen.findByLabelText('Gross Salary *');
		await waitFor(() => expect(grossInput).toHaveValue(50000));
		expect(
			screen.getByText('Derived from the effective payroll schedule')
		).toBeVisible();
		expect(screen.getByText('Basic')).toBeVisible();
		expect(screen.getByText('Total Earnings')).toBeVisible();
		expect(screen.getByText('Net Pay')).toBeVisible();
		// Loan EMI appears in the deduction list because it is active.
		expect(screen.getAllByText('₹1,000.00').length).toBeGreaterThan(0);
	});

	it('persists explicit overrides and resets them to derived values', async () => {
		renderPage();
		await screen.findByText('Alice Payroll');

		fireEvent.click(screen.getByRole('button', { name: /Edit Alice Payroll/ }));
		await screen.findByRole('heading', { name: 'Personal Information' });
		fireEvent.click(screen.getByRole('button', { name: 'Salary Profile' }));
		const grossInput = await screen.findByLabelText('Gross Salary *');
		await waitFor(() => expect(grossInput).toHaveValue(50000));

		fireEvent.click(screen.getByRole('checkbox', { name: 'Enable overrides' }));
		const pfInput = screen.getByLabelText('Employee PF override value');
		fireEvent.change(pfInput, { target: { value: '999' } });
		expect(pfInput).toHaveValue(999);

		// Reset returns the component to its derived value.
		fireEvent.click(
			screen.getByRole('button', {
				name: 'Reset Employee PF to derived value',
			})
		);

		// Override again and save; the payload persists the exception.
		fireEvent.change(pfInput, { target: { value: '888' } });
		fireEvent.click(
			screen.getByRole('button', { name: '+ Add New Salary Profile' })
		);

		await waitFor(() => {
			const saveCall = fetchMock.mock.calls.find(
				([url, init]) =>
					String(url) === '/api/payroll/salary-profile' &&
					init?.method === 'POST'
			);
			expect(saveCall).toBeTruthy();
			const payload = JSON.parse(String(saveCall?.[1]?.body));
			expect(payload.pf_employee).toBe(888);
			expect(payload.is_manual_override).toBe(true);
			expect(payload.basic).toBeNull();
			expect(payload.da).toBeNull();
			expect(payload.net_pay).toBe(
				payload.total_earnings - payload.total_deductions
			);
			expect(payload.employee_id).toBe(1);
		});
		expect(
			await screen.findByText('✓ New salary profile created!')
		).toBeVisible();
	});
});
