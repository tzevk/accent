/**
 * DB-backed project access resolution.
 *
 * Routes call `requireProjectAccess` instead of re-deriving project
 * authority. Failures are closed: a missing session is 401, and every other
 * failure — unknown identifier, unrelated actor, membership or lookup error —
 * returns the same generic 403 body so existence is never disclosed.
 */

import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { getTableColumns } from '@/utils/schema-cache';
import {
	DEFAULT_LEAD_POLICY,
	resolveProjectRights,
	type LeadPolicy,
	type ProjectRights,
	type ProjectRightsUser,
} from './policy';
import { normalizeLeadPolicy } from './lead-policy';

type DbConnection = {
	execute: (
		sql: string,
		params?: unknown[]
	) => Promise<[Record<string, unknown>[], unknown]>;
	release?: () => void;
};

const IDENTIFIER_COLUMNS = ['project_id', 'id', 'project_code'] as const;

export const PROJECT_ACCESS_DENIED =
	'You do not have permission to access this project';

export type ProjectAccessOk = {
	user: ProjectRightsUser;
	project: Record<string, unknown>;
	rights: ProjectRights;
	leadPolicy: LeadPolicy;
	db: DbConnection;
	ownsDb: boolean;
};

export type ProjectAccessFailure = { response: Response };

export type ProjectAccessResult = ProjectAccessOk | ProjectAccessFailure;

export type ProjectAccessOptions = {
	db?: DbConnection;
	getLeadPolicy?: (db: DbConnection) => Promise<LeadPolicy>;
	/**
	 * Also require the member-contribution right, not just workspace entry.
	 * A read-only non-member opens the workspace but cannot contribute.
	 */
	requireContribution?: boolean;
	financialPermissions?: {
		quotation?: boolean;
		purchase_order?: boolean;
		invoice?: boolean;
	};
};

/**
 * The single denial body for project authority. Financial document areas
 * reuse it so a denied project and a denied financial area are
 * indistinguishable — neither discloses that the project exists.
 */
export function projectAccessDeniedResponse(): Response {
	return Response.json(
		{ success: false, error: PROJECT_ACCESS_DENIED },
		{ status: 403 }
	);
}

function denied() {
	return { response: projectAccessDeniedResponse() };
}

/**
 * Find one non-deleted project by any supported identifier: the baseline
 * primary key `project_id`, the runtime variant `id`, or `project_code`.
 */
export async function findProjectRow(
	db: DbConnection,
	identifier: string | number
): Promise<Record<string, unknown> | null> {
	if (
		identifier === null ||
		identifier === undefined ||
		identifier === '' ||
		identifier === 'undefined'
	) {
		return null;
	}

	const columns = await getTableColumns(db, 'projects');
	const candidates = IDENTIFIER_COLUMNS.filter((column) => columns.has(column));
	if (candidates.length === 0) {
		throw new Error('projects table has no identifier column');
	}

	const where = candidates.map((column) => `p.${column} = ?`).join(' OR ');
	const [rows] = await db.execute(
		`SELECT p.* FROM projects p WHERE (${where}) AND p.isDelete = 0 LIMIT 1`,
		candidates.map(() => identifier)
	);
	if (Array.isArray(rows) && rows.length > 0) return rows[0];

	const numeric =
		typeof identifier === 'number' ? identifier : Number(identifier);
	if (
		Number.isFinite(numeric) &&
		candidates.includes('project_id') &&
		String(numeric) === String(identifier).trim()
	) {
		const [numericRows] = await db.execute(
			'SELECT p.* FROM projects p WHERE p.project_id = ? AND p.isDelete = 0 LIMIT 1',
			[numeric]
		);
		if (Array.isArray(numericRows) && numericRows.length > 0) {
			return numericRows[0];
		}
	}

	return null;
}

/**
 * The minimal query surface `loadLeadPolicy` needs; every mysql2 pool
 * connection satisfies it.
 */
export type PolicyReader = {
	execute(sql: string, params?: unknown): Promise<[unknown, unknown]>;
};

/**
 * Read the single stored lead policy row (id = 1).
 *
 * Fails closed: a missing row falls back to the approved default, while a
 * database error or an unreadable `sections` payload throws so the caller
 * denies access instead of silently widening lead rights.
 */
