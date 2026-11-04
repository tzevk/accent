import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { PERMISSIONS, RESOURCES, hasPermission } from '@/utils/rbac';
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
	readLeadAuditEvidenceSection,
} from '@/server/reports/lead-audit/audit';

/**
 * GET /api/reports/lead-audit/audit
 *
 * One page of available audit evidence: activities, stage/lifecycle
 * decisions, owner changes, corrections, legacy reviews, and conversions,
 * plus the separately labelled first page of retained deleted evidence.
 *
 * Access: both `reports:read` and `leads:read`, or the super-admin bypass.
 * Proposal details additionally require `proposals:read`; Project details
 * require `projects:read`. Denied downstream facts are absent, not empty.
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

	const includeProposals = !!(
		user.is_super_admin ||
		hasPermission(user, RESOURCES.PROPOSALS, PERMISSIONS.READ)
	);
	const includeProjects = !!(
		user.is_super_admin ||
		hasPermission(user, RESOURCES.PROJECTS, PERMISSIONS.READ)
	);

	try {
		const source = new URL(request.url).searchParams;
		const { evidenceFilters, undated } = parseAuditEvidenceRequest(source);
		const pagination = parseLeadAuditPagination(source);
		const data = await withLeadAuditConnection(async (db) => {
			const clock = await readLeadAuditClock(db);
			const filters = parseLeadAuditFilters(source, clock.today);
			return readLeadAuditEvidenceSection(db, filters, clock, {
				evidenceFilters,
				undated,
				pagination,
				includeProposals,
				// A Project is only reachable through a readable Proposal.
				includeProjects: includeProposals && includeProjects,
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
		console.error('Lead Audit evidence error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load Lead audit evidence' },
			{ status: 500 }
		);
	}
}
