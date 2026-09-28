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

import EmployeeHub from '@/components/EmployeeHub';

function renderHub() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<EmployeeHub />
		</QueryClientProvider>
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
];

function response(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

describe('EmployeeHub', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
