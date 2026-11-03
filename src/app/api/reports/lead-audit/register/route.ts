import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	LeadAuditValidationError,
	canReadLeadAudit,
	readLeadAuditRegister,
} from '@/server/reports/lead-audit';

/**
 * GET /api/reports/lead-audit/register
 *
 * The paginated Lead evidence behind one intake figure. The metric names the
 * population (Leads recorded, Enquiries dated, or Missing Enquiry Dates) and
 * every applied filter is retained.
 *
 * Access: both `reports:read` and `leads:read`, or the established super-admin
 * bypass.
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
		const data = await readLeadAuditRegister(
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
		console.error('Lead Audit register error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the Lead Audit Lead register' },
			{ status: 500 }
		);
	}
}
