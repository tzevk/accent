import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { canReadLeadAudit } from '@/server/reports/lead-audit/access';
import { readLeadAuditClock } from '@/server/reports/lead-audit/clock';
import { withLeadAuditConnection } from '@/server/reports/lead-audit/connection';
import {
	buildCurrentStateIgnoredFilters,
	readLeadAuditCurrentStateSection,
} from '@/server/reports/lead-audit/current-state';
import { parseLeadAuditFilters } from '@/server/reports/lead-audit/filters';
import { LeadAuditValidationError } from '@/server/reports/lead-audit/types';

/**
 * GET /api/reports/lead-audit/current-state
 *
 * Live current-owner workload and the five operational Lead queues at the
 * database's observation day. The selected reporting period is parsed for
 * validity but explicitly ignored: these figures never claim a period-end
 * backlog. Current owner, source, current stage, priority, and search narrow
 * the population; actor and audit filters are reported as ignored.
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
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(searchParams, clock.today);
			return readLeadAuditCurrentStateSection(db, filters, clock, {
				ignoredFilters: buildCurrentStateIgnoredFilters(filters, searchParams),
			});
		});
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit current-state error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the Lead Audit current state' },
			{ status: 500 }
		);
	}
}
