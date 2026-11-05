/**
 * GET/PUT /api/admin/project-lead-policy
 *
 * The shared Project Lead policy: one section map that applies to every
 * project. `projects:update` holders (and super admins) may read and save it.
 * Reads go through the same `loadLeadPolicy` the project routes use, so a
 * save takes effect on the next request without a separate cache.
 */

import { NextResponse } from 'next/server';
import { withDb } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	isLeadSectionSetting,
	isSectionId,
	hasAllProjectScope,
	loadLeadPolicy,
	normalizeLeadSectionRecord,
	type LeadPolicy,
	type LeadSectionSetting,
} from '@/lib/project-rights';
import type { SectionId } from '@/lib/project-rights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SectionRecord = Record<SectionId, LeadSectionSetting>;

/**
 * The shared policy applies to every project, so only a super admin or a
 * project administrator whose grant covers all projects may read or rewrite
 * it. A `led`/`assigned` update grant must not reach it.
 */
function canAdministerProjectPolicy(user: unknown): boolean {
	const candidate = user as Parameters<typeof hasAllProjectScope>[0] | null;
	if (!candidate) return false;
	return Boolean(candidate.is_super_admin) || hasAllProjectScope(candidate);
}

function policyForbidden(): NextResponse {
	return NextResponse.json(
		{
			success: false,
			error: 'Forbidden: all-projects project administration is required',
		},
		{ status: 403 }
	);
}

function policyPayload(
	sections: LeadPolicy['sections'],
	row: { updated_at?: unknown; updated_by?: unknown } | undefined
) {
	return {
		sections,
		updated_at: row?.updated_at ?? null,
		updated_by: row?.updated_by ?? null,
	};
}

function validateSections(
	value: unknown
): { ok: true; sections: SectionRecord } | { ok: false; error: string } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { ok: false, error: 'sections must be an object' };
	}

	for (const [key, setting] of Object.entries(value)) {
		if (!isSectionId(key)) {
			return { ok: false, error: `Unknown project section "${key}"` };
		}
		if (!isLeadSectionSetting(setting)) {
			return {
				ok: false,
				error: `Invalid setting for "${key}" — use hidden, view, or edit`,
			};
		}
	}

	const normalized = normalizeLeadSectionRecord({ sections: value });
	return { ok: true, sections: normalized };
}

export async function GET(request: Request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;
	if (!canAdministerProjectPolicy(auth.user)) return policyForbidden();

	try {
		const data = await withDb(async (db) => {
			const policy = await loadLeadPolicy(db);
			const [rows] = await db.execute(
				'SELECT updated_at, updated_by FROM project_lead_policy WHERE id = 1 LIMIT 1'
			);
			return policyPayload(policy.sections, rows?.[0]);
		});

		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Project lead policy read error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the project lead policy' },
			{ status: 500 }
		);
	}
}

export async function PUT(request: Request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;
	if (!canAdministerProjectPolicy(auth.user)) return policyForbidden();

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ success: false, error: 'A JSON body is required' },
			{ status: 400 }
		);
	}

	const candidate =
		body && typeof body === 'object' && !Array.isArray(body) && 'sections' in body
			? body.sections
			: undefined;
	const validation = validateSections(candidate);
	if (!validation.ok) {
		return NextResponse.json(
			{ success: false, error: validation.error },
			{ status: 400 }
		);
	}

	const updatedBy = auth.user?.id ?? null;

	try {
		const data = await withDb(async (db) => {
			await db.execute(
				`INSERT INTO project_lead_policy (id, sections, updated_at, updated_by)
				 VALUES (1, ?, CURRENT_TIMESTAMP, ?)
				 ON DUPLICATE KEY UPDATE
				   sections = VALUES(sections),
				   updated_at = CURRENT_TIMESTAMP,
				   updated_by = VALUES(updated_by)`,
				[JSON.stringify(validation.sections), updatedBy]
			);
			const [rows] = await db.execute(
				'SELECT updated_at, updated_by FROM project_lead_policy WHERE id = 1 LIMIT 1'
			);
			return policyPayload(validation.sections, rows?.[0]);
		});

		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Project lead policy save error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to save the project lead policy' },
			{ status: 500 }
		);
	}
}
