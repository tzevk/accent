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
const rbacMock = vi.hoisted(() => ({
	payrollRead: false,
	superAdmin: false,
	payrollUpdate: false,
	usersRead: false,
}));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		user: { is_super_admin: rbacMock.superAdmin ? 1 : 0 },
		can: (resource: string, permission: string) =>
			(resource === 'payroll' &&
				((permission === 'read' && rbacMock.payrollRead) ||
					(permission === 'update' && rbacMock.payrollUpdate))) ||
			(resource === 'users' && permission === 'read' && rbacMock.usersRead),
		RESOURCES: { PAYROLL: 'payroll', EMPLOYEES: 'employees', USERS: 'users' },
		PERMISSIONS: { UPDATE: 'update', READ: 'read' },
	}),
}));

import EmployeeHub from '@/components/EmployeeHub';

function renderHub(search = '') {
	window.history.pushState({}, '', `/employees${search}`);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<EmployeeHub />
		</QueryClientProvider>
	);
}

function listEmployeeTypes() {
	return fetchMock.mock.calls
		.map(([url]) => String(url))
		.filter((url) => url.startsWith('/api/employees/list'))
		.map((url) =>
			new URL(url, 'http://localhost').searchParams.get('employee_type')
		);
}

/** Open an employee row's action from the list. */
function openEmployee(name: string, mode: 'View' | 'Edit') {
	fireEvent.click(screen.getByRole('button', { name: `${mode} ${name}` }));
}

/** The editor's section rail, which the list never renders. */
function sectionRail() {
	return screen.findByRole('navigation', { name: 'Employee Sections' });
}

