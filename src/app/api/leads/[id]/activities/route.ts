import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	logLeadActivity,
	type LogLeadActivityInput,
} from '@/server/leads/activities';
import {
	leadWorkflowFailure,
	parseLeadTaskActivityId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/activities — record one manual Lead activity.
 *
 * A call, an email, a meeting, or a plain-text note, optionally with the
 * dated next action it schedules in the same interaction. The author is the
 * authenticated session; the request never names an actor.
 *
 * The write is one transaction: the activity, the next action, an automatic
 * stage change, and its history commit together or not at all.
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

	let data: LogLeadActivityInput;
	try {
		data = (await request.json()) as LogLeadActivityInput;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const actorUserId = Number(auth.user.id);
	try {
		const result = await logLeadActivity(leadId, data, actorUserId);
		void logActivity({
			userId: actorUserId,
			actionType: 'create',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: `Recorded a lead activity: ${String(data.activity_type ?? '')}`,
			details: {
				lead_numeric_id: leadId,
				activity_id: result.activity_id,
				stage: result.stage,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: 'Activity recorded',
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to record the lead activity');
	}
}
