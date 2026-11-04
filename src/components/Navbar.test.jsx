import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
		RESOURCES: { ADMIN: 'admin', PAYROLL: 'payroll' },
		PERMISSIONS: { READ: 'read' },
	}),
}));

import Navbar from '@/components/Navbar';

async function openPayrollGroup() {
	render(<Navbar />);
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

	it('deep-links Salary Profiles to the hub filtered to Payroll', async () => {
		await openPayrollGroup();

		expect(
			screen.getByRole('link', { name: 'Salary Profiles' })
		).toHaveAttribute('href', '/employees?type=Payroll');
	});

	it('deep-links Contract Pay to the hub filtered to Contract', async () => {
		await openPayrollGroup();

		expect(screen.getByRole('link', { name: 'Contract Pay' })).toHaveAttribute(
			'href',
			'/employees?type=Contract'
		);
	});

	it('keeps the payroll run entries beside the deep links', async () => {
		await openPayrollGroup();

		expect(screen.getByRole('link', { name: 'Payroll Run' })).toHaveAttribute(
			'href',
			'/admin/payroll'
		);
		expect(screen.getByRole('link', { name: 'Component Rates' })).toBeVisible();
	});

	it('hides the hub deep links from a session without payroll:read', async () => {
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

	it('shows the hub deep links to a payroll:read holder who is not a super admin', async () => {
		rbacMock.superAdmin = false;
		await openPayrollGroup();

		expect(screen.getByRole('link', { name: 'Salary Profiles' })).toBeVisible();
		expect(screen.getByRole('link', { name: 'Contract Pay' })).toBeVisible();
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

		render(<Navbar />);

		expect(await screen.findByRole('link', { name: 'Projects' })).toBeVisible();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/projects/access',
			expect.objectContaining({ cache: 'no-store' })
		);
	});

	it('hides Projects from a user with no relationship and no project permission', async () => {
		fetchMock.mockResolvedValue(projectAccessResponse(false));

		render(<Navbar />);

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

		render(<Navbar />);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole('link', { name: 'Projects' })
		).not.toBeInTheDocument();
	});
});
