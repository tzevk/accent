import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	applyLeadLifecycle,
	type LeadLifecycleInput,
} from '@/server/leads/lifecycle';
import {
	leadWorkflowFailure,
	parseLeadId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/stage — one explicit lifecycle decision on a Lead.
 *
 * Qualify, Nurture, Disqualify, or Reopen. The decision is a human one: the
 * author is the authenticated session, the request never names an actor, and
 * the server decides what the decision needs.
 *
 * The write is one transaction: the stage, the ownership change, the next
 * action, the cancelled work, and the stage history commit together or not
 * at all.
 */

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;

	const { id } = await params;
	const leadId = parseLeadId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}

	let data: LeadLifecycleInput;
	try {
		data = (await request.json()) as LeadLifecycleInput;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const actorUserId = Number(auth.user.id);
	try {
		const result = await applyLeadLifecycle(leadId, data, actorUserId);
		void logActivity({
			userId: actorUserId,
			actionType: 'update',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: `Lead lifecycle decision: ${String(data.action ?? '')}`,
			details: {
				lead_numeric_id: leadId,
				action: data.action,
				stage: result.stage,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: `Lead is now ${result.stage}`,
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to apply the lead decision');
	}
}
