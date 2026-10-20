import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	correctLeadActivity,
	getLeadActivityCorrectionState,
	type CorrectLeadActivityInput,
} from '@/server/leads/corrections';
import {
	leadWorkflowFailure,
	parseLeadId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/activities/[activityId]/corrections — correct one
 * logged Lead activity.
 * GET  /api/leads/[id]/activities/[activityId]/corrections — the current
 * values of one activity and the corrections it has.
 *
 * A correction states that a logged activity was recorded wrongly. It
 * needs a reason, and it never erases what was there before: the previous
 * values, the reason, the actor of the session, and the moment of the
 * correction are kept in the correction history. The version the editor
 * saw travels with the request, so a correction of an activity that moved
 * on is refused instead of overwriting the accepted correction.
 *
 * The write is one transaction: the corrected values, the correction row,
 * and the new version of the activity commit together or not at all.
 */

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string; activityId: string }> }
): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;

	const { id, activityId } = await params;
	const leadId = parseLeadId(id);
	const targetActivityId = parseLeadId(activityId);
	if (leadId === null || targetActivityId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}

	let data: CorrectLeadActivityInput;
	try {
		data = (await request.json()) as CorrectLeadActivityInput;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const actorUserId = Number(auth.user.id);
	try {
		const result = await correctLeadActivity(
			leadId,
			targetActivityId,
			data,
			actorUserId
		);
		void logActivity({
			userId: actorUserId,
			actionType: 'update',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: `Corrected a lead activity: ${String(targetActivityId)}`,
			details: {
				lead_numeric_id: leadId,
				activity_id: targetActivityId,
				version: result.version,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: 'Activity corrected',
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to correct the lead activity');
	}
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string; activityId: string }> }
): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	const { id, activityId } = await params;
	const leadId = parseLeadId(id);
	const targetActivityId = parseLeadId(activityId);
	if (leadId === null || targetActivityId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}

	try {
		const state = await getLeadActivityCorrectionState(
			leadId,
			targetActivityId
		);
		return Response.json({ success: true, data: state });
	} catch (error) {
		return leadWorkflowFailure(
			error,
			'Failed to fetch the lead activity corrections'
		);
	}
}
