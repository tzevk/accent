import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	LeadAuditValidationError,
	canReadLeadAudit,
	parseLeadAuditFilters,
	readLeadAuditClock,
	withLeadAuditConnection,
} from '@/server/reports/lead-audit';
import { readLeadAuditCoverageSection } from '@/server/reports/lead-audit/coverage';

/**
 * GET /api/reports/lead-audit/coverage
 *
 * The Data coverage view: unknown current facts, missing authors, outcomes,
 * occurrence times, and histories, unresolved links, retained deleted
 * evidence, and the metric exclusions those gaps produce.
 *
 * Access: the same two report grants as every other report view.
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
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(source, clock.today);
			return readLeadAuditCoverageSection(db, filters, clock);
		});
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit coverage error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load Lead Audit data coverage' },
			{ status: 500 }
		);
	}
}
