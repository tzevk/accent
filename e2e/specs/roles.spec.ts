import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readStoredRole,
	seedUserAdministrationFixture,
} from '../fixtures/user-administration.ts';

// The owned Next dev server compiles this route on first visit. The assertions
// below are unchanged; the budget only covers that compilation.
test.setTimeout(300_000);

/** role administration is the settings read/update surface, nothing more. */
const ROLE_ADMIN_PERMISSIONS = ['settings:read', 'settings:update'] as const;
const ROLE_INITIAL_PERMISSIONS = ['employees:read'] as const;
const ROLE_EXPECTED_PERMISSIONS = [
	'employees:read',
	'employees:update',
] as const;

// Actor: a role administrator whose owned role grants exactly settings:read
// and settings:update.
// Starting state: one namespaced role with no users and exactly employees:read.
// Action: sign in, open Edit Role Permissions, find that role, enable
// Employees: Edit in its permission dialog and save; reload and reopen it.
// Proof: the saved notice names the role, the database stores exactly
// employees:read + employees:update, the list reports 2 granted, and the
// reopened dialog shows both Employees: View and Employees: Edit checked.
test('a role administrator saves a role permission and reopens it', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedUserAdministrationFixture(
		db,
		`${namespace}-roles`,
		{
			actorPermissions: ROLE_ADMIN_PERMISSIONS,
			editableRolePermissions: ROLE_INITIAL_PERMISSIONS,
		}
	);
	try {
		const role = fixture.editableRole;
		if (!role) {
			throw new Error('[roles] the editable role was not seeded.');
		}

		const before = await readStoredRole(db, role.id);
		expect(before).toMatchObject({
			id: role.id,
			roleCode: role.roleCode,
			roleName: role.roleName,
			permissions: [...ROLE_INITIAL_PERMISSIONS],
		});

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: fixture.actor.username,
			password: fixture.actor.password,
		});

		await page.goto('/employees/role-permissions');
		await expect(
			page.getByRole('heading', { name: 'Edit Role Permissions', exact: true })
		).toBeVisible();

		const search = page.getByRole('searchbox', {
			name: 'Search roles',
			exact: true,
		});
		await search.fill(role.roleName);
		const roleRow = page.getByRole('row').filter({ hasText: role.roleName });
		await expect(roleRow).toBeVisible();
		await roleRow
			.getByRole('button', {
				name: `Edit permissions for ${role.roleName}`,
				exact: true,
			})
			.click();

		await expect(
			page.getByRole('heading', {
				name: 'Manage role permissions',
				exact: true,
			})
		).toBeVisible();
		await expect(
			page.getByRole('checkbox', { name: 'Employees: View', exact: true })
		).toBeChecked();
		const editEmployees = page.getByRole('checkbox', {
			name: 'Employees: Edit',
			exact: true,
		});
		await expect(editEmployees).not.toBeChecked();
		await editEmployees.check();

		const saveResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'PUT' &&
				url.pathname === '/api/roles-master'
			);
		});
		await page
			.getByRole('button', { name: 'Save role permissions', exact: true })
			.click();
		expect((await saveResponse).status()).toBe(200);
		await expect(
			page.getByRole('status').filter({
				hasText: `Permissions updated for ${role.roleName}. They apply to every user with this role.`,
			})
		).toBeVisible();

		const saved = await readStoredRole(db, role.id);
		expect(saved).not.toBeNull();
		expect([...(saved?.permissions ?? [])].sort()).toEqual([
			...ROLE_EXPECTED_PERMISSIONS,
		]);
		await expect(
			page
				.getByRole('row')
				.filter({ hasText: role.roleName })
				.getByText('2 granted', { exact: true })
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Edit Role Permissions', exact: true })
		).toBeVisible();
		const reopenedSearch = page.getByRole('searchbox', {
			name: 'Search roles',
			exact: true,
		});
		await reopenedSearch.fill(role.roleName);
		const reopenedRow = page
			.getByRole('row')
			.filter({ hasText: role.roleName });
		await expect(reopenedRow).toBeVisible();
		await reopenedRow
			.getByRole('button', {
				name: `Edit permissions for ${role.roleName}`,
				exact: true,
			})
			.click();
		await expect(
			page.getByRole('checkbox', { name: 'Employees: View', exact: true })
		).toBeChecked();
		await expect(
			page.getByRole('checkbox', { name: 'Employees: Edit', exact: true })
		).toBeChecked();

		const afterReopen = await readStoredRole(db, role.id);
		expect([...(afterReopen?.permissions ?? [])].sort()).toEqual([
			...ROLE_EXPECTED_PERMISSIONS,
		]);
	} finally {
		await fixture.dispose();
	}
});
