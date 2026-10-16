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
];

function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

describe('EmployeeHub', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.pushState({}, '', '/employees');
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation(
			(input: RequestInfo | URL, init?: RequestInit) => {
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
});
