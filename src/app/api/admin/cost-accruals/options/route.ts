/**
 * GET /api/admin/cost-accruals/options
 *
 * The capture form's choice lists: the active Projects a destination may be
 * classified to, and the active users an accrual may be owned by. Reads need
 * the same expense-ledger privilege as the register itself.
 */

import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectOptions } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const projects = await fetchProjectOptions();
		db = await dbConnect();
		const [ownerRows] = await db.execute(
			`SELECT id AS user_id, full_name, username
         FROM users
        WHERE isDelete = 0 AND (is_active = 1 OR is_active IS NULL)
        ORDER BY full_name, id`
		);
		await db.release();
		db = null;
		return NextResponse.json({
			success: true,
			data: { projects, owners: ownerRows },
		});
	} catch (error) {
		console.error('Cost accrual options error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Options failed',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
