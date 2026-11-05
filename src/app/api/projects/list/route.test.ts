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

const { GET } = await import('@/app/api/projects/list/route');

const member = {
	id: 42,
	email: 'member@example.com',
	is_super_admin: 0,
	permissions: [],
	role_permissions: [],
	merged_permissions: [],
	field_permissions: {},
};

const rows = [
	{
		project_id: 'PRJ-1',
		id: 1,
		name: 'Mine',
		status: 'Ongoing',
		priority: 'HIGH',
		project_team: JSON.stringify([{ user_id: 42 }]),
		scope_of_work: 'Scope',
		description: 'Private',
		budget: '100',
	},
	{
		project_id: 'PRJ-2',
		id: 2,
		name: 'Not mine',
		status: 'Completed',
		priority: 'LOW',
		project_team: JSON.stringify([{ user_id: 7 }]),
		budget: '999',
	},
];

function request(): Request {
	return new Request('http://localhost/api/projects/list');
}

describe('GET /api/projects/list project-rights sweep', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			release: mockRelease,
		});
		mockGetCurrentUser.mockResolvedValue(member);
		mockExecute.mockResolvedValueOnce([rows, []]);
		mockExecute.mockImplementation(async (sql: string) =>
			sql.includes('FROM project_lead_policy')
				? [[{ sections: '{}' }], []]
				: [[], []]
		);
	});

	it('returns only openable projects with rights and filtered fields', async () => {
		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].name).toBe('Mine');
		expect(body.data[0].rights.canOpen).toBe(true);
		expect(body.data[0].rights.isMember).toBe(true);
		expect(body.data[0].description).toBeUndefined();
		expect(body.data[0].budget).toBeUndefined();
		expect(Object.hasOwn(body.data[0], 'budget')).toBe(false);
		expect(Object.hasOwn(body.data[0], 'project_value')).toBe(false);
		expect(Object.hasOwn(body.data[0], 'cost_to_company')).toBe(false);
		expect(Object.hasOwn(body.data[0], 'profitability_estimate')).toBe(false);
		expect(Object.hasOwn(body.data[0], 'actual_profit_loss')).toBe(false);
		expect(body.stats.total).toBe(1);
		expect(body.stats.completed).toBe(0);
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('reads only non-deleted projects so a deleted row leaves the list', async () => {
		await GET(request());

		const [sql] = mockExecute.mock.calls[0];
		expect(String(sql)).toContain('isDelete = 0');
	});

	it('returns every commercial column unchanged to a super admin', async () => {
		mockGetCurrentUser.mockResolvedValue({
			...member,
			is_super_admin: 1,
		});
		mockExecute.mockReset();
		mockExecute.mockResolvedValueOnce([
			[
				{
					...rows[0],
					project_value: '5000',
					cost_to_company: '4000',
					profitability_estimate: '20',
					actual_profit_loss: '500',
				},
			],
			[],
		]);

		const response = await GET(request());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data[0].budget).toBe('100');
		expect(body.data[0].project_value).toBe('5000');
		expect(body.data[0].cost_to_company).toBe('4000');
		expect(body.data[0].profitability_estimate).toBe('20');
		expect(body.data[0].actual_profit_loss).toBe('500');
	});
});
