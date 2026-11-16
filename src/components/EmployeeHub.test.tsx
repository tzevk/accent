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
import { formatDate } from '@/lib/format';

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

/**
 * One resolve payload per Employee: a covering agreement plus the shared
 * state/CTC projection. Tests override only the fields they exercise.
 */
function salaryResolution(
	employeeId: number,
	overrides: Record<string, unknown> = {}
) {
	const name =
		employeeId === 1
			? 'Alice Worker'
			: employeeId === 2
				? 'Bob Builder'
				: 'Carol Director';
	return {
		employee_id: employeeId,
		state: 'selected',
		anchor: '2026-11-16',
		source: 'employee_salary_profile',
		agreement_id: 11,
		conflict_ids: [],
		conflict_source: null,
		salary_type: 'monthly',
		pay_stream: 'payroll',
		effective_from: '2026-01-01',
		effective_to: null,
		classification: 'current',
		ctc: {
			status: 'resolved',
			amount: 56000,
			source: 'employer_cost',
			legacy_fallback: false,
			invalid_reason: null,
		},
		timeline_version: 3,
		used: false,
		use_ambiguous: false,
		use_unknown_history: false,
		use_months: [],
		profile: savedProfile,
		employee: {
			id: employeeId,
			employee_id: `ATS00${employeeId}`,
			full_name: name,
			department: null,
			employee_type: null,
			status: 'active',
			joining_date: null,
			hire_date: null,
			exit_date: null,
		},
		...overrides,
	};
}

