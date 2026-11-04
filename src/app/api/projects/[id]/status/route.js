import { NextResponse } from 'next/server';
import { hasColumn } from '@/utils/schema-cache';
import {
	PROJECT_ACCESS_DENIED,
	requireProjectAccess,
} from '@/lib/project-rights';

/**
 * PUT /api/projects/[id]/status
 * Body: { status: string }
 *
 * Lifecycle is separate from editing. Closing requires the close grant in
 * scope; any other (reopen/activate) transition requires the reopen grant.
 * Lead designation contributes nothing; a general update grant does not
 * reach this route.
 */
export async function PUT(request, { params }) {
	const { id } = await params;
	const access = await requireProjectAccess(request, id);
	if ('response' in access) return access.response;

	const { project, rights, db, ownsDb } = access;

	try {
		const body = await request.json().catch(() => ({}));
		const status = typeof body?.status === 'string' ? body.status.trim() : '';
		if (!status) {
			return NextResponse.json(
				{ success: false, error: 'status is required' },
				{ status: 400 }
			);
		}

		const isClose = status.toLowerCase() === 'completed';
		const permitted = isClose
			? rights.canPerform.close
			: rights.canPerform.reopen;
		if (!permitted) {
			return NextResponse.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		const hasProjectStatus = await hasColumn(db, 'projects', 'project_status');
		const hasStatus = await hasColumn(db, 'projects', 'status');

		if (!hasStatus && !hasProjectStatus) {
			return NextResponse.json(
				{ success: false, error: 'Project status column not found' },
				{ status: 500 }
			);
		}

		const setParts = [];
		const setParams = [];
		if (hasStatus) {
			setParts.push('status = ?');
			setParams.push(status);
		}
		if (hasProjectStatus) {
			setParts.push('project_status = ?');
			setParams.push(status);
		}

		// Resolve the real key of the row the access helper already resolved.
		const keyColumn =
			project.id !== undefined && project.id !== null ? 'id' : 'project_id';
		const keyValue = project[keyColumn];
		if (keyValue === undefined || keyValue === null) {
			return NextResponse.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		const [result] = await db.execute(
			`UPDATE projects SET ${setParts.join(', ')} WHERE ${keyColumn} = ? AND isDelete = 0`,
			[...setParams, keyValue]
		);

		const affectedRows = result?.affectedRows || 0;
		if (affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		return NextResponse.json({ success: true, affected_rows: affectedRows });
	} catch (error) {
		console.error('Project status update error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update project status',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (ownsDb) {
			try {
				db.release?.();
			} catch (error) {
				console.warn(
					'Error releasing DB connection in status PUT:',
					error?.message
				);
			}
		}
	}
}
