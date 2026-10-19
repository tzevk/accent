import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { hasPermission } from '@/utils/rbac';
import {
	deleteLead,
	getLeadDetail,
	updateLead,
	LeadWorkflowError,
} from '@/server/leads/workflow';

function workflowFailure(error: unknown, fallback: string): Response {
	if (error instanceof LeadWorkflowError) {
		return Response.json(
			{ success: false, error: error.message, code: error.code },
			{ status: error.status }
		);
	}
	console.error('Lead workflow error:', error);
	return Response.json({ success: false, error: fallback }, { status: 500 });
}

function parseId(value: string): number | null {
	const id = Number.parseInt(value, 10);
	return Number.isInteger(id) && id > 0 ? id : null;
}

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
	const leadId = parseId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}
	try {
		const lead = await getLeadDetail(leadId);
		return Response.json({ success: true, data: lead });
	} catch (error) {
		return workflowFailure(error, 'Failed to fetch lead');
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const { id } = await params;
	const leadId = parseId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}
	let data: Record<string, unknown>;
	try {
		data = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	// Permission follows the actual action: a pure assignment needs
	// leads:assign, ordinary edits need leads:update, mixed bodies need both.
	// Ownership never restricts editing — only the grants do.
	const keys = Object.keys(data);
	const ownerProvided = Object.hasOwn(data, 'owner_user_id');
	const pureAssignment = ownerProvided && keys.length === 1;
	const needsAssign = ownerProvided;
	const needsUpdate = !pureAssignment;

	const assignAuth = needsAssign
		? await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.ASSIGN)
		: null;
	if (assignAuth instanceof Response) return assignAuth;
	const updateAuth = needsUpdate
		? await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.UPDATE)
		: null;
	if (updateAuth instanceof Response) return updateAuth;
	const user = assignAuth?.user ?? updateAuth?.user;
	if (!user) {
		return Response.json(
			{ success: false, error: 'Forbidden: missing permission' },
			{ status: 403 }
		);
	}
	if (
		!user.is_super_admin &&
		((needsAssign &&
			!hasPermission(user, RESOURCES.LEADS, PERMISSIONS.ASSIGN)) ||
			(needsUpdate &&
				!hasPermission(user, RESOURCES.LEADS, PERMISSIONS.UPDATE)))
	) {
		return Response.json(
			{ success: false, error: 'Forbidden: missing permission' },
			{ status: 403 }
		);
	}

	try {
		const updated = await updateLead(leadId, data, Number(user.id));
		const companyName =
			typeof data.company_name === 'string' ? data.company_name : 'lead';
		void logActivity({
			userId: Number(user.id),
			actionType: pureAssignment ? 'assign' : 'update',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: pureAssignment
				? `Assigned lead: ${companyName}`
				: `Updated lead: ${companyName}`,
			details: pureAssignment
				? { owner_user_id: updated.owner_user_id }
				: { updated_fields: keys },
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: updated,
			message: pureAssignment
				? 'Lead assigned successfully'
				: 'Lead updated successfully',
		});
	} catch (error) {
		return workflowFailure(error, 'Failed to update lead');
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.DELETE
	);
	if (auth instanceof Response) return auth;

	const { id } = await params;
	const leadId = parseId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}
	try {
		await deleteLead(leadId);
		void logActivity({
			userId: Number(auth.user.id),
			actionType: 'delete',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: `Soft deleted lead #${leadId}`,
			details: { isDelete: 1 },
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({ success: true, message: 'Lead marked as deleted' });
	} catch (error) {
		return workflowFailure(error, 'Failed to delete lead');
	}
}
