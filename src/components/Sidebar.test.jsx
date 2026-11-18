import { fireEvent, render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const route = vi.hoisted(() => ({ pathname: '/employees' }));
const session = vi.hoisted(() => ({ is_super_admin: 0 }));

vi.mock('next/navigation', () => ({
	usePathname: () => route.pathname,
	useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: {
			is_super_admin: session.is_super_admin,
			email: 'reader@example.com',
		},
		can: () => true,
		RESOURCES: {
			EMPLOYEES: 'employees',
			PAYROLL: 'payroll',
			SETTINGS: 'settings',
		},
		PERMISSIONS: { READ: 'read' },
	}),
}));
vi.mock('@/context/SessionContext', () => ({ clearSessionCache: vi.fn() }));

import Sidebar from '@/components/Sidebar';

function renderSidebar() {
	return render(
		<TooltipProvider>
			<SidebarProvider>
				<Sidebar />
			</SidebarProvider>
		</TooltipProvider>
	);
}

describe('Sidebar employee master children', () => {
	beforeEach(() => {
		route.pathname = '/employees';
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {},
		}));
		session.is_super_admin = 0;
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, data: { unread_count: 0 } }),
		});
	});

	it('links the merged hub as the employee list entry', () => {
		renderSidebar();
		expect(screen.getByRole('link', { name: 'Employees' })).toHaveAttribute(
			'href',
			'/employees'
		);
	});

	it('keeps the attendance and leave children next to the hub link', () => {
		renderSidebar();

		expect(screen.getByRole('link', { name: 'Attendance' })).toHaveAttribute(
			'href',
			'/employees/attendance'
		);
		expect(
			screen.getByRole('link', { name: 'Leave Requests' })
		).toHaveAttribute('href', '/employees/leaves');
	});

	it('offers role permission management under the employee master', () => {
		renderSidebar();

		expect(
			screen.getByRole('link', { name: 'Edit Role Permissions' })
		).toHaveAttribute('href', '/employees/role-permissions');
	});

	it('drops the children that pointed at the merged pay routes', () => {
		renderSidebar();

		expect(screen.queryByRole('link', { name: 'Salary Profiles' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Contract' })).toBeNull();
	});

	it('keeps masters behind one dropdown outside master routes', () => {
		route.pathname = '/user/dashboard';
		renderSidebar();

		expect(screen.queryByRole('link', { name: 'User Master' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Masters' }));
		expect(screen.getByRole('link', { name: 'User Master' })).toHaveAttribute(
			'href',
			'/masters/users'
		);
	});

	it('does not render report navigation links', () => {
		session.is_super_admin = 1;
		route.pathname = '/admin/dashboard';
		renderSidebar();

		expect(screen.queryByRole('link', { name: 'Timesheet Report' })).toBeNull();
		expect(
			screen.queryByRole('link', { name: 'Outstanding Balances' })
		).toBeNull();
	});

	it('opens the account menu with a log out action', () => {
		renderSidebar();

		fireEvent.click(
			screen.getByRole('button', { name: /reader@example\.com/i })
		);
		expect(screen.getByRole('menuitem', { name: /log out/i })).toBeTruthy();
	});
});
