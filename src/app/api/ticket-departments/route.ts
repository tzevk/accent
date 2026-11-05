import { NextResponse } from 'next/server';
import type {
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	listTicketDepartments,
	type TicketDepartment,
} from '@/lib/tickets/departments';

/**
 * GET  /api/ticket-departments
 *   The selectable routing catalog for any signed-in account.
 * GET  /api/ticket-departments?all=true
 *   Super-admin configuration view: every live department, including
 *   unmapped or inactive rows, plus the active roles that may be assigned.
 *   Recipient users and their emails are never exposed here.
 * POST /api/ticket-departments
 *   Super-admin only. `{ name, role_id, is_active }` creates a department.
 *   `role_id` may be null until the super admin picks a responsible role.
 *
 * Department updates live at `PUT /api/ticket-departments/[id]`, matching the
 * shared ResourceFormModal convention.
 */

type RoleRow = RowDataPacket & {
	id: number | string;
	role_name: string;
	role_code: string;
};

type RoleOption = {
	id: number;
	role_name: string;
	role_code: string;
};

function isSuperAdmin(user: { is_super_admin?: unknown }): boolean {
	return (
		user.is_super_admin === true ||
		user.is_super_admin === 1 ||
		user.is_super_admin === '1'
	);
}

function errorResponse(error: string, status: number) {
	return NextResponse.json({ success: false, error }, { status });
}

function serverError(error: unknown, fallback: string) {
	console.error(fallback, error);
	return errorResponse(fallback, 500);
}

function isDuplicateEntry(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ER_DUP_ENTRY'
	);
}

function parseName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const name = value.trim();
	if (name.length === 0 || name.length > 100) return null;
	return name;
}

function parseRoleId(value: unknown): { ok: boolean; roleId: number | null } {
	if (value === null || value === undefined) return { ok: true, roleId: null };
	if (typeof value === 'number') {
		return Number.isInteger(value) && value > 0
			? { ok: true, roleId: value }
			: { ok: false, roleId: null };
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return { ok: true, roleId: null };
		if (!/^\d+$/.test(trimmed)) return { ok: false, roleId: null };
		const parsed = Number(trimmed);
		return Number.isSafeInteger(parsed) && parsed > 0
			? { ok: true, roleId: parsed }
			: { ok: false, roleId: null };
	}
	return { ok: false, roleId: null };
}

function parseIsActive(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	if (value === 1 || value === '1' || value === 'true') return true;
	if (value === 0 || value === '0' || value === 'false') return false;
	return null;
}

async function roleIsActive(
	db: PoolConnection,
	roleId: number
): Promise<boolean> {
	const [rows] = await db.execute<RowDataPacket[]>(
		`SELECT id FROM roles_master WHERE id = ? AND status = 'active' LIMIT 1`,
		[roleId]
	);
	return rows.length > 0;
}

async function departmentById(
	db: PoolConnection,
	departmentId: number
): Promise<TicketDepartment | null> {
	const departments = await listTicketDepartments(db, true);
	return (
		departments.find((department) => department.id === departmentId) ?? null
	);
}

export async function GET(request: Request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return errorResponse('Unauthorized', 401);
	}

	const { searchParams } = new URL(request.url);
	const wantsAll = searchParams.get('all') === 'true';
	if (wantsAll && !isSuperAdmin(user)) {
		return errorResponse(
			'Only super administrators can view the department configuration',
			403
		);
	}

	let db: PoolConnection | undefined;
	try {
		db = await dbConnect();
		if (!db) {
			throw new Error('Database connection unavailable');
		}

		if (!wantsAll) {
			const data = await listTicketDepartments(db, false);
			return NextResponse.json({ success: true, data });
		}

		const data = await listTicketDepartments(db, true);
		const [roleRows] = await db.execute<RoleRow[]>(
			`SELECT id, role_name, role_code
			 FROM roles_master
			 WHERE status = 'active'
			 ORDER BY role_hierarchy DESC, role_name ASC`
		);
		const roles: RoleOption[] = roleRows.map((row) => ({
			id: Number(row.id),
			role_name: row.role_name,
			role_code: row.role_code,
		}));
		return NextResponse.json({ success: true, data, roles });
	} catch (error) {
		return serverError(error, 'Failed to fetch ticket departments');
	} finally {
		if (db) db.release();
	}
}

export async function POST(request: Request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return errorResponse('Unauthorized', 401);
	}
	if (!isSuperAdmin(user)) {
		return errorResponse(
			'Only super administrators can configure ticket departments',
			403
		);
	}

	let body: Record<string, unknown>;
	try {
		const parsed: unknown = await request.json();
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return errorResponse('Invalid request body', 400);
		}
		body = parsed as Record<string, unknown>;
	} catch {
		return errorResponse('Invalid request body', 400);
	}

	const name = parseName(body.name);
	if (!name) {
		return errorResponse(
			'Department name must be between 1 and 100 characters',
			400
		);
	}

	const role = parseRoleId(body.role_id);
	if (!role.ok) {
		return errorResponse('role_id must be a positive integer or null', 400);
	}

	const isActive =
		body.is_active === undefined ? true : parseIsActive(body.is_active);
	if (isActive === null) {
		return errorResponse('is_active must be a boolean', 400);
	}

	let db: PoolConnection | undefined;
	try {
		db = await dbConnect();
		if (!db) {
			throw new Error('Database connection unavailable');
		}

		if (role.roleId !== null && !(await roleIsActive(db, role.roleId))) {
			return errorResponse('Selected role does not exist or is inactive', 400);
		}

		const [existing] = await db.execute<RowDataPacket[]>(
			`SELECT id FROM ticket_departments WHERE name = ? LIMIT 1`,
			[name]
		);
		if (existing.length > 0) {
			return errorResponse('A department with that name already exists', 409);
		}

		const [result] = await db.execute<ResultSetHeader>(
			`INSERT INTO ticket_departments (name, role_id, is_active)
			 VALUES (?, ?, ?)`,
			[name, role.roleId, isActive ? 1 : 0]
		);

		const created = await departmentById(db, result.insertId);
		if (!created) {
			return errorResponse('Failed to load the created department', 500);
		}

		return NextResponse.json({ success: true, data: created });
	} catch (error) {
		if (isDuplicateEntry(error)) {
			return errorResponse('A department with that name already exists', 409);
		}
		return serverError(error, 'Failed to create ticket department');
	} finally {
		if (db) db.release();
	}
}
