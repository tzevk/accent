import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import type { PoolConnection } from 'mysql2/promise';
import { getCurrentUser } from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	hasUserProjectAssignment,
	isUserInProjectTeam,
} from '@/utils/project-access';

type MemberSection =
	| 'assumption'
	| 'discussion'
	| 'query_log'
	| 'lessons_learnt';

type ProjectRow = {
	id?: number | string | null;
	project_id?: number | string | null;
	project_code?: number | string | null;
	project_team?: unknown;
	isDelete?: number | string | null;
	project_assumption_list?: unknown;
	project_query_log_list?: unknown;
	project_lessons_learnt_list?: unknown;
};

type RequestUser = {
	id: number | string;
	full_name?: string | null;
	username?: string | null;
	email?: string | null;
	is_super_admin?: boolean | number | string | null;
};

const JSON_SECTION_COLUMNS: Record<
	Exclude<MemberSection, 'discussion'>,
	| 'project_assumption_list'
	| 'project_query_log_list'
	| 'project_lessons_learnt_list'
> = {
	assumption: 'project_assumption_list',
	query_log: 'project_query_log_list',
	lessons_learnt: 'project_lessons_learnt_list',
};

function jsonResponse(
	body: Record<string, unknown>,
	status = 200
): NextResponse {
	return NextResponse.json(body, { status });
}

function isSuperAdmin(user: RequestUser): boolean {
	return (
		user.is_super_admin === true ||
		user.is_super_admin === 1 ||
		user.is_super_admin === '1'
	);
}

function userLabel(user: RequestUser): string {
	return user.full_name?.trim() || user.username?.trim() || String(user.id);
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function textValue(entry: Record<string, unknown>, field: string): string {
	return typeof entry[field] === 'string' ? entry[field].trim() : '';
}

function requiredText(
	entry: Record<string, unknown>,
	field: string
): string | null {
	const value = textValue(entry, field);
	return value ? value : null;
}

function parseList(value: unknown): Array<Record<string, unknown>> {
	let parsed = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(item): item is Record<string, unknown> =>
			Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	);
}

function projectRowId(project: ProjectRow): number | null {
	const value = project.id ?? project.project_id;
	const numericValue = Number(value);
	return Number.isInteger(numericValue) && numericValue > 0
		? numericValue
		: null;
}

function projectKeyColumn(project: ProjectRow): 'id' | 'project_id' {
	return project.id !== undefined && project.id !== null ? 'id' : 'project_id';
}

async function findProject(
	db: PoolConnection,
	routeId: string
): Promise<ProjectRow | null> {
	try {
		const [rows] = await db.execute(
			`SELECT * FROM projects
             WHERE (id = ? OR project_id = ? OR project_code = ?)
               AND (isDelete = 0 OR isDelete IS NULL)
             LIMIT 1`,
			[routeId, routeId, routeId]
		);
		return (rows as ProjectRow[] | undefined)?.[0] || null;
	} catch {
		// Older installations use project_id as the numeric primary key and do
		// not expose an id column. Keep the member endpoint compatible with both.
		const [rows] = await db.execute(
			`SELECT * FROM projects
             WHERE (project_id = ? OR project_code = ?)
               AND (isDelete = 0 OR isDelete IS NULL)
             LIMIT 1`,
			[routeId, routeId]
		);
		return (rows as ProjectRow[] | undefined)?.[0] || null;
	}
}

async function getRequestContext(
	request: Request,
	params: Promise<{ id?: string }> | { id?: string }
): Promise<
	{ user: RequestUser; routeId: string } | { response: NextResponse }
> {
	const user = (await getCurrentUser(request)) as RequestUser | null;
	if (!user) {
		return {
			response: jsonResponse({ success: false, error: 'Unauthorized' }, 401),
		};
	}

	const { id } = await params;
	const routeId = typeof id === 'string' ? id.trim() : '';
	if (!routeId || routeId === 'undefined') {
		return {
			response: jsonResponse(
				{ success: false, error: 'Invalid project id' },
				400
			),
		};
	}

	return { user, routeId };
}

async function authorizeProject(
	db: PoolConnection,
	project: ProjectRow,
	user: RequestUser
): Promise<NextResponse | null> {
	if (isSuperAdmin(user)) return null;

	const isTeamMember = isUserInProjectTeam(
		project.project_team,
		user.id,
		user.email
	);
	const assignmentProject = {
		id: project.id ?? undefined,
		project_id: project.project_id ?? undefined,
		project_code: project.project_code ?? undefined,
	};
	const hasAssignment =
		!isTeamMember &&
		(await hasUserProjectAssignment(db, assignmentProject, user.id));
	if (!isTeamMember && !hasAssignment) {
		return jsonResponse(
			{
				success: false,
				error: 'You do not have permission to access this project',
			},
			403
		);
	}
	return null;
}

