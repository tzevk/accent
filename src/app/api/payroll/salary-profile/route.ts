import { NextResponse } from 'next/server';
import { withDb, withTransaction } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { getPermissionsFor } from '@/utils/permissions';
import {
	readSalaryTimeline,
	runSalaryCommand,
	type SalaryCommandInput,
} from '@/lib/salary-profile-commands';
import { SALARY_WRITE_ISOLATION } from '@/lib/salary-write-isolation';

const OPERATIONS: Record<string, true> = {
	'create-initial': true,
	correct: true,
	revise: true,
	cancel: true,
};

function failure(
	status: number,
	error: string,
	code: string,
	details?: Record<string, unknown>
) {
	return NextResponse.json(
		details === undefined
			? { success: false, error, code }
			: { success: false, error, code, details },
		{ status }
	);
}

/**
 * POST /api/payroll/salary-profile
 *
 * Explicit salary lifecycle operations. The legacy request `id` upsert and
 * same-date overwrite are deliberately absent; `cancel` is an operation, not a
 * hard DELETE.
 */
export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return failure(400, 'Request body must be valid JSON', 'invalid_input');
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return failure(400, 'Request body must be an object', 'invalid_input');
	}
	const operation = (body as Record<string, unknown>).operation;
	if (typeof operation !== 'string' || OPERATIONS[operation] !== true) {
		return failure(
			400,
			'operation must be create-initial, correct, revise or cancel',
			'invalid_input'
		);
	}

	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		operation === 'cancel' ? PERMISSIONS.DELETE : PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	const actorId = Number(authResult.user?.id);
	if (!Number.isInteger(actorId) || actorId <= 0) {
		return failure(401, 'Unauthorized', 'unauthorized');
	}

	try {
		const outcome = await withTransaction(
			(db) =>
				runSalaryCommand(db, body as unknown as SalaryCommandInput, {
					actorId,
				}),
			{ isolation: SALARY_WRITE_ISOLATION }
		);
		if (!outcome.ok) {
			return failure(
				outcome.status,
				outcome.message,
				outcome.code,
				outcome.details
			);
		}
		return NextResponse.json({
			success: true,
			data: {
				operation: outcome.operation,
				agreement_id: outcome.agreement_id,
				timeline_version: outcome.timeline_version,
				classification: outcome.classification,
				effective_from: outcome.effective_from,
				effective_to: outcome.effective_to,
			},
		});
	} catch (error) {
		console.error('Error saving salary profile:', error);
		return failure(
			500,
			error instanceof Error ? error.message : 'Internal server error',
			'internal_error'
		);
	}
}

/**
 * GET /api/payroll/salary-profile?employee_id=&date=&month=
 *
 * Payroll-authorized timeline read. It composes the attendance source and the
 * working-day helper under payroll:read; it never broadens employee access.
 */
export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;

	const { searchParams } = new URL(request.url);
	const employeeId = Number(searchParams.get('employee_id'));
	if (!Number.isInteger(employeeId) || employeeId <= 0) {
		return failure(
			400,
			'employee_id must be a positive integer',
			'invalid_input'
		);
	}
	const permissions = getPermissionsFor(authResult.user, RESOURCES.PAYROLL);
	const update = permissions.includes(PERMISSIONS.UPDATE);
	const remove = permissions.includes(PERMISSIONS.DELETE);

	try {
		const result = await withDb((db) =>
			readSalaryTimeline(db, employeeId, {
				asOf: searchParams.get('date') ?? undefined,
				month: searchParams.get('month') ?? undefined,
				permissions: { update, delete: remove },
			})
		);
		if (!result.ok) {
			return failure(result.status, result.message, result.code);
		}
		return NextResponse.json({ success: true, data: result.timeline });
	} catch (error) {
		console.error('Error fetching salary timeline:', error);
		return failure(
			500,
			error instanceof Error ? error.message : 'Internal server error',
			'internal_error'
		);
	}
}
