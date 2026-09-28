import { expect, test } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import { ADMIN_USER, DELIVERABLE_PREFIX } from '../lib/fixtures';

/**
 * Soft delete, verified end to end: the API hides the row from its list, and
 * the row is still on disk with isDelete = 1, attributed to the acting user.
 */

interface AdminRow {
	id: number;
}

interface DeliverableRow {
	isDelete: number;
	deleted_at: string | null;
	deleted_by: number | null;
}

test.describe('soft delete', () => {
	test('DELETE hides the row from the list but keeps it flagged in the database', async ({
		request,
	}) => {
		const admin = await rows<AdminRow>(
			`SELECT id FROM users WHERE username = ?`,
			[ADMIN_USER.username]
		);
		expect(admin).toHaveLength(1);
		const adminUserId = admin[0].id;

		const name = `${DELIVERABLE_PREFIX}${Date.now()}`;
		const created = await request.post('/api/masters/deliverables', {
			data: { deliverable_name: name },
		});
		expect(created.status()).toBe(200);
		const createdRow = (await created.json()).data;
		expect(createdRow.id).toBeTruthy();

		const listBefore = await request.get('/api/masters/deliverables');
		expect(listBefore.status()).toBe(200);
		const namesBefore = (await listBefore.json()).data.map(
			(row: { deliverable_name: string }) => row.deliverable_name
		);
		expect(namesBefore).toContain(name);

		const deleted = await request.delete(
			`/api/masters/deliverables/${createdRow.id}`
		);
		expect(deleted.status()).toBe(200);

		const listAfter = await request.get('/api/masters/deliverables');
		expect(listAfter.status()).toBe(200);
		const namesAfter = (await listAfter.json()).data.map(
			(row: { deliverable_name: string }) => row.deliverable_name
		);
		expect(namesAfter).not.toContain(name);

		const [dbRow] = await rows<DeliverableRow>(
			`SELECT isDelete, deleted_at, deleted_by FROM deliverables_master WHERE id = ?`,
			[createdRow.id]
		);
		expect(dbRow).toBeTruthy();
		expect(Number(dbRow.isDelete)).toBe(1);
		expect(dbRow.deleted_at).not.toBeNull();
		expect(Number(dbRow.deleted_by)).toBe(adminUserId);

		writeArtifact('soft-delete-deliverable', {
			deliverable: { id: createdRow.id, name },
			listedBeforeDelete: true,
			listedAfterDelete: false,
			databaseRow: {
				isDelete: Number(dbRow.isDelete),
				deletedAt: dbRow.deleted_at,
				deletedBy: Number(dbRow.deleted_by),
			},
			ok: true,
		});
		expect(readArtifact('soft-delete-deliverable')).toMatchObject({
			ok: true,
		});
	});
});
