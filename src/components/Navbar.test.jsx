import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const rbacMock = vi.hoisted(() => ({
	superAdmin: true,
	payrollRead: true,
	adminRead: true,
	projectsRead: false,
	admin: { id: 1, is_super_admin: 1, email: 'admin@example.com' },
	member: { id: 42, is_super_admin: 0, email: 'member@example.com' },
}));

vi.mock('next/navigation', () => ({
	usePathname: () => '/admin',
	useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/image', () => ({ default: () => <img alt="" /> }));
vi.mock('@/components/NotificationsBell', () => ({ default: () => null }));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: rbacMock.superAdmin ? rbacMock.admin : rbacMock.member,
		can: (resource, permission) =>
			permission === 'read' &&
			((resource === 'payroll' && rbacMock.payrollRead) ||
				(resource === 'admin' && rbacMock.adminRead) ||
				(resource === 'projects' && rbacMock.projectsRead)),
		RESOURCES: { ADMIN: 'admin', PAYROLL: 'payroll', PROJECTS: 'projects' },
		PERMISSIONS: { READ: 'read', UPDATE: 'update' },
	}),
}));

import Navbar from '@/components/Navbar';

vi.stubGlobal('matchMedia', () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
}));
vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
);

function resetTheme() {
	document.documentElement.removeAttribute('data-theme');
	localStorage.removeItem('accent-theme');
}

beforeEach(resetTheme);
afterEach(resetTheme);

function renderNavbar() {
	return render(<Navbar />, {
		wrapper: ({ children }) => (
			<TooltipProvider>
				<SidebarProvider>{children}</SidebarProvider>
			</TooltipProvider>
		),
	});
}

async function openAdminMenu() {
	renderNavbar();
	fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
	return screen.findByRole('link', { name: 'Payroll Run' });
}

