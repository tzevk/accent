import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { canReadLeadAudit } from '@/server/reports/lead-audit/access';
import { readLeadAuditClock } from '@/server/reports/lead-audit/clock';
import { withLeadAuditConnection } from '@/server/reports/lead-audit/connection';
import {
	readLeadAuditConversionSection,
	resolveLeadAuditConversionOptions,
} from '@/server/reports/lead-audit/conversion';
import { parseLeadAuditFilters } from '@/server/reports/lead-audit/filters';
import { parseLeadAuditConversionEvidence } from '@/server/reports/lead-audit/conversion-filters';
import { LeadAuditValidationError } from '@/server/reports/lead-audit/types';

/**
 * GET /api/reports/lead-audit/conversion
 *
 * Cohort progress, source-level conversion, dated period handoffs, the
 * current stage distribution, and the downstream permission states of the
 * evidenced handoffs under the applied filters.
 *
 * Proposal facts require `proposals:read` and Project facts require
 * `projects:read`. Denied fields are absent from this payload; the section
 * reports their state, not their content. The super-admin bypass is the
 * established one.
 *
 * Access: both `reports:read` and `leads:read`, or the super-admin bypass.
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
		const searchParams = new URL(request.url).searchParams;
		parseLeadAuditConversionEvidence(searchParams);
		const options = resolveLeadAuditConversionOptions(user);
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(searchParams, clock.today);
			return readLeadAuditConversionSection(db, filters, clock, options);
		});
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit conversion error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the Lead Audit conversion' },
			{ status: 500 }
		);
	}
}
