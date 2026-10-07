/**
 * POST /api/admin/cost-accruals/[id]/commands
 *
 * The versioned financial commands on a Cost Accrual: submit, recognize,
 * reject, cancel, and update. Recognition is the authorizing act that turns a
 * captured accrual into confirmed cost, so it carries its own privilege —
 * `other_expenses:approve` — while drafting and editing need
 * `other_expenses:update`. A patch that reprices the currency pair is the same
 * approval act as on every other source.
 *
 * Every command states the version it expects. A stale version, a command the
 * current state does not allow, a cost that is not ready for recognition
 * (including a PO balance offered as evidence), or a missing reason all fail
 * explicitly and change nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	OrderError,
	executeAccrualCommandWithConsumption,
} from '@/lib/company-expenditure';
import type {
	AccrualCommandInput,
	AccrualPatch,
	CostCommandName,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS: CostCommandName[] = [
	'update',
	'submit',
	'recognize',
	'reject',
	'cancel',
];

const CONVERSION_PATCH_FIELDS = [
	'currency',
	'reportingCurrency',
	'conversionRate',
	'conversionDate',
	'conversionEvidenceReference',
] as const;

/** Recognition and refusal are approvals; drafting and edits are updates. */
function permissionFor(
	command: CostCommandName,
	patch: Record<string, unknown> | undefined
): string {
	if (command === 'update' || command === 'submit') {
		const touchesConversion =
			patch !== undefined &&
			CONVERSION_PATCH_FIELDS.some((field) => patch[field] !== undefined);
		return touchesConversion ? PERMISSIONS.APPROVE : PERMISSIONS.UPDATE;
	}
	return PERMISSIONS.APPROVE;
}

/** Map the HTTP (snake_case) patch onto the module's field names. */
function commandPatch(raw: Record<string, unknown> | undefined): AccrualPatch {
	if (!raw) return {};
	const patch: AccrualPatch = {
		description:
			raw.description === undefined ? undefined : String(raw.description),
		vendorName:
			raw.vendor_name === undefined ? undefined : String(raw.vendor_name),
		vendorReference:
			raw.vendor_reference === undefined
				? undefined
				: String(raw.vendor_reference),
		orderUid: raw.order_uid === undefined ? undefined : String(raw.order_uid),
		evidenceBasis:
			raw.evidence_basis === undefined ? undefined : String(raw.evidence_basis),
		costClassification:
			raw.cost_classification === undefined
				? undefined
				: (raw.cost_classification as AccrualPatch['costClassification']),
		projectId:
			raw.project_id === undefined
				? undefined
				: (raw.project_id as number | null),
		servicePeriodStart:
			raw.service_period_start === undefined
				? undefined
				: (raw.service_period_start as string | null),
		servicePeriodEnd:
			raw.service_period_end === undefined
				? undefined
				: (raw.service_period_end as string | null),
		grossAmount:
			raw.gross_amount === undefined
				? undefined
				: (raw.gross_amount as number | null),
		taxAmount:
			raw.tax_amount === undefined
				? undefined
				: (raw.tax_amount as number | null),
		taxTreatment:
			raw.tax_treatment === undefined
				? undefined
				: (raw.tax_treatment as AccrualPatch['taxTreatment']),
		taxEvidenceReference:
			raw.tax_evidence_reference === undefined
				? undefined
				: (raw.tax_evidence_reference as string | null),
		currency:
			raw.currency === undefined ? undefined : (raw.currency as string | null),
		reportingCurrency:
			raw.reporting_currency === undefined
				? undefined
				: (raw.reporting_currency as string | null),
		conversionRate:
			raw.conversion_rate === undefined
				? undefined
				: (raw.conversion_rate as number | string | null),
		conversionDate:
			raw.conversion_date === undefined
				? undefined
				: (raw.conversion_date as string | null),
		conversionEvidenceReference:
			raw.conversion_evidence_reference === undefined
				? undefined
				: (raw.conversion_evidence_reference as string | null),
		sourceReference:
			raw.source_reference === undefined
				? undefined
				: (raw.source_reference as string | null),
		evidenceReference:
			raw.evidence_reference === undefined
				? undefined
				: (raw.evidence_reference as string | null),
		ownerUserId:
			raw.owner_user_id === undefined
				? undefined
				: (raw.owner_user_id as number | null),
	};
	return patch;
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const command = String(body.command ?? '') as CostCommandName;
		if (!COMMANDS.includes(command)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown command: ${body.command ?? ''}`,
					code: 'invalid_command',
				},
				{ status: 400 }
			);
		}

		const authResult = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			permissionFor(command, body.patch as Record<string, unknown> | undefined)
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		const accrualId = Number(id);
		if (!Number.isInteger(accrualId) || accrualId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid accrual id is required' },
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

		const input: AccrualCommandInput = {
			id: accrualId,
			command,
			expectedVersion,
			reason: body.reason === undefined ? null : String(body.reason),
			evidenceReference:
				body.evidence_reference === undefined
					? undefined
					: String(body.evidence_reference),
			patch: commandPatch(body.patch as Record<string, unknown> | undefined),
		};
		const result = await executeAccrualCommandWithConsumption(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: command === 'recognize' ? 'approve' : 'update',
			resourceType: 'cost_accrual',
			resourceId: accrualId,
			description: `Cost accrual ${command} (version ${result.financial_version}) for accrual ${accrualId}`,
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
		if (error instanceof OrderError) {
			return NextResponse.json(
				{
					success: false,
					message: error.message,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('Cost accrual command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