describe('Navbar admin menu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rbacMock.superAdmin = true;
		rbacMock.payrollRead = true;
		rbacMock.adminRead = true;
		rbacMock.projectsRead = false;
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, data: {} }),
		});
	});

	it('opens Salary Profiles and Contract Pay in the shared salary workspace', async () => {
		await openAdminMenu();

		expect(
			screen.getByRole('link', { name: 'Salary Profiles' })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles?stream=payroll');
		expect(screen.getByRole('link', { name: 'Contract Pay' })).toHaveAttribute(
			'href',
			'/admin/payroll/salary-profiles?stream=contract'
		);
	});

	it('keeps the payroll run entries beside the workspace links', async () => {
		await openAdminMenu();

		expect(screen.getByRole('link', { name: 'Payroll Run' })).toHaveAttribute(
			'href',
			'/admin/payroll'
		);
		expect(screen.getByRole('link', { name: 'Component Rates' })).toBeVisible();
	});

	it('hides the salary workspace entries from a session without payroll:read', async () => {
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = false;
		await openAdminMenu();

		expect(
			screen.queryByRole('link', { name: 'Salary Profiles' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('link', { name: 'Contract Pay' })
		).not.toBeInTheDocument();
		// Entries without a resource keep their visibility.
		expect(screen.getByRole('link', { name: 'Payroll Run' })).toBeVisible();
	});

	it('shows the salary workspace entries to a payroll:read holder who is not a super admin', async () => {
		rbacMock.superAdmin = false;
		await openAdminMenu();

		expect(screen.getByRole('link', { name: 'Salary Profiles' })).toBeVisible();
		expect(screen.getByRole('link', { name: 'Contract Pay' })).toBeVisible();
	});

	it('admits a payroll-only session to Payroll without unrelated Admin groups', async () => {
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = true;
		rbacMock.adminRead = false;
		await openAdminMenu();

		expect(
			screen.getByRole('link', { name: 'Salary Profiles' })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles?stream=payroll');
		expect(screen.queryByText('Cash & Expenses')).not.toBeInTheDocument();
		expect(screen.queryByText('Monitoring')).not.toBeInTheDocument();
	});

	it('keeps the other Admin groups for an admin:read holder', async () => {
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = false;
		rbacMock.adminRead = true;
		await openAdminMenu();

		expect(screen.getByText('Cash & Expenses')).toBeVisible();
		expect(screen.getByText('Monitoring')).toBeVisible();
	});
});

describe('Navbar Projects entry', () => {
	const setProjectAccess = (hasProjectAccess) => {
		rbacMock.member = { ...rbacMock.member, hasProjectAccess };
	};

	beforeEach(() => {
		vi.clearAllMocks();
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = false;
		rbacMock.adminRead = false;
		rbacMock.projectsRead = false;
		setProjectAccess(false);
		vi.stubGlobal('fetch', fetchMock);
	});

	it('shows Projects from the session snapshot without a second request', () => {
		setProjectAccess(true);

		renderNavbar();

		expect(screen.getByRole('link', { name: 'Projects' })).toBeVisible();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('hides Projects from a user with no relationship and no project permission', () => {
		renderNavbar();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(
			screen.queryByRole('link', { name: 'Projects' })
		).not.toBeInTheDocument();
	});

	it('hides Projects when a refreshed session no longer has project access', () => {
		setProjectAccess(true);
		const view = renderNavbar();
		expect(screen.getByRole('link', { name: 'Projects' })).toBeVisible();

		setProjectAccess(false);
		view.rerender(<Navbar />);

		expect(
			screen.queryByRole('link', { name: 'Projects' })
		).not.toBeInTheDocument();
	});

	it('hides Projects when a global read grant covers no accessible Project', () => {
		rbacMock.projectsRead = true;

		renderNavbar();

		expect(
			screen.queryByRole('link', { name: 'Projects' })
		).not.toBeInTheDocument();
	});
});

describe('Navbar actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rbacMock.superAdmin = true;
		rbacMock.payrollRead = true;
		rbacMock.adminRead = true;
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, data: {} }),
		});
	});

	it('removes the Get started call to action', () => {
		renderNavbar();

		expect(
			screen.queryByRole('button', { name: /get started/i })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('link', { name: /get started/i })
		).not.toBeInTheDocument();
	});

	it('switches the app to dark and back from the header control', async () => {
		renderNavbar();

		const toDark = screen.getByRole('button', { name: 'Switch to dark mode' });
		expect(toDark).toBeEnabled();

		fireEvent.click(toDark);

		await waitFor(() => {
			expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
		});
		expect(
			screen.getByRole('button', { name: 'Switch to light mode' })
		).toBeVisible();
		expect(localStorage.getItem('accent-theme')).toBe('dark');

		fireEvent.click(
			screen.getByRole('button', { name: 'Switch to light mode' })
		);

		await waitFor(() => {
			expect(document.documentElement).not.toHaveAttribute('data-theme');
		});
		expect(
			screen.getByRole('button', { name: 'Switch to dark mode' })
		).toBeVisible();
		expect(localStorage.getItem('accent-theme')).toBeNull();
	});

	it('lists the report sub-items under Reports', async () => {
		renderNavbar();
		fireEvent.click(screen.getByRole('button', { name: 'Reports' }));

		expect(
			await screen.findByRole('link', { name: 'Employee Report' })
		).toHaveAttribute('href', '/reports/employee-report');
	});

	it('opens the mobile navigation sheet with the primary links', async () => {
		renderNavbar();
		fireEvent.click(
			screen.getByRole('button', { name: 'Open navigation menu' })
		);

		const sheet = await screen.findByRole('dialog', {
			name: 'Primary navigation',
		});
		expect(sheet).toBeVisible();
		expect(
			within(sheet).getByRole('link', { name: 'Dashboard' })
		).toBeVisible();
		expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
		expect(
			within(sheet).getByRole('button', { name: 'Sign Out' })
		).toBeVisible();
	});
});
