import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, apiPut, apiPost, accountParam, rbacState } = vi.hoisted(() => ({
	apiGet: vi.fn(),
	apiPut: vi.fn(),
	apiPost: vi.fn(),
	accountParam: { value: null as string | null },
	rbacState: { superAdmin: false },
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
	useSearchParams: () => ({
		get: (name: string) => (name === 'account' ? accountParam.value : null),
	}),
}));
vi.mock('@/components/Navbar', () => ({ default: () => <nav>Navbar</nav> }));
vi.mock('@/components/LoadingSpinner', () => ({
	default: () => <div>Loading</div>,
}));
vi.mock('@/lib/api-client', () => ({ apiGet, apiPut, apiPost }));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: { is_super_admin: rbacState.superAdmin },
		can: (_resource: string, permission: string) =>
			permission === 'read' || permission === 'update',
	}),
}));

import UserMasterPage from './page';

const linkedInactiveAccount = {
	id: 71,
	username: 'former.employee',
	email: 'login@example.com',
	full_name: 'Account Name',
	employee_id: 19,
	employee_name: 'Canonical Employee Name',
	employee_code: 'EMP019',
	status: 'inactive',
	is_active: 0,
	permissions: [],
};

function mockData(users = [linkedInactiveAccount]) {
	apiGet.mockImplementation(async (url: string) => {
		if (url === '/api/users/list') return { data: users };
		if (url === '/api/employees/list') return { employees: [] };
		if (url === '/api/vendors') return { data: [] };
		if (url === '/api/roles/list') return { success: true, data: [] };
		return { data: [] };
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	accountParam.value = null;
	rbacState.superAdmin = false;
	mockData();
	apiPut.mockResolvedValue({ success: true });
	apiPost.mockResolvedValue({ success: true });
});

describe('user account management', () => {
	it('shows canonical linked Employee name/code when Employee list has no row and offers restore', async () => {
		render(<UserMasterPage />);
		expect(
			await screen.findByText('Canonical Employee Name')
		).toBeInTheDocument();
		expect(screen.getByText('EMP019')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Restore Access' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Disable Access' })
		).not.toBeInTheDocument();
	});

	it('restores access through the existing account row without changing ownership', async () => {
		render(<UserMasterPage />);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Restore Access' })
		);
		await waitFor(() =>
			expect(apiPut).toHaveBeenCalledWith('/api/users', {
				id: 71,
				status: 'active',
				is_active: 1,
			})
		);
		expect(apiGet).toHaveBeenCalledWith('/api/users/list', {
			page: 1,
			limit: 1000,
		});
	});

	it('disables access explicitly while keeping the Employee link on the account record', async () => {
		const activeAccount = {
			...linkedInactiveAccount,
			status: 'active',
			is_active: 1,
		};
		mockData([activeAccount]);
		render(<UserMasterPage />);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Disable Access' })
		);
		await waitFor(() =>
			expect(apiPut).toHaveBeenCalledWith('/api/users', {
				id: 71,
				status: 'inactive',
				is_active: 0,
			})
		);
		expect(screen.getByText('EMP019')).toBeInTheDocument();
	});

	it('reveals the account requested by Employee navigation without opening an editor or mutating', async () => {
		accountParam.value = '71';
		render(<UserMasterPage />);
		const account = await screen.findByText('Canonical Employee Name');
		expect(account.closest('tr')).toHaveAttribute('data-account-id', '71');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(apiPut).not.toHaveBeenCalled();
		expect(apiPost).not.toHaveBeenCalled();
	});

	it('offers an inactive-account repair only to a super admin and submits the stated reason', async () => {
		rbacState.superAdmin = true;
		render(<UserMasterPage />);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Repair Employee Link' })
		);
		expect(
			within(screen.getByRole('dialog')).getByText('Canonical Employee Name')
		).toBeInTheDocument();
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Reason (required)' }),
			{
				target: { value: 'Correct verified employee assignment' },
			}
		);
		fireEvent.click(screen.getByRole('button', { name: 'Confirm Repair' }));
		await waitFor(() =>
			expect(apiPost).toHaveBeenCalledWith(
				'/api/users/71/employee-link-repair',
				{ employee_id: null, reason: 'Correct verified employee assignment' }
			)
		);
	});
	it('shows a repair history conflict in the dialog and keeps it open without hiding the account', async () => {
		rbacState.superAdmin = true;
		apiPost.mockRejectedValueOnce(
			new Error('Historical activity prevents reassignment.')
		);
		render(<UserMasterPage />);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Repair Employee Link' })
		);
		const dialog = screen.getByRole('dialog');
		fireEvent.change(
			within(dialog).getByRole('textbox', { name: 'Reason (required)' }),
			{
				target: { value: 'Verified correction' },
			}
		);
		fireEvent.click(
			within(dialog).getByRole('button', { name: 'Confirm Repair' })
		);
		expect(await within(dialog).findByRole('alert')).toHaveTextContent(
			'Historical activity prevents reassignment.'
		);
		expect(screen.getAllByRole('alert')).toHaveLength(1);
		expect(
			within(dialog).getByRole('button', { name: 'Confirm Repair' })
		).toBeEnabled();
		expect(
			within(screen.getByText('former.employee').closest('tr')!).getByText(
				'Canonical Employee Name'
			)
		).toBeInTheDocument();
	});
	it('cancels the repair dialog with Escape and restores focus to its trigger', async () => {
		rbacState.superAdmin = true;
		render(<UserMasterPage />);
		const trigger = await screen.findByRole('button', {
			name: 'Repair Employee Link',
		});
		trigger.focus();
		fireEvent.click(trigger);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		);
		expect(document.activeElement).toBe(trigger);
		expect(apiPost).not.toHaveBeenCalled();
	});
	it('keeps permitted accounts visible when Employee and Vendor reads are forbidden', async () => {
		apiGet.mockImplementation(async (url: string) => {
			if (url === '/api/users/list') return { data: [linkedInactiveAccount] };
			if (url === '/api/employees/list' || url === '/api/vendors') {
				throw new Error('Forbidden');
			}
			return { data: [] };
		});

		render(<UserMasterPage />);

		expect(
			await screen.findByText('Canonical Employee Name')
		).toBeInTheDocument();
		expect(
			screen
				.getAllByRole('alert')
				.some((alert) => alert.textContent?.includes('Forbidden'))
		).toBe(true);
		expect(screen.getByRole('button', { name: 'Create User' })).toBeDisabled();
	});
	it('does not report an empty account list when the account read fails', async () => {
		apiGet.mockImplementation(async (url: string) => {
			if (url === '/api/users/list') throw new Error('Account read failed');
			if (url === '/api/employees/list') return { employees: [] };
			if (url === '/api/vendors') return { data: [] };
			return { data: [] };
		});

		render(<UserMasterPage />);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Account read failed'
		);
		expect(
			screen.queryByText('No users found. Create a user from an employee.')
		).not.toBeInTheDocument();
	});

	it('loads account pages using the users list pagination envelope', async () => {
		const secondAccount = {
			...linkedInactiveAccount,
			id: 1201,
			username: 'page.two',
			employee_id: 29,
			employee_name: 'Second Page Employee',
		};
		apiGet.mockImplementation(
			async (url: string, query?: { page?: number }) => {
				if (url === '/api/users/list') {
					return query?.page === 2
						? { data: [secondAccount], pagination: { current: 2, total: 2 } }
						: {
								data: [linkedInactiveAccount],
								pagination: { current: 1, total: 2 },
							};
				}
				if (url === '/api/employees/list') return { employees: [] };
				if (url === '/api/vendors') return { data: [] };
				return { data: [] };
			}
		);

		render(<UserMasterPage />);

		expect(await screen.findByText('Second Page Employee')).toBeInTheDocument();
		expect(apiGet).toHaveBeenCalledWith('/api/users/list', {
			page: 2,
			limit: 1000,
		});
	});

	it('excludes Employees whose canonical linked_user_id exists even if account pages omit them', async () => {
		apiGet.mockImplementation(
			async (url: string, query?: { page?: number }) => {
				if (url === '/api/users/list') {
					return {
						data: [],
						pagination: { current: query?.page || 1, total: 2 },
					};
				}
				if (url === '/api/employees/list') {
					return {
						employees: [
							{
								id: 19,
								first_name: 'Linked',
								last_name: 'Employee',
								linked_user_id: 71,
							},
							{
								id: 20,
								first_name: 'Available',
								last_name: 'Employee',
								linked_user_id: null,
							},
						],
						pagination: { current: 1, total: 1 },
					};
				}
				if (url === '/api/vendors') return { data: [] };
				return { data: [] };
			}
		);

		render(<UserMasterPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Create User' }));

		expect(
			screen.queryByRole('button', { name: /Linked Employee/ })
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: /Available Employee/ })
		).toBeInTheDocument();
	});
});
