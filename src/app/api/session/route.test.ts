import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { mockExecute, mockRelease, mockDbConnect, mockGetCurrentUser } =
	vi.hoisted(() => ({
		mockExecute: vi.fn(),
		mockRelease: vi.fn(),
		mockDbConnect: vi.fn(),
		mockGetCurrentUser: vi.fn(),
	}));

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
}));

const member = {
	id: 42,
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

function request(): Request {
	return new Request('http://localhost/api/session');
}

describe('GET /api/session', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			release: mockRelease,
		});
		mockGetCurrentUser.mockResolvedValue(member);
		mockExecute.mockImplementation(async (sql: string) =>
			sql.includes('FROM project_lead_policy')
				? [[{ sections: '{}' }], []]
				: [[], []]
		);
	});

	it('does not check Projects access without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request());

		expect(await response.json()).toEqual({ authenticated: false });
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('grants a super admin without scanning projects', async () => {
		mockGetCurrentUser.mockResolvedValueOnce({
			...member,
			is_super_admin: 1,
		});

		const response = await GET(request());
		const body = await response.json();

		expect(body).toMatchObject({
			authenticated: true,
			user: { id: member.id, hasProjectAccess: true },
		});
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('grants access from a team relationship', async () => {
		mockExecute.mockResolvedValueOnce([
			[
				{
					project_id: 10,
					project_team: JSON.stringify([{ user_id: 42 }]),
				},
			],
			[],
		]);

		const response = await GET(request());
		const body = await response.json();

		expect(body).toMatchObject({
			authenticated: true,
			user: { id: member.id, hasProjectAccess: true },
		});
	});

	it('hides Projects for a user with a global read grant but no accessible Project', async () => {
		mockGetCurrentUser.mockResolvedValueOnce({
			...member,
			merged_permissions: ['projects:read'],
		});
		mockExecute.mockResolvedValueOnce([
			[
				{
					project_id: 10,
					project_team: JSON.stringify([{ user_id: 7 }]),
				},
			],
			[],
		]);

		const response = await GET(request());
		const body = await response.json();

		expect(body).toMatchObject({
			authenticated: true,
			user: { id: member.id, hasProjectAccess: false },
		});
	});

	it('hides Projects but preserves the authenticated session when the scan errors', async () => {
		mockExecute.mockRejectedValueOnce(new Error('connection lost'));

		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			authenticated: true,
			user: { id: member.id, hasProjectAccess: false },
		});
	});
});
