import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { PERMISSIONS, RESOURCES, hasPermission } from '@/utils/rbac';
import {
	LEAD_AUDIT_EXPORT_CONTENT_TYPE,
	LeadAuditValidationError,
	canReadLeadAudit,
	readLeadAuditExportWorkbook,
	resolveLeadAuditConversionOptions,
} from '@/server/reports/lead-audit';
import { parseIncludeDetailedEvidence } from '@/server/reports/lead-audit/evidence-privacy';

/**
 * GET /api/reports/lead-audit/download
 *
 * The complete Excel evidence copy for the applied report scope. The export
 * always covers the whole applied result, never only the visible page, and it
 * is generated on its own connection and observation clock.
 *
 * Access: both `reports:read` and `leads:read` plus `reports:export`, or the
 * established super-admin bypass. A reader who may view the report but lacks
 * the export grant cannot download it.
 *
 * Narrative evidence is opt-in with `include_narrative=1` (or the longer
 * `include_detailed_evidence=1`). Without it, notes and reasons are absent
 * from every sheet, including nested correction values.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}
	if (!canReadLeadAudit(user)) {
		return NextResponse.json(
			{
				success: false,
				error:
					'The Lead Audit report requires both the Reports read grant and the Leads read grant',
			},
			{ status: 403 }
		);
	}
	if (!hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.EXPORT)) {
		return NextResponse.json(
			{
				success: false,
				error:
					'Downloading the Lead Audit workbook requires the Reports export grant (reports:export)',
			},
			{ status: 403 }
		);
	}

	const searchParams = new URL(request.url).searchParams;
	try {
		const { buffer, filename } = await readLeadAuditExportWorkbook(
			searchParams,
			resolveLeadAuditConversionOptions(user),
			{ includeNarrative: parseIncludeDetailedEvidence(searchParams) }
		);
		return new Response(new Uint8Array(buffer), {
			status: 200,
			headers: {
				'Content-Type': LEAD_AUDIT_EXPORT_CONTENT_TYPE,
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': String(buffer.length),
				'Cache-Control': 'no-store',
			},
		});
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit export error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to generate the Lead Audit workbook' },
			{ status: 500 }
		);
	}
}
