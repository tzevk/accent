import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	LEGACY_REVIEW_PERMISSIONS,
	isLegacyReviewType,
} from '@/lib/lead-review';
import { resolveLegacyReview } from '@/server/leads/legacy-review';
import {
	leadWorkflowFailure,
	parseLeadTaskActivityId,
} from '@/app/api/leads/_lib/route-helpers';

/**
 * POST /api/leads/[id]/review — resolve one open legacy review item.
 *
 * The reviewer is the authenticated session; the request never names an
 * actor. Each review type needs the resource right that matches the
 * decision it makes:
 * - `stage` → `leads:update`
 * - `owner` → `leads:assign`
 * - `proposal_link` → `leads:update` and `proposals:read` (the reviewer has
 *   to be able to see the Proposals they choose between)
 *
 * A refused or invalid resolution persists nothing.
 */

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
): Promise<Response> {
	const readAuth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (readAuth instanceof Response) return readAuth;

	let data: Record<string, unknown>;
	try {
		data = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const reviewType = data.review_type;
	const requiredPermission = isLegacyReviewType(reviewType)
		? LEGACY_REVIEW_PERMISSIONS[reviewType]
		: PERMISSIONS.UPDATE;
	const actionAuth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		requiredPermission
	);
	if (actionAuth instanceof Response) return actionAuth;

	if (reviewType === 'proposal_link') {
		const proposalAuth = await ensurePermission(
			request,
			RESOURCES.PROPOSALS,
			PERMISSIONS.READ
		);
		if (proposalAuth instanceof Response) return proposalAuth;
	}

	const { id } = await params;
	const leadId = parseLeadTaskActivityId(id);
	if (leadId === null) {
		return Response.json(
			{ success: false, error: 'Lead not found' },
			{ status: 404 }
		);
	}

	const reviewerUserId = Number(readAuth.user.id);
	try {
		const result = await resolveLegacyReview(
			leadId,
			{
				review_type: reviewType,
				resolution: data.resolution,
				reason: data.reason,
			},
			reviewerUserId
		);
		void logActivity({
			userId: reviewerUserId,
			actionType: 'update',
			resourceType: 'lead',
			resourceId: String(leadId),
			description: `Resolved legacy ${String(result.review_type)} review item`,
			details: {
				lead_numeric_id: leadId,
				review_type: result.review_type,
				resolved_value: result.resolved_value,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: result,
			message: 'Legacy review item resolved',
		});
	} catch (error) {
		return leadWorkflowFailure(
			error,
			'Failed to resolve the legacy review item'
		);
	}
}
