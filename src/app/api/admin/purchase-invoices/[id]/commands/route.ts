/**
 * POST /api/admin/purchase-invoices/[id]/commands
 *
 * The versioned financial commands on a supplier invoice: submit, recognize,
 * reject, cancel, and update (including its service-period slices). The
 * invoice register itself stays the operational record; these commands are the
 * only path that changes its financial fields.
 *
 * Authorization is layered: the source register privilege
 * (`purchase_orders:update`) covers reads and edits, and the financial
 * approval privilege (`other_expenses:approve`) is required for recognize,
 * reject, and cancel. Every command states the version it expects; a stale
 * version, a disallowed transition, a cost that is not ready for recognition,
 * or a missing reason fails explicitly and changes nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executeSupplierCommand,
} from '@/lib/company-expenditure';
import type {
	CostCommandName,
	SupplierCommandInput,
	SupplierInvoicePatch,
	SupplierSplitInput,
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

const APPROVAL_COMMANDS: CostCommandName[] = ['recognize', 'reject', 'cancel'];

function splitInput(split: Record<string, unknown>): SupplierSplitInput {
	return {
		servicePeriodStart:
			split.service_period_start === undefined
				? undefined
				: (split.service_period_start as string | null),
		servicePeriodEnd:
			split.service_period_end === undefined
				? undefined
				: (split.service_period_end as string | null),
		amount:
			split.amount === undefined
				? undefined
				: (split.amount as number | string | null),
		taxAmount:
			split.tax_amount === undefined
				? undefined
				: (split.tax_amount as number | string | null),
		note: split.note === undefined ? undefined : (split.note as string | null),
	};
}

/** Map the HTTP (snake_case) patch onto the module's field names. */
function commandPatch(
	raw: Record<string, unknown> | undefined
): SupplierInvoicePatch {
	if (!raw) return {};
	const patch: SupplierInvoicePatch = {
		costClassification:
			raw.cost_classification === undefined
				? undefined
				: (raw.cost_classification as SupplierInvoicePatch['costClassification']),
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
		billDate:
			raw.bill_date === undefined ? undefined : (raw.bill_date as string | null),
		currency:
			raw.currency === undefined ? undefined : (raw.currency as string | null),
		grossAmount:
			raw.gross_amount === undefined
				? undefined
				: (raw.gross_amount as number | null),
		taxAmount:
			raw.tax_amount === undefined ? undefined : (raw.tax_amount as number | null),
		taxTreatment:
			raw.tax_treatment === undefined
				? undefined
				: (raw.tax_treatment as SupplierInvoicePatch['taxTreatment']),
		taxEvidenceReference:
			raw.tax_evidence_reference === undefined
				? undefined
				: (raw.tax_evidence_reference as string | null),
		sourceReference:
			raw.source_reference === undefined
				? undefined
				: (raw.source_reference as string | null),
		evidenceReference:
			raw.evidence_reference === undefined
				? undefined
				: (raw.evidence_reference as string | null),
		withholdingTaxAmount:
			raw.withholding_tax_amount === undefined
				? undefined
				: (raw.withholding_tax_amount as number | null),
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
	};
	if (raw.splits !== undefined) {
		patch.splits = Array.isArray(raw.splits)
			? raw.splits.map((split) =>
					splitInput((split ?? {}) as Record<string, unknown>)
				)
			: null;
	}
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
			RESOURCES.PURCHASE_ORDERS,
			PERMISSIONS.UPDATE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		if (APPROVAL_COMMANDS.includes(command)) {
			const approval = await ensurePermission(
				request,
				RESOURCES.OTHER_EXPENSES,
				PERMISSIONS.APPROVE
			);
			if (approval instanceof Response) return approval;
			if (!approval.authorized) return approval.response;
		}

		const { id } = await params;
		const invoiceId = Number(id);
		if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid invoice id is required' },
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

		const input: SupplierCommandInput = {
			id: invoiceId,
			command,
			expectedVersion,
			reason: body.reason === undefined ? null : String(body.reason),
			evidenceReference:
				body.evidence_reference === undefined
					? undefined
					: String(body.evidence_reference),
			patch: commandPatch(
				(body.patch ?? undefined) as Record<string, unknown> | undefined
			),
		};
		const result = await executeSupplierCommand(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: command === 'recognize' ? 'approve' : 'update',
			resourceType: 'purchase_invoice',
			resourceId: invoiceId,
			description: `Supplier cost ${command} (version ${result.financial_version}) for invoice ${invoiceId}`,
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
		console.error('Supplier invoice command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
