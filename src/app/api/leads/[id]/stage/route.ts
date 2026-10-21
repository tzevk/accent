import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { hasPermission } from '@/utils/rbac';
import {
	applyLeadLifecycle,
	type LeadLifecycleInput,
} from '@/server/leads/lifecycle';
import {
	leadWorkflowFailure,
	parseLeadTaskActivityId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/stage — one explicit lifecycle decision on a Lead.
 *
 * Qualify, Nurture, Disqualify, or Reopen. The decision is a human one: the
 * author is the authenticated session, the request never names an actor, and
 * the server decides what the decision needs.
 *
 * The decision needs the Lead update right. A decision that also names an
 * owner needs the Lead assign right, exactly like every other owner write
 * of the Lead feature; without it the request is refused and nothing is
 * written.
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
	const leadId = parseLeadTaskActivityId(id);
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

	// An owner write needs the assign right, exactly like every other owner
	// write of the Lead feature. The refusal happens before the decision,
	// so a request without the grant changes nothing.
	if (
		Object.hasOwn(data, 'owner_user_id') &&
		!hasPermission(auth.user, RESOURCES.LEADS, PERMISSIONS.ASSIGN)
	) {
		return Response.json(
			{ success: false, error: 'Forbidden: missing permission' },
			{ status: 403 }
		);
	}

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
