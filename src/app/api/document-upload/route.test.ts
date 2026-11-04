import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import type * as ProjectRightsModule from '@/lib/project-rights';

const {
	mockQuery,
	mockWriteFile,
	mockMkdir,
	mockUnlink,
	mockReadFile,
	mockExistsSync,
} = vi.hoisted(() => ({
	mockQuery: vi.fn(),
	mockWriteFile: vi.fn().mockResolvedValue(undefined),
	mockMkdir: vi.fn().mockResolvedValue(undefined),
	mockUnlink: vi.fn().mockResolvedValue(undefined),
	mockReadFile: vi.fn().mockResolvedValue(Buffer.from('sample-file-content')),
	mockExistsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('@/utils/database', () => ({
	query: (...args: unknown[]) => mockQuery(...args),
}));

const { mockRequireProjectAccess } = vi.hoisted(() => ({
	mockRequireProjectAccess: vi.fn(),
}));

vi.mock('@/lib/project-rights', async (importOriginal) => {
	const actual = await importOriginal<typeof ProjectRightsModule>();
	return {
		...actual,
		requireProjectAccess: mockRequireProjectAccess,
		loadLeadPolicy: vi.fn().mockResolvedValue({ sections: {} }),
	};
});

function grantProjectAccess({
	read = true,
	edit = true,
	userId = 5,
	projectId = 10,
} = {}) {
	mockRequireProjectAccess.mockResolvedValue({
		user: { id: userId, email: 'member@example.com' },
		project: { id: projectId, project_id: projectId },
		rights: {
			canOpen: true,
			canContribute: true,
			isMember: true,
			isLead: false,
			sections: { upload_documents: { read, edit } },
		},
		leadPolicy: { sections: {} },
		db: { release: vi.fn() },
		ownsDb: false,
	});
}

function denyProjectAccess(status = 403) {
	mockRequireProjectAccess.mockResolvedValue({
		response: NextResponse.json(
			{
				success: false,
				error:
					status === 401
						? 'Unauthorized'
						: 'You do not have permission to access this project',
			},
			{ status }
		),
	});
}

let currentMockUser: Record<string, unknown> | null = null;

vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/utils/api-permissions')>();
	return {
		...actual,
		getCurrentUser: vi.fn().mockImplementation(async () => currentMockUser),
		ensurePermission: vi
			.fn()
			.mockImplementation(async (req, resource, permission) => {
				if (!currentMockUser) {
					return NextResponse.json(
						{ success: false, error: 'Unauthorized' },
						{ status: 401 }
					);
				}
				const userPerms =
					(currentMockUser.merged_permissions as string[]) || [];
				const required = `${resource}:${permission}`;
				if (currentMockUser.is_super_admin || userPerms.includes(required)) {
					return { authorized: true, user: currentMockUser };
				}
				return NextResponse.json(
					{ success: false, error: `Forbidden: missing ${required}` },
					{ status: 403 }
				);
			}),
	};
});

vi.mock('fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs/promises')>();
	return {
		...actual,
		default: {
			...actual,
			writeFile: (...args: unknown[]) => mockWriteFile(...args),
			mkdir: (...args: unknown[]) => mockMkdir(...args),
			unlink: (...args: unknown[]) => mockUnlink(...args),
			readFile: (...args: unknown[]) => mockReadFile(...args),
		},
		writeFile: (...args: unknown[]) => mockWriteFile(...args),
		mkdir: (...args: unknown[]) => mockMkdir(...args),
		unlink: (...args: unknown[]) => mockUnlink(...args),
		readFile: (...args: unknown[]) => mockReadFile(...args),
	};
});

vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return {
		...actual,
		default: {
			...actual,
			existsSync: (...args: unknown[]) => mockExistsSync(...args),
		},
		existsSync: (...args: unknown[]) => mockExistsSync(...args),
	};
});

