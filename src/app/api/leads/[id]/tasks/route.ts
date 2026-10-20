import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	scheduleLeadTask,
	type ScheduleLeadTaskInput,
} from '@/server/leads/activities';
import {
	leadWorkflowFailure,
	parseLeadId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/tasks — schedule one dated next action for a Lead.
 *
 * The scheduled work is a real row of the activity log: it has a date, a
 * kind, and an author. It never changes the stage of the Lead.
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

	let data: ScheduleLeadTaskInput;
	try {
		data = (await request.json()) as ScheduleLeadTaskInput;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const actorUserId = Number(auth.user.id);
	try {
		const result = await scheduleLeadTask(leadId, data, actorUserId);
		void logActivity({
			userId: actorUserId,
			actionType: 'create',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: 'Scheduled a lead task',
			details: {
				lead_numeric_id: leadId,
				task_id: result.task_id,
				next_action_date: result.next_action_date,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: 'Next action scheduled',
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to schedule the lead task');
	}
}
