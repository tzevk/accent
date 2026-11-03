import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	LeadAuditValidationError,
	canReadLeadAudit,
} from '@/server/reports/lead-audit';
import { readLeadAuditWorkEvidence } from '@/server/reports/lead-audit/work';

/**
 * GET /api/reports/lead-audit/work/evidence
 *
 * One page of the recorded activities behind a selected work figure, with
 * every applied Lead filter and evidence filter retained. `metric` names the
 * population (completed work, outreach, successful contact, one activity
 * type, unknown types, undated work, or cancelled work).
 *
 * Access: both `reports:read` and `leads:read`, or the established super-admin
 * bypass. The unrelated Project Activities report field grant is not accepted.
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

	try {
		const data = await readLeadAuditWorkEvidence(
			new URL(request.url).searchParams
		);
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit work evidence error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the work evidence' },
			{ status: 500 }
		);
	}
}
