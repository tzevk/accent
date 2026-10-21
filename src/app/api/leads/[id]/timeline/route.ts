import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { getLeadTimeline } from '@/server/leads/activities';
import {
	leadWorkflowFailure,
	parseLeadTaskActivityId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * GET /api/leads/[id]/timeline — the chronological Lead timeline.
 *
 * The activities, the stage changes, and the ownership changes of one Lead,
 * oldest first. Completed work and scheduled work stay distinguishable, and
 * evidence that does not know its author or its outcome says so.
 */

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	const { id } = await params;
	const leadId = parseLeadTaskActivityId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}

	try {
		const entries = await getLeadTimeline(leadId);
		return Response.json({ success: true, data: { entries } });
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to fetch the lead timeline');
	}
}
