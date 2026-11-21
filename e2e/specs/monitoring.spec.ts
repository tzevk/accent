import type { RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createAuditFilterFixture,
	createLiveMonitoringFixture,
} from '../fixtures/collaboration.ts';

// The owned Next dev server compiles the admin pages and their APIs on first
// visit. Every assertion still waits for its observable result; this only
// bounds compilation and the real sign-in flow.
test.setTimeout(300_000);

interface AuditRow extends RowDataPacket {
	action: string;
	resource: string;
	resource_id: number | string | null;
	old_value: unknown;
	new_value: unknown;
}

interface UserStatusPayload {
	success: boolean;
	data: {
		user_id: number;
		username: string;
		email: string;
	};
}

/**
 * Actor: An administrator whose hard role-code gate opens `/admin` and whose
 * direct `users:read` grant opens Audit Logs. It is not a super admin.
 *
 * Starting state: One seeded `update_permissions` entry by this administrator
 * for its own user id, with a fixed previous permission set and a fixed
 * updated permission set that differ.
 *
 * Action: Open `/admin/audit-logs`, reveal Filters, choose the Update
 * Permissions action and User Permissions resource, search for the unique
 * administrator username, then expand the remaining row.
 *
 * Proof: The filtered table shows that exact user, action, resource and
 * resource id, and Change Details shows the seeded old-only permission under
 * Previous and the seeded new-only permission under Updated. An independent
 * database read of the captured audit id matches both JSON values.
 */
test('admin filters audit logs to the changed permissions and sees both evidence sides', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await createAuditFilterFixture(db, namespace);
	try {
		page.setDefaultNavigationTimeout(60_000);
		page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: fixture.admin.username,
			password: fixture.admin.password,
		});

		await page.goto('/admin/audit-logs');
		await expect(
			page.getByRole('heading', { name: 'Audit Logs', exact: true })
		).toBeVisible();

		await page.getByRole('button', { name: 'Filters', exact: true }).click();

		const actionSelect = page
			.getByRole('combobox')
			.filter({ has: page.getByRole('option', { name: 'All Actions' }) });
		await actionSelect.selectOption({ label: 'Updated Permissions' });

		const resourceSelect = page
			.getByRole('combobox')
			.filter({ has: page.getByRole('option', { name: 'All Resources' }) });
		await resourceSelect.selectOption({ label: 'User Permissions' });

		const filteredResponse = page.waitForResponse(
			(response) => {
				if (response.request().method() !== 'GET') return false;
				const url = new URL(response.url());
				return (
					url.pathname === '/api/audit-logs' &&
					url.searchParams.get('action') === 'update_permissions' &&
					url.searchParams.get('resource') === 'user_permissions' &&
					url.searchParams.get('search') === fixture.admin.username
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByPlaceholder('Search...', { exact: true })
			.fill(fixture.admin.username);
		expect((await filteredResponse).ok()).toBe(true);

		const logRow = page
			.getByRole('row')
			.filter({ hasText: fixture.admin.username });
		await expect(logRow).toBeVisible();
		await expect(logRow).toContainText('Updated Permissions');
		await expect(logRow).toContainText('User Permissions');
		await expect(logRow).toContainText(String(fixture.resourceId));

		await logRow.click();

		const details = page.getByRole('row').filter({ hasText: 'Change Details' });
		await expect(details).toBeVisible();
		await expect(
			details.getByText('Module Permissions', { exact: true })
		).toBeVisible();
		const previous = details
			.getByText('Previous', { exact: true })
			.locator('..');
		await expect(previous).toContainText('reports:read');
		const updated = details.getByText('Updated', { exact: true }).locator('..');
		await expect(updated).toContainText('payroll:read');

		const [auditRows] = await db.execute<AuditRow[]>(
			`SELECT action, resource, resource_id, old_value, new_value
         FROM audit_logs
        WHERE id = ? AND user_id = ?`,
			[fixture.auditId, fixture.admin.userId]
		);
		expect(auditRows).toHaveLength(1);
		expect(auditRows[0].action).toBe('update_permissions');
		expect(auditRows[0].resource).toBe('user_permissions');
		expect(Number(auditRows[0].resource_id)).toBe(fixture.resourceId);
		const storedOldValue =
			typeof auditRows[0].old_value === 'string'
				? JSON.parse(auditRows[0].old_value)
				: auditRows[0].old_value;
		const storedNewValue =
			typeof auditRows[0].new_value === 'string'
				? JSON.parse(auditRows[0].new_value)
				: auditRows[0].new_value;
		expect(storedOldValue).toEqual({
			permissions: fixture.oldPermissions,
		});
		expect(storedNewValue).toEqual({
			permissions: fixture.newPermissions,
		});
	} finally {
		await fixture.dispose();
	}
});

