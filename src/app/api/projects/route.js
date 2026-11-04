import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
	getCurrentUser,
} from '@/utils/api-permissions';
import {
	hasColumn,
} from '@/utils/schema-cache';
import {
	DEFAULT_LEAD_POLICY,
	PROJECT_ACCESS_DENIED,
	filterProjectForRights,
	requireProjectAccess,
	resolveProjectRights,
} from '@/lib/project-rights';
import {
	sanitizeJsonStrings,
	sanitizeOptionalRichText,
} from '@/lib/sanitize-fields';

// GET all projects
export async function GET(request) {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		db = await dbConnect();

		// Use cached schema check instead of DDL on every request
		const hasCompanyId = await hasColumn(db, 'projects', 'company_id');
		let rows;

		if (hasCompanyId) {
			try {
				const [r] = await db.execute(`
          SELECT p.*, 
                 c.company_name AS linked_company_name,
                 prop.client_name AS proposal_client_name,
                 prop_c.company_name AS proposal_company_name
          FROM projects p
          LEFT JOIN companies c ON p.company_id = c.id
          LEFT JOIN proposals prop ON p.proposal_id = prop.id
          LEFT JOIN companies prop_c ON prop.company_id = prop_c.id
          WHERE p.isDelete = 0
          ORDER BY p.created_at DESC
        `);
				// Merge client_name: prefer p.client_name, then linked_company_name, then proposal info
				rows = r.map((row) => ({
					...row,
					client_name:
						row.client_name ||
						row.linked_company_name ||
						row.proposal_client_name ||
						row.proposal_company_name ||
						null,
				}));
			} catch (joinErr) {
				// If the join still fails due to schema drift, log and fallback
				if (
					String(joinErr?.message || '').includes('Unknown column') &&
					String(joinErr?.message || '').includes('company_id')
				) {
					console.warn(
						'company_id column missing during join, falling back to projects only select'
					);
					const [r] = await db.execute(
						`SELECT p.* FROM projects p WHERE p.isDelete = 0 ORDER BY p.created_at DESC`
					);
					rows = r;
				} else {
					throw joinErr;
				}
			}
		} else {
			const [r] = await db.execute(
				`SELECT p.* FROM projects p WHERE p.isDelete = 0 ORDER BY p.created_at DESC`
			);
			rows = r;
		}

		// Every row is resolved through the shared project-rights policy.
		const projects = [];
		for (const project of rows) {
			const rights = resolveProjectRights({
				user,
				project,
				leadPolicy: DEFAULT_LEAD_POLICY,
			});
			if (!rights.canOpen) continue;
			projects.push({
				...filterProjectForRights(project, rights),
				rights,
			});
		}

		return NextResponse.json({ success: true, data: projects });
	} catch (error) {
		console.error('Projects GET error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch projects',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// POST - Create new project
export async function POST(request) {
	let db;
	try {
		// RBAC: create projects
		const auth = await ensurePermission(
			request,
			RESOURCES.PROJECTS,
			PERMISSIONS.CREATE
		);
		if (auth instanceof Response) return auth;

		const data = await request.json();
		const {
			project_code,
			name,
			description,
			company_id,
			project_manager,
			start_date,
			end_date,
			target_date,
			budget,
			assigned_to,
			status,
			type,
			priority,
			progress,
			proposal_id,
			notes,
			// New fields
			project_schedule,
			input_document,
			list_of_deliverables,
			kickoff_meeting,
			in_house_meeting,
			project_team,
		} = data;

		if (!name) {
			return NextResponse.json(
				{
					success: false,
					error: 'Project name is required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// If a proposal_id is provided, prefer company information from that proposal
		let effectiveCompanyId = company_id || null;
		// use data.client_name (may be present in payload) rather than an undefined variable
		let effectiveClientName = data.client_name || null;

		// Debug logging
		console.log('POST /api/projects - received data:', {
			company_id,
			client_name: data.client_name,
			proposal_id,
			effectiveCompanyId,
			effectiveClientName,
		});

		if (proposal_id) {
			try {
				const [proposalRows] = await db.execute(
					'SELECT company_id, client_name FROM proposals WHERE (id = ? OR proposal_id = ?) AND isDelete = 0',
					[proposal_id, proposal_id]
				);
				if (proposalRows && proposalRows.length > 0) {
					// Use company_id/client_name from proposal if present
					if (proposalRows[0].company_id)
						effectiveCompanyId = proposalRows[0].company_id;
					if (proposalRows[0].client_name)
						effectiveClientName = proposalRows[0].client_name;
				}
			} catch (e) {
				console.warn(
					'Failed to lookup proposal for company override:',
					e?.message || e
				);
			}
		}

		// Fetch company name from effectiveCompanyId if available, otherwise use effectiveClientName
		let client_name = effectiveClientName;
		if (effectiveCompanyId) {
			try {
				const [companyRows] = await db.execute(
					'SELECT company_name FROM companies WHERE id = ?',
					[effectiveCompanyId]
				);
				if (companyRows.length > 0) {
					client_name = client_name || companyRows[0].company_name;
				}
			} catch (e) {
				console.warn('Failed to fetch company name:', e?.message || e);
			}
		}

		// `projects.project_id` is an AUTO_INCREMENT integer primary key in this
		// schema, so the route inserts NULL for it and MySQL assigns the PK. The
		// human-readable `SSS_MM_YYYY` serial belongs to `project_code`.
		let generatedCode;
		{
			const now = new Date();
			const month = String(now.getMonth() + 1).padStart(2, '0');
			const year = now.getFullYear();

			// Find highest serial number globally from project_code (continues across months)
			const [projects] = await db.execute(
				`SELECT project_code,
					CAST(SUBSTRING_INDEX(project_code, '_', 1) AS UNSIGNED) as serial_num
				FROM projects WHERE project_code LIKE '%\\_%\\_%'
				ORDER BY serial_num DESC
				LIMIT 1`
			);

			let maxSerial = 0;
			if (projects.length > 0 && projects[0].serial_num) {
				maxSerial = projects[0].serial_num;
			}

			const nextSerial = String(maxSerial + 1).padStart(3, '0');
			generatedCode = `${nextSerial}_${month}_${year}`;
		}

		// Use user-provided project_code, or fall back to auto-generated value
		const projectCode = (project_code && project_code.trim()) || generatedCode;

		// Insert the new project (include activities/disciplines JSON and new fields)
		const [result] = await db.execute(
			`INSERT INTO projects (
        project_id, project_code, name, description, company_id, client_name, project_manager,
        start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes,
        activities, disciplines, discipline_descriptions, assignments,
        project_schedule, input_document, list_of_deliverables, kickoff_meeting, in_house_meeting,
        project_assumption_list, project_lessons_learnt_list, project_team
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				null, // project_id — AUTO_INCREMENT
				projectCode,
				name,
				sanitizeOptionalRichText(description) ?? null,
				effectiveCompanyId || null,
				client_name,
				project_manager || null,
				start_date || null,
				end_date || null,
				target_date || null,
				budget || null,
				assigned_to || null,
				status || 'NEW',
				type || 'ONGOING',
				priority || 'MEDIUM',
				progress || 0,
				proposal_id || null,
				notes || null,
				JSON.stringify(data.activities || []),
				JSON.stringify(data.disciplines || []),
				JSON.stringify(sanitizeJsonStrings(data.discipline_descriptions || {})),
				JSON.stringify(data.assignments || []),
				project_schedule || null,
				input_document || null,
				list_of_deliverables || null,
				kickoff_meeting || null,
				in_house_meeting || null,
				data.project_assumption_list
					? typeof data.project_assumption_list === 'string'
						? data.project_assumption_list
						: JSON.stringify(data.project_assumption_list)
					: null,
				data.project_lessons_learnt_list
					? typeof data.project_lessons_learnt_list === 'string'
						? data.project_lessons_learnt_list
						: JSON.stringify(data.project_lessons_learnt_list)
					: null,
				project_team || null,
			]
		);

		// Get the created project (PK is project_id)
		const [newProject] = await db.execute(
			'SELECT * FROM projects WHERE project_id = ? AND isDelete = 0',
			[result.insertId]
		);

		// Log the activity
		logActivity(
			{
				actionType: 'create',
				resourceType: 'project',
				resourceId: result.insertId.toString(),
				description: `Created project: ${name}`,
				details: {
					project_code: projectCode,
					project_name: name,
					client_name: client_name,
					status: status || 'NEW',
				},
			},
			request
		).catch((err) => console.error('Failed to log activity:', err));

		return NextResponse.json(
			{
				success: true,
				data: newProject[0],
				message: 'Project created successfully',
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('Projects POST error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to create project',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db)
			try {
				db.release();
			} catch {}
	}
}

// DELETE - Delete project
export async function DELETE(request) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get('id');

	if (!id) {
		return NextResponse.json(
			{
				success: false,
				error: 'Project ID is required',
			},
			{ status: 400 }
		);
	}

	// Same policy and key logic as DELETE /api/projects/[id]: resolve the
	// target through the shared helper, then require an explicit delete
	// grant in scope.
	const access = await requireProjectAccess(request, id);
	if ('response' in access) return access.response;

	const { project, rights, db, ownsDb } = access;

	try {
		if (!rights.canPerform.delete) {
			return NextResponse.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

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
			`UPDATE projects SET isDelete = 1 WHERE ${keyColumn} = ? AND isDelete = 0`,
			[keyValue]
		);

		if (!result || (result.affectedRows ?? 0) === 0) {
			return NextResponse.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		// Log the activity
		logActivity(
			{
				actionType: 'delete',
				resourceType: 'project',
				resourceId: String(keyValue),
				description: `Deleted project: ${project.name || keyValue}`,
				details: {
					project_id: project.project_id,
					project_name: project.name,
				},
			},
			request
		).catch((err) => console.error('Failed to log activity:', err));

		return NextResponse.json({
			success: true,
			message: 'Project deleted successfully',
		});
	} catch (error) {
		console.error('Projects DELETE error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete project',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (ownsDb) {
			try {
				db.release?.();
			} catch (e) {
				console.warn('Error releasing DB connection in DELETE:', e?.message);
			}
		}
	}
}
