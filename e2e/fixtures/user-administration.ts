/**
 * Disposable identities for the User Management browser journeys.
 *
 * Each fixture call creates:
 *
 * - an administrator acting through ordinary permissions (never a super
 *   admin). `createJourneyUser` owns the role, user and password; this module
 *   raises only that owned role's hierarchy so the API's real target-hierarchy
 *   rule lets it manage the fixture's role-less target accounts. The role's
 *   permission grant is exactly what the caller asked for;
 * - an optional employee with no user account, for the real Create User flow;
 * - an optional role-less target account with direct permissions, for the
 *   permission-editor, disable and reset journeys;
 * - an optional namespaced role with no users, for the role-permission journey.
 *
 * Every row is tracked by primary key. Teardown deletes the account created
 * through the browser (found by its owned employee link or exact username)
 * before the employee, then the target, the editable role and the actor. It
 * never touches pre-existing operational rows.
 */
import { createHash, randomBytes } from 'node:crypto';
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { hashFixturePassword } from '../../scripts/leads-integration/support.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** One step above a role-less target (hierarchy 0), below any super admin. */
const ACTOR_ROLE_HIERARCHY = 1;

export interface UserAdministrationSeedOptions {
	/** Exact permissions the acting administrator's owned role receives. */
	actorPermissions: readonly string[];
	/** Seed an employee with no user account for the Create User journey. */
	withEmployee?: boolean;
	/** Seed a role-less target account with these direct permissions. */
	targetPermissions?: readonly string[];
	/** Seed a namespaced role with these permissions for role administration. */
	editableRolePermissions?: readonly string[];
}

export interface UserAdministrationActor {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
}

export interface UserAdministrationEmployee {
	id: number;
	employeeCode: string;
	fullName: string;
	email: string;
}

export interface UserAdministrationTarget {
	userId: number;
	username: string;
	password: string;
	/** Distinct replacement password, generated for the reset journey. */
	newPassword: string;
}

export interface UserAdministrationRole {
	id: number;
	roleCode: string;
	roleName: string;
	permissions: string[];
}

export interface UserAdministrationFixture {
	actor: UserAdministrationActor;
	/** Username the Create User journey submits; never pre-seeded. */
	newAccountUsername: string;
	newAccountPassword: string;
	employee: UserAdministrationEmployee | null;
	target: UserAdministrationTarget | null;
	editableRole: UserAdministrationRole | null;
	/** Record an account the browser created so cleanup deletes that exact row. */
	trackCreatedUser(userId: number): void;
	/** Delete every owned session, user, role and employee. Idempotent. */
	dispose(): Promise<void>;
}

export interface StoredUserAccountState {
	id: number;
	username: string;
	email: string | null;
	employeeId: number | null;
	roleId: number | null;
	status: string | null;
	isActive: number;
	isDeleted: number;
	isSuperAdmin: number;
	permissions: string[];
	fieldPermissions: Record<string, unknown>;
	lastPasswordChange: string | null;
	sessions: number;
}

export interface StoredRoleState {
	id: number;
	roleCode: string;
	roleName: string;
	permissions: string[];
}

interface IdentityRow extends RowDataPacket {
	id: number | string;
}

interface RoleIdRow extends RowDataPacket {
	role_id: number | string | null;
}

interface RoleStateRow extends RowDataPacket {
	id: number | string;
	role_code: string;
	role_name: string;
	permissions: unknown;
}

interface UserStateRow extends RowDataPacket {
	id: number | string;
	username: string;
	email: string | null;
	employee_id: number | string | null;
	role_id: number | string | null;
	status: string | null;
	is_active: number | string;
	isDelete: number | string;
	is_super_admin: number | string;
	permissions: unknown;
	field_permissions: unknown;
	last_password_change: string | null;
	sessions: number | string;
}

interface OwnedRows {
	actor: JourneyUser | null;
	targetId: number | null;
	employeeId: number | null;
	roleId: number | null;
	createdUserIds: Set<number>;
}

/**
 * Seed one isolated set of User Management rows. The caller owns the result
 * and must `dispose()` it in a `finally` block.
 */
