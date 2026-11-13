/**
 * Harness fixture hook for the #431 payroll-review journey.
 *
 * The browser test seeds its own disposable Payroll Run, Employee and Payroll
 * Slip through the Playwright `db` fixture. This hook runs earlier, before the
 * owned application starts, and owns the shared reference the fixture reuses:
 * the `admin` role with exactly the payroll-read permission the journey needs.
 *
 * It is deliberately a real seed, not a no-op required export. Cleanup removes
 * the role only when this module created it and no user still references it;
 * the fixture's administrator is deleted first, and the database is dropped
 * anyway. Nothing here logs or persists credentials.
 */
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { E2EFixtureHookContext } from '../../scripts/e2e/environment.ts';
import { PAYROLL_REVIEW_PERMISSION } from './payroll-review.ts';

const ADMIN_ROLE_CODE = 'admin';
/** Distinct from the fixture's own role name so ownership stays unambiguous. */
const REFERENCE_ROLE_NAME = 'E2E Payroll Reference Admin';

interface RoleRow extends RowDataPacket {
	id: number | string;
	permissions: unknown;
}

interface HookState {
	ownedRoleId: number | null;
}

const state: HookState = { ownedRoleId: null };

function parsePermissions(value: unknown): string[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((entry): entry is string => typeof entry === 'string');
}

function assertPayrollOnlyRole(value: unknown): void {
	const permissions = parsePermissions(value);
	const unexpected = permissions.filter(
		(permission) => permission !== PAYROLL_REVIEW_PERMISSION
	);
	if (
		unexpected.length > 0 ||
		!permissions.includes(PAYROLL_REVIEW_PERMISSION)
	) {
		throw new Error(
			`[e2e] existing role ${ADMIN_ROLE_CODE} must grant only ` +
				`${PAYROLL_REVIEW_PERMISSION}; refusing to modify it.`
		);
	}
}

/**
 * Seed the payroll-only admin role the journey's ordinary administrator reuses.
 * A pre-existing compatible role is shared, never modified or taken over.
 */
export async function seed(context: E2EFixtureHookContext): Promise<void> {
	const [existing] = await context.reader.execute<RoleRow[]>(
		`SELECT id, permissions
       FROM roles_master
      WHERE role_code = ?
      LIMIT 1`,
		[ADMIN_ROLE_CODE]
	);
	if (existing.length > 0) {
		assertPayrollOnlyRole(existing[0].permissions);
		return;
	}

	const [result] = await context.reader.execute<ResultSetHeader>(
		`INSERT INTO roles_master (
        role_code, role_name, role_hierarchy, permissions, status
      ) VALUES (?, ?, 1, ?, 'active')`,
		[
			ADMIN_ROLE_CODE,
			REFERENCE_ROLE_NAME,
			JSON.stringify([PAYROLL_REVIEW_PERMISSION]),
		]
	);
	state.ownedRoleId = Number(result.insertId);
}

/**
 * Delete the reference role this module created. The fixture's user is gone by
 * the time the harness calls this; a leftover user keeps the role for the
 * database drop rather than breaking cleanup.
 */
export async function cleanup(context: E2EFixtureHookContext): Promise<void> {
	if (state.ownedRoleId === null) return;
	await context.reader.execute(
		`DELETE FROM roles_master
      WHERE id = ?
        AND role_code = ?
        AND role_name = ?
        AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = ?)`,
		[state.ownedRoleId, ADMIN_ROLE_CODE, REFERENCE_ROLE_NAME, state.ownedRoleId]
	);
	state.ownedRoleId = null;
}
