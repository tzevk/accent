import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { hasPermission } from '@/utils/rbac';
import {
	createLead,
	listLeads,
	type LeadListFilters,
} from '@/server/leads/workflow';
import { leadWorkflowFailure } from '@/app/api/leads/_lib/route-helpers';

function parseListFilters(request: Request): LeadListFilters {
	const { searchParams } = new URL(request.url);
	return {
		page: Math.max(
			1,
			Number.parseInt(searchParams.get('page') || '1', 10) || 1
		),
		limit: Math.min(
			200,
			Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20)
		),
		search: searchParams.get('search') || '',
		status: searchParams.get('status') || '',
		city: searchParams.get('city') || '',
		sortBy: searchParams.get('sortBy') || 'created_at',
		sortOrder: searchParams.get('sortOrder') || 'desc',
		owner: searchParams.get('owner') || '',
		review: searchParams.get('review') || '',
	};
}

export async function GET(request: Request): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	try {
		const filters = parseListFilters(request);
		const { leads, stats, total } = await listLeads(filters);
		return Response.json({
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
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to process lead request');
	}
}

export async function POST(request: Request): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.CREATE
	);
	if (auth instanceof Response) return auth;

	let data: Record<string, unknown>;
	try {
		data = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	// An explicit owner override differs from creator defaulting and needs
	// the assignment grant; ownership stays an intake default otherwise.
	// Strict matching only: garbage values fail closed to the assign check
	// and then to the workflow's 422, never to a coerced user.
	const ownerProvided = Object.hasOwn(data, 'owner_user_id');
	const creatorId = Number(auth.user.id);
	const rawOwner = data.owner_user_id;
	const matchesCreator =
		(typeof rawOwner === 'number' && rawOwner === creatorId) ||
		(typeof rawOwner === 'string' &&
			/^\d+$/.test(rawOwner.trim()) &&
			Number.parseInt(rawOwner.trim(), 10) === creatorId);
	const overrideDiffers = ownerProvided && !matchesCreator;
	if (
		overrideDiffers &&
		!auth.user.is_super_admin &&
		!hasPermission(auth.user, RESOURCES.LEADS, PERMISSIONS.ASSIGN)
	) {
		return Response.json(
			{ success: false, error: 'Forbidden: missing permission' },
			{ status: 403 }
		);
	}

	try {
		const { id } = await createLead(data, Number(auth.user.id));
		const companyName =
			typeof data.company_name === 'string' ? data.company_name : 'lead';
		void logActivity({
			userId: Number(auth.user.id),
			actionType: 'create',
			resourceType: 'lead',
			resourceId: String(id),
			description: `Created lead: ${companyName}`,
			details: { lead_numeric_id: id, company_name: companyName },
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			data: { id },
			message: 'Lead created successfully',
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to process lead request');
	}
}
