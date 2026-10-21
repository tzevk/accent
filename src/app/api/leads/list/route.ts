import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { listLeads, type LeadListFilters } from '@/server/leads/workflow';
import { parseLeadListQuery } from '@/server/leads/queues';
import { leadWorkflowFailure } from '@/app/api/leads/_lib/route-helpers';

/**
 * GET /api/leads/list — workspace list with workspace filters.
 * Shares the workflow list query and the filter parser with GET /api/leads
 * so counters, filters, and soft-delete definitions cannot drift between
 * the two.
 */
export async function GET(request: Request): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	const startTime = Date.now();
	try {
		const { searchParams } = new URL(request.url);
		const query = parseLeadListQuery(searchParams);
		const filters: LeadListFilters = {
			...query,
			// The queue of the authenticated user, never a client-supplied id.
			viewerUserId: Number(auth.user.id),
		};
		// The current state of the canonical Proposal reaches a reader who
		// may read Proposals, and nobody else.
		const includeProposals =
			auth.user.is_super_admin ||
			hasPermission(auth.user, RESOURCES.PROPOSALS, PERMISSIONS.READ);
		const { leads, stats, total } = await listLeads(filters, {
			includeProposals,
		});
		return NextResponse.json({
			success: true,
			data: {
				leads,
				stats,
				pagination: {
					page: filters.page,
					limit: filters.limit,
					total,
					totalPages: Math.ceil(total / filters.limit),
				},
			},
			_meta: { queryTimeMs: Date.now() - startTime },
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to fetch leads');
	}
}
