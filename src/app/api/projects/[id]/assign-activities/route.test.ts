import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRights from '@/lib/project-rights';

const mocks = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockRelease: vi.fn(),
	mockDbConnect: vi.fn(),
	mockRequireProjectAccess: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRights>();
	return {
		...actual,
		requireProjectAccess: mocks.mockRequireProjectAccess,
	};
});
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn(),
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: { READ: 'read', ASSIGN: 'assign' },
}));

// The handler imports after `vi.mock` so the mocks are hoisted first.
const { GET, POST, PUT, DELETE } = await import(
	'@/app/api/projects/[id]/assign-activities/route'
);

const db = { execute: mocks.mockExecute, release: mocks.mockRelease };

function params() {
	return { params: Promise.resolve({ id: '1' }) };
}

function request(body: unknown, method = 'POST') {
	return new Request('http://localhost/api/projects/1/assign-activities', {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

function team(memberIds: number[]) {
	return JSON.stringify(
		memberIds.map((id) => ({
			user_id: id,
			email: id === 42 ? 'member@example.com' : `user${id}@example.com`,
		}))
	);
}

function access(options: {
	memberIds?: number[];
	canAssignActivity?: boolean;
	projectActivityRead?: boolean;
} = {}) {
	const {
		memberIds = [42],
		canAssignActivity = true,
		projectActivityRead = true,
	} = options;
	return {
		user: { id: 1, email: 'manager@example.com', is_super_admin: 0 },
		project: {
			project_id: 1,
			title: 'Project One',
			project_team: team(memberIds),
		},
		rights: {
			canAssignActivity,
			sections: { project_activity: { read: projectActivityRead } },
		},
		db,
		ownsDb: false,
	};
}

function identityRows(rows: Array<Record<string, unknown>>) {
	return [rows];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.mockDbConnect.mockResolvedValue(db);
	mocks.mockRequireProjectAccess.mockResolvedValue(access());
});

describe('POST project activity assignments', () => {
	it('refuses a non-member with the shared code and message', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue(
			access({ memberIds: [7] })
		);
		mocks.mockExecute.mockResolvedValueOnce(
			identityRows([
				{
					id: 42,
					full_name: 'Nina Nonmember',
					email: 'nina@example.com',
				},
			])
		);

		const response = await POST(
			request({
				activities: [{ user_id: 42, activity_name: 'RCC Check' }],
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body).toEqual({
			success: false,
			code: 'ASSIGNEE_NOT_PROJECT_MEMBER',
			error:
				'Add Nina Nonmember to the Project Team before assigning this activity.',
		});
		// Only the identity lookup ran; no assignment or team write exists.
		expect(mocks.mockExecute.mock.calls).toHaveLength(1);
	});

	it('creates the assignment for a current team member', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(
				identityRows([
					{
						id: 42,
						full_name: 'Mona Member',
						email: 'member@example.com',
					},
				])
			)
			.mockResolvedValueOnce([[{ id: 42, username: 'mona' }]])
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await POST(
			request({
				activities: [{ user_id: 42, activity_name: 'RCC Check' }],
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(201);
		expect(body.assigned).toBe(1);

		const insert = mocks.mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_activity_assignments')
		);
		expect(insert).toBeDefined();
		expect(insert[1][1]).toBe(42);

		// Assignment never changes the team.
		const teamWrite = mocks.mockExecute.mock.calls.find(([sql]) =>
			/set\s+project_team/i.test(String(sql))
		);
		expect(teamWrite).toBeUndefined();
	});

	it('refuses the whole batch before writing when any target is a non-member', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue(
			access({ memberIds: [42] })
		);
		mocks.mockExecute.mockResolvedValueOnce(
			identityRows([
				{ id: 42, full_name: 'Mona Member', email: 'member@example.com' },
				{ id: 99, full_name: 'Sam Stranger', email: 'sam@example.com' },
			])
		);

		const response = await POST(
			request({
				activities: [
					{ user_id: 42, activity_name: 'Member work' },
					{ user_id: 99, activity_name: 'Stranger work' },
				],
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.code).toBe('ASSIGNEE_NOT_PROJECT_MEMBER');
		expect(body.error).toContain('Sam Stranger');
		expect(
			mocks.mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO user_activity_assignments')
			)
		).toBe(false);
	});

	it('refuses an actor without assignment authority', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue(
			access({ canAssignActivity: false })
		);

		const response = await POST(
			request({
				activities: [{ user_id: 42, activity_name: 'RCC Check' }],
			}),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.success).toBe(false);
		expect(mocks.mockExecute).not.toHaveBeenCalled();
	});

	it('returns the access failure untouched', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue({
			response: Response.json(
				{ success: false, error: 'denied' },
				{ status: 403 }
			),
		});

		const response = await POST(
			request({
				activities: [{ user_id: 42, activity_name: 'RCC Check' }],
			}),
			params()
		);

		expect(response.status).toBe(403);
		expect(mocks.mockExecute).not.toHaveBeenCalled();
	});
});

describe('PUT project activity assignments', () => {
	it('refuses changing an assignment to a non-member before writing', async () => {
		mocks.mockExecute.mockResolvedValueOnce(
			identityRows([
				{ id: 99, full_name: 'Sam Stranger', email: 'sam@example.com' },
			])
		);

		const response = await PUT(
			request(
				{ updates: [{ assignment_id: 'a1', user_id: 99 }] },
				'PUT'
			),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body).toEqual({
			success: false,
			code: 'ASSIGNEE_NOT_PROJECT_MEMBER',
			error:
				'Add Sam Stranger to the Project Team before assigning this activity.',
		});
		expect(
			mocks.mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE user_activity_assignments')
			)
		).toBe(false);
	});

	it('reassigns to a current member', async () => {
		mocks.mockExecute
			.mockResolvedValueOnce(
				identityRows([
					{
						id: 42,
						full_name: 'Mona Member',
						email: 'member@example.com',
					},
				])
			)
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await PUT(
			request(
				{ updates: [{ assignment_id: 'a1', user_id: 42 }] },
				'PUT'
			),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.updated).toBe(1);
	});
});

describe('DELETE project activity assignments', () => {
	it('removes an assignment for an authorised manager', async () => {
		mocks.mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await DELETE(
			new Request(
				'http://localhost/api/projects/1/assign-activities?assignment_id=a1',
				{ method: 'DELETE' }
			),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
	});

	it('refuses a manager without assignment authority', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue(
			access({ canAssignActivity: false })
		);

		const response = await DELETE(
			new Request(
				'http://localhost/api/projects/1/assign-activities?assignment_id=a1',
				{ method: 'DELETE' }
			),
			params()
		);

		expect(response.status).toBe(403);
		expect(mocks.mockExecute).not.toHaveBeenCalled();
	});
});


describe('GET project activity assignments', () => {
	function getRequest() {
		return new Request('http://localhost/api/projects/1/assign-activities', {
			method: 'GET',
		});
	}

	it('lets a project lead list assignments without the assign grant', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue(
			access({ canAssignActivity: false, projectActivityRead: true })
		);
		mocks.mockExecute.mockResolvedValueOnce([
			[
				{
					user_id: 42,
					full_name: 'Member One',
					username: 'member',
					position: 'Engineer',
				},
			],
		]);

		const response = await GET(getRequest(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.total).toBe(1);
		expect(mocks.mockExecute.mock.calls[0][1]).toEqual([1]);
	});

	it('refuses an actor with neither assignment nor activity read', async () => {
		mocks.mockRequireProjectAccess.mockResolvedValue(
			access({ canAssignActivity: false, projectActivityRead: false })
		);

		const response = await GET(getRequest(), params());

		expect(response.status).toBe(403);
		expect(mocks.mockExecute).not.toHaveBeenCalled();
	});
});
