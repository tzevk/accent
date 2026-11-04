import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { canReadLeadAudit } from '@/server/reports/lead-audit/access';
import { readLeadAuditClock } from '@/server/reports/lead-audit/clock';
import { withLeadAuditConnection } from '@/server/reports/lead-audit/connection';
import { parseLeadAuditConversionEvidence } from '@/server/reports/lead-audit/conversion-filters';
import {
	parseLeadAuditFilters,
	parseLeadAuditPagination,
} from '@/server/reports/lead-audit/filters';
import {
	readLeadAuditConversionEvidenceSection,
	resolveLeadAuditConversionOptions,
} from '@/server/reports/lead-audit/conversion';
import { LeadAuditValidationError } from '@/server/reports/lead-audit/types';

/**
 * GET /api/reports/lead-audit/conversion
 *
 * The paginated conversion evidence of the applied report scope. `evidence`
 * names the population: all cohort and period evidence, evidenced cohort
 * handoffs, dated period handoffs, undated canonical links, unresolved links,
 * or Converted stage labels without evidence. Every shared report filter is
 * retained; the activity and audit filters are disclosed as not applicable.
 *
 * Proposal facts require `proposals:read` and Project facts require
 * `projects:read`. Denied fields are absent from this payload, not merely
 * hidden by the interface. The super-admin bypass is the established one.
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
		const source = new URL(request.url).searchParams;
		const options = resolveLeadAuditConversionOptions(user);
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(source, clock.today);
			const evidence = parseLeadAuditConversionEvidence(source);
			const pagination = parseLeadAuditPagination(source);
			return readLeadAuditConversionEvidenceSection(
				db,
				filters,
				clock,
				evidence,
				pagination,
				options
			);
		});
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit conversion evidence error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to load the Lead Audit conversion evidence',
			},
			{ status: 500 }
		);
	}
}
