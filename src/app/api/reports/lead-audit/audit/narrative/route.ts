import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { PERMISSIONS, RESOURCES, hasPermission } from '@/utils/rbac';
import {
	LeadAuditValidationError,
	canReadLeadAudit,
	readLeadAuditClock,
	withLeadAuditConnection,
} from '@/server/reports/lead-audit';
import {
	parseAuditNarrativeReference,
	readLeadAuditEvidenceNarrative,
} from '@/server/reports/lead-audit/audit';

/**
 * GET /api/reports/lead-audit/audit/narrative?type=activity&id=12
 *
 * On-demand narrative evidence for one audit row: notes, reasons, original
 * and corrected values, correction changes, and the permission-controlled
 * downstream context of a conversion. The text is returned as data and must
 * be rendered as plain text.
 *
 * Access: report and Lead read grants for Lead-side narrative; Proposal
 * details additionally require `proposals:read` and Project details
 * `projects:read`. A denied downstream grant returns a Restricted state with
 * no Proposal or Project fields.
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
		const ref = parseAuditNarrativeReference(
			new URL(request.url).searchParams
		);
		const data = await withLeadAuditConnection(async (db) => {
			// Read the observation clock so every report connection follows
			// the same calendar and connection contract.
			await readLeadAuditClock(db);
			return readLeadAuditEvidenceNarrative(db, ref, {
				includeProposals,
				includeProjects: includeProposals && includeProjects,
			});
		});
		if (!data) {
			return NextResponse.json(
				{ success: false, error: 'Audit evidence not found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof LeadAuditValidationError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: 422 }
			);
		}
		console.error('Lead Audit narrative error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load audit narrative evidence' },
			{ status: 500 }
		);
	}
}
