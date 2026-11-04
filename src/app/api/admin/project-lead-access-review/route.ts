/**
 * GET /api/admin/project-lead-access-review
 *
 * Read-only review list: users who hold a `projects:update` grant while every
 * project relationship they have is a project they lead. An administrator can
 * then narrow or remove those grants deliberately.
 *
 * This endpoint writes nothing.
 */

import { NextResponse } from 'next/server';
import { withDb } from '@/utils/database';
import {
	getCurrentUser,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { selectLeadAccessReviewUsers } from '@/lib/project-rights/lead-access-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReviewUserRow = {
	user_id: number | string;
	full_name: string | null;
	email: string | null;
	role_name: string | null;
	permissions: unknown;
	field_permissions: unknown;
	is_super_admin: unknown;
	role_permissions: unknown;
};

export async function GET(request: Request) {
	const currentUser = await getCurrentUser(request);
	if (!currentUser) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	const canReview =
		currentUser.is_super_admin ||
		hasPermission(currentUser, RESOURCES.USERS, PERMISSIONS.READ);
	if (!canReview) {
		return NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
	}

	try {
		const data = await withDb(async (db) => {
			const [users] = await db.execute(
				`SELECT u.id AS user_id,
				        u.full_name,
				        u.email,
				        u.permissions,
				        u.field_permissions,
				        u.is_super_admin,
				        r.role_name,
				        r.permissions AS role_permissions
				   FROM users u
				   LEFT JOIN roles_master r ON u.role_id = r.id
				  WHERE u.isDelete = 0`
			);
			const [projects] = await db.execute(
				'SELECT project_team FROM projects WHERE isDelete = 0'
			);

			return selectLeadAccessReviewUsers(
				users as ReviewUserRow[],
				projects as { project_team?: unknown }[]
			);
		});

		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Project lead access review error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to load project lead access review',
			},
			{ status: 500 }
		);
	}
}
