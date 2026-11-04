import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const { mockRequireProjectAccess, mockLoadLeadPolicy } = vi.hoisted(() => ({
	mockRequireProjectAccess: vi.fn(),
	mockLoadLeadPolicy: vi.fn(),
}));

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return {
		...actual,
		requireProjectAccess: mockRequireProjectAccess,
		loadLeadPolicy: mockLoadLeadPolicy,
	};
});

const {
	GET,
	POST,
	PUT,
	DELETE,
} = await import('@/app/api/projects/[id]/followups/route');

const project = {
	id: 10,
	project_id: 10,
	project_code: 'CODE-10',
	project_team: '[]',
};

const db = { execute: mockExecute, release: mockRelease };

function rights(overrides = {}) {
	return {
		canOpen: true,
		canContribute: true,
		isMember: true,
		isLead: false,
		sections: {
			discussion: { read: true, edit: false },
		},
		...overrides,
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
	return new Request('http://localhost/api/projects/PRJ-10/followups', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			follow_up_date: '2026-08-03',
			description: 'Review the schedule',
		}),
	});
}

describe('GET /api/projects/[id]/followups', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		grantAccess();
		mockExecute.mockResolvedValue([[]]);
	});

	it('returns follow-ups for a readable discussion section', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 5, project_id: 10, description: 'Review' }],
		]);

		const response = await GET(
			new Request('http://localhost/api/projects/PRJ-10/followups'),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data).toEqual([
			{ id: 5, project_id: 10, description: 'Review' },
		]);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('SELECT * FROM project_followups'),
			[10]
		);
	});

	it('denies and queries nothing when the lead policy hides discussion', async () => {
		grantAccess(
			rights({
				isLead: true,
				sections: { discussion: { read: false, edit: false } },
			})
		);

		const response = await GET(
			new Request('http://localhost/api/projects/PRJ-10/followups'),
			params()
		);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body).toEqual({
			success: false,
			error: 'You do not have permission to access this project',
		});
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns the access denial unchanged for a scope that does not cover the project', async () => {
		denyAccess();

		const response = await GET(
			new Request('http://localhost/api/projects/PRJ-10/followups'),
			params()
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('follow-up writes use discussion contribution rights', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		grantAccess();
		mockExecute.mockResolvedValue([{ insertId: 5, affectedRows: 1 }]);
	});

	it('accepts a discussion contribution from a team member', async () => {
		const response = await POST(postRequest(), params());

		expect(response.status).toBe(200);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO project_followups')
			)
		).toBe(true);
	});

	it('does not require the global projects:update grant', async () => {
		const response = await POST(postRequest(), params());

		expect(response.status).toBe(200);
	});

	it('refuses a lead whose policy makes discussion view-only', async () => {
		grantAccess(
			rights({
				isLead: true,
				sections: { discussion: { read: true, edit: false } },
			})
		);

		const response = await POST(postRequest(), params());

		expect(response.status).toBe(403);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('INSERT')
			)
		).toBe(false);
	});

	it('allows a lead with discussion edit', async () => {
		grantAccess(
			rights({
				isLead: true,
				sections: { discussion: { read: true, edit: true } },
			})
		);

		const response = await POST(postRequest(), params());

		expect(response.status).toBe(200);
	});

	it('refuses PUT and DELETE for a view-only lead and writes nothing', async () => {
		grantAccess(
			rights({
				isLead: true,
				sections: { discussion: { read: true, edit: false } },
			})
		);

		const put = await PUT(
			new Request('http://localhost/api/projects/PRJ-10/followups', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: 5, description: 'Changed' }),
			}),
			params()
		);
		const removed = await DELETE(
			new Request(
				'http://localhost/api/projects/PRJ-10/followups?followup_id=5'
			),
			params()
		);

		expect(put.status).toBe(403);
		expect(removed.status).toBe(403);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				/^(UPDATE|DELETE|INSERT)/.test(String(sql).trim())
			)
		).toBe(false);
	});

	it('lets a lead with edit update and delete', async () => {
		grantAccess(
			rights({
				isLead: true,
				sections: { discussion: { read: true, edit: true } },
			})
		);

		const put = await PUT(
			new Request('http://localhost/api/projects/PRJ-10/followups', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: 5, description: 'Changed' }),
			}),
			params()
		);
		const removed = await DELETE(
			new Request(
				'http://localhost/api/projects/PRJ-10/followups?followup_id=5'
			),
			params()
		);

		expect(put.status).toBe(200);
		expect(removed.status).toBe(200);
	});

	it('refuses a removed member contribution', async () => {
		grantAccess(rights({ canContribute: false }));

		const response = await POST(postRequest(), params());

		expect(response.status).toBe(403);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('INSERT')
			)
		).toBe(false);
	});
});
