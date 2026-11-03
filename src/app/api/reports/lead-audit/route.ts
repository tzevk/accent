import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	LeadAuditValidationError,
	canReadLeadAudit,
	readLeadAuditReport,
} from '@/server/reports/lead-audit';

/**
 * GET /api/reports/lead-audit
 *
 * The Lead Audit and Performance intake section: the selected period's system
 * entry, separately dated Enquiries, the intake and Enquiry Date trends, and
 * stored source volumes, under the applied filters.
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
		const data = await readLeadAuditReport(new URL(request.url).searchParams);
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit report error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the Lead Audit report' },
			{ status: 500 }
		);
	}
}
