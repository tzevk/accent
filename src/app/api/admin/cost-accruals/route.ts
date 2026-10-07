/**
 * GET/POST /api/admin/cost-accruals
 *
 * The Cost Accrual register (#313): listed for finance review and captured
 * with its financial identity (evidence basis, received-work period,
 * classification, amount/currency/tax basis, owner). A capture is a draft or
 * pending-evidence row — it is not cost until an authorized recognize command
 * establishes it, so this route needs `other_expenses:create`, while the
 * approval acts live on the command route behind `other_expenses:approve`.
 */

import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { CostError, captureAccrualCost } from '@/lib/company-expenditure';
import type { AccrualCaptureInput } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATES = [
	'draft',
	'pending_evidence',
	'recognized',
	'rejected',
	'cancelled',
] as const;

/** Map the HTTP (snake_case) body onto the module's capture input. */
function captureInput(body: Record<string, unknown>): AccrualCaptureInput {
	return {
		description: String(body.description ?? ''),
		vendorName:
			body.vendor_name === undefined ? undefined : String(body.vendor_name),
		vendorReference:
			body.vendor_reference === undefined
				? undefined
				: String(body.vendor_reference),
		orderUid: body.order_uid === undefined ? undefined : String(body.order_uid),
		evidenceBasis:
			body.evidence_basis === undefined
				? undefined
				: String(body.evidence_basis),
		costClassification:
			body.cost_classification === undefined
				? undefined
				: (body.cost_classification as AccrualCaptureInput['costClassification']),
		projectId:
			body.project_id === undefined ? undefined : Number(body.project_id),
		servicePeriodStart:
			body.service_period_start === undefined
				? undefined
				: (body.service_period_start as string | null),
		servicePeriodEnd:
			body.service_period_end === undefined
				? undefined
				: (body.service_period_end as string | null),
		grossAmount:
			body.gross_amount === undefined
				? undefined
				: (body.gross_amount as number | null),
		taxAmount:
			body.tax_amount === undefined
				? undefined
				: (body.tax_amount as number | null),
		taxTreatment:
			body.tax_treatment === undefined
				? undefined
				: (body.tax_treatment as AccrualCaptureInput['taxTreatment']),
		taxEvidenceReference:
			body.tax_evidence_reference === undefined
				? undefined
				: (body.tax_evidence_reference as string | null),
		currency: body.currency === undefined ? undefined : String(body.currency),
		reportingCurrency:
			body.reporting_currency === undefined
				? undefined
				: String(body.reporting_currency),
		conversionRate:
			body.conversion_rate === undefined
				? undefined
				: (body.conversion_rate as number | string | null),
		conversionDate:
			body.conversion_date === undefined
				? undefined
				: (body.conversion_date as string | null),
		conversionEvidenceReference:
			body.conversion_evidence_reference === undefined
				? undefined
				: (body.conversion_evidence_reference as string | null),
		sourceReference:
			body.source_reference === undefined
				? undefined
				: (body.source_reference as string | null),
		evidenceReference:
			body.evidence_reference === undefined
				? undefined
				: (body.evidence_reference as string | null),
		ownerUserId:
			body.owner_user_id === undefined || body.owner_user_id === null
				? undefined
				: Number(body.owner_user_id),
		submit: body.submit === true,
	};
}

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const url = new URL(request.url);
		const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1);
		const limit = Math.min(
			Math.max(Number(url.searchParams.get('limit') ?? 25), 1),
			200
		);
		const state = url.searchParams.get('state');
		const search = url.searchParams.get('search');

		const where = ['a.isDelete = 0'];
		const params: Array<string | number> = [];
		if (state && (STATES as readonly string[]).includes(state)) {
			where.push('a.recognition_state = ?');
			params.push(state);
		}
		if (search) {
			where.push(
				'(a.accrual_number LIKE ? OR a.description LIKE ? OR a.vendor_name LIKE ?)'
			);
			const like = `%${search}%`;
			params.push(like, like, like);
		}

		db = await dbConnect();
		const [rows] = await db.execute(
			`SELECT a.id, a.accrual_number, a.cost_uid, a.description, a.vendor_name,
              a.evidence_basis, a.cost_classification, a.recognition_state,
              a.recognition_period, a.period_basis, a.service_period_start,
              a.service_period_end, a.currency, a.gross_amount, a.tax_amount,
              a.tax_treatment, a.recognized_amount, a.replaced_amount,
              a.owner_user_id, a.financial_version, a.created_at,
              p.project_code, COALESCE(p.project_title, p.name) AS project_name
         FROM cost_accruals a
         LEFT JOIN projects p ON p.project_id = a.project_id AND p.isDelete = 0
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC
        LIMIT ? OFFSET ?`,
			[...params, limit, (page - 1) * limit]
		);
		const [countRows] = await db.execute(
			`SELECT COUNT(*) AS total FROM cost_accruals a
        WHERE ${where.join(' AND ')}`,
			params
		);
		const [statsRows] = await db.execute(
			`SELECT recognition_state, COUNT(*) AS count, SUM(gross_amount) AS gross
         FROM cost_accruals
        WHERE isDelete = 0
        GROUP BY recognition_state`
		);
		await db.release();
		db = null;

		return NextResponse.json({
			success: true,
			data: rows,
			pagination: {
				page,
				limit,
				total: Number((countRows as Array<{ total: number }>)[0]?.total ?? 0),
			},
			stats: statsRows,
		});
	} catch (error) {
		console.error('Error listing cost accruals:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'List failed',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function POST(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = (await request.json()) as Record<string, unknown>;
		const recorded = await captureAccrualCost(captureInput(body), {
			id: authResult.user?.id ?? null,
		});
		await logActivity({
			userId: authResult.user?.id,
			actionType: 'create',
			resourceType: 'cost_accrual',
			resourceId: recorded.id,
			description: `Captured cost accrual ${recorded.accrual_number} (${recorded.recognition_state})`,
			request,
		});
		return NextResponse.json(
			{ success: true, data: recorded },
			{ status: 201 }
		);
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
		console.error('Cost accrual capture error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Capture failed',
			},
			{ status: 500 }
		);
	}
}
