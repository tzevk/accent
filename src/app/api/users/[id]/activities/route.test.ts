import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiPermissions from '@/utils/api-permissions';

const mockExecute = vi.fn();
const mockEnd = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual = await importOriginal<typeof ApiPermissions>();
	return { ...actual, getCurrentUser: mockGetCurrentUser };
});

// Load after mocks so this HTTP contract receives the mocked dependencies.
const { GET } = await import('@/app/api/users/[id]/activities/route');

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
	return new Request('http://localhost/api/users/42/activities');
}

function params() {
	return { params: Promise.resolve({ id: '42' }) };
}

describe('GET /api/users/[id]/activities Logged Hours', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockDbConnect.mockResolvedValue({
			execute: mockExecute,
			end: mockEnd,
		});
		mockGetCurrentUser.mockResolvedValue(member);
	});

	it('decodes effective and legacy entries with Work Period precedence', async () => {
		mockExecute.mockResolvedValue([
			[
				{
					id: 'assignment-work-period',
					project_id: 10,
					activity_name: 'Implementation',
					daily_entries: JSON.stringify([
						{
							date: '2026-10-25',
							hours: 7,
							remarks: 'Historical duration',
						},
						{ date: '2026-10-26', hours: 2 },
						{ date: '2026-10-27', hours: '3' },
					]),
					legacy_daily_entries: JSON.stringify([
						{
							date: '2026-10-25',
							hours: 7,
							remarks: 'Historical duration',
						},
					]),
					work_period_entries: JSON.stringify([
						{ date: '2026-10-27', hours: 3 },
					]),
					actual_hours: '99',
				},
				{
					id: 'assignment-legacy',
					project_id: 10,
					activity_name: 'Historical work',
					daily_entries: JSON.stringify([{ date: '2026-10-24', hours: 4 }]),
					legacy_daily_entries: JSON.stringify([
						{ date: '2026-10-24', hours: 4 },
					]),
					work_period_entries: null,
					actual_hours: '7.5',
				},
				{
					id: 'assignment-malformed',
					project_id: 10,
					activity_name: 'Malformed projection',
					daily_entries: '{invalid json',
					legacy_daily_entries: JSON.stringify([
						{ date: '2026-10-23', hours: 6 },
					]),
					work_period_entries: '[]',
					actual_hours: '99',
				},
			],
			[],
		]);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.count).toBe(3);
		expect(body.data[0]).toMatchObject({
			actual_hours: 12,
			daily_entries: [
				{
					date: '2026-10-25',
					hours: 7,
					remarks: 'Historical duration',
				},
				{ date: '2026-10-26', hours: 2 },
				{ date: '2026-10-27', hours: '3' },
			],
			legacy_daily_entries: [
				{
					date: '2026-10-25',
					hours: 7,
					remarks: 'Historical duration',
				},
			],
		});
		expect(body.data[1].actual_hours).toBe(7.5);
		expect(body.data[2]).toMatchObject({
			actual_hours: 0,
			daily_entries: [],
			legacy_daily_entries: [{ date: '2026-10-23', hours: 6 }],
		});
		expect(mockEnd).toHaveBeenCalledOnce();
	});
});
