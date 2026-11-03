import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { canReadLeadAudit } from '@/server/reports/lead-audit/access';
import { readLeadAuditClock } from '@/server/reports/lead-audit/clock';
import { withLeadAuditConnection } from '@/server/reports/lead-audit/connection';
import {
	parseLeadAuditFilters,
	parseLeadAuditPagination,
} from '@/server/reports/lead-audit/filters';
import {
	parseLeadAuditTimingPopulation,
	readLeadAuditTimingEvidence,
	readLeadAuditTimingIncomingFilters,
} from '@/server/reports/lead-audit/timing';
import { LeadAuditValidationError } from '@/server/reports/lead-audit/types';

/**
 * GET /api/reports/lead-audit/timing/evidence
 *
 * One page of the cohort evidence behind a selected timing figure: the timing
 * samples, the Leads without evidenced outreach, or one exclusion population.
 * Every applied cohort filter is retained, and pagination totals describe the
 * full filtered population rather than the visible page.
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
		const searchParams = new URL(request.url).searchParams;
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = {
				...parseLeadAuditFilters(searchParams, clock.today),
				...readLeadAuditTimingIncomingFilters(searchParams),
			};
			const population = parseLeadAuditTimingPopulation(searchParams);
			const pagination = parseLeadAuditPagination(searchParams);
			return readLeadAuditTimingEvidence(
				db,
				filters,
				clock,
				population,
				pagination
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
		console.error('Lead Audit timing evidence error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load Lead timing evidence' },
			{ status: 500 }
		);
	}
}
