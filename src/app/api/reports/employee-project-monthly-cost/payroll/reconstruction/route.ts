/**
 * POST /api/reports/employee-project-monthly-cost/payroll/reconstruction
 *
 * Propose a one-time historical reconstruction for a finalized Payroll Slip
 * that has no saved allocation shares (#308, ADR-0016). The proposal is built
 * from the slip's recorded employer cost and the available monthly Logged
 * Hours and stays pending until an authorized reviewer approves it; nothing is
 * recorded cost and no allocation row exists until then.
 *
 * Body: `{ month: 'YYYY-MM', payroll_slip_id: number, evidence_reference? }`.
 *
 * Access: the operation privilege `other_expenses:update` **and** the
 * financial-source read gate (#308) — the response carries Payroll Slip
 * employer cost and share figures, so a caller without payroll source access
 * is refused with no values.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	proposeAllocationReconstruction,
} from '@/lib/company-expenditure';
import { canReadFinancialSources } from '../../financial-read-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			PERMISSIONS.UPDATE
		);
		if (authResult instanceof Response) return authResult;
		if (!canReadFinancialSources(authResult.user)) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden: missing permission' },
				{ status: 403 }
			);
		}

		const body = (await request.json()) as Record<string, unknown>;
		const month = String(body.month ?? '');
		if (!/^\d{4}-\d{2}$/.test(month)) {
			return NextResponse.json(
				{
					success: false,
					error: 'Valid month (YYYY-MM) is required',
					code: 'invalid_month',
				},
				{ status: 400 }
			);
		}
		const monthNumber = Number(month.slice(5, 7));
		if (monthNumber < 1 || monthNumber > 12) {
			return NextResponse.json(
				{
					success: false,
					error: 'Valid month (YYYY-MM) is required',
					code: 'invalid_month',
				},
				{ status: 400 }
			);
		}
		const slipId = Number(body.payroll_slip_id);
		if (!Number.isInteger(slipId) || slipId <= 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'Valid payroll_slip_id is required',
					code: 'invalid_payroll_slip_id',
				},
				{ status: 400 }
			);
		}

		const result = await proposeAllocationReconstruction(
			{
				month,
				payrollSlipId: slipId,
				evidenceReference:
					body.evidence_reference === undefined ||
					body.evidence_reference === null
						? null
						: String(body.evidence_reference),
			},
			{ id: authResult.user?.id ?? null }
		);

		await logActivity({
			userId: authResult.user?.id ?? 0,
			actionType: 'update',
			resourceType: 'payroll_allocation_reconstruction',
			resourceId: slipId,
			description: `Proposed Project allocation reconstruction ${result.proposal_uid} for Payroll Slip ${slipId} (version ${result.financial_version})`,
			request,
		});

		return NextResponse.json({ success: true, data: result }, { status: 201 });
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
		console.error('Reconstruction propose error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
