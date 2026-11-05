import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RolePermissionDialog from './RolePermissionDialog';

describe('RolePermissionDialog', () => {
	it('starts from the role permissions and saves the edited set', () => {
		const onSaveAction = vi.fn();
		render(
			<RolePermissionDialog
				open
				roleName="Employee"
				initialPermissions={['leads:read']}
				saving={false}
				onCloseAction={vi.fn()}
				onSaveAction={onSaveAction}
			/>
		);

		expect(
			screen.getByRole('dialog', { name: 'Manage role permissions' })
		).toBeTruthy();
		expect(
			(screen.getByLabelText('Leads: View') as HTMLInputElement).checked
		).toBe(true);
		expect(document.activeElement).toBe(
			screen.getByRole('searchbox', { name: 'Search role permissions' })
		);

		fireEvent.click(screen.getByLabelText('Projects: View'));
		fireEvent.click(
			screen.getByRole('button', { name: 'Save role permissions' })
		);

		expect(onSaveAction).toHaveBeenCalledWith(['leads:read', 'projects:read']);
	});

	it('traps Tab between the first and last controls', () => {
		render(
			<RolePermissionDialog
				open
				roleName="Employee"
				initialPermissions={['leads:read']}
				saving={false}
				onCloseAction={vi.fn()}
				onSaveAction={vi.fn()}
			/>
		);

		const save = screen.getByRole('button', { name: 'Save role permissions' });
		save.focus();
		fireEvent.keyDown(document, { key: 'Tab' });

		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Close role permission editor' })
		);
	});

	it('filters resources and closes without saving', () => {
		const onCloseAction = vi.fn();
		render(
			<RolePermissionDialog
				open
				roleName="Employee"
				initialPermissions={['leads:read']}
				saving={false}
				onCloseAction={onCloseAction}
				onSaveAction={vi.fn()}
			/>
		);

		fireEvent.change(
			screen.getByRole('searchbox', { name: 'Search role permissions' }),
			{ target: { value: 'invoice' } }
		);
		expect(screen.getByText('Invoices')).toBeTruthy();
		expect(screen.queryByText('Leads')).not.toBeTruthy();

		fireEvent.click(
			screen.getByRole('button', { name: 'Close role permission editor' })
		);
		expect(onCloseAction).toHaveBeenCalledTimes(1);
	});
});
