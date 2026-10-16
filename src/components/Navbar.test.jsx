import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const rbacMock = vi.hoisted(() => ({
	superAdmin: true,
	payrollRead: true,
	adminRead: true,
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
				(resource === 'admin' && rbacMock.adminRead)),
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
