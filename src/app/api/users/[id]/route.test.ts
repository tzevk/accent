import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockRelease: vi.fn(),
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		ensurePermission: mocks.mockEnsurePermission,
	};
});

import { GET } from '@/app/api/users/[id]/route';

const db = { execute: mocks.mockExecute, release: mocks.mockRelease };

function params() {
	return { params: Promise.resolve({ id: '89' }) };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.mockDbConnect.mockResolvedValue(db);
	mocks.mockEnsurePermission.mockResolvedValue({
		authorized: true,
		user: { id: 1, is_super_admin: true },
	});
});

describe('GET /api/users/[id]', () => {
	it('returns the role grants alongside the user-specific permissions', async () => {
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					id: 89,
					username: 'rahul.sharma',
					role_id: 28,
					role_name: 'Employee',
					role_code: 'employee',
					role_permissions: '["leads:read","projects:read"]',
					role_hierarchy: 30,
					permissions: [],
					field_permissions: { modules: {} },
				},
			],
		]);

		const response = await GET(
			new Request('http://localhost/api/users/89'),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.role_permissions).toEqual(['leads:read', 'projects:read']);
		expect(body.data.role_name).toBe('Employee');
		expect(mocks.mockExecute.mock.calls[0][0]).toContain(
			'r.permissions AS role_permissions'
		);
	});

	it('normalizes a legacy comma-separated role permission value', async () => {
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					id: 89,
					role_permissions: 'leads:read, projects:read',
				},
			],
		]);

		const response = await GET(
			new Request('http://localhost/api/users/89'),
			params()
		);
		const body = await response.json();

		expect(body.data.role_permissions).toEqual(['leads:read', 'projects:read']);
	});

	it('returns 404 when the user is missing', async () => {
		mocks.mockExecute.mockResolvedValueOnce([[]]);

		const response = await GET(
			new Request('http://localhost/api/users/89'),
			params()
		);

		expect(response.status).toBe(404);
	});
});
