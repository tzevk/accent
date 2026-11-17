import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectMock, getServerAuthMock } = vi.hoisted(() => ({
	redirectMock: vi.fn(),
	getServerAuthMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/utils/server-auth', () => ({ getServerAuth: getServerAuthMock }));

import AdminLayout from '@/app/admin/layout';

const children = 'admin-content';

function signedIn(user: Record<string, unknown>) {
	getServerAuthMock.mockResolvedValue({
		authenticated: true,
		user,
		error: null,
	});
}

describe('admin shell admission for the Salary Profiles workspace', () => {
	beforeEach(() => {
		redirectMock.mockReset();
		getServerAuthMock.mockReset();
	});

	it('admits a payroll-only editor identity that is not an admin', async () => {
		signedIn({ id: 41, merged_permissions: ['payroll:read'] });

		await expect(AdminLayout({ children })).resolves.toBe(children);
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it('still denies employee-only access to the admin shell', async () => {
		signedIn({ id: 42, merged_permissions: ['employees:read'] });

		await expect(AdminLayout({ children })).resolves.toBeUndefined();
		expect(redirectMock).toHaveBeenCalledWith('/user/dashboard');
	});

	it('keeps the existing other-expense and project-admin exceptions', async () => {
		signedIn({ id: 43, merged_permissions: ['other_expenses:read'] });
		await expect(AdminLayout({ children })).resolves.toBe(children);

		redirectMock.mockReset();
		signedIn({ id: 44, merged_permissions: ['projects:update'] });
		await expect(AdminLayout({ children })).resolves.toBe(children);
		expect(redirectMock).not.toHaveBeenCalled();
	});
});