function serverMetadata(user: RequestUser): {
	id: string;
	created_by: string;
	created_at: string;
} {
	return {
		id: randomUUID(),
		created_by: userLabel(user),
		created_at: new Date().toISOString(),
	};
}

function buildJsonEntry(
	section: Exclude<MemberSection, 'discussion'>,
	input: Record<string, unknown>,
	user: RequestUser
): Record<string, unknown> {
	const metadata = serverMetadata(user);

	if (section === 'assumption') {
		return {
			assumption_description: textValue(input, 'assumption_description'),
			reason: textValue(input, 'reason'),
			remark: textValue(input, 'remark'),
			assumption_taken_by: userLabel(user),
			...metadata,
		};
	}

	if (section === 'query_log') {
		return {
			query_description: textValue(input, 'query_description'),
			query_issued_date: textValue(input, 'query_issued_date') || today(),
			reply_from_client: textValue(input, 'reply_from_client'),
			reply_received_date: textValue(input, 'reply_received_date'),
			query_resolved: textValue(input, 'query_resolved') || 'Pending',
			remark: textValue(input, 'remark'),
			query_updated_by: userLabel(user),
			...metadata,
		};
	}

	return {
		what_was_new: textValue(input, 'what_was_new'),
		difficulty_faced: textValue(input, 'difficulty_faced'),
		what_you_learn: textValue(input, 'what_you_learn'),
		areas_of_improvement: textValue(input, 'areas_of_improvement'),
		remark: textValue(input, 'remark'),
		...metadata,
	};
}

