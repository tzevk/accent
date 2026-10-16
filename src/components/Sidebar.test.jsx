import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const route = vi.hoisted(() => ({ pathname: '/employees' }));

vi.mock('next/navigation', () => ({
	usePathname: () => route.pathname,
}));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: { is_super_admin: 0, email: 'reader@example.com' },
		can: () => true,
		RESOURCES: { EMPLOYEES: 'employees', PAYROLL: 'payroll' },
		PERMISSIONS: { READ: 'read' },
	}),
}));

import Sidebar from '@/components/Sidebar';

function renderSidebar() {
	return render(<Sidebar />);
}

describe('Sidebar employee master children', () => {
	beforeEach(() => {
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

	it('drops the children that pointed at the merged pay routes', () => {
		renderSidebar();

		expect(screen.queryByRole('link', { name: 'Salary Profiles' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Contract' })).toBeNull();
	});
});
