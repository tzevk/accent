import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	listLeads,
	LeadWorkflowError,
	type LeadListFilters,
} from '@/server/leads/workflow';

/**
 * GET /api/leads/list — workspace list with workspace filters.
 * Shares the workflow list query with GET /api/leads so counters, filters,
 * and soft-delete definitions cannot drift between the two.
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
		const filters: LeadListFilters = {
			page: Math.max(
				1,
				Number.parseInt(searchParams.get('page') || '1', 10) || 1
			),
			limit: Math.min(
				200,
				Math.max(
					1,
					Number.parseInt(searchParams.get('limit') || '20', 10) || 20
				)
			),
			search: searchParams.get('search') || '',
			status: searchParams.get('status') || '',
			city: searchParams.get('city') || '',
			sortBy: searchParams.get('sortBy') || 'created_at',
			sortOrder: searchParams.get('sortOrder') || 'desc',
			owner: searchParams.get('owner') || '',
			review: searchParams.get('review') || '',
		};
		const { leads, stats, total } = await listLeads(filters);
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
		if (error instanceof LeadWorkflowError) {
			return NextResponse.json(
				{ success: false, error: error.message, code: error.code },
				{ status: error.status }
			);
		}
		console.error('Leads list error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch leads' },
			{ status: 500 }
		);
	}
}
