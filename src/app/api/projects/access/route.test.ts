import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
}));

const { GET } = await import('@/app/api/projects/access/route');

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
	return new Request('http://localhost/api/projects/access');
}

describe('GET /api/projects/access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			release: mockRelease,
		});
		mockGetCurrentUser.mockResolvedValue(member);
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('grants a super admin without scanning projects', async () => {
		mockGetCurrentUser.mockResolvedValueOnce({
			...member,
			is_super_admin: 1,
		});

		const response = await GET(request());
		const body = await response.json();

		expect(body.data.hasAccess).toBe(true);
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

		expect(body).toEqual({ success: true, data: { hasAccess: true } });
	});

	it('denies an unrelated user', async () => {
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

		expect(body).toEqual({ success: true, data: { hasAccess: false } });
	});

	it('fails closed when the scan errors', async () => {
		mockExecute.mockRejectedValueOnce(new Error('connection lost'));

		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.hasAccess).toBe(false);
	});
});
