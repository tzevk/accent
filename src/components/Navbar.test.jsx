import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
	usePathname: () => '/admin',
	useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/image', () => ({ default: () => <img alt="" /> }));
vi.mock('@/components/NotificationsBell', () => ({ default: () => null }));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: { is_super_admin: 1, email: 'admin@example.com' },
		can: () => true,
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
});
