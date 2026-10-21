import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	updateLeadTask,
	type UpdateLeadTaskInput,
} from '@/server/leads/activities';
import {
	leadWorkflowFailure,
	parseLeadTaskActivityId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * PATCH /api/leads/[id]/tasks/[taskId] — close one scheduled Lead task.
 *
 * The task either happened (`Completed`, with the call outcome or the email
 * reply that says so) or it will not happen (`Cancelled`). Closing the last
 * outstanding task of an active Lead needs the replacement next action in
 * the same request.
 */

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string; taskId: string }> }
): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;

	const { id, taskId } = await params;
	const leadId = parseLeadTaskActivityId(id);
	const numericTaskId = parseLeadTaskActivityId(taskId);
	if (leadId === null || numericTaskId === null) {
		return Response.json(
			{ success: false, error: 'Lead task not found' },
			{ status: 404 }
		);
	}

	let data: UpdateLeadTaskInput;
	try {
		data = (await request.json()) as UpdateLeadTaskInput;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const actorUserId = Number(auth.user.id);
	try {
		const result = await updateLeadTask(
			leadId,
			numericTaskId,
			data,
			actorUserId
		);
		void logActivity({
			userId: actorUserId,
			actionType: 'update',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: `Closed a lead task: ${result.status}`,
			details: {
				lead_numeric_id: leadId,
				task_id: result.task_id,
				status: result.status,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: 'Lead task updated',
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to update the lead task');
	}
}
