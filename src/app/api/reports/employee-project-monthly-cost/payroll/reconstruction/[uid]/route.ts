/**
 * POST /api/reports/employee-project-monthly-cost/payroll/reconstruction/{uid}
 *
 * Review one reconstruction proposal (#308, ADR-0016): approve freezes the
 * reviewed figures as the Payroll Slip's Project allocation (appending a
 * `reconstructed` journal row and linking the frozen allocation); reject
 * records the decision and changes nothing else. Every command states the
 * version it expects — a stale version, an already-reviewed proposal, or a
 * slip that gained an allocation since the proposal is refused with no partial
 * write. Neither outcome touches the Payroll Slip, its payment status, or the
 * Payroll Run.
 *
 * Body: `{ command: 'approve' | 'reject', expected_version: number, reason? }`.
 *
 * Access: `other_expenses:approve` **and** the financial-source read gate —
 * the response carries employer cost and share figures.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	reviewAllocationReconstruction,
} from '@/lib/company-expenditure';
import { canReadFinancialSources } from '../../../financial-read-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS = ['approve', 'reject'] as const;

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ uid: string }> }
) {
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			PERMISSIONS.APPROVE
		);
		if (authResult instanceof Response) return authResult;
		if (!canReadFinancialSources(authResult.user)) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden: missing permission' },
				{ status: 403 }
			);
		}

		const { uid } = await params;
		if (!uid) {
			return NextResponse.json(
				{
					success: false,
					error: 'A reconstruction proposal id is required',
					code: 'invalid_proposal',
				},
				{ status: 400 }
			);
		}
		const body = (await request.json()) as Record<string, unknown>;
		const command = String(body.command ?? '');
		if (!(COMMANDS as readonly string[]).includes(command)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown command: ${body.command ?? ''}`,
					code: 'invalid_command',
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

		const result = await reviewAllocationReconstruction(
			{
				proposalUid: uid,
				command: command as 'approve' | 'reject',
				expectedVersion,
				reason:
					body.reason === undefined || body.reason === null
						? null
						: String(body.reason),
			},
			{ id: authResult.user?.id ?? null }
		);

		await logActivity({
			userId: authResult.user?.id ?? 0,
			actionType: command === 'approve' ? 'approve' : 'reject',
			resourceType: 'payroll_allocation_reconstruction',
			resourceId: result.evidence.payroll_slip_id,
			description: `Allocation reconstruction ${command} (version ${result.financial_version}) for proposal ${result.proposal_uid}`,
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
		console.error('Reconstruction review error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
