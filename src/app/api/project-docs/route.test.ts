import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const { mockRequireProjectAccess } = vi.hoisted(() => ({
	mockRequireProjectAccess: vi.fn(),
}));

const mockDb = { execute: mockExecute, release: mockRelease };

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return {
		...actual,
		requireProjectAccess: mockRequireProjectAccess,
	};
});

const { GET, POST, PUT, DELETE } = await import('@/app/api/project-docs/route');

const project = {
	id: 10,
	project_id: 10,
	project_code: 'CODE-10',
};

function grantAccess({ read = true, edit = true } = {}) {
	mockRequireProjectAccess.mockResolvedValue({
		user: { id: 42, email: 'member@example.com' },
		project,
		rights: {
			canOpen: true,
			canContribute: true,
			isMember: true,
			isLead: false,
			sections: { upload_documents: { read, edit } },
		},
		leadPolicy: { sections: {} },
		db: mockDb,
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

function jsonRequest(body: unknown, method = 'POST'): Request {
	return new Request('http://localhost/api/project-docs', {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('GET /api/project-docs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockExecute.mockResolvedValue([[]]);
	});

	it('requires a target project instead of returning every document', async () => {
		grantAccess();

		const response = await GET(new Request('http://localhost/api/project-docs'));

		expect(response.status).toBe(400);
		expect(mockRequireProjectAccess).not.toHaveBeenCalled();
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns the documents of a readable project only', async () => {
		grantAccess();
		mockExecute.mockResolvedValueOnce([
			[{ id: 'd1', project_id: 10, name: 'Spec' }],
		]);

		const response = await GET(
			new Request('http://localhost/api/project-docs?project_id=PRJ-10')
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: [{ id: 'd1', project_id: 10, name: 'Spec' }],
		});
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('WHERE pd.project_id = ?'),
			[10]
		);
	});

	it('denies when upload_documents is not readable', async () => {
		grantAccess({ read: false, edit: false });

		const response = await GET(
			new Request('http://localhost/api/project-docs?project_id=PRJ-10')
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns the access denial for a project the actor cannot open', async () => {
		denyAccess();

		const response = await GET(
			new Request('http://localhost/api/project-docs?project_id=PRJ-10')
		);

		expect(response.status).toBe(403);
	});
});

describe('project-docs writes require upload_documents edit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbConnect.mockResolvedValue(mockDb);
		mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
	});

	it('links a document to the resolved project with edit authority', async () => {
		grantAccess();

		const response = await POST(
			jsonRequest({ project_id: 'PRJ-10', name: 'Spec' })
		);

		expect(response.status).toBe(201);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO project_documents'),
			expect.arrayContaining([10])
		);
	});

	it('denies a document link when the section is read-only', async () => {
		grantAccess({ read: true, edit: false });

		const response = await POST(
			jsonRequest({ project_id: 'PRJ-10', name: 'Spec' })
		);

		expect(response.status).toBe(403);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('INSERT')
			)
		).toBe(false);
	});

	it('resolves the stored document project before updating', async () => {
		grantAccess();
		mockExecute
			.mockResolvedValueOnce([[{ project_id: 10 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await PUT(
			jsonRequest({ id: 'doc-1', name: 'Renamed' }, 'PUT')
		);

		expect(response.status).toBe(200);
		expect(mockRequireProjectAccess).toHaveBeenCalledWith(
			expect.anything(),
			10,
			expect.objectContaining({ db: mockDb })
		);
	});

	it('denies a stored document update without upload_documents edit', async () => {
		grantAccess({ read: true, edit: false });
		mockExecute.mockResolvedValueOnce([[{ project_id: 10 }]]);

		const response = await PUT(
			jsonRequest({ id: 'doc-1', name: 'Renamed' }, 'PUT')
		);

		expect(response.status).toBe(403);
		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).startsWith('UPDATE project_documents')
			)
		).toBe(false);
	});

	it('returns 404 for an unknown stored document', async () => {
		mockExecute.mockResolvedValueOnce([[]]);

		const response = await DELETE(
			new Request('http://localhost/api/project-docs?id=missing', {
				method: 'DELETE',
			})
		);

		expect(response.status).toBe(404);
		expect(mockRequireProjectAccess).not.toHaveBeenCalled();
	});

	it('deletes only the stored document of an editable project', async () => {
		grantAccess();
		mockExecute
			.mockResolvedValueOnce([[{ project_id: 10 }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);

		const response = await DELETE(
			new Request('http://localhost/api/project-docs?id=doc-1', {
				method: 'DELETE',
			})
		);

		expect(response.status).toBe(200);
		expect(mockExecute).toHaveBeenLastCalledWith(
			expect.stringContaining('DELETE FROM project_documents'),
			['doc-1', 10]
		);
	});
});
