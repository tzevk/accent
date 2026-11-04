import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invalidateUserCache } from '@/utils/api-permissions';
const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn().mockResolvedValue({
		authorized: true,
		user: { id: 1, is_super_admin: true },
	}),
	RESOURCES: { USERS: 'users' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
	getCurrentUser: vi.fn().mockResolvedValue({ id: 1, is_super_admin: true }),
	invalidateUserCache: vi.fn(),
	canModifyTargetUser: vi.fn().mockReturnValue({ allowed: true }),
	validateUserGrants: vi.fn().mockResolvedValue({ allowed: true }),
}));

const { PUT: routePUT } = await import('@/app/api/users/route');
// The route is imported after the module mocks so ensurePermission and the
// database mock are in place when the handler module initializes.

type CreateRequestOpts = { body?: unknown };

function createRequest(opts: CreateRequestOpts = {}) {
	const req = {
		url: 'http://localhost/api/users',
		method: 'PUT',
		headers: new Headers(),
		json: vi.fn().mockResolvedValue(opts.body),
	};
	return req;
}

describe('PUT /api/users project scopes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('persists projectScopes and invalidates the authorization cache', async () => {
		const fieldPermissions = {
			modules: {
				projects: {
					enabled: true,
					name: 'Projects',
					category: 'module',
					crud: { read: true, update: true },
					sections: {},
				},
			},
			projectScopes: {
				projects: { read: 'all', update: 'assigned' },
			},
		};

		mockExecute
			.mockResolvedValueOnce([
				[
					{
						id: '7',
						employee_id: null,
						vendor_id: null,
						account_type: null,
						is_super_admin: 0,
						role_id: 2,
						role_hierarchy: 5,
					},
				],
			])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[{ id: '7', username: 'scoped-user' }]]);

		const response = await routePUT(
			createRequest({
				body: {
					id: '7',
					permissions: ['projects:read', 'projects:update'],
					field_permissions: fieldPermissions,
				},
			})
		);
		const json = await response.json();

		expect(json.success).toBe(true);

		const updateCall = mockExecute.mock.calls.find((call) =>
			String(call[0]).includes('UPDATE users SET')
		);
		expect(updateCall).toBeTruthy();
		const params = updateCall?.[1] as unknown[];
		const stored = JSON.parse(String(params[1]));

		expect(stored.projectScopes).toEqual({
			projects: { read: 'all', update: 'assigned' },
		});
		expect(stored.modules.projects.crud).toEqual({
			read: true,
			update: true,
		});

		expect(invalidateUserCache).toHaveBeenCalledWith('7');
	});

	it('keeps unrelated sibling keys in field_permissions', async () => {
		const fieldPermissions = {
			modules: {},
			projectScopes: { projects: { read: 'led' } },
			futurePermissionGroup: { enabled: true },
		};

		mockExecute
			.mockResolvedValueOnce([
				[
					{
						id: '7',
						employee_id: null,
						vendor_id: null,
						account_type: null,
						is_super_admin: 0,
						role_id: 2,
						role_hierarchy: 5,
					},
				],
			])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[{ id: '7', username: 'scoped-user' }]]);

		await routePUT(
			createRequest({
				body: {
					id: '7',
					permissions: [],
					field_permissions: fieldPermissions,
				},
			})
		);

		const updateCall = mockExecute.mock.calls.find((call) =>
			String(call[0]).includes('UPDATE users SET')
		);
		const stored = JSON.parse(String((updateCall?.[1] as unknown[])[1]));

		expect(stored).toEqual(fieldPermissions);
	});
});
