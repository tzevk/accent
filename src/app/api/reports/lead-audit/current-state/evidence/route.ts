import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { canReadLeadAudit } from '@/server/reports/lead-audit/access';
import { readLeadAuditClock } from '@/server/reports/lead-audit/clock';
import { withLeadAuditConnection } from '@/server/reports/lead-audit/connection';
import {
	buildCurrentStateIgnoredFilters,
	parseCurrentStateEvidenceSelection,
	readLeadAuditCurrentStateEvidence,
} from '@/server/reports/lead-audit/current-state';
import {
	parseLeadAuditFilters,
	parseLeadAuditPagination,
} from '@/server/reports/lead-audit/filters';
import { LeadAuditValidationError } from '@/server/reports/lead-audit/types';

/**
 * GET /api/reports/lead-audit/current-state/evidence
 *
 * The paginated evidence behind one current-state figure. `group=workload`
 * (the default) reads Leads by their present owner; `group=risk` requires
 * one existing queue key. Lead queues identify individual Leads; the Overdue
 * and Due today registers identify individual scheduled work items and also
 * report their full-result distinct-Lead count, so the register reconciles
 * with the queue counter beyond the visible page.
 *
 * Access: both `reports:read` and `leads:read`, or the established
 * super-admin bypass.
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
		const selection = parseCurrentStateEvidenceSelection(searchParams);
		const pagination = parseLeadAuditPagination(searchParams);
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(searchParams, clock.today);
			return readLeadAuditCurrentStateEvidence(
				db,
				filters,
				clock,
				selection,
				pagination,
				{
					ignoredFilters: buildCurrentStateIgnoredFilters(
						filters,
						searchParams
					),
				}
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
		console.error('Lead Audit current-state evidence error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to load the Lead Audit current-state evidence',
			},
			{ status: 500 }
		);
	}
}
