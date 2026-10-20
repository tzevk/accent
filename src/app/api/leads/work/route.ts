import {
	ensurePermission,
	PERMISSIONS,
	RESOURCES,
} from '@/utils/api-permissions';
import { listUpcomingLeadWork } from '@/server/leads/workflow';
import { leadWorkflowFailure } from '@/app/api/leads/_lib/route-helpers';

/**
 * GET /api/leads/work?scope=upcoming — the outstanding Lead work across
 * Leads, soonest first.
 *
 * The dashboard follow-up widget reads this: the outstanding scheduled work
 * of every Lead, with the Lead it belongs to.
 */

export async function GET(request: Request): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	const { searchParams } = new URL(request.url);
	const scope = searchParams.get('scope') ?? 'upcoming';
	if (scope !== 'upcoming') {
		return Response.json(
			{
				success: false,
				error: `Unsupported work scope: ${scope}`,
				code: 'view_invalid',
			},
			{ status: 400 }
		);
	}
	const requestedLimit = Number.parseInt(searchParams.get('limit') ?? '20', 10);
	const limit = Number.isInteger(requestedLimit)
		? Math.min(Math.max(requestedLimit, 1), 50)
		: 20;

	try {
		const work = await listUpcomingLeadWork(limit);
		return Response.json({ success: true, data: { work } });
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to fetch the lead work queue');
	}
}