/**
 * Actor: An administrator whose hard role-code gate opens
 * `/admin/live-monitoring`.
 *
 * Starting state: One seeded ordinary employee with a presence row updated at
 * seed time, 47 minutes of today's screen time, 6 activities and 75%
 * productivity.
 *
 * Action: Open Live User Monitoring, choose the All Status filter, search for
 * that employee's unique username, inspect the remaining card, and choose its
 * View Dashboard action.
 *
 * Proof: The card shows that employee's exact name, email, screen time,
 * activity count and productivity. The click opens
 * `/admin/live-monitoring/user/<their id>`; the user-status response identifies
 * the same id, username and email, the dashboard heading greets that employee,
 * and the administrator-only Back control is visible.
 */
test("admin opens the matching monitored user's dashboard from the filtered list", async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await createLiveMonitoringFixture(db, namespace);
	try {
		page.setDefaultNavigationTimeout(60_000);
		page.setViewportSize({ width: 1440, height: 900 });

		await signInThroughUi(page, {
			username: fixture.admin.username,
			password: fixture.admin.password,
		});

		await page.goto('/admin/live-monitoring');
		await expect(
			page.getByRole('heading', {
				name: 'Live User Monitoring',
				exact: true,
			})
		).toBeVisible();

		const statusSelect = page
			.getByRole('combobox')
			.filter({ has: page.getByRole('option', { name: 'All Status' }) });
		await statusSelect.selectOption({ label: 'All Status' });

		await page
			.getByPlaceholder('Search users...', { exact: true })
			.fill(fixture.monitored.username);

		const card = page
			.getByRole('heading', {
				name: fixture.monitored.username,
				exact: true,
			})
			.locator(
				'xpath=ancestor::div[.//button[normalize-space(.)="View Dashboard"]][1]'
			);
		await expect(card).toBeVisible();
		await expect(
			card.getByText(fixture.monitoredEmail, { exact: true })
		).toBeVisible();
		await expect(
			card.getByText(`${fixture.screenTimeMinutes}m`, { exact: true })
		).toBeVisible();
		await expect(
			card.getByText(String(fixture.activitiesCompleted), { exact: true })
		).toBeVisible();
		await expect(
			card.getByText(`${fixture.productivityPercent}%`, { exact: true })
		).toBeVisible();

		const detailResponse = page.waitForResponse(
			(response) => {
				if (response.request().method() !== 'GET') return false;
				const url = new URL(response.url());
				return (
					url.pathname === '/api/user-status' &&
					url.searchParams.get('user_id') === String(fixture.monitored.userId)
				);
			},
			{ timeout: 60_000 }
		);
		await card
			.getByRole('button', { name: 'View Dashboard', exact: true })
			.click();
		await page.waitForURL(
			new RegExp(`/admin/live-monitoring/user/${fixture.monitored.userId}$`)
		);

		const detail = await detailResponse;
		expect(detail.ok()).toBe(true);
		const payload = (await detail.json()) as UserStatusPayload;
		expect(payload.success).toBe(true);
		expect(Number(payload.data.user_id)).toBe(fixture.monitored.userId);
		expect(payload.data.username).toBe(fixture.monitored.username);
		expect(payload.data.email).toBe(fixture.monitoredEmail);

		await expect(
			page
				.getByRole('heading', { level: 1 })
				.filter({ hasText: fixture.monitored.username })
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Back', exact: true })
		).toBeVisible();
	} finally {
		await fixture.dispose();
	}
});