export async function loadLeadPolicy(db: PolicyReader): Promise<LeadPolicy> {
	const result = await db.execute(
		'SELECT sections FROM project_lead_policy WHERE id = 1 LIMIT 1'
	);
	const first = Array.isArray(result) ? result[0] : undefined;
	const row = Array.isArray(first) ? first[0] : undefined;
	if (row === undefined || row === null) return DEFAULT_LEAD_POLICY;
	if (typeof row !== 'object' || Array.isArray(row) || !('sections' in row)) {
		throw new Error('project_lead_policy row is unreadable');
	}

	const raw = row.sections;
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error('project_lead_policy.sections is not valid JSON');
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('project_lead_policy.sections must be an object');
	}

	// Stored shape is the section map; tolerate a wrapped `{ sections }` row
	// written by hand.
	const policyInput =
		'sections' in parsed ? { sections: parsed.sections } : { sections: parsed };

	return normalizeLeadPolicy(policyInput);
}

function parsePermissionArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed)
				? parsed.filter((item): item is string => typeof item === 'string')
				: [];
		} catch {
			return [];
		}
	}
	return [];
}

function hasAnyGrant(user: ProjectRightsUser, keys: string[]): boolean {
	const sources = [
		user.merged_permissions,
		user.permissions,
		user.role_permissions,
	];
	return sources.some((source) =>
		keys.some((key) => parsePermissionArray(source).includes(key))
	);
}

function financialAreasFromUser(user: ProjectRightsUser) {
	return {
		quotation: hasAnyGrant(user, ['quotations:read', 'quotations:update']),
		purchase_order: hasAnyGrant(user, [
			'purchase_orders:read',
			'purchase_orders:update',
		]),
		invoice: hasAnyGrant(user, ['invoices:read', 'invoices:update']),
	};
}

/**
 * Resolve the actor, the target project, and the pure rights decision.
 * Never lets a lookup, membership, grant, or policy error become a pass.
 */
export async function resolveProjectAccess(
	request: Request,
	projectId: string | number | null | undefined,
	opts: ProjectAccessOptions = {}
): Promise<ProjectAccessResult> {
	let user: ProjectRightsUser | null = null;
	try {
		user = (await getCurrentUser(request)) as ProjectRightsUser | null;
	} catch (error) {
		console.error('[project-rights] user lookup failed', error);
	}
	if (!user) {
		return {
			response: Response.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			),
		};
	}

	let db = opts.db;
	let ownsDb = false;
	try {
		if (!db) {
			db = (await dbConnect()) as DbConnection;
			ownsDb = true;
		}

		const project = await findProjectRow(db, projectId ?? '');
		if (!project) {
			console.warn('[project-rights] project not found or not readable', {
				projectId,
				userId: user.id,
			});
			if (ownsDb) db.release?.();
			return denied();
		}

		let leadPolicy: LeadPolicy = DEFAULT_LEAD_POLICY;
		if (opts.getLeadPolicy) {
			leadPolicy = await opts.getLeadPolicy(db);
		}

		const rights = resolveProjectRights({
			user,
			project,
			leadPolicy,
			financialPermissions:
				opts.financialPermissions ?? financialAreasFromUser(user),
		});

		if (!rights.canOpen) {
			console.warn('[project-rights] access denied', {
				projectId,
				userId: user.id,
			});
			if (ownsDb) db.release?.();
			return denied();
		}

		if (opts.requireContribution && !rights.canContribute) {
			console.warn('[project-rights] contribution denied', {
				projectId,
				userId: user.id,
			});
			if (ownsDb) db.release?.();
			return denied();
		}

		return { user, project, rights, leadPolicy, db, ownsDb };
	} catch (error) {
		console.error('[project-rights] access resolution failed', error);
		if (ownsDb) db?.release?.();
		return denied();
	}
}

/**
 * Same contract as `resolveProjectAccess`, named for handlers where the
 * intent is "this route requires project access". Both names are recognised
 * by `scripts/check-route-auth.mjs`.
 */
export async function requireProjectAccess(
	request: Request,
	projectId: string | number | null | undefined,
	opts: ProjectAccessOptions = {}
): Promise<ProjectAccessResult> {
	return resolveProjectAccess(request, projectId, opts);
}
