import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RolePermissionPanel from './RolePermissionPanel';

describe('RolePermissionPanel', () => {
	it('lists the permissions inherited from the user role', () => {
		render(
			<RolePermissionPanel
				roleName="Employee"
				roleId={28}
				rolePermissions={['leads:read', 'projects:read']}
				canManage
				onManageAction={vi.fn()}
			/>
		);

		expect(screen.getByText('Inherited from role: Employee')).toBeTruthy();
		expect(screen.getByText('Leads')).toBeTruthy();
		expect(screen.queryByText(/Convert/)).toBeNull();
		expect(screen.getByText(/Projects/)).toBeTruthy();
		expect(
			screen.getByRole('button', { name: 'Manage role permissions' })
		).toBeTruthy();
	});

	it('explains when the role grants nothing', () => {
		render(
			<RolePermissionPanel
				roleName="Employee"
				roleId={28}
				rolePermissions={[]}
				canManage={false}
				onManageAction={vi.fn()}
			/>
		);

		expect(
			screen.getByText('This role currently grants no permissions.')
		).toBeTruthy();
		expect(
			screen.queryByRole('button', { name: 'Manage role permissions' })
		).not.toBeTruthy();
	});

	it('warns and hides management for the super-admin role', () => {
		render(
			<RolePermissionPanel
				roleName="Super Admin"
				roleCode="super_admin"
				roleId={23}
				rolePermissions={['projects:read']}
				canManage
				onManageAction={vi.fn()}
			/>
		);

		expect(
			screen.getByText(/Super administrators bypass role permissions/)
		).toBeTruthy();
		expect(
			screen.queryByRole('button', { name: 'Manage role permissions' })
		).toBeNull();
	});

	it('calls the manage action', () => {
		const onManageAction = vi.fn();
		render(
			<RolePermissionPanel
				roleName="Employee"
				roleId={28}
				rolePermissions={['leads:read']}
				canManage
				onManageAction={onManageAction}
			/>
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Manage role permissions' })
		);
		expect(onManageAction).toHaveBeenCalledTimes(1);
	});
});