const employees = [
	{
		id: 1,
		employee_id: 'ATS001',
		first_name: 'Alice',
		last_name: 'Worker',
		email: 'alice@example.com',
		department: 'Engineering',
		position: 'Developer',
		workplace: 'Mumbai',
		status: 'active',
		employee_type: 'Payroll',
	},
	{
		id: 2,
		employee_id: 'ATS002',
		first_name: 'Bob',
		last_name: 'Builder',
		email: 'bob@example.com',
		department: 'Operations',
		position: 'Manager',
		workplace: 'Malvan',
		status: 'active',
		employee_type: 'Contract',
	},
	{
		id: 3,
		employee_id: 'ATS003',
		first_name: 'Carol',
		last_name: 'Director',
		email: 'carol@example.com',
		department: 'Finance',
		position: 'Director',
		workplace: 'Delhi',
		hire_date: '2023-05-01T00:00:00.000Z',
		status: 'active',
	},
	{
		id: 4,
		employee_id: 'ATS004',
		first_name: 'Dave',
		last_name: 'Payroll',
		email: 'dave@example.com',
		department: 'Engineering',
		position: 'Engineer',
		workplace: 'Mumbai',
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

let aliceAccount: {
	linked_user_id: number | null;
	linked_username: string | null;
	linked_user_status: 'active' | 'inactive' | null;
} | null = null;
function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

describe('EmployeeHub', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		aliceAccount = null;
		rbacMock.payrollRead = false;
		rbacMock.superAdmin = false;
		rbacMock.payrollUpdate = false;
		rbacMock.usersRead = false;
		vi.stubGlobal('fetch', fetchMock);
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
		window.URL.createObjectURL = vi.fn(() => 'blob:mock');
		window.URL.revokeObjectURL = vi.fn();
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/employees/list')) {
					const account = aliceAccount;
					const result = account
						? employees.map((employee) =>
								employee.id === 1 ? { ...employee, ...account } : employee
							)
						: employees;
					return response({
						success: true,
						employees: result,
						departments: ['Engineering', 'Operations'],
						workplaces: ['Mumbai', 'Malvan'],
						pagination: { total: 1, totalRecords: 2, limit: 100 },
					});
				}
				if (url.startsWith('/api/roles-master')) {
					return response({
						success: true,
						data: [{ id: 4, role_name: 'Manager' }],
					});
				}
				if (url.startsWith('/api/users')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/companies')) {
					return response({ success: true, data: [] });
				}
				if (url.startsWith('/api/attendance/summary')) {
					const employeeId = new URL(url, 'http://localhost').searchParams.get(
						'employee_id'
					);
					return response({
						success: true,
						data: [{ total_present: employeeId === '1' ? 5 : 1 }],
						dayDetails: [],
					});
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
				if (url.startsWith('/api/payroll/salary-profile')) {
					return response({ success: true, data: savedProfile });
				}
				if (url.startsWith('/api/payroll/schedules/current')) {
					return response({ success: true, data: {} });
				}
				if (url.startsWith('/api/employees/salary-structure/export')) {
					return Promise.resolve({
						ok: true,
						blob: async () => ({ size: 12 }) as Blob,
					});
				}
				if (url === '/api/uploads' && init?.method === 'POST') {
					return response({
						success: true,
						data: { fileUrl: '/uploads/avatar.png' },
					});
				}
				if (url === '/api/employees' && init?.method === 'POST') {
					return response({ success: true, data: { id: 3, ...employees[0] } });
				}

				if (url.startsWith('/api/employees?id=') && init?.method === 'PUT') {
					const employeeId = new URL(url, 'http://localhost').searchParams.get(
						'id'
					);
					const employee = employees.find(
						(item) => String(item.id) === employeeId
					);
					return response({ success: true, data: employee });
				}
				return Promise.reject(new Error(`Unexpected request: ${url}`));
			}
		);
	});

	it('shows the all-employee hub without payroll controls or requests', async () => {
		renderHub();

		expect(
			await screen.findByRole('heading', { name: 'Employees' })
		).toBeVisible();
		expect(await screen.findByText('Alice Worker')).toBeVisible();
		expect(await screen.findByText('Bob Builder')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Add Employee' })).toBeVisible();
		expect(
			screen.queryByText(/Salary Profile|Payroll Slip|Contract Amount/i)
		).not.toBeInTheDocument();
		await waitFor(() => {
			expect(
				fetchMock.mock.calls.some(([url]) =>
					String(url).includes('/api/payroll/')
				)
			).toBe(false);
			expect(listEmployeeTypes().every((type) => type === null)).toBe(true);
		});
	});

	it('edits representative common fields and saves through the employee API', async () => {
		renderHub();
		await screen.findByText('Alice Worker');
		fireEvent.click(screen.getByRole('button', { name: 'Add Employee' }));

		fireEvent.change(screen.getByLabelText(/First Name/), {
			target: { value: 'Charlie' },
		});
		fireEvent.change(screen.getByLabelText(/Last Name/), {
			target: { value: 'Person' },
		});
		fireEvent.change(screen.getByLabelText(/Employee ID/), {
			target: { value: 'ATS003' },
		});
		fireEvent.click(
			screen.getByRole('button', { name: 'Contact Information' })
		);
		fireEvent.change(screen.getByLabelText(/^Email/), {
			target: { value: 'charlie@example.com' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save Employee' }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/employees',
				expect.objectContaining({ method: 'POST' })
			);
		});
		const [, request] = fetchMock.mock.calls.find(
			([url, init]) =>
				String(url) === '/api/employees' && init?.method === 'POST'
		) as [string, RequestInit];
		const payload = JSON.parse(String(request.body));
		expect(payload).toMatchObject({
			first_name: 'Charlie',
			email: 'charlie@example.com',
		});
	});

	it('shows validation errors before submitting an incomplete employee', async () => {
		renderHub();
		await screen.findByText('Alice Worker');
		fireEvent.click(screen.getByRole('button', { name: 'Add Employee' }));
		fireEvent.submit(
			screen.getByRole('button', { name: 'Save Employee' }).closest('form')!
		);
		const error = await screen.findByRole('alert');
		expect(error).toHaveTextContent(
			'Please fill in required fields: Employee ID, First Name, Last Name, Email'
		);
		expect(
			fetchMock.mock.calls.some(
				([url, init]) =>
					String(url) === '/api/employees' && init?.method === 'POST'
			)
		).toBe(false);
	});
	it('uploads a profile photo through the common media field', async () => {
		renderHub();
		await screen.findByText('Alice Worker');
		fireEvent.click(screen.getByRole('button', { name: 'Add Employee' }));
		const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
		fireEvent.change(screen.getByLabelText('Profile Photo'), {
			target: { files: [file] },
		});

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/uploads',
				expect.objectContaining({ method: 'POST' })
			);
		});
		expect(await screen.findByAltText('Employee profile')).toBeVisible();
	});

	it('resets employee form and attendance state when selection changes', async () => {
		renderHub();
		await screen.findByText('Alice Worker');
		fireEvent.click(screen.getByRole('button', { name: 'Edit Alice Worker' }));
		fireEvent.click(screen.getByRole('button', { name: 'Attendance & Exit' }));
		await waitFor(() => {
			expect(screen.getByText('5')).toBeVisible();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Select Bob Builder' }));
		expect(screen.getByLabelText(/First Name/)).toHaveValue('Bob');
		expect(screen.queryByText('5')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Attendance & Exit' }));
		await waitFor(() => {
			expect(screen.getByText('1')).toBeVisible();
		});
	});

	it('seeds the Employee Type filter from ?type=Payroll and lists that type', async () => {
		renderHub('?type=Payroll');

		await screen.findByText('Alice Worker');
		await waitFor(() => {
			expect(listEmployeeTypes()).toContain('Payroll');
		});
		expect(screen.getByLabelText('Employee Type filter')).toHaveValue(
			'Payroll'
		);
		expect(window.location.search).toBe('?type=Payroll');
	});

	it('seeds the Employee Type filter from ?type=Contract and lists that type', async () => {
		renderHub('?type=Contract');

		await screen.findByText('Alice Worker');
		await waitFor(() => {
			expect(listEmployeeTypes()).toContain('Contract');
		});
		expect(screen.getByLabelText('Employee Type filter')).toHaveValue(
			'Contract'
		);
	});

	it('lists all employee types when ?type= is unknown', async () => {
		renderHub('?type=Deputation');

		await screen.findByText('Alice Worker');
		await waitFor(() => {
			expect(listEmployeeTypes().length).toBeGreaterThan(0);
		});
		expect(listEmployeeTypes().every((type) => type === null)).toBe(true);
		expect(screen.getByLabelText('Employee Type filter')).toHaveValue('');
	});

	it('changes the list query without rewriting the URL when the filter changes', async () => {
		renderHub('?type=Payroll');

		await screen.findByText('Alice Worker');
		fireEvent.change(screen.getByLabelText('Employee Type filter'), {
			target: { value: 'Contract' },
		});

		await waitFor(() => {
			expect(listEmployeeTypes()).toContain('Contract');
		});
		expect(screen.getByLabelText('Employee Type filter')).toHaveValue(
			'Contract'
		);
		expect(window.location.search).toBe('?type=Payroll');

		fireEvent.change(screen.getByLabelText('Employee Type filter'), {
			target: { value: '' },
		});
		await waitFor(() => {
			expect(listEmployeeTypes()).toContain(null);
		});
		expect(window.location.search).toBe('?type=Payroll');
	});

	it('renders the Employee Type column for every row', async () => {
		renderHub();

		await screen.findByText('Alice Worker');
		expect(
			screen.getByRole('columnheader', { name: 'Employee Type' })
		).toBeVisible();
		expect(
			within(screen.getByRole('row', { name: /Alice Worker/ })).getByText(
				'Payroll'
			)
		).toBeVisible();
		expect(
			within(screen.getByRole('row', { name: /Bob Builder/ })).getByText(
				'Contract'
			)
		).toBeVisible();
		expect(
			within(screen.getByRole('row', { name: /Carol Director/ })).getByText('—')
		).toBeVisible();
	});

	it('keeps the Employee Type select authoritative in the editor', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		fireEvent.click(screen.getByRole('button', { name: 'Edit Alice Worker' }));
		// The directory grouping that decides which pay tab an employee
		// offers stays editable master data on the one hub.
		expect(await screen.findByLabelText('Employee Type')).toHaveValue(
			'Payroll'
		);
	});

	it('names the active Employee Type filter in the empty state', async () => {
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/employees/list')) {
				return response({
					success: true,
					employees: [],
					departments: [],
					workplaces: [],
					pagination: { total: 0, totalRecords: 0, limit: 100 },
				});
			}
			return response({ success: true, data: [] });
		});

		const allTypes = renderHub();
		expect(await screen.findByText('No employees yet')).toBeVisible();
		allTypes.unmount();

		const payroll = renderHub('?type=Payroll');
		expect(await screen.findByText('No Payroll employees yet')).toBeVisible();
		payroll.unmount();

		renderHub('?type=Contract');
		expect(await screen.findByText('No Contract employees yet')).toBeVisible();
	});

	it('hides every pay affordance from a session without payroll:read', async () => {
		renderHub();
		await screen.findByText('Alice Worker');

		expect(
			screen.queryByRole('button', { name: 'Salary Structure (All Users)' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {
				name: /View salary profile for Alice Worker/,
			})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {
				name: /View salary profile for Bob Builder/,
			})
		).not.toBeInTheDocument();

		openEmployee('Alice Worker', 'Edit');
		const nav = await sectionRail();
		expect(
			within(nav).queryByRole('button', { name: 'Salary Profile' })
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Select Bob Builder' }));
		expect(
			within(nav).queryByRole('button', { name: 'Contract Pay' })
		).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', { name: 'Select Carol Director' })
		);
		expect(
			within(nav).queryByRole('button', { name: 'Salary Profile' })
		).not.toBeInTheDocument();
		expect(
			within(nav).queryByRole('button', { name: 'Contract Pay' })
		).not.toBeInTheDocument();

		await waitFor(() => {
			expect(
				fetchMock.mock.calls.some(([url]) =>
					String(url).includes('/api/payroll/salary-profile')
				)
			).toBe(false);
		});
	});

	it('exports the all-users salary structure for payroll:read holders', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		fireEvent.click(
			screen.getByRole('button', { name: 'Salary Structure (All Users)' })
		);
		expect(
			await screen.findByText('All-users salary structure Excel downloaded')
		).toBeVisible();

		const exportCalls = fetchMock.mock.calls.filter(([url]) =>
			String(url).startsWith('/api/employees/salary-structure/export')
		);
		expect(exportCalls.length).toBe(1);
		expect(
			screen.getByRole('button', { name: 'Salary Structure (All Users)' })
		).toBeEnabled();
	});

	it('reports all-users salary structure export failures', async () => {
		rbacMock.payrollRead = true;
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('/api/employees/list')) {
				return response({
					success: true,
					employees,
					departments: ['Engineering', 'Operations'],
					workplaces: ['Mumbai', 'Malvan'],
					pagination: { total: 1, totalRecords: 2, limit: 100 },
				});
			}
			if (url.startsWith('/api/employees/salary-structure/export')) {
				return response({ error: 'Export failed: rate limited' }, false);
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});

		renderHub();
		await screen.findByText('Alice Worker');
		fireEvent.click(
			screen.getByRole('button', { name: 'Salary Structure (All Users)' })
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Export failed: rate limited'
		);
		expect(
			screen.getByRole('button', { name: 'Salary Structure (All Users)' })
		).toBeEnabled();
	});
	it('exposes the full text of every truncating column', async () => {
		renderHub();
		await screen.findByText('Alice Worker');

		const row = screen.getByText('ATS001').closest('tr');
		expect(row).not.toBeNull();
		const cells = within(row as HTMLElement).getAllByRole('cell');
		expect(cells[0]).toHaveAttribute('title', 'ATS001');
		expect(within(cells[1]).getByText('Alice Worker')).toHaveAttribute(
			'title',
			'Alice Worker'
		);
		expect(within(cells[1]).getByText('alice@example.com')).toHaveAttribute(
			'title',
			'alice@example.com'
		);
		expect(cells[2]).toHaveAttribute('title', 'Engineering');
		expect(cells[4]).toHaveAttribute('title', 'Developer');
		expect(cells[5]).toHaveAttribute('title', 'Mumbai');
	});

	it('expands a Payroll row to the persisted salary figures with payroll:read', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		// The expand control renders on Payroll rows only.
		expect(
			screen.queryByRole('button', {
				name: /View salary profile for Bob Builder/,
			})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {
				name: /View salary profile for Carol Director/,
			})
		).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {
				name: /View salary profile for Alice Worker/,
			})
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

		const profileCalls = fetchMock.mock.calls.filter(([url]) =>
			String(url).startsWith('/api/payroll/salary-profile?employee_id=')
		);
		expect(profileCalls.length).toBe(1);
		expect(String(profileCalls[0][0])).toContain('employee_id=1');

		// One row expands at a time; a Payroll row without a profile offers the editor.
		fireEvent.click(
			screen.getByRole('button', {
				name: /View salary profile for Dave Payroll/,
			})
		);
		expect(
			await screen.findByText('No salary profile found for this employee.')
		).toBeVisible();
		expect(screen.queryByTestId('inline-salary-1')).not.toBeInTheDocument();
	});

	it('offers the Salary Profile tab in edit mode only for a Payroll employee', async () => {
		rbacMock.payrollRead = true;
		rbacMock.superAdmin = true;
		renderHub();
		await screen.findByText('Alice Worker');

		openEmployee('Alice Worker', 'View');
		const viewNav = await sectionRail();
		expect(
			within(viewNav).queryByRole('button', { name: 'Salary Profile' })
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		const nav = await sectionRail();
		expect(
			within(nav).getByRole('button', { name: 'Salary Profile' })
		).toBeVisible();
	});

	it('offers the Contract Pay tab in edit mode only for a Contract employee', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Bob Builder');

		openEmployee('Bob Builder', 'View');
		const viewNav = await sectionRail();
		expect(
			within(viewNav).queryByRole('button', { name: 'Contract Pay' })
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		const nav = await sectionRail();
		expect(
			within(nav).queryByRole('button', { name: 'Salary Profile' })
		).not.toBeInTheDocument();
		expect(
			within(nav).getByRole('button', { name: 'Contract Pay' })
		).toBeVisible();
	});

	it('offers no pay tab when editing an employee with no pay Employee Type', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Carol Director');

		openEmployee('Carol Director', 'Edit');
		const nav = await sectionRail();
		expect(
			within(nav).queryByRole('button', { name: 'Salary Profile' })
		).not.toBeInTheDocument();
		expect(
			within(nav).queryByRole('button', { name: 'Contract Pay' })
		).not.toBeInTheDocument();
	});

	it('renders no payroll run actions even with payroll:read', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		expect(
			screen.queryByRole('button', { name: 'Generate Payroll' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Salary Slip (PDF)' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Salary Sheet (Excel)' })
		).not.toBeInTheDocument();

		const runCalls = fetchMock.mock.calls.filter(([url]) =>
			/^\/api\/payroll\/(generate|bulk-pdf|export-sheet)/.test(String(url))
		);
		expect(runCalls).toEqual([]);
	});

	it("opens the Salary Profile tab from the panel's edit link", async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		fireEvent.click(
			screen.getByRole('button', { name: /View salary profile for Alice/ })
		);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Edit Salary Profile →' })
		);

		// The salary agreement form is the active section, not Personal
		// Information: its fields render without another click.
		expect(await screen.findByLabelText('Gross Salary *')).toBeVisible();
	});

	it('opens the row edit on the first section, not the pay tab', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		openEmployee('Alice Worker', 'Edit');
		await sectionRail();
		// The tab exists in the rail, but the editor still starts on the
		// employee's own fields.
		expect(
			await screen.findByRole('heading', { name: 'Personal Information' })
		).toBeVisible();
		expect(screen.queryByLabelText('Gross Salary *')).not.toBeInTheDocument();
	});

	it('opens the first section when view switches to edit', async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		openEmployee('Alice Worker', 'View');
		fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

		expect(
			await screen.findByRole('heading', { name: 'Personal Information' })
		).toBeVisible();
		expect(screen.queryByLabelText('Gross Salary *')).not.toBeInTheDocument();
	});

	it('shows linked account state from employee data and navigates to its account without loading users separately', async () => {
		aliceAccount = {
			linked_user_id: 91,
			linked_username: 'alice.login',
			linked_user_status: 'inactive',
		};
		rbacMock.usersRead = true;
		renderHub();
		await screen.findByText('Alice Worker');
		openEmployee('Alice Worker', 'View');
		expect(
			await screen.findByText(/alice\.login.*Inactive access/i)
		).toBeVisible();
		expect(
			screen.getByRole('link', { name: 'Manage User Account' })
		).toHaveAttribute('href', '/masters/users?account=91');
		expect(
			fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/users'))
		).toBe(false);
	});
	it('shows linked account metadata without a management link when users:read is absent', async () => {
		aliceAccount = {
			linked_user_id: 91,
			linked_username: 'alice.login',
			linked_user_status: 'inactive',
		};
		renderHub();
		await screen.findByText('Alice Worker');
		openEmployee('Alice Worker', 'View');

		expect(
			await screen.findByText(/alice\.login.*Inactive access/i)
		).toBeVisible();
		expect(
			screen.queryByRole('link', { name: 'Manage User Account' })
		).not.toBeInTheDocument();
	});
});
