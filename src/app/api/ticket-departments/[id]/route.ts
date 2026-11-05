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
 * PUT /api/ticket-departments/[id]
 *   Super-admin only. Replaces the configuration of one live department:
 *   `{ name, role_id, is_active }`. `role_id` may be null to unmap the
 *   department; nullable is intentional during setup. Unknown departments
 *   return 404, duplicate names 409, invalid names or inactive roles 400.
 *
 * This path matches the shared ResourceFormModal convention
 * (`${endpoint}/${row.id}`), so the collection route does not expose PUT.
 */

type DepartmentRow = RowDataPacket & {
	id: number | string;
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

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
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

	const { id } = await params;
	const departmentId = Number(id);
	if (!Number.isInteger(departmentId) || departmentId <= 0) {
		return errorResponse('Invalid department id', 400);
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

		const [existing] = await db.execute<DepartmentRow[]>(
			`SELECT id FROM ticket_departments WHERE id = ? AND isDelete = 0 LIMIT 1`,
			[departmentId]
		);
		if (existing.length === 0) {
			return errorResponse('Ticket department not found', 404);
		}

		if (role.roleId !== null && !(await roleIsActive(db, role.roleId))) {
			return errorResponse('Selected role does not exist or is inactive', 400);
		}

		const [duplicate] = await db.execute<DepartmentRow[]>(
			`SELECT id FROM ticket_departments WHERE name = ? AND id <> ? LIMIT 1`,
			[name, departmentId]
		);
		if (duplicate.length > 0) {
			return errorResponse('A department with that name already exists', 409);
		}

		await db.execute<ResultSetHeader>(
			`UPDATE ticket_departments
			 SET name = ?, role_id = ?, is_active = ?
			 WHERE id = ? AND isDelete = 0`,
			[name, role.roleId, isActive ? 1 : 0, departmentId]
		);

		const updated = await departmentById(db, departmentId);
		if (!updated) {
			return errorResponse('Ticket department not found', 404);
		}

		return NextResponse.json({ success: true, data: updated });
	} catch (error) {
		if (isDuplicateEntry(error)) {
			return errorResponse('A department with that name already exists', 409);
		}
		return serverError(error, 'Failed to update ticket department');
	} finally {
		if (db) db.release();
	}
}
