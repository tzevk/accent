import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const { mockRequireProjectAccess } = vi.hoisted(() => ({
	mockRequireProjectAccess: vi.fn(),
}));

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return {
		...actual,
		requireProjectAccess: mockRequireProjectAccess,
	};
});

const { GET, POST, PUT, DELETE } =
	await import('@/app/api/projects/[id]/activities/route');

const project = {
	id: 10,
	project_id: 10,
	project_code: 'CODE-10',
};

const db = { execute: mockExecute, release: mockRelease };

function rights({ read = true, edit = false } = {}) {
	return {
		canOpen: true,
		canContribute: true,
		isMember: true,
		isLead: false,
		sections: { project_activity: { read, edit } },
	};
}

function grantAccess(rightsValue = rights()) {
	mockRequireProjectAccess.mockResolvedValue({
		user: { id: 42, email: 'member@example.com' },
		project,
		rights: rightsValue,
		leadPolicy: { sections: {} },
		db,
		ownsDb: false,
	});
}

function denyAccess() {
	mockRequireProjectAccess.mockResolvedValue({
		response: Response.json(
			{
				success: false,
				error: 'You do not have permission to access this project',
			},
			{ status: 403 }
		),
	});
}

function params() {
	return { params: Promise.resolve({ id: 'PRJ-10' }) };
}

function postRequest(): Request {
	return new Request('http://localhost/api/projects/10/activities', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ activity_name: 'Design review' }),
	});
}

describe('GET /api/projects/[id]/activities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		grantAccess();
		mockExecute.mockResolvedValue([[]]);
	});

	it('returns activities for a readable activity section', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 'a1', project_id: 10, activity_name: 'Design review' }],
		]);

		const response = await GET(
			new Request('http://localhost/api/projects/10/activities'),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data).toEqual([
			{ id: 'a1', project_id: 10, activity_name: 'Design review' },
		]);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('FROM project_activities'),
			[10]
		);
	});

	it('denies a member without project_activity read and queries nothing', async () => {
		grantAccess(rights({ read: false, edit: false }));

		const response = await GET(
			new Request('http://localhost/api/projects/10/activities'),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns the access denial for a scope that does not cover the project', async () => {
		denyAccess();

		const response = await GET(
			new Request('http://localhost/api/projects/10/activities'),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('project activity writes require project_activity edit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		grantAccess(rights({ read: true, edit: true }));
		mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
	});

	it('adds an activity with edit authority', async () => {
		const response = await POST(postRequest(), params());

		expect(response.status).toBe(201);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO project_activities')
			)
		).toBe(true);
	});

	it('updates and deletes by the resolved project key', async () => {
		const put = await PUT(
			new Request('http://localhost/api/projects/10/activities', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					activity_record_id: 'a1',
					activity_name: 'Changed',
				}),
			}),
			params()
		);
		const removed = await DELETE(
			new Request(
				'http://localhost/api/projects/10/activities?activity_record_id=a1'
			),
			params()
		);

		expect(put.status).toBe(200);
		expect(removed.status).toBe(200);
		expect(
			mockExecute.mock.calls.some(
				([sql, values]) =>
					String(sql).startsWith('DELETE FROM project_activities') &&
					values[1] === 10
			)
		).toBe(true);
	});

	it('refuses a lead with view-only activity and writes nothing', async () => {
		grantAccess(rights({ read: true, edit: false }));

		const post = await POST(postRequest(), params());
		const put = await PUT(
			new Request('http://localhost/api/projects/10/activities', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ activity_record_id: 'a1' }),
			}),
			params()
		);
		const removed = await DELETE(
			new Request(
				'http://localhost/api/projects/10/activities?activity_record_id=a1'
			),
			params()
		);

		expect(post.status).toBe(403);
		expect(put.status).toBe(403);
		expect(removed.status).toBe(403);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				/^(INSERT|UPDATE|DELETE)\b/.test(String(sql).trim())
			)
		).toBe(false);
	});

	it('does not let an update grant alone write when the section is not editable', async () => {
		grantAccess(rights({ read: true, edit: false }));

		const response = await POST(postRequest(), params());

		expect(response.status).toBe(403);
	});
});
