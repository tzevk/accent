import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT as updateUsers } from '@/app/api/users/route';
import { PUT as updateUser } from '@/app/api/users/[id]/route';

const { mockExecute, mockValidateGrants, mockEnsurePermission } = vi.hoisted(
	() => ({
		mockExecute: vi.fn(),
		mockValidateGrants: vi.fn(),
		mockEnsurePermission: vi.fn(),
	})
);

vi.mock('@/utils/database', () => ({
	dbConnect: vi
		.fn()
		.mockResolvedValue({ execute: mockExecute, release: vi.fn() }),
}));
vi.mock('@/utils/api-permissions', async () => {
	const actual = await vi.importActual<
		typeof import('@/utils/api-permissions')
	>('@/utils/api-permissions');
	return {
		...actual,
		ensurePermission: mockEnsurePermission,
		validateUserGrants: mockValidateGrants,
	};
});
vi.mock('@/utils/session', () => ({ revokeAllUserSessions: vi.fn() }));

const currentUser = {
	id: 7,
	employee_id: null,
	vendor_id: null,
	account_type: 'employee',
	is_super_admin: false,
	role_id: 3,
	role_hierarchy: 1,
};
const actor = { id: 41, is_super_admin: true };

type Route = 'collection' | 'detail';
async function put(route: Route, body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/users', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(route === 'collection' ? { id: 7, ...body } : body),
	});
	if (route === 'collection') return updateUsers(request);
	return updateUser(request, { params: Promise.resolve({ id: '7' }) });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEnsurePermission.mockResolvedValue({ user: actor });
	mockValidateGrants.mockResolvedValue({ allowed: true });
	mockExecute.mockImplementation(async (sql: string) => {
		if (sql.includes('UPDATE users')) return [[]];
		if (sql.includes('SELECT')) return [[currentUser]];
		return [[]];
	});
});

describe('ordinary user update ownership boundary', () => {
	it.each(['collection', 'detail'] as const)(
		'rejects a fractional employee_id on an unlinked account through %s before writing editable fields',
		async (route) => {
			const response = await put(route, {
				employee_id: 1.1,
				full_name: 'Changed name',
			});

			expect(response.status).toBe(409);
		}
	);

	it('accepts an unchanged Employee owner through the collection endpoint', async () => {
		const existing = { ...currentUser, employee_id: 12 };
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('UPDATE users')) return [[]];
			if (sql.includes('SELECT')) return [[existing]];
			return [[]];
		});

		const response = await put('collection', {
			employee_id: '12',
			full_name: 'Changed name',
		});

		expect(response.status).toBe(200);
	});

	it.each([
		['collection', 'employee_id', null],
		['collection', 'vendor_id', 9],
		['collection', 'account_type', 'vendor'],
		['detail', 'employee_id', null],
		['detail', 'vendor_id', 9],
		['detail', 'account_type', 'vendor'],
	] as const)(
		'rejects changed %s ownership field %s',
		async (route, key, value) => {
			const existing = {
				...currentUser,
				employee_id: key === 'employee_id' ? 12 : currentUser.employee_id,
				vendor_id: key === 'vendor_id' ? 5 : currentUser.vendor_id,
			};
			mockExecute.mockImplementation(async (sql: string) => {
				if (sql.includes('UPDATE users')) return [[]];
				if (sql.includes('SELECT')) return [[existing]];
				return [[]];
			});
			const response = await put(route, {
				[key]: value,
				full_name: 'Changed name',
			});

			expect(response.status).toBe(409);
		}
	);

	it('accepts an unchanged Employee owner through the detail endpoint', async () => {
		const existing = { ...currentUser, employee_id: 12 };
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('UPDATE users')) return [[]];
			if (sql.includes('SELECT')) return [[existing]];
			return [[]];
		});

		const response = await put('detail', {
			employee_id: 12,
			full_name: 'Changed name',
		});

		expect(response.status).toBe(200);
	});
});
