import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const rbacMock = vi.hoisted(() => ({
	superAdmin: true,
	payrollRead: true,
	adminRead: true,
	projectsRead: false,
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
		user: {
			is_super_admin: rbacMock.superAdmin ? 1 : 0,
			email: 'admin@example.com',
		},
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

function renderNavbar() {
	return render(
		<TooltipProvider>
			<SidebarProvider>
				<Navbar />
			</SidebarProvider>
		</TooltipProvider>
	);
}

async function openPayrollGroup() {
	renderNavbar();
	fireEvent.mouseEnter(screen.getByRole('button', { name: 'Admin' }));
	fireEvent.mouseEnter(screen.getByRole('button', { name: 'Payroll' }));
}

describe('Navbar payroll group', () => {
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
		await openPayrollGroup();

		expect(
			screen.getByRole('link', { name: 'Salary Profiles' })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles?stream=payroll');
		expect(screen.getByRole('link', { name: 'Contract Pay' })).toHaveAttribute(
			'href',
			'/admin/payroll/salary-profiles?stream=contract'
		);
	});

	it('keeps the payroll run entries beside the workspace links', async () => {
		await openPayrollGroup();

		expect(screen.getByRole('link', { name: 'Payroll Run' })).toHaveAttribute(
			'href',
			'/admin/payroll'
		);
		expect(screen.getByRole('link', { name: 'Component Rates' })).toBeVisible();
	});

	it('hides the salary workspace entries from a session without payroll:read', async () => {
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = false;
		await openPayrollGroup();

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
		await openPayrollGroup();

		expect(screen.getByRole('link', { name: 'Salary Profiles' })).toBeVisible();
		expect(screen.getByRole('link', { name: 'Contract Pay' })).toBeVisible();
	});

	it('admits a payroll-only session to Payroll without unrelated Admin groups', async () => {
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = true;
		rbacMock.adminRead = false;
		renderNavbar();

		fireEvent.mouseEnter(screen.getByRole('button', { name: 'Admin' }));
		expect(screen.getByRole('button', { name: 'Payroll' })).toBeVisible();
		expect(
			screen.queryByRole('button', { name: 'Cash & Expenses' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Monitoring' })
		).not.toBeInTheDocument();

		fireEvent.mouseEnter(screen.getByRole('button', { name: 'Payroll' }));
		expect(
			screen.getByRole('link', { name: 'Salary Profiles' })
		).toHaveAttribute('href', '/admin/payroll/salary-profiles?stream=payroll');
		expect(screen.getByRole('link', { name: 'Payroll Run' })).toBeVisible();
	});

	it('keeps the other Admin groups for an admin:read holder', async () => {
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = false;
		rbacMock.adminRead = true;
		renderNavbar();

		fireEvent.mouseEnter(screen.getByRole('button', { name: 'Admin' }));
		expect(
			screen.getByRole('button', { name: 'Cash & Expenses' })
		).toBeVisible();
		expect(screen.getByRole('button', { name: 'Monitoring' })).toBeVisible();
	});
});

describe('Navbar Projects entry', () => {
	const projectAccessResponse = (hasAccess) => ({
		ok: true,
		json: async () => ({ success: true, data: { hasAccess } }),
	});

	beforeEach(() => {
		vi.clearAllMocks();
		rbacMock.superAdmin = false;
		rbacMock.payrollRead = false;
		rbacMock.adminRead = false;
		rbacMock.projectsRead = false;
		vi.stubGlobal('fetch', fetchMock);
	});

	it('shows Projects to a user with a project relationship but no project permission', async () => {
		fetchMock.mockResolvedValue(projectAccessResponse(true));

		renderNavbar();

		expect(await screen.findByRole('link', { name: 'Projects' })).toBeVisible();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/projects/access',
			expect.objectContaining({ cache: 'no-store' })
		);
	});

	it('hides Projects from a user with no relationship and no project permission', async () => {
		fetchMock.mockResolvedValue(projectAccessResponse(false));

		renderNavbar();

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole('link', { name: 'Projects' })
		).not.toBeInTheDocument();
	});

	it('hides Projects from a scoped read grant that leads nothing', async () => {
		rbacMock.projectsRead = true;
		fetchMock.mockResolvedValue(projectAccessResponse(false));

		renderNavbar();

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole('link', { name: 'Projects' })
		).not.toBeInTheDocument();
	});
});
