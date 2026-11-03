import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	LeadAuditValidationError,
	canReadLeadAudit,
	parseLeadAuditFilters,
	parseLeadAuditPagination,
	readLeadAuditClock,
	withLeadAuditConnection,
} from '@/server/reports/lead-audit';
import {
	parseAuditEvidenceRequest,
	readLeadAuditDeletedEvidenceSection,
} from '@/server/reports/lead-audit/audit';

/**
 * GET /api/reports/lead-audit/audit/deleted
 *
 * The separately paginated retained deleted-record evidence. It never enters
 * an operational total and never invents a deletion actor or time; the
 * selected period does not apply because deletion time was not recorded.
 *
 * Access: the same two report grants as the audit view.
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
		const { evidenceFilters, undated } = parseAuditEvidenceRequest(source);
		const pagination = parseLeadAuditPagination(source);
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(source, clock.today);
			return readLeadAuditDeletedEvidenceSection(
				db,
				filters,
				clock,
				pagination,
				{ evidenceFilters, undated }
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
		console.error('Lead Audit deleted evidence error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load retained deleted evidence' },
			{ status: 500 }
		);
	}
}