describe('SEC-06 & SEC-10 — Document Upload, IDOR, and Authenticated Downloads', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockQuery.mockReset();
		mockRequireProjectAccess.mockReset();
		currentMockUser = null;
		mockExistsSync.mockReturnValue(true);
	});

	describe('POST /api/document-upload', () => {
		const makePostRequest = (fields: Record<string, unknown>) => {
			return {
				formData: async () => ({
					get: (key: string) => fields[key],
				}),
				url: 'http://localhost/api/document-upload',
				method: 'POST',
			} as unknown as Request;
		};

		const makeMockFile = (name: string, type: string, size = 1024) => ({
			name,
			type,
			size,
			arrayBuffer: async () => Buffer.from('mock-file-content'),
		});

		it('returns 401 when user is not authenticated', async () => {
			denyProjectAccess(401);
			const { POST } = await import('@/app/api/document-upload/route');
			const file = makeMockFile('spec.pdf', 'application/pdf');
			const req = makePostRequest({
				file,
				entity_type: 'project',
				entity_id: '10',
			});

			const res = await POST(req);
			expect(res.status).toBe(401);
		});
		it('returns 403 when the project upload section is read-only', async () => {
			currentMockUser = {
				id: 2,
				username: 'bob',
				is_super_admin: 0,
				merged_permissions: ['projects:read'],
			};
			grantProjectAccess({ read: true, edit: false });

			const { POST } = await import('@/app/api/document-upload/route');
			const file = makeMockFile('spec.pdf', 'application/pdf');
			const req = makePostRequest({
				file,
				entity_type: 'project',
				entity_id: '10',
			});
			const res = await POST(req);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toBe(
				'You do not have permission to access this project'
			);
		});

		it('denies a project the actor cannot access (IDOR prevention)', async () => {
			currentMockUser = {
				id: 1,
				username: 'alice',
				is_super_admin: 0,
				merged_permissions: ['projects:update'],
			};
			denyProjectAccess();

			const { POST } = await import('@/app/api/document-upload/route');
			const file = makeMockFile('spec.pdf', 'application/pdf');
			const req = makePostRequest({
				file,
				entity_type: 'project',
				entity_id: '999',
			});
			const res = await POST(req);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toBe(
				'You do not have permission to access this project'
			);
		});

		it('returns 400 when file extension or type is disallowed', async () => {
			currentMockUser = {
				id: 1,
				username: 'alice',
				is_super_admin: 0,
				merged_permissions: ['projects:update'],
			};
			grantProjectAccess();

			const { POST } = await import('@/app/api/document-upload/route');
			const file = makeMockFile('payload.svg', 'image/svg+xml');
			const req = makePostRequest({
				file,
				entity_type: 'project',
				entity_id: '10',
			});
			const res = await POST(req);
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toContain('File type not allowed');
		});

		it('successfully uploads file to private directory with UUID and creates entity_documents record', async () => {
			currentMockUser = {
				id: 5,
				username: 'alice',
				is_super_admin: 0,
				merged_permissions: ['projects:update'],
			};
			grantProjectAccess({ userId: 5 });
			mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT

			const { POST } = await import('@/app/api/document-upload/route');
			const file = makeMockFile('report.pdf', 'application/pdf');
			const req = makePostRequest({
				file,
				entity_type: 'project',
				entity_id: '10',
			});
			const res = await POST(req);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.file_url).toMatch(
				/^\/api\/document-upload\/download\?id=/
			);

			// Verify file saved in private/documents without entity_id in path (SEC-10)
			expect(mockWriteFile).toHaveBeenCalled();
			const [writtenPath] = mockWriteFile.mock.calls[0];
			expect(writtenPath).toContain('private');
			expect(writtenPath).toContain('documents');
			expect(writtenPath).not.toContain('project_10');
			expect(writtenPath).toMatch(/[0-9a-f-]{36}\.pdf$/);

			// Verify DB record
			const [insertSql, insertParams] = mockQuery.mock.calls[0];
			expect(insertSql).toContain('INSERT INTO entity_documents');
			expect(insertParams[1]).toBe('project');
			expect(insertParams[2]).toBe(10);
			expect(insertParams[3]).toBe('report.pdf');
			expect(insertParams[5]).toContain('/api/document-upload/download?id=');
			expect(insertParams[8]).toBe(5); // uploaded_by
		});
	});

	describe('GET /api/document-upload', () => {
		it('returns 401 when unauthorized', async () => {
			const { GET } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?entity_type=invoice&entity_id=42'
			);

			const res = await GET(req);
			expect(res.status).toBe(401);
		});

		it('returns 403 when user lacks read permission on invoices', async () => {
			currentMockUser = {
				id: 3,
				username: 'guest',
				is_super_admin: 0,
				merged_permissions: ['projects:read'],
			};

			const { GET } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?entity_type=invoice&entity_id=42'
			);

			const res = await GET(req);
			expect(res.status).toBe(403);
		});

		it('lists project documents only for a readable upload section', async () => {
			currentMockUser = {
				id: 3,
				username: 'member',
				is_super_admin: 0,
				merged_permissions: [],
			};
			grantProjectAccess({ read: true, edit: false });
			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'project-doc-1',
						entity_type: 'project',
						entity_id: 10,
						original_name: 'spec.pdf',
					},
				],
			]);

			const { GET } = await import('@/app/api/document-upload/route');
			const res = await GET(
				new Request(
					'http://localhost/api/document-upload?entity_type=project&entity_id=10'
				)
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(1);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining('FROM entity_documents'),
				['project', 10]
			);
		});

		it('denies project documents when upload_documents is not readable', async () => {
			currentMockUser = {
				id: 3,
				username: 'member',
				is_super_admin: 0,
				merged_permissions: [],
			};
			grantProjectAccess({ read: false, edit: false });

			const { GET } = await import('@/app/api/document-upload/route');
			const res = await GET(
				new Request(
					'http://localhost/api/document-upload?entity_type=project&entity_id=10'
				)
			);

			expect(res.status).toBe(403);
			expect(mockQuery).not.toHaveBeenCalled();
		});

		it('returns 404 when invoice does not exist', async () => {
			currentMockUser = {
				id: 3,
				username: 'accountant',
				is_super_admin: 0,
				merged_permissions: ['invoices:read'],
			};
			mockQuery.mockResolvedValueOnce([[]]); // invoice not found

			const { GET } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?entity_type=invoice&entity_id=999'
			);

			const res = await GET(req);
			expect(res.status).toBe(404);
		});

		it('returns list of documents with secure download URLs', async () => {
			currentMockUser = {
				id: 3,
				username: 'accountant',
				is_super_admin: 0,
				merged_permissions: ['invoices:read'],
			};
			mockQuery.mockResolvedValueOnce([[{ id: 42 }]]); // invoice exists
			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-uuid-1',
						entity_type: 'invoice',
						entity_id: 42,
						original_name: 'invoice.pdf',
						file_name: 'doc-uuid-1.pdf',
						file_url: '/uploads/documents/legacy.pdf',
						file_type: 'application/pdf',
						file_size: 1024,
						uploaded_by: 3,
					},
				],
			]);

			const { GET } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?entity_type=invoice&entity_id=42'
			);

			const res = await GET(req);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data).toHaveLength(1);
			expect(body.data[0].file_url).toBe(
				'/api/document-upload/download?id=doc-uuid-1'
			);
		});
	});

	describe('DELETE /api/document-upload', () => {
		it('returns 403 when the project upload section is read-only', async () => {
			currentMockUser = {
				id: 10,
				username: 'charlie',
				is_super_admin: 0,
				merged_permissions: ['projects:update'],
			};
			grantProjectAccess({ read: true, edit: false });

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-uuid-123',
						entity_type: 'project',
						entity_id: 5,
						file_name: 'doc-uuid-123.pdf',
						uploaded_by: 99,
					},
				],
			]);

			const { DELETE } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?id=doc-uuid-123',
				{
					method: 'DELETE',
				}
			);

			const res = await DELETE(req);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toBe(
				'You do not have permission to access this project'
			);
		});

		it('allows deletion with project upload edit authority', async () => {
			currentMockUser = {
				id: 10,
				username: 'charlie',
				is_super_admin: 0,
				merged_permissions: [],
			};
			grantProjectAccess({ read: true, edit: true });

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-uuid-123',
						entity_type: 'project',
						entity_id: 5,
						file_name: 'doc-uuid-123.pdf',
						uploaded_by: 99,
					},
				],
			]);
			mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]); // DELETE query

			const { DELETE } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?id=doc-uuid-123',
				{
					method: 'DELETE',
				}
			);

			const res = await DELETE(req);
			expect(res.status).toBe(200);
			expect(mockUnlink).toHaveBeenCalled();
		});

		it('denies deletion when the project has no upload edit right', async () => {
			currentMockUser = {
				id: 1,
				username: 'admin',
				is_super_admin: 0,
				merged_permissions: ['projects:delete'],
			};
			grantProjectAccess({ read: true, edit: false });

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-uuid-123',
						entity_type: 'project',
						entity_id: 5,
						file_name: 'doc-uuid-123.pdf',
						uploaded_by: 99,
					},
				],
			]);

			const { DELETE } = await import('@/app/api/document-upload/route');
			const req = new Request(
				'http://localhost/api/document-upload?id=doc-uuid-123',
				{
					method: 'DELETE',
				}
			);

			const res = await DELETE(req);
			expect(res.status).toBe(403);
			expect(mockUnlink).not.toHaveBeenCalled();
		});
	});

	describe('GET /api/document-upload/download', () => {
		it('returns 401 when download requested without session', async () => {
			const { GET } = await import('@/app/api/document-upload/download/route');
			const req = new Request(
				'http://localhost/api/document-upload/download?id=doc-123'
			);

			const res = await GET(req);
			expect(res.status).toBe(401);
		});

		it('returns 403 when user lacks read permission on the entity', async () => {
			currentMockUser = {
				id: 4,
				username: 'outsider',
				is_super_admin: 0,
				merged_permissions: ['leads:read'], // lacks purchase_orders:read
			};

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-po-1',
						entity_type: 'purchase_order',
						entity_id: 8,
						original_name: 'po.pdf',
						file_name: 'doc-po-1.pdf',
						file_type: 'application/pdf',
					},
				],
			]);

			const { GET } = await import('@/app/api/document-upload/download/route');
			const req = new Request(
				'http://localhost/api/document-upload/download?id=doc-po-1'
			);

			const res = await GET(req);
			expect(res.status).toBe(403);
		});

		it('denies a project document download when upload_documents is unreadable', async () => {
			currentMockUser = {
				id: 4,
				username: 'outsider',
				is_super_admin: 0,
				merged_permissions: [],
			};
			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-project-1',
						entity_type: 'project',
						entity_id: 10,
						original_name: 'spec.pdf',
						file_name: 'doc-project-1.pdf',
						file_type: 'application/pdf',
					},
				],
			]);
			grantProjectAccess({ read: false, edit: false });

			const { GET } = await import('@/app/api/document-upload/download/route');
			const req = new Request(
				'http://localhost/api/document-upload/download?id=doc-project-1'
			);

			const res = await GET(req);
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({
				success: false,
				error: 'You do not have permission to access this project',
			});
		});

		it('serves a project document to a section reader', async () => {
			currentMockUser = {
				id: 4,
				username: 'member',
				is_super_admin: 0,
				merged_permissions: [],
			};
			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-project-1',
						entity_type: 'project',
						entity_id: 10,
						original_name: 'spec.pdf',
						file_name: 'doc-project-1.pdf',
						file_type: 'application/pdf',
					},
				],
			]);
			grantProjectAccess({ read: true, edit: false });
			mockExistsSync.mockReturnValue(true);

			const { GET } = await import('@/app/api/document-upload/download/route');
			const req = new Request(
				'http://localhost/api/document-upload/download?id=doc-project-1'
			);

			const res = await GET(req);
			expect(res.status).toBe(200);
		});

		it('returns 404 when file does not exist on disk', async () => {
			currentMockUser = {
				id: 1,
				username: 'manager',
				is_super_admin: 0,
				merged_permissions: ['purchase_orders:read'],
			};

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-po-1',
						entity_type: 'purchase_order',
						entity_id: 8,
						original_name: 'po.pdf',
						file_name: 'doc-po-1.pdf',
						file_type: 'application/pdf',
					},
				],
			]);
			mockQuery.mockResolvedValueOnce([[{ id: 8 }]]); // purchase order exists
			mockExistsSync.mockReturnValue(false); // file missing on disk

			const { GET } = await import('@/app/api/document-upload/download/route');
			const req = new Request(
				'http://localhost/api/document-upload/download?id=doc-po-1'
			);

			const res = await GET(req);
			expect(res.status).toBe(404);
		});

		it('serves file with nosniff and attachment headers upon authorized download', async () => {
			currentMockUser = {
				id: 1,
				username: 'manager',
				is_super_admin: 0,
				merged_permissions: ['purchase_orders:read'],
			};

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-po-1',
						entity_type: 'purchase_order',
						entity_id: 8,
						original_name: 'PO_Confidential.pdf',
						file_name: 'doc-po-1.pdf',
						file_type: 'application/pdf',
					},
				],
			]);
			mockQuery.mockResolvedValueOnce([[{ id: 8 }]]); // purchase order exists
			mockExistsSync.mockReturnValue(true);

			const { GET } = await import('@/app/api/document-upload/download/route');
			const req = new Request(
				'http://localhost/api/document-upload/download?id=doc-po-1'
			);

			const res = await GET(req);
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Type')).toBe('application/pdf');
			expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(res.headers.get('Content-Disposition')).toContain('attachment');
			expect(res.headers.get('Content-Disposition')).toContain(
				'PO_Confidential.pdf'
			);
		});

		it('supports route param download via /api/document-upload/download/[id]', async () => {
			currentMockUser = {
				id: 1,
				username: 'manager',
				is_super_admin: 0,
				merged_permissions: ['purchase_orders:read'],
			};

			mockQuery.mockResolvedValueOnce([
				[
					{
						id: 'doc-po-2',
						entity_type: 'purchase_order',
						entity_id: 8,
						original_name: 'PO_Param.pdf',
						file_name: 'doc-po-2.pdf',
						file_type: 'application/pdf',
					},
				],
			]);
			mockQuery.mockResolvedValueOnce([[{ id: 8 }]]);
			mockExistsSync.mockReturnValue(true);

			const { GET } =
				await import('@/app/api/document-upload/download/[id]/route');
			const req = new Request(
				'http://localhost/api/document-upload/download/doc-po-2'
			);

			const res = await GET(req, {
				params: Promise.resolve({ id: 'doc-po-2' }),
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('Content-Disposition')).toContain('PO_Param.pdf');
		});
	});
});