let salaryResolutions: Record<string, unknown> = {};

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
		salaryResolutions = {};
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
				if (url.startsWith('/api/payroll/salary-profile/resolve')) {
					const employeeId =
						new URL(url, 'http://localhost').searchParams.get('employee_id') ||
						'';
					const resolution = salaryResolutions[employeeId];
					if (!resolution) {
						return response(
							{ success: false, error: 'Employee not found' },
							false
						);
					}
					return response({
						success: true,
						period: {
							kind: 'date',
							date: '2026-11-16',
							month: null,
							start: '2026-11-16',
							end: '2026-11-16',
						},
						as_of: '2026-11-16',
						data: resolution,
					});
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
				name: /View salary summary for Alice Worker/,
			})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {
				name: /View salary summary for Bob Builder/,
			})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('link', { name: /salary workspace/i })
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

	it('expands every employee row to an authorized salary summary and workspace link', async () => {
		rbacMock.payrollRead = true;
		salaryResolutions = {
			'1': salaryResolution(1),
			'2': salaryResolution(2, {
				salary_type: 'contract',
				pay_stream: 'contract',
				effective_from: '2026-02-01',
				effective_to: '2026-12-31',
			}),
			'3': salaryResolution(3, {
				state: 'unavailable',
				source: null,
				agreement_id: null,
				salary_type: null,
				pay_stream: null,
				effective_from: null,
				effective_to: null,
				classification: null,
				ctc: {
					status: 'missing',
					amount: null,
					source: 'none',
					legacy_fallback: false,
					invalid_reason: null,
				},
				profile: null,
				timeline_version: 0,
			}),
		};
		renderHub();
		await screen.findByText('Alice Worker');

		// Employee Type never decides salary eligibility: a Payroll, a Contract
		// and an untyped employee all offer the authorized summary.
		for (const name of ['Alice Worker', 'Bob Builder', 'Carol Director']) {
			expect(
				screen.getByRole('button', { name: `View salary summary for ${name}` })
			).toBeVisible();
		}

		fireEvent.click(
			screen.getByRole('button', {
				name: 'View salary summary for Alice Worker',
			})
		);
		const panel = await screen.findByTestId('inline-salary-1');
		expect(await within(panel).findByText('₹56,000.00')).toBeVisible();
		expect(within(panel).getByText(/Recorded employer cost/)).toBeVisible();
		expect(within(panel).getByText('monthly')).toBeVisible();
		expect(within(panel).getByText('Payroll')).toBeVisible();
		expect(
			within(panel).getByText(
				new RegExp(`Effective ${formatDate('2026-01-01')}`)
			)
		).toBeVisible();
		expect(
			within(panel).getByRole('link', { name: /Open salary workspace/ })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles/1');
		// A payroll reader gets the summary and history link, not a writer.
		expect(
			within(panel).queryByRole('button', { name: /Edit|Correct|Cancel/ })
		).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Gross Salary *')).not.toBeInTheDocument();

		// The Contract employee reads the Contract stream at the same anchor.
		fireEvent.click(
			screen.getByRole('button', {
				name: 'View salary summary for Bob Builder',
			})
		);
		const contractPanel = await screen.findByTestId('inline-salary-2');
		expect(await within(contractPanel).findByText('contract')).toBeVisible();
		expect(within(contractPanel).getByText('Contract')).toBeVisible();
		expect(
			within(contractPanel).getByText(
				new RegExp(`Effective ${formatDate('2026-02-01')}`)
			)
		).toBeVisible();
		expect(
			within(contractPanel).getByRole('link', { name: /Open salary workspace/ })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles/2');

		// An employee without a covering agreement is explicit, never zero.
		fireEvent.click(
			screen.getByRole('button', {
				name: 'View salary summary for Carol Director',
			})
		);
		const emptyPanel = await screen.findByTestId('inline-salary-3');
		expect(
			await within(emptyPanel).findByText(/No salary agreement covers/)
		).toBeVisible();
		expect(within(emptyPanel).queryByText(/₹/)).not.toBeInTheDocument();
		expect(
			within(emptyPanel).getByRole('link', { name: /Open salary workspace/ })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles/3');
		expect(screen.queryByTestId('inline-salary-1')).not.toBeInTheDocument();

		const resolveCalls = fetchMock.mock.calls
			.map(([url]) => String(url))
			.filter((url) => url.startsWith('/api/payroll/salary-profile/resolve'));
		expect(resolveCalls).toEqual([
			expect.stringContaining('employee_id=1'),
			expect.stringContaining('employee_id=2'),
			expect.stringContaining('employee_id=3'),
		]);
	});

	it('discloses a legacy gross fallback instead of presenting it as an explicit CTC', async () => {
		rbacMock.payrollRead = true;
		salaryResolutions = {
			'1': salaryResolution(1, {
				ctc: {
					status: 'resolved',
					amount: 50000,
					source: 'gross_salary',
					legacy_fallback: true,
					invalid_reason: null,
				},
			}),
		};
		renderHub();
		await screen.findByText('Alice Worker');

		fireEvent.click(
			screen.getByRole('button', {
				name: 'View salary summary for Alice Worker',
			})
		);
		const panel = await screen.findByTestId('inline-salary-1');
		expect(await within(panel).findByText('₹50,000.00')).toBeVisible();
		expect(
			within(panel).getByText(/Legacy gross salary reference/)
		).toBeVisible();
		expect(
			within(panel).queryByText(/Recorded employer cost/)
		).not.toBeInTheDocument();
	});

	it('reports an ambiguous agreement without showing a salary figure', async () => {
		rbacMock.payrollRead = true;
		salaryResolutions = {
			'1': salaryResolution(1, {
				state: 'ambiguous',
				agreement_id: null,
				conflict_ids: [11, 12],
				salary_type: null,
				pay_stream: null,
				effective_from: null,
				effective_to: null,
				classification: null,
				ctc: {
					status: 'missing',
					amount: null,
					source: 'none',
					legacy_fallback: false,
					invalid_reason: null,
				},
				profile: null,
			}),
		};
		renderHub();
		await screen.findByText('Alice Worker');

		fireEvent.click(
			screen.getByRole('button', {
				name: 'View salary summary for Alice Worker',
			})
		);
		const panel = await screen.findByTestId('inline-salary-1');
		expect(
			await within(panel).findByText(/2 conflicting agreements/)
		).toBeVisible();
		expect(within(panel).queryByText(/₹/)).not.toBeInTheDocument();
		expect(
			within(panel).getByRole('link', { name: /Open salary workspace/ })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles/1');
	});

	it('never embeds a salary editor in the employee editor', async () => {
		rbacMock.payrollRead = true;
		rbacMock.payrollUpdate = true;
		rbacMock.superAdmin = true;
		renderHub();
		await screen.findByText('Alice Worker');

		openEmployee('Alice Worker', 'Edit');
		const nav = await sectionRail();
		expect(
			within(nav).queryByRole('button', { name: 'Salary Profile' })
		).not.toBeInTheDocument();
		expect(
			within(nav).queryByRole('button', { name: 'Contract Pay' })
		).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Gross Salary *')).not.toBeInTheDocument();
		expect(
			fetchMock.mock.calls.some(([url]) =>
				String(url).startsWith('/api/payroll/')
			)
		).toBe(false);

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

	it('sends the salary summary to the employee workspace instead of an embedded editor', async () => {
		rbacMock.payrollRead = true;
		salaryResolutions = { '1': salaryResolution(1) };
		renderHub();
		await screen.findByText('Alice Worker');

		fireEvent.click(
			screen.getByRole('button', { name: /View salary summary for Alice/ })
		);
		const panel = await screen.findByTestId('inline-salary-1');
		expect(
			within(panel).getByRole('link', { name: /Open salary workspace/ })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles/1');
		expect(screen.queryByLabelText('Gross Salary *')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /Edit Salary Profile/ })
		).not.toBeInTheDocument();
	});

	it("opens the row edit on the employee's own fields", async () => {
		rbacMock.payrollRead = true;
		renderHub();
		await screen.findByText('Alice Worker');

		openEmployee('Alice Worker', 'Edit');
		await sectionRail();
		// Employee editing is unchanged: no salary surface in the section rail.
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
