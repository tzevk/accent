import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	canModifyTargetUser,
	ensurePermission,
	invalidateUserCache,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { repairEmployeeLink } from '@/utils/account-link-repair';

interface RepairDb {
	execute(
		sql: string,
		values?: unknown[]
	): Promise<[Array<Record<string, unknown>>, unknown]>;
	beginTransaction(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
	release(): void;
}

const MAX_REASON_LENGTH = 2000;

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	let db: RepairDb | undefined;
	let userId: number | undefined;
	try {
		const auth = await ensurePermission(
			request,
			RESOURCES.USERS,
			PERMISSIONS.UPDATE
		);
		if (auth instanceof Response) return auth;
		if (!auth.user?.is_super_admin) {
			return NextResponse.json(
				{ success: false, error: 'Super-admin access is required' },
				{ status: 403 }
			);
		}

		const { id } = await params;
		if (
			!/^\d+$/.test(id) ||
			!Number.isSafeInteger(Number(id)) ||
			Number(id) <= 0
		) {
			return NextResponse.json(
				{ success: false, error: 'User ID must be a positive integer' },
				{ status: 400 }
			);
		}
		userId = Number(id);

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return NextResponse.json(
				{ success: false, error: 'A valid JSON body is required' },
				{ status: 400 }
			);
		}
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return NextResponse.json(
				{ success: false, error: 'A JSON object is required' },
				{ status: 400 }
			);
		}
		const { employee_id: employeeId, reason } = body as {
			employee_id?: unknown;
			reason?: unknown;
		};
		if (
			employeeId !== null &&
			(!Number.isSafeInteger(employeeId) || Number(employeeId) <= 0)
		) {
			return NextResponse.json(
				{
					success: false,
					error: 'employee_id must be a positive integer or null',
				},
				{ status: 400 }
			);
		}
		if (
			typeof reason !== 'string' ||
			!reason.trim() ||
			reason.length > MAX_REASON_LENGTH
		) {
			return NextResponse.json(
				{
					success: false,
					error: `reason is required and must not exceed ${MAX_REASON_LENGTH} characters`,
				},
				{ status: 400 }
			);
		}

		const targetCheck = canModifyTargetUser(auth.user, { id: userId });
		if (!targetCheck.allowed) {
			return NextResponse.json(
				{ success: false, error: targetCheck.reason || 'Forbidden' },
				{ status: 403 }
			);
		}

		const connection: RepairDb = await dbConnect();
		db = connection;
		const result = await repairEmployeeLink(connection, {
			targetId: userId,
			actor: auth.user,
			employeeId: employeeId as number | null,
			reason: reason.trim(),
		});
		if (!result.ok) {
			return NextResponse.json(
				{ success: false, error: result.error },
				{ status: result.status }
			);
		}
		invalidateUserCache(userId);
		return NextResponse.json({
			success: true,
			data: {
				user_id: userId,
				previous_employee_id: result.previousEmployeeId,
				employee_id: employeeId,
			},
		});
	} catch (error) {
		console.error('Employee link repair failed:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Employee link repair failed; no changes were committed',
			},
			{ status: 409 }
		);
	} finally {
		if (db) db.release();
	}
}
