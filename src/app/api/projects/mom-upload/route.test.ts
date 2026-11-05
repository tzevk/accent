import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ProjectRightsModule from '@/lib/project-rights';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const { mockRequireProjectAccess } = vi.hoisted(() => ({
	mockRequireProjectAccess: vi.fn(),
}));

const db = { execute: mockExecute, release: mockRelease };

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return {
		...actual,
		requireProjectAccess: mockRequireProjectAccess,
	};
});

const { GET, POST } =
	await import('@/app/api/projects/mom-upload/route');

const project = { id: 10, project_id: 10, project_code: 'CODE-10' };

function grantAccess(right: 'read' | 'edit') {
	mockRequireProjectAccess.mockResolvedValue({
		user: { id: 42, email: 'member@example.com' },
		project,
		rights: {
			canOpen: true,
			canContribute: true,
			isMember: true,
			isLead: false,
			sections: {
				minutes_internal_meet: {
					read: true,
					edit: right === 'edit',
				},
			},
		},
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

function uploadRequest(fields: Record<string, unknown>): Request {
	return {
		formData: async () => ({ get: (key: string) => fields[key] }),
	} as unknown as Request;
}

function file(name = 'mom.pdf', type = 'application/pdf') {
	return {
		name,
		type,
		size: 1024,
		arrayBuffer: async () => Buffer.from('mom'),
	};
}

describe('POST /api/projects/mom-upload', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
	});

	it('requires the target project', async () => {
		grantAccess('edit');

		const response = await POST(uploadRequest({ file: file() }));

		expect(response.status).toBe(400);
		expect(mockRequireProjectAccess).not.toHaveBeenCalled();
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('stores the document against the project and uploader', async () => {
		grantAccess('edit');

		const response = await POST(
			uploadRequest({ file: file(), project_id: 'PRJ-10' })
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.file_url).toContain('project_id=10');
		const [sql, params] = mockExecute.mock.calls[0];
		expect(sql).toContain('INSERT INTO project_mom_documents');
		expect(params[1]).toBe(10);
		expect(params[6]).toBe(42);
	});

	it('denies an upload without minutes_internal_meet edit', async () => {
		grantAccess('read');

		const response = await POST(
			uploadRequest({ file: file(), project_id: 'PRJ-10' })
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns the access denial for a project the actor cannot open', async () => {
		denyAccess();

		const response = await POST(
			uploadRequest({ file: file(), project_id: 'PRJ-10' })
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('GET /api/projects/mom-upload', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockResolvedValue([
			[
				{
					id: 'doc-1',
					original_name: 'mom.pdf',
					file_type: 'application/pdf',
					file_data: Buffer.from('mom'),
				},
			],
		]);
	});

	it('requires both the document and its project', async () => {
		grantAccess('read');

		const missingProject = await GET(
			new Request('http://localhost/api/projects/mom-upload?id=doc-1')
		);
		const missingDocument = await GET(
			new Request(
				'http://localhost/api/projects/mom-upload?project_id=PRJ-10'
			)
		);

		expect(missingProject.status).toBe(400);
		expect(missingDocument.status).toBe(400);
		expect(mockRequireProjectAccess).not.toHaveBeenCalled();
	});

	it('serves a document only inside its readable project', async () => {
		grantAccess('read');

		const response = await GET(
			new Request(
				'http://localhost/api/projects/mom-upload?id=doc-1&project_id=PRJ-10'
			)
		);

		expect(response.status).toBe(200);
		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining('WHERE id = ? AND project_id = ?'),
			['doc-1', 10]
		);
	});

	it('denies a document UUID in a project without minutes_internal_meet read', async () => {
		mockRequireProjectAccess.mockResolvedValue({
			user: { id: 42, email: 'member@example.com' },
			project,
			rights: {
				canOpen: true,
				sections: { minutes_internal_meet: { read: false, edit: false } },
			},
			leadPolicy: { sections: {} },
			db,
			ownsDb: false,
		});

		const response = await GET(
			new Request(
				'http://localhost/api/projects/mom-upload?id=doc-1&project_id=PRJ-10'
			)
		);

		expect(response.status).toBe(403);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('returns 404 when the document is not attached to the project', async () => {
		grantAccess('read');
		mockExecute.mockResolvedValueOnce([[]]);

		const response = await GET(
			new Request(
				'http://localhost/api/projects/mom-upload?id=doc-1&project_id=PRJ-10'
			)
		);

		expect(response.status).toBe(404);
	});
});
