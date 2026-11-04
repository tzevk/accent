import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTableColumns = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: mockGetTableColumns,
}));

const { GET } = await import('@/app/api/projects/[id]/detail/route');

const project = {
	id: 10,
	project_id: 'PRJ-10',
	project_code: 'CODE-10',
	name: 'Alpha Project',
	status: 'Ongoing',
	priority: 'HIGH',
	project_team: JSON.stringify([{ user_id: 42, role: 'Team Member' }]),
	scope_of_work: 'Visible scope',
	description: 'Internal notes',
	budget: '1000',
	project_value: '5000',
	cost_to_company: '4000',
	profitability_estimate: '20',
	actual_profit_loss: '500',
};

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
	return new Request('http://localhost/api/projects/PRJ-10/detail');
}

function params(id = 'PRJ-10') {
	return { params: Promise.resolve({ id }) };
}

describe('GET /api/projects/[id]/detail commercial omission', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			release: mockRelease,
		});
		mockGetCurrentUser.mockResolvedValue(member);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockExecute.mockResolvedValue([[project], []]);
	});

	it('returns 401 without a session', async () => {
		mockGetCurrentUser.mockResolvedValueOnce(null);

		const response = await GET(request(), params());

		expect(response.status).toBe(401);
	});

	it('omits protected amounts from the detail load as absent keys', async () => {
		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.name).toBe('Alpha Project');
		for (const column of [
			'budget',
			'project_value',
			'cost_to_company',
			'profitability_estimate',
			'actual_profit_loss',
		]) {
			expect(Object.hasOwn(body.data, column)).toBe(false);
		}
	});

	it('keeps the amounts in the same shape for an authorised reader', async () => {
		mockGetCurrentUser.mockResolvedValue({
			...member,
			is_super_admin: 1,
		});

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.project_value).toBe('5000');
		expect(body.data.cost_to_company).toBe('4000');
		expect(body.data.profitability_estimate).toBe('20');
		expect(body.data.actual_profit_loss).toBe('500');
	});

	it('does not reveal internal cost for a quotation grant alone', async () => {
		mockGetCurrentUser.mockResolvedValue({
			...member,
			merged_permissions: ['quotations:read'],
		});

		const response = await GET(request(), params());
		const body = await response.json();

		expect(body.rights.financialAreas.quotation).toBe(true);
		expect(Object.hasOwn(body.data, 'cost_to_company')).toBe(false);
		expect(Object.hasOwn(body.data, 'profitability_estimate')).toBe(false);
		expect(Object.hasOwn(body.data, 'project_value')).toBe(false);
	});

	it('denies a non-member with the generic project denial', async () => {
		mockGetCurrentUser.mockResolvedValue({
			...member,
			id: 99,
			email: 'outsider@example.com',
		});

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body).toEqual({
			success: false,
			error: 'You do not have permission to access this project',
		});
	});
});