export async function seedUserAdministrationFixture(
	connection: Connection,
	namespace: string,
	options: UserAdministrationSeedOptions
): Promise<UserAdministrationFixture> {
	const fixtureNamespace = namespace.trim();
	if (!fixtureNamespace) {
		throw new Error('[user-administration] namespace must not be empty.');
	}
	const actorPermissions = normalizePermissions(
		options.actorPermissions,
		'actorPermissions'
	);
	const targetPermissions =
		options.targetPermissions === undefined
			? null
			: normalizePermissions(options.targetPermissions, 'targetPermissions');
	const editableRolePermissions =
		options.editableRolePermissions === undefined
			? null
			: normalizePermissions(
					options.editableRolePermissions,
					'editableRolePermissions'
				);

	const key = createHash('sha256')
		.update(fixtureNamespace)
		.digest('hex')
		.slice(0, 8);
	const newAccountUsername = fitIdentifier(`${fixtureNamespace}-created`, 50);
	const newAccountPassword = randomBytes(24).toString('hex');

	const owned: OwnedRows = {
		actor: null,
		targetId: null,
		employeeId: null,
		roleId: null,
		createdUserIds: new Set<number>(),
	};
	let disposed = false;

	try {
		const actorUser = await createJourneyUser(
			connection,
			`${fixtureNamespace}-actor`,
			actorPermissions
		);
		owned.actor = actorUser;
		await raiseActorRoleHierarchy(connection, actorUser.userId);

		let employee: UserAdministrationEmployee | null = null;
		if (options.withEmployee === true) {
			employee = await seedEmployee(connection, fixtureNamespace, key);
			owned.employeeId = employee.id;
		}

		let target: UserAdministrationTarget | null = null;
		if (targetPermissions !== null) {
			const username = fitIdentifier(`${fixtureNamespace}-target`, 50);
			const email = `${fitIdentifier(`${fixtureNamespace}-target`, 80).toLowerCase()}@e2e.invalid`;
			const password = randomBytes(24).toString('hex');
			const newPassword = randomBytes(24).toString('hex');
			const passwordHash = await hashFixturePassword(password);
			const userId = await insertRow(
				connection,
				`INSERT INTO users (
            username, password_hash, email, full_name, status, role_id,
            permissions, is_active, isDelete, is_super_admin, account_type
          ) VALUES (?, ?, ?, ?, 'active', NULL, ?, 1, 0, 0, 'employee')`,
				[
					username,
					passwordHash,
					email,
					username,
					JSON.stringify(targetPermissions),
				]
			);
			owned.targetId = userId;
			target = {
				userId,
				username,
				password,
				newPassword,
			};
		}

		let editableRole: UserAdministrationRole | null = null;
		if (editableRolePermissions !== null) {
			const roleCode = fitIdentifier(`${fixtureNamespace}-edit-role`, 50);
			const roleName = fitIdentifier(
				`E2E User Administration Role ${key}`,
				255
			);
			const roleId = await insertRow(
				connection,
				`INSERT INTO roles_master (
            role_code, role_name, role_hierarchy, permissions, status, description
          ) VALUES (?, ?, 0, ?, 'active', 'E2E User Administration fixture')`,
				[roleCode, roleName, JSON.stringify(editableRolePermissions)]
			);
			owned.roleId = roleId;
			editableRole = {
				id: roleId,
				roleCode,
				roleName,
				permissions: [...editableRolePermissions],
			};
		}

		return {
			actor: {
				userId: actorUser.userId,
				username: actorUser.username,
				password: actorUser.password,
			},
			newAccountUsername,
			newAccountPassword,
			employee,
			target,
			editableRole,
			trackCreatedUser(userId: number): void {
				owned.createdUserIds.add(userId);
			},
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				await cleanupOwned(connection, owned, newAccountUsername);
			},
		};
	} catch (error) {
		try {
			await cleanupOwned(connection, owned, newAccountUsername);
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; user-administration fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

/**
 * Independent read of one account, including its stored permission payloads
 * and live session count. MariaDB may hand JSON columns back as strings or as
 * already-parsed values, so both shapes are accepted without stringifying an
 * object.
 */
export async function readUserAccountState(
	connection: Connection,
	userId: number
): Promise<StoredUserAccountState | null> {
	const [rows] = await connection.execute<UserStateRow[]>(
		`SELECT u.id, u.username, u.email, u.employee_id, u.role_id,
            u.status, u.is_active, u.isDelete, u.is_super_admin,
            u.permissions, u.field_permissions, u.last_password_change,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
       FROM users u
      WHERE u.id = ?
      LIMIT 1`,
		[userId]
	);
	return rows[0] ? toUserState(rows[0]) : null;
}

/** Independent read of a role's flat permissions. */
export async function readStoredRole(
	connection: Connection,
	roleId: number
): Promise<StoredRoleState | null> {
	const [rows] = await connection.execute<RoleStateRow[]>(
		`SELECT id, role_code, role_name, permissions
       FROM roles_master
      WHERE id = ?
      LIMIT 1`,
		[roleId]
	);
	const row = rows[0];
	if (!row) return null;
	return {
		id: Number(row.id),
		roleCode: String(row.role_code),
		roleName: String(row.role_name),
		permissions: parseStringArray(row.permissions),
	};
}

function normalizePermissions(
	permissions: readonly string[],
	label: string
): string[] {
	const unique = new Set<string>();
	for (const permission of permissions) {
		if (typeof permission !== 'string' || permission.trim() === '') {
			throw new Error(
				`[user-administration] ${label} must contain non-empty strings.`
			);
		}
		unique.add(permission);
	}
	return [...unique].sort();
}

/**
 * `createJourneyUser` intentionally gives a custom role no hierarchy. The
 * User Management APIs refuse a non-super-admin who tries to modify a target
 * with an equal or higher hierarchy, and the target accounts this fixture
 * seeds are role-less (hierarchy 0). Raise only the fixture-owned role.
 */
async function raiseActorRoleHierarchy(
	connection: Connection,
	userId: number
): Promise<void> {
	const [rows] = await connection.execute<RoleIdRow[]>(
		'SELECT role_id FROM users WHERE id = ? LIMIT 1',
		[userId]
	);
	const roleId = rows[0]?.role_id;
	if (roleId === null || roleId === undefined) {
		throw new Error(
			'[user-administration] the acting user must own a fixture role.'
		);
	}
	await connection.execute(
		'UPDATE roles_master SET role_hierarchy = ? WHERE id = ?',
		[ACTOR_ROLE_HIERARCHY, Number(roleId)]
	);
}

async function seedEmployee(
	connection: Connection,
	fixtureNamespace: string,
	key: string
): Promise<UserAdministrationEmployee> {
	const employeeCode = fitIdentifier(`E2E-UA-${key}`, 20);
	const firstName = 'E2E';
	const lastName = `UA-${key}`;
	const fullName = `${firstName} ${lastName}`;
	const email = `${fitIdentifier(
		`${fixtureNamespace}-emp`,
		80
	).toLowerCase()}@e2e.invalid`;
	const id = await insertRow(
		connection,
		`INSERT INTO employees (
        employee_id, first_name, last_name, email, position, department,
        hire_date, joining_date, status, employee_type, grade, designation,
        company_name, isDelete
      ) VALUES (?, ?, ?, ?, 'E2E User Setup', ?, '2025-01-15', '2025-01-15',
                'active', 'Permanent', 'E2E', 'E2E User Setup',
                'Accent Techno Solutions Pvt Ltd', 0)`,
		[employeeCode, firstName, lastName, email, `E2E UA ${key}`]
	);
	return { id, employeeCode, fullName, email };
}

async function cleanupOwned(
	connection: Connection,
	owned: OwnedRows,
	createdAccountUsername: string
): Promise<void> {
	const targetIds = new Set<number>(owned.createdUserIds);
	if (owned.targetId !== null) targetIds.add(owned.targetId);

	const [createdRows] = await connection.execute<IdentityRow[]>(
		owned.employeeId === null
			? 'SELECT id FROM users WHERE username = ?'
			: 'SELECT id FROM users WHERE username = ? OR employee_id = ?',
		owned.employeeId === null
			? [createdAccountUsername]
			: [createdAccountUsername, owned.employeeId]
	);
	for (const row of createdRows) targetIds.add(Number(row.id));

	if (targetIds.size > 0) {
		const ids = [...targetIds];
		const placeholders = ids.map(() => '?').join(', ');
		await connection.execute(
			`DELETE FROM sessions WHERE user_id IN (${placeholders})`,
			ids
		);
		await connection.execute(
			`DELETE FROM users WHERE id IN (${placeholders})`,
			ids
		);
	}

	if (owned.roleId !== null) {
		await connection.execute(
			`DELETE FROM roles_master
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = ?)`,
			[owned.roleId, owned.roleId]
		);
	}

	if (owned.employeeId !== null) {
		await connection.execute('DELETE FROM employees WHERE id = ?', [
			owned.employeeId,
		]);
	}

	if (owned.actor !== null) {
		await owned.actor.dispose();
		owned.actor = null;
	}
}

async function insertRow(
	connection: Connection,
	sql: string,
	params: ExecuteValues[]
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(sql, params);
	return Number(result.insertId);
}

function toUserState(row: UserStateRow): StoredUserAccountState {
	return {
		id: Number(row.id),
		username: String(row.username),
		email: row.email === null ? null : String(row.email),
		employeeId: row.employee_id === null ? null : Number(row.employee_id),
		roleId: row.role_id === null ? null : Number(row.role_id),
		status: row.status === null ? null : String(row.status),
		isActive: Number(row.is_active),
		isDeleted: Number(row.isDelete),
		isSuperAdmin: Number(row.is_super_admin),
		permissions: parseStringArray(row.permissions),
		fieldPermissions: parseObject(row.field_permissions),
		lastPasswordChange:
			row.last_password_change === null
				? null
				: String(row.last_password_change),
		sessions: Number(row.sessions),
	};
}

function parseStringArray(value: unknown): string[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text) return [];
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text.split(',');
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((entry): entry is string => typeof entry === 'string');
}

function parseObject(value: unknown): Record<string, unknown> {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text) return {};
		try {
			parsed = JSON.parse(text);
		} catch {
			return {};
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
	return parsed as Record<string, unknown>;
}