async function recordActivity(
	request: Request,
	user: RequestUser,
	projectId: number,
	section: MemberSection,
	entry: Record<string, unknown>
): Promise<void> {
	try {
		await logActivity({
			userId: Number(user.id),
			status: 'success',
			actionType: 'create',
			resourceType: 'project',
			resourceId: projectId,
			description: `Added ${section} contribution to project ${projectId}`,
			details: { section, entry },
			request,
		});
	} catch (error) {
		console.error('Member project contribution audit failed:', error);
	}
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id?: string }> }
) {
	const context = await getRequestContext(request, params);
	if ('response' in context) return context.response;

	let db: PoolConnection | null = null;
	try {
		db = await dbConnect();
		if (!db) throw new Error('Database connection unavailable');
		const project = await findProject(db, context.routeId);
		if (!project) {
			return jsonResponse({ success: false, error: 'Project not found' }, 404);
		}

		const authorizationError = await authorizeProject(
			db,
			project,
			context.user
		);
		if (authorizationError) return authorizationError;

		const numericProjectId = projectRowId(project);
		if (numericProjectId === null) {
			return jsonResponse(
				{ success: false, error: 'Member project details are unavailable' },
				500
			);
		}

		const [discussionRows] = await db.execute(
			`SELECT * FROM project_followups
             WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL)
             ORDER BY follow_up_date DESC, created_at DESC`,
			[numericProjectId]
		);

		return jsonResponse({
			success: true,
			data: {
				assumptions: parseList(project.project_assumption_list),
				discussions: Array.isArray(discussionRows) ? discussionRows : [],
				queryLog: parseList(project.project_query_log_list),
				lessonsLearnt: parseList(project.project_lessons_learnt_list),
			},
		});
	} catch (error) {
		console.error('Member project details GET failed:', error);
		return jsonResponse(
			{ success: false, error: 'Member project details are unavailable' },
			500
		);
	} finally {
		if (db) db.release();
	}
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id?: string }> }
) {
	const context = await getRequestContext(request, params);
	if ('response' in context) return context.response;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonResponse(
			{ success: false, error: 'Malformed request body' },
			400
		);
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return jsonResponse(
			{ success: false, error: 'Malformed request body' },
			400
		);
	}
	const input = body as Record<string, unknown>;
	const section = input.section;
	const entryInput = input.entry;
	if (
		typeof section !== 'string' ||
		!['assumption', 'discussion', 'query_log', 'lessons_learnt'].includes(
			section
		) ||
		!entryInput ||
		typeof entryInput !== 'object' ||
		Array.isArray(entryInput)
	) {
		return jsonResponse(
			{ success: false, error: 'Section and entry are required' },
			400
		);
	}

	const typedSection = section as MemberSection;
	const typedEntry = entryInput as Record<string, unknown>;
	const requiredField =
		typedSection === 'assumption'
			? 'assumption_description'
			: typedSection === 'query_log'
				? 'query_description'
				: typedSection === 'lessons_learnt'
					? 'what_was_new'
					: 'description';
	const requiredValue = requiredText(typedEntry, requiredField);
	if (!requiredValue) {
		return jsonResponse(
			{ success: false, error: `${requiredField} is required` },
			400
		);
	}

	let db: PoolConnection | null = null;
	try {
		db = await dbConnect();
		if (!db) throw new Error('Database connection unavailable');
		const project = await findProject(db, context.routeId);
		if (!project) {
			return jsonResponse({ success: false, error: 'Project not found' }, 404);
		}

		const authorizationError = await authorizeProject(
			db,
			project,
			context.user
		);
		if (authorizationError) return authorizationError;

		const numericProjectId = projectRowId(project);
		if (numericProjectId === null) {
			return jsonResponse(
				{ success: false, error: 'Member project details are unavailable' },
				500
			);
		}

		let createdEntry: Record<string, unknown>;
		if (typedSection === 'discussion') {
			const discussion = {
				project_id: numericProjectId,
				follow_up_date: textValue(typedEntry, 'follow_up_date') || today(),
				follow_up_type: 'Internal Review',
				description: requiredValue,
				status: 'Scheduled',
				priority: 'Medium',
				responsible_person: textValue(typedEntry, 'responsible_person'),
				logged_by: userLabel(context.user),
				created_by: userLabel(context.user),
			};
			const [result] = await db.execute(
				`INSERT INTO project_followups
                 (project_id, follow_up_date, follow_up_type, description, status,
                  priority, responsible_person, logged_by, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					discussion.project_id,
					discussion.follow_up_date,
					discussion.follow_up_type,
					discussion.description,
					discussion.status,
					discussion.priority,
					discussion.responsible_person || null,
					discussion.logged_by,
					discussion.created_by,
				]
			);
			const insertId = (result as { insertId?: number })?.insertId;
			createdEntry = {
				...discussion,
				id: insertId ?? null,
				isDelete: 0,
				created_at: new Date().toISOString(),
			};

			if (insertId !== undefined && insertId !== null) {
				try {
					const [rows] = await db.execute(
						`SELECT * FROM project_followups
                         WHERE id = ? AND project_id = ? LIMIT 1`,
						[insertId, numericProjectId]
					);
					if (Array.isArray(rows) && rows[0]) {
						createdEntry = rows[0] as Record<string, unknown>;
					}
				} catch (selectError) {
					console.warn('Could not reload member discussion:', selectError);
				}
			}
		} else {
			const column = JSON_SECTION_COLUMNS[typedSection];
			await db.beginTransaction();
			try {
				const projectKey = projectKeyColumn(project);
				const projectKeyValue =
					projectKey === 'id' ? project.id : project.project_id;
				if (projectKeyValue === null || projectKeyValue === undefined) {
					throw new Error('Project key unavailable');
				}
				const [lockedRows] = await db.execute(
					`SELECT ${column} FROM projects
                     WHERE ${projectKey} = ?
                       AND (isDelete = 0 OR isDelete IS NULL)
                     FOR UPDATE`,
					[projectKeyValue]
				);
				const lockedProject = (lockedRows as ProjectRow[] | undefined)?.[0];
				if (!lockedProject) {
					await db.rollback();
					return jsonResponse(
						{ success: false, error: 'Project not found' },
						404
					);
				}

				createdEntry = buildJsonEntry(typedSection, typedEntry, context.user);
				const nextEntries = [...parseList(lockedProject[column]), createdEntry];
				await db.execute(
					`UPDATE projects SET ${column} = ? WHERE ${projectKey} = ?
                     AND (isDelete = 0 OR isDelete IS NULL)`,
					[JSON.stringify(nextEntries), projectKeyValue]
				);
				await db.commit();
			} catch (error) {
				try {
					await db.rollback();
				} catch (rollbackError) {
					console.error('Member project rollback failed:', rollbackError);
				}
				throw error;
			}
		}

		await recordActivity(
			request,
			context.user,
			numericProjectId,
			typedSection,
			createdEntry
		);
		return jsonResponse({
			success: true,
			data: { section: typedSection, entry: createdEntry },
		});
	} catch (error) {
		console.error('Member project details POST failed:', error);
		return jsonResponse(
			{ success: false, error: 'Unable to save project contribution' },
			500
		);
	} finally {
		if (db) db.release();
	}
}
