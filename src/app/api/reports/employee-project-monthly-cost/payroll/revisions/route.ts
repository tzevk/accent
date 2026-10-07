/**
 * GET/POST /api/reports/employee-project-monthly-cost/payroll/revisions
 *
 * The Project Cost Allocation Revision surface (#309, ADR-0016). GET reads one
 * Payroll Slip's full allocation version history — every frozen version, its
 * journal row, actor, reason/evidence, and whether the shares reconcile. POST
 * applies one authorized correction: the corrected monthly attribution is
 * re-run through the canonical allocation rule and appended as the next
 * immutable version, with the same recorded employer cost.
 *
 * Access: the financial read gate — super admins, or `reports:read` **and**
 * `other_expenses:read` **and** `payroll:read` (the payload carries Payroll
 * Slip employer cost). POST additionally requires `payroll:update`, the
 * payroll module's write privilege. Unauthorized actors receive `403` with no
 * employer-cost, share, or slip value, and no write.
 *
 * Query (GET): `payroll_slip_id=<id>` (required, positive integer).
 * Body (POST): { payroll_slip_id, expected_version, reason,
 *                evidence_reference, lines: [{ project_id, hours }] }
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	fetchAllocationRevisionHistory,
	reviseEmployeeAllocation,
} from '@/lib/company-expenditure';
import type { AllocationRevisionLine } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The financial read gate shared with the payroll drilldown (#307). */
function hasFinancialReadGate(
	user: Record<string, unknown>,
	isSuperAdmin: boolean
): boolean {
	return (
		isSuperAdmin ||
		(hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ) &&
			hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
			hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ))
	);
}

export async function GET(request: Request) {
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}
		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		if (!hasFinancialReadGate(user, isSuperAdmin)) {
			return NextResponse.json(
				{
					success: false,
					error:
						'You do not have permission to view the employee project cost report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const slipParam = url.searchParams.get('payroll_slip_id');
		const payrollSlipId = Number(slipParam);
		if (
			slipParam === null ||
			slipParam.trim() === '' ||
			!Number.isInteger(payrollSlipId) ||
			payrollSlipId <= 0
		) {
			return NextResponse.json(
				{
					success: false,
					error: 'payroll_slip_id is required (positive integer)',
					code: 'slip_required',
				},
				{ status: 400 }
			);
		}

		const data = await fetchAllocationRevisionHistory(payrollSlipId);
		if (!data) {
			return NextResponse.json(
				{
					success: false,
					error: 'Payroll Slip not found',
					code: 'slip_not_found',
				},
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('GET payroll allocation revisions error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to read the allocation history' },
			{ status: 500 }
		);
	}
}

export async function POST(request: Request) {
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}
		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		const authorized =
			hasFinancialReadGate(user, isSuperAdmin) &&
			(isSuperAdmin ||
				hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.UPDATE));
		if (!authorized) {
			return NextResponse.json(
				{
					success: false,
					error:
						'You do not have permission to revise Project cost allocations',
				},
				{ status: 403 }
			);
		}

		const body = (await request.json()) as Record<string, unknown>;
		const payrollSlipId = Number(body.payroll_slip_id);
		if (!Number.isInteger(payrollSlipId) || payrollSlipId <= 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'payroll_slip_id is required (positive integer)',
					code: 'slip_required',
				},
				{ status: 400 }
			);
		}
		const expectedVersion = Number(body.expected_version);
		if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
			return NextResponse.json(
				{
					success: false,
					error: 'expected_version is required',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}

		if (!Array.isArray(body.lines)) {
			// An omitted list is not "no eligible hours": that state must be
			// stated explicitly, so a malformed client cannot erase attribution.
			return NextResponse.json(
				{
					success: false,
					error:
						'lines must be an array of { project_id, hours } destinations ([] = no eligible hours)',
					code: 'invalid_lines',
				},
				{ status: 422 }
			);
		}
		const lines: AllocationRevisionLine[] = body.lines.map((entry) => {
			const record =
				entry !== null && typeof entry === 'object'
					? (entry as Record<string, unknown>)
					: {};
			return {
				project_id:
					record.project_id === null || record.project_id === undefined
						? null
						: Number(record.project_id),
				hours: Number(record.hours),
			};
		});

		const result = await reviseEmployeeAllocation(
			{
				payrollSlipId,
				expectedVersion,
				reason: body.reason === undefined ? '' : String(body.reason),
				evidenceReference:
					body.evidence_reference === undefined
						? ''
						: String(body.evidence_reference),
				lines,
			},
			{ id: user.id ?? null }
		);

		await logActivity({
			userId: user.id,
			actionType: 'update',
			resourceType: 'payroll_employee_allocation',
			resourceId: payrollSlipId,
			description: `Project cost allocation revised to version ${result.version} for Payroll Slip ${payrollSlipId}`,
			request,
		});

		return NextResponse.json({ success: true, data: result });
	} catch (error: unknown) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('POST payroll allocation revision error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Revision failed',
			},
			{ status: 500 }
		);
	}
}
