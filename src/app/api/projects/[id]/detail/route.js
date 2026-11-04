import { NextResponse } from 'next/server';
import {
	requireProjectAccess,
	filterProjectForRights,
} from '@/lib/project-rights';

/**
 * Helper to safely parse JSON fields
 */
function parseJsonField(value, fallback = []) {
	if (!value) return fallback;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

/**
 * GET /api/projects/[id]/detail
 *
 * Optimized endpoint for fetching single project details for the edit screen.
 * Authorization and payload shaping both come from the shared project-rights
 * policy: a denied project returns the generic 403 (never an empty payload),
 * unreadable sections are omitted, and `rights` travels beside `data`.
 */
export async function GET(request, { params }) {
	const startTime = Date.now();
	const { id } = await params;

	const access = await requireProjectAccess(request, id);
	if ('response' in access) return access.response;

	const { project, rights, db, ownsDb } = access;

	try {
		const projectKey = project.id ?? project.project_id;

		let projectActivities = [];
		let assignments = [];
		if (rights.sections.project_activity.read) {
			const [activitiesResult, assignmentsResult] = await Promise.all([
				db
					.execute(
						'SELECT * FROM project_activities WHERE project_id = ? ORDER BY created_at DESC',
						[projectKey]
					)
					.catch(() => [[]]),
				db
					.execute(
						'SELECT * FROM user_activity_assignments WHERE project_id = ?',
						[projectKey]
					)
					.catch(() => [[]]),
			]);
			projectActivities = activitiesResult[0] || [];
			assignments = assignmentsResult[0] || [];
		}

		const jsonFields = [
			'planning_activities_list',
			'documents_list',
			'input_documents_list',
			'documents_received_list',
			'documents_issued_list',
			'project_handover_list',
			'project_manhours_list',
			'project_query_log_list',
			'project_assumption_list',
			'project_lessons_learnt_list',
			'project_schedule_list',
			'kickoff_meetings_list',
			'internal_meetings_list',
			'software_items',
			'project_activities_list',
			'project_team',
		];

		for (const field of jsonFields) {
			if (project[field]) {
				project[field] = parseJsonField(project[field]);
			}
		}

		if (
			rights.sections.project_activity.read &&
			Array.isArray(project.project_activities_list) &&
			assignments.length > 0
		) {
			const assignmentMap = new Map();
			for (const assignment of assignments) {
				assignmentMap.set(assignment.activity_name, assignment);
			}

			project.project_activities_list = project.project_activities_list.map(
				(activity) => {
					const assignment = assignmentMap.get(activity.name);
					if (!assignment) return activity;
					return {
						...activity,
						assigned_user: assignment.user_id
							? String(assignment.user_id)
							: activity.assigned_user || '',
						due_date: assignment.due_date || activity.due_date || '',
						priority: assignment.priority || activity.priority || 'MEDIUM',
					};
				}
			);
		}

		const queryTime = Date.now() - startTime;

		const response = NextResponse.json({
			success: true,
			data: filterProjectForRights(
				{
					...project,
					project_activities: projectActivities || [],
				},
				rights
			),
			rights,
			_meta: { queryTimeMs: queryTime },
		});

		// No caching for edit pages — always return fresh data
		response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

		return response;
	} catch (error) {
		console.error('Project detail error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch project',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (ownsDb) {
			try {
				db.release?.();
			} catch (e) {
				console.error('Error releasing connection:', e);
			}
		}
	}
}
