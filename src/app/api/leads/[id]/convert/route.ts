import { z } from 'zod';
import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { convertLead, type ConvertLeadInput } from '@/server/leads/conversion';
import {
	leadWorkflowFailure,
	parseLeadTaskActivityId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/convert — the Lead-to-Proposal handoff.
 *
 * One request, one transaction: the canonical Proposal of the enquiry is
 * created, the Lead is marked Converted, the conversion is recorded as
 * evidence, and the scheduled Lead work moves to the Proposal.
 *
 * The handoff needs three grants: `leads:convert`, `leads:update`, and
 * `proposals:create`. Every missing grant is refused before anything is
 * written. The established super-admin behaviour applies to all three.
 */

/**
 * The request body: the optional Proposal title and notes. Every other
 * value is the server module's business, not the route's.
 */
const ConvertBodySchema = z.record(z.string(), z.unknown());

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const convertAuth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.CONVERT
	);
	if (convertAuth instanceof Response) return convertAuth;

	const updateAuth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.UPDATE
	);
	if (updateAuth instanceof Response) return updateAuth;

	const proposalAuth = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.CREATE
	);
	if (proposalAuth instanceof Response) return proposalAuth;

	const { id } = await params;
	const leadId = parseLeadTaskActivityId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}

	let data: ConvertLeadInput = {};
	const raw = await request.text();
	if (raw.trim() !== '') {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return Response.json(
				{ success: false, error: 'Invalid JSON body' },
				{ status: 400 }
			);
		}
		const body = ConvertBodySchema.safeParse(parsed);
		if (!body.success) {
			return Response.json(
				{
					success: false,
					error: 'The conversion request body must be a JSON object',
				},
				{ status: 422 }
			);
		}
		data = body.data;
	}

	const actorUserId = Number(convertAuth.user.id);
	try {
		const result = await convertLead(leadId, data, actorUserId);
		void logActivity({
			userId: actorUserId,
			actionType: 'update',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: result.already_converted
				? `Lead conversion repeated: Proposal #${result.proposal_id}`
				: `Lead converted to Proposal #${result.proposal_id}`,
			details: {
				lead_numeric_id: leadId,
				proposal_id: result.proposal_id,
				already_converted: result.already_converted,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: result.already_converted
				? `Proposal #${result.proposal_id} is already the canonical proposal of this enquiry`
				: `Proposal #${result.proposal_id} created from this enquiry`,
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to convert the lead');
	}
}
