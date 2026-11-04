import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	filterProjectForRights,
	loadLeadPolicy,
	resolveProjectRights,
} from '@/lib/project-rights';

/**
 * GET /api/projects/list
 *
 * Optimized endpoint for the projects list page.
 *
 * Every row is resolved through the shared project-rights policy: only
 * projects the actor may open are returned, unreadable sections and
 * protected commercial columns are omitted, and each row carries the
 * resolved `rights` so the client renders from server truth. Stats are
 * computed from the filtered set.
 */
export async function GET(request) {
	const startTime = Date.now();
	let db;

	try {
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			console.error('Auth check failed:', authErr?.message);
			return NextResponse.json(
				{ success: false, error: 'Authentication failed' },
				{ status: 500 }
			);
		}

		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		if (!user.id) {
			return NextResponse.json(
				{ success: false, error: 'Invalid user session' },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const search = searchParams.get('search') || '';
		const status = searchParams.get('status') || '';
		const priority = searchParams.get('priority') || '';

		db = await dbConnect();

		let sourceProjects = [];
		try {
			const [projectsResult] = await db.execute(`
        SELECT * FROM projects WHERE isDelete = 0 ORDER BY created_at DESC
      `);
			sourceProjects = projectsResult || [];
		} catch (queryErr) {
			console.warn('Projects query failed:', queryErr?.message);
			sourceProjects = [];
		}

		// One policy read per request, shared by every row.
		const leadPolicy = await loadLeadPolicy(db);

		let projects = [];
		for (const project of sourceProjects) {
			const rights = resolveProjectRights({
				user,
				project,
				leadPolicy,
			});
			if (!rights.canOpen) continue;
			projects.push({
				...filterProjectForRights(project, rights),
				rights,
			});
		}

		if (search) {
			const s = search.toLowerCase();
			projects = projects.filter(
				(p) =>
					String(p.name || '')
						.toLowerCase()
						.includes(s) ||
					String(p.project_id || '')
						.toLowerCase()
						.includes(s) ||
					String(p.client_name || '')
						.toLowerCase()
						.includes(s)
			);
		}

		if (status) {
			projects = projects.filter(
				(p) => String(p.status || '').toLowerCase() === status.toLowerCase()
			);
		}

		if (priority) {
			projects = projects.filter(
				(p) => String(p.priority || '').toLowerCase() === priority.toLowerCase()
			);
		}

		const stats = {
			total: projects.length,
			in_progress: projects.filter((project) =>
				String(project.status || '')
					.toLowerCase()
					.includes('progress')
			).length,
			completed: projects.filter((project) =>
				String(project.status || '')
					.toLowerCase()
					.includes('complete')
			).length,
			new_projects: projects.filter(
				(project) => String(project.status || '').toLowerCase() === 'new'
			).length,
			on_hold: projects.filter((project) =>
				String(project.status || '')
					.toLowerCase()
					.includes('hold')
			).length,
			total_budget: projects.reduce((sum, project) => {
				const value = Number(project.budget);
				return sum + (Number.isFinite(value) ? value : 0);
			}, 0),
		};

		const queryTime = Date.now() - startTime;

		return NextResponse.json({
			success: true,
			data: projects,
			stats,
			_meta: {
				queryTimeMs: queryTime,
				filtered: projects.length,
			},
		});
	} catch (error) {
		console.error('Projects list error:', error?.message, error?.stack);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch projects',
				details: error?.message,
				stack:
					process.env.NODE_ENV === 'development' ? error?.stack : undefined,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
