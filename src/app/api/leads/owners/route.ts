import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { listLeadOwners } from '@/server/leads/workflow';

/**
 * GET /api/leads/owners — minimal assignment directory.
 * Active users only, name-ordered; guarded by leads:assign so the directory
 * cannot be used to probe users without assignment rights.
 */
export async function GET(request: Request): Promise<Response> {
	const auth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.ASSIGN
	);
	if (auth instanceof Response) return auth;

	try {
		const owners = await listLeadOwners();
		return NextResponse.json({ success: true, data: owners });
	} catch (error) {
		console.error('Lead owners error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch lead owners' },
			{ status: 500 }
		);
	}
}
