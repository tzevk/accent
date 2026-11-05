import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { mockWithDb, mockExecute } = vi.hoisted(() => ({
	mockWithDb: vi.fn(),
	mockExecute: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ withDb: mockWithDb }));

let currentUser: Record<string, unknown> | null = null;

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn(async () => {
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}
		const merged = (currentUser.merged_permissions as string[]) || [];
		if (currentUser.is_super_admin || merged.includes('projects:update')) {
			return { authorized: true, user: currentUser };
		}
		return NextResponse.json(
			{ success: false, error: 'Forbidden: missing permission' },
			{ status: 403 }
		);
	}),
	getCurrentUser: vi.fn(async () => currentUser),
	RESOURCES: { PROJECTS: 'projects' },
	PERMISSIONS: { READ: 'read', UPDATE: 'update' },
}));

import { GET, PUT } from '@/app/api/admin/project-lead-policy/route';
import { WORK_SECTION_IDS } from '@/lib/project-rights/sections';

type StoredPolicy = {
	sections: string;
	updated_at: string;
	updated_by: number | null;
};

let stored: StoredPolicy | null = null;

function request(method: 'GET' | 'PUT', body?: unknown): Request {
	return new Request('http://localhost/api/admin/project-lead-policy', {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const editor = {
	id: 7,
	email: 'editor@example.com',
	is_super_admin: 0,
	merged_permissions: ['projects:update'],
	field_permissions: {
		projectScopes: { projects: { update: 'all' } },
	},
};

function allEdit() {
	return Object.fromEntries(WORK_SECTION_IDS.map((section) => [section, 'edit']));
}

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = editor;
	stored = null;
	mockWithDb.mockImplementation(
		(fn: (db: { execute: typeof mockExecute }) => unknown) =>
			fn({ execute: mockExecute })
	);
	mockExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
		if (/^\s*INSERT INTO project_lead_policy/i.test(sql)) {
			stored = {
				sections: String(params?.[0] ?? '{}'),
				updated_at: '2026-11-06 10:05:00',
				updated_by: (params?.[1] as number | null) ?? null,
			};
			return [{ affectedRows: 1 }, []];
		}
		if (sql.includes('SELECT sections FROM project_lead_policy')) {
			return stored ? [[{ sections: stored.sections }], []] : [[], []];
		}
		if (sql.includes('SELECT updated_at, updated_by')) {
			return stored
				? [
						[
							{
								updated_at: stored.updated_at,
								updated_by: stored.updated_by,
							},
						],
						[],
					]
				: [[], []];
		}
		return [[], []];
	});
});

describe('GET /api/admin/project-lead-policy', () => {
	it('returns 401 without a session and never touches the database', async () => {
		currentUser = null;

		const response = await GET(request('GET'));

		expect(response.status).toBe(401);
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('returns 403 without projects:update', async () => {
		currentUser = { ...editor, merged_permissions: [] };

		const response = await GET(request('GET'));

		expect(response.status).toBe(403);
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('returns every section editable when no row is stored yet', async () => {
		const response = await GET(request('GET'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.sections).toEqual(allEdit());
		expect(body.data.updated_at).toBeNull();
	});

	it('returns the stored, normalized sections', async () => {
		stored = {
			sections: JSON.stringify({
				project_details: 'hidden',
				scope: 'view',
				unknown_section: 'hidden',
			}),
			updated_at: '2026-11-05 09:00:00',
			updated_by: 3,
		};

		const response = await GET(request('GET'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.sections.project_details).toBe('hidden');
		expect(body.data.sections.scope).toBe('view');
		expect(body.data.sections.documents_issued).toBe('edit');
		expect(body.data.sections).not.toHaveProperty('unknown_section');
		expect(body.data.updated_at).toBe('2026-11-05 09:00:00');
		expect(body.data.updated_by).toBe(3);
	});

	it('allows a super admin', async () => {
		currentUser = { id: 1, is_super_admin: 1, merged_permissions: [] };

		const response = await GET(request('GET'));

		expect(response.status).toBe(200);
	});

	it('returns 403 for a scoped projects:update holder', async () => {
		currentUser = {
			...editor,
			field_permissions: {
				projectScopes: { projects: { update: 'led' } },
			},
		};

		const response = await GET(request('GET'));

		expect(response.status).toBe(403);
		expect(mockWithDb).not.toHaveBeenCalled();
	});
});

describe('PUT /api/admin/project-lead-policy', () => {
	it('returns 401 without a session', async () => {
		currentUser = null;

		const response = await PUT(request('PUT', { sections: {} }));

		expect(response.status).toBe(401);
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('returns 403 without projects:update', async () => {
		currentUser = { ...editor, merged_permissions: [] };

		const response = await PUT(request('PUT', { sections: {} }));

		expect(response.status).toBe(403);
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('returns 403 for a scoped projects:update holder', async () => {
		currentUser = {
			...editor,
			field_permissions: {
				projectScopes: { projects: { update: 'assigned' } },
			},
		};

		const response = await PUT(request('PUT', { sections: {} }));

		expect(response.status).toBe(403);
		expect(mockWithDb).not.toHaveBeenCalled();
	});

	it('rejects an unknown section key', async () => {
		const response = await PUT(
			request('PUT', { sections: { not_a_section: 'hidden' } })
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('not_a_section');
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('rejects the protected commercial pseudo-section', async () => {
		const response = await PUT(
			request('PUT', { sections: { commercial: 'view' } })
		);

		expect(response.status).toBe(400);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('rejects an unknown setting value', async () => {
		const response = await PUT(
			request('PUT', { sections: { scope: 'admin' } })
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('scope');
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it.each([
		['missing', {}],
		['null', { sections: null }],
		['an array', { sections: ['hidden'] }],
	])('rejects %s sections', async (_label, body) => {
		const response = await PUT(request('PUT', body));

		expect(response.status).toBe(400);
	});

	it('saves the policy and returns it; GET then reads the saved values', async () => {
		const sections = {
			project_details: 'hidden',
			scope: 'hidden',
			documents_issued: 'view',
		};

		const saved = await PUT(request('PUT', { sections }));
		const savedBody = await saved.json();

		expect(saved.status).toBe(200);
		expect(savedBody.data.sections).toEqual({
			...allEdit(),
			...sections,
		});
		expect(savedBody.data.updated_by).toBe(7);

		const insertCall = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO project_lead_policy')
		);
		expect(insertCall).toBeDefined();
		expect(JSON.parse(String(insertCall?.[1]?.[0]))).toEqual({
			...allEdit(),
			...sections,
		});

		const read = await GET(request('GET'));
		const readBody = await read.json();
		expect(read.status).toBe(200);
		expect(readBody.data.sections).toEqual(savedBody.data.sections);
	});
});
