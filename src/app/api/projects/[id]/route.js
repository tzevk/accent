import { dbConnect } from '@/utils/database';
import {
	RESOURCES,
	PERMISSIONS,
	getCurrentUser,
} from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import {
	COMMERCIAL_SECTION,
	PROJECT_ACCESS_DENIED,
	buildSectionUpdate,
	filterProjectForRights,
	isSectionId,
	loadLeadPolicy,
	requireProjectAccess,
	validateSectionWrite,
} from '@/lib/project-rights';
import { isUserInProjectTeam } from '@/utils/project-access';
import { sanitizeOptionalRichText } from '@/lib/sanitize-fields';

// Rich-text columns keep the previous write-path sanitization.
const RICH_TEXT_COLUMNS = ['description', 'additional_scope', 'scope_of_work'];

// GET specific project
export async function GET(request, { params }) {
	const { id } = await params;
	const access = await requireProjectAccess(request, id, {
		getLeadPolicy: loadLeadPolicy,
	});
	if ('response' in access) return access.response;

	const { project, rights, db, ownsDb } = access;
	try {
		let projectActivities = [];
		const activityKey =
			project.project_id ?? project.id ?? project.project_code ?? null;
		if (rights.sections.project_activity.read && activityKey !== null) {
			try {
				const [activities] = await db.execute(
					`SELECT * FROM project_activities WHERE project_id = ? ORDER BY created_at DESC`,
					[activityKey]
				);
				projectActivities = activities || [];
			} catch (actError) {
				console.warn(
					'Could not fetch project activities:',
					actError.message || actError
				);
				projectActivities = [];
			}
		}

		const jsonListFields = [
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
		];
		for (const field of jsonListFields) {
			if (typeof project[field] === 'string') {
				try {
					project[field] = JSON.parse(project[field]);
				} catch {
					project[field] = [];
				}
			}
		}

		if (
			rights.sections.project_activity.read &&
			Array.isArray(project.project_activities_list) &&
			project.project_activities_list.length > 0 &&
			activityKey !== null
		) {
			try {
				const [assignments] = await db.execute(
					'SELECT * FROM user_activity_assignments WHERE project_id = ?',
					[activityKey]
				);
				if (assignments && assignments.length > 0) {
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
			} catch (assignErr) {
				console.warn(
					'Could not merge activity assignments:',
					assignErr.message || assignErr
				);
			}
		}

		const filtered = filterProjectForRights(
			{ ...project, project_activities: projectActivities },
			rights
		);

		return Response.json({
			success: true,
			data: filtered,
			rights,
		});
	} catch (error) {
		console.error('Database error:', error);
		const details = error?.message || String(error);
		return Response.json(
			{
				success: false,
				error: 'Failed to fetch project',
				details,
			},
			{ status: 500 }
		);
	} finally {
		if (ownsDb) {
			try {
				db.release?.();
			} catch (e) {
				console.warn(
					'Error releasing DB connection in GET /api/projects/[id]:',
					e?.message || e
				);
			}
		}
	}
}

// PUT - Update one project section
export async function PUT(request, context) {
	const { id } = await context.params;
	const access = await requireProjectAccess(request, id, {
		getLeadPolicy: loadLeadPolicy,
	});
	if ('response' in access) return access.response;

	const { project, rights, db, ownsDb } = access;

	try {
		let body;
		try {
			body = await request.json();
		} catch {
			body = null;
		}

		const section =
			typeof body?.section === 'string' ? body.section.trim() : '';
		if (!section) {
			return Response.json(
				{ success: false, error: 'A project section is required' },
				{ status: 400 }
			);
		}

		const values = body?.values;
		if (!values || typeof values !== 'object' || Array.isArray(values)) {
			return Response.json(
				{ success: false, error: 'values must be an object' },
				{ status: 400 }
			);
		}

		const isCommercial = section === COMMERCIAL_SECTION;
		if (!isCommercial && !isSectionId(section)) {
			return Response.json(
				{ success: false, error: `Unknown project section "${section}"` },
				{ status: 400 }
			);
		}

		// Sanitize rich text before validation so only the sanitized value is
		// ever persisted or echoed back.
		const preparedValues = { ...values };
		for (const column of RICH_TEXT_COLUMNS) {
			if (column in preparedValues) {
				preparedValues[column] = sanitizeOptionalRichText(
					preparedValues[column]
				);
			}
		}

		const options = isCommercial
			? { commercialEdit: rights.commercial?.edit || [] }
			: {};

		if (!isCommercial) {
			if (!(rights.editableSections || []).includes(section)) {
				return Response.json(
					{ success: false, error: PROJECT_ACCESS_DENIED },
					{ status: 403 }
				);
			}
		}

		const validation = validateSectionWrite(section, preparedValues, options);
		if (!validation.ok) {
			const status =
				isCommercial && validation.code === 'PROTECTED_FIELD' ? 403 : 400;
			return Response.json(
				{ success: false, error: validation.error, code: validation.code },
				{ status }
			);
		}

		const built = buildSectionUpdate(section, preparedValues, options);
		if (!built.ok) {
			return Response.json(
				{ success: false, error: built.error, code: built.code },
				{ status: 400 }
			);
		}

		const { columns, params } = built.update;
		if (columns.length === 0) {
			return Response.json(
				{ success: false, error: 'values must contain at least one field' },
				{ status: 400 }
			);
		}

		// Resolve the real key of the row the access helper already resolved.
		// The runtime schema uses numeric `id` as PK; the baseline uses
		// `project_id`.
		const keyColumn =
			project.id !== undefined && project.id !== null ? 'id' : 'project_id';
		const keyValue = project[keyColumn];
		if (keyValue === undefined || keyValue === null) {
			return Response.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		const setParts = columns.map((column) => `${column} = ?`);
		const sql = `UPDATE projects SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${keyColumn} = ? AND isDelete = 0`;

		const [result] = await db.execute(sql, [...params, keyValue]);
		if (!result || (result.affectedRows ?? 0) === 0) {
			return Response.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		return Response.json({
			success: true,
			section,
			updated: columns,
			message: 'Project updated successfully',
		});
	} catch (error) {
		console.error('Project section update error:', error);
		return Response.json(
			{
				success: false,
				error: 'Failed to update project',
				details: error?.message || 'Unknown error',
			},
			{ status: 500 }
		);
	} finally {
		if (ownsDb) {
			try {
				db.release?.();
			} catch (error) {
				console.warn('Error releasing DB connection in PUT:', error?.message);
			}
		}
	}
}

// DELETE project
export async function DELETE(request, { params }) {
	let db;
	try {
		// Get current user first
		const user = await getCurrentUser(request);
		if (!user) {
			return Response.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Check if user has full projects:delete permission (only super admins)
		const hasFullAccess =
			user.is_super_admin ||
			hasPermission(user, RESOURCES.PROJECTS, PERMISSIONS.DELETE);

		const { id } = await params;
		const projectId = parseInt(id);

		db = await dbConnect();

		// If user doesn't have full access, check if they're in the project team
		if (!hasFullAccess) {
			const [projectRows] = await db.execute(
				'SELECT project_team FROM projects WHERE project_id = ? AND isDelete = 0',
				[projectId]
			);
			if (projectRows && projectRows.length > 0) {
				const isTeamMember = isUserInProjectTeam(
					projectRows[0].project_team,
					user.id,
					user.email
				);
				if (!isTeamMember) {
					console.log(
						`[Projects API DELETE] User ${user.email} denied delete access to project ${id} - not a team member`
					);
					return Response.json(
						{
							success: false,
							error: 'You do not have permission to delete this project',
						},
						{ status: 403 }
					);
				}
				console.log(
					`[Projects API DELETE] User ${user.email} granted delete access to project ${id} as team member`
				);
			} else {
				return Response.json(
					{ success: false, error: 'Project not found' },
					{ status: 404 }
				);
			}
		}

		const [result] = await db.execute(
			'UPDATE projects SET isDelete = 1 WHERE id = ?',
			[projectId]
		);

		if (result.affectedRows === 0) {
			return Response.json(
				{
					success: false,
					error: 'Project not found',
				},
				{ status: 404 }
			);
		}

		return Response.json({
			success: true,
			message: 'Project deleted successfully',
		});
	} catch (error) {
		console.error('Database error:', error);
		return Response.json(
			{
				success: false,
				error: 'Failed to delete project',
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
