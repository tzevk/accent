import {
	getLinkedEmployee,
	listCurrentProjectIds,
	listManagerAssignments,
	parseWorkPeriodInput,
	createWorkPeriod,
	updateWorkPeriodCommand,
	deleteWorkPeriodCommand,
	WorkPeriodCommandError,
} from '@/server/work-periods/commands';
import {
	createManagerWorkPeriodSchema,
	createSelfWorkPeriodSchema,
	deleteWorkPeriodSchema,
	parseWorkPeriodSchema,
	updateWorkPeriodSchema,
	workPeriodCreateScopeSchema,
	workPeriodJsonObjectSchema,
	workPeriodMutationScopeSchema,
	workPeriodQuerySchema,
} from '@/server/work-periods/validation';
import {
	formatIstLocal,
	isSelfServicePeriod,
	istDate,
	parseIstLocal,
	shiftIstDate,
	weekStartFor,
	workPeriodWeekSeconds,
} from '@/lib/work-periods';
import {
	readWorkPeriods,
	type WorkPeriodListingRecord,
} from '@/server/work-periods/store';
import {
	loadLeadPolicy,
	PROJECT_ACCESS_DENIED,
	requireProjectAccess,
} from '@/lib/project-rights';
import { getCurrentUser } from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';
import { isUserInProjectTeam } from '@/utils/project-access';
import { drizzle } from 'drizzle-orm/mysql2';

type JsonBody = Record<string, unknown>;

function jsonError(status: number, code: string, error: string): Response {
	return Response.json({ success: false, error, code }, { status });
}

function commandFailure(error: unknown, fallback: string): Response {
	if (error instanceof WorkPeriodCommandError) {
		return jsonError(error.status, error.code, error.message);
	}
	console.error(`[work-periods] ${fallback}`, error);
	return jsonError(500, 'WORK_PERIOD_REQUEST_FAILED', fallback);
}

async function readBody(request: Request): Promise<JsonBody> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new WorkPeriodCommandError(
			400,
			'INVALID_WORK_PERIOD',
			'A valid JSON request body is required.'
		);
	}
	return parseWorkPeriodSchema(workPeriodJsonObjectSchema, body);
}

function resolvedProjectId(project: Record<string, unknown>): number {
	const projectId = Number(project.project_id ?? project.id);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) {
		throw new WorkPeriodCommandError(
			500,
			'WORK_PERIOD_WRITE_FAILED',
			'Project identity is invalid.'
		);
	}
	return projectId;
}

function canEditProjectActivity(rights: Record<string, unknown>): boolean {
	const sections = rights.sections;
	if (sections && typeof sections === 'object') {
		const projectActivity = (sections as Record<string, unknown>)
			.project_activity;
		if (projectActivity && typeof projectActivity === 'object') {
			return Boolean((projectActivity as Record<string, unknown>).edit);
		}
	}
	const editableSections = rights.editableSections;
	return (
		Array.isArray(editableSections) &&
		editableSections.includes('project_activity')
	);
}

function requireManagerEdit(rights: Record<string, unknown>): Response | null {
	return canEditProjectActivity(rights)
		? null
		: jsonError(403, 'PROJECT_ACCESS_DENIED', PROJECT_ACCESS_DENIED);
}

function requireCurrentTeam(
	project: Record<string, unknown>,
	user: { id: number; email?: string | null }
): Response | null {
	return isUserInProjectTeam(project.project_team, user.id, user.email)
		? null
		: jsonError(403, 'PROJECT_ACCESS_DENIED', PROJECT_ACCESS_DENIED);
}

function weekWindow(requestedWeek: string | undefined, nowMs: number) {
	const today = istDate(nowMs);
	const weekStart = requestedWeek ?? weekStartFor(today);
	const weekStartMs = parseIstLocal(`${weekStart}T00:00`);
	if (
		weekStartMs === null ||
		istDate(weekStartMs) !== weekStart ||
		weekStartFor(weekStart) !== weekStart
	) {
		throw new WorkPeriodCommandError(
			400,
			'INVALID_WORK_PERIOD',
			'week must be a valid Monday in YYYY-MM-DD format.'
		);
	}
	const weekEnd = shiftIstDate(weekStart, 7);
	const weekEndMs = parseIstLocal(`${weekEnd}T00:00`);
	if (weekEndMs === null) {
		throw new WorkPeriodCommandError(
			400,
			'INVALID_WORK_PERIOD',
			'week must be a valid Monday in YYYY-MM-DD format.'
		);
	}
	return { today, weekStart, weekEnd, weekStartMs, weekEndMs };
}

function periodRow(
	record: WorkPeriodListingRecord,
	weekStart: string,
	weekEnd: string,
	editable: boolean
) {
	const quantity = Number(record.quantity);
	return {
		id: record.id,
		assignmentId: record.assignmentId,
		projectId: record.projectId,
		activityId: record.activityId,
		employeeId: record.employeeId,
		userId: record.userId,
		projectCode: record.projectCode ?? '',
		projectName: record.projectName ?? '',
		discipline: record.discipline ?? '',
		activityName: record.activityName,
		subActivityName: record.subActivityName ?? '',
		employeeName: record.employeeName ?? '',
		defaultManhours: record.defaultManhours,
		status: record.status,
		start: formatIstLocal(record.startMs),
		end: formatIstLocal(record.endMs),
		quantity: Number.isFinite(quantity) ? quantity : 0,
		dateCompleted: record.dateCompleted,
		remarks: record.remarks ?? '',
		durationSeconds: (record.endMs - record.startMs) / 1000,
		weekSeconds: workPeriodWeekSeconds(record.startMs, record.endMs, weekStart),
		weekQuantity:
			record.dateCompleted >= weekStart && record.dateCompleted < weekEnd
				? Number.isFinite(quantity)
					? quantity
					: 0
				: 0,
		editable,
	};
}

function mutationSuccess(id: string): Response {
	return Response.json({ success: true, data: { id }, affected_rows: 1 });
}

export async function GET(request: Request): Promise<Response> {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) return jsonError(401, 'UNAUTHORIZED', 'Unauthorized');

		const query = parseWorkPeriodSchema(
			workPeriodQuerySchema,
			Object.fromEntries(new URL(request.url).searchParams)
		);
		const projectParam = query.projectId;
		const userParam = query.userId;
		if (projectParam && userParam) {
			throw new WorkPeriodCommandError(
				400,
				'INVALID_WORK_PERIOD',
				'Choose either dashboard or manager history, not both.'
			);
		}
		if (userParam && String(user.id) !== userParam) {
			return jsonError(403, 'FORBIDDEN', 'Forbidden');
		}

		const nowMs = Date.now();
		const window = weekWindow(query.week, nowMs);
		db = await dbConnect();
		const ddb = drizzle({ client: db });

		if (projectParam) {
			const access = await requireProjectAccess(request, projectParam, {
				db,
				getLeadPolicy: loadLeadPolicy,
			});
			if ('response' in access) return access.response;
			const denied = requireManagerEdit(access.rights);
			if (denied) return denied;
			const projectId = resolvedProjectId(access.project);
			const records = await readWorkPeriods(ddb, {
				projectId,
				weekStart: window.weekStartMs,
				weekEnd: window.weekEndMs,
			});
			const assignments = await listManagerAssignments(
				db,
				projectId,
				access.project.project_team
			);
			const editableAssignments = new Set(assignments.map((row) => row.id));
			return Response.json({
				success: true,
				data: {
					canLog: true,
					today: window.today,
					weekStart: window.weekStart,
					periods: records.map((record) =>
						periodRow(
							record,
							window.weekStart,
							window.weekEnd,
							editableAssignments.has(record.assignmentId)
						)
					),
					assignments,
				},
			});
		}

		const employee = await getLinkedEmployee(db, user.id);
		if (!employee) {
			return Response.json({
				success: true,
				data: {
					canLog: false,
					today: window.today,
					weekStart: window.weekStart,
					periods: [],
				},
			});
		}
		const records = await readWorkPeriods(ddb, {
			employeeId: employee.employeeId,
			weekStart: window.weekStartMs,
			weekEnd: window.weekEndMs,
		});
		const currentProjects =
			records.length > 0
				? await listCurrentProjectIds(db, user.id, user.email)
				: new Set<number>();
		return Response.json({
			success: true,
			data: {
				canLog: true,
				today: window.today,
				weekStart: window.weekStart,
				periods: records.map((record) =>
					periodRow(
						record,
						window.weekStart,
						window.weekEnd,
						record.userId === user.id &&
							record.projectId !== null &&
							currentProjects.has(record.projectId) &&
							isSelfServicePeriod(record.startMs, record.endMs, nowMs)
					)
				),
			},
		});
	} catch (error) {
		return commandFailure(error, 'Failed to fetch Work Periods');
	} finally {
		try {
			db?.release();
		} catch (error) {
			console.warn('[work-periods] failed to release GET connection', error);
		}
	}
}

export async function POST(request: Request): Promise<Response> {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) return jsonError(401, 'UNAUTHORIZED', 'Unauthorized');
		const body = await readBody(request);
		const scope = parseWorkPeriodSchema(workPeriodCreateScopeSchema, body);
		const manager = scope.manager;
		const requestedProjectId = scope.projectId;
		db = await dbConnect();
		const access = await requireProjectAccess(request, requestedProjectId, {
			db,
			getLeadPolicy: loadLeadPolicy,
		});
		if ('response' in access) return access.response;
		if (manager) {
			const denied = requireManagerEdit(access.rights);
			if (denied) return denied;
		} else {
			const denied = requireCurrentTeam(access.project, user);
			if (denied) return denied;
		}

		const nowMs = Date.now();
		const project = access.project;
		const projectId = resolvedProjectId(project);
		if (manager) {
			const data = parseWorkPeriodSchema(createManagerWorkPeriodSchema, body);
			const input = parseWorkPeriodInput(data, nowMs);
			const saved = await createWorkPeriod({
				db,
				actor: user,
				project,
				projectId,
				input,
				nowMs,
				manager: true,
				assignmentId: data.assignmentId,
			});
			return mutationSuccess(saved.id);
		}

		const employee = await getLinkedEmployee(db, user.id);
		if (!employee) {
			return jsonError(
				403,
				'EMPLOYEE_LINK_REQUIRED',
				'Your User Account is not linked to an active Employee. Contact an administrator.'
			);
		}
		const data = parseWorkPeriodSchema(createSelfWorkPeriodSchema, body);
		const input = parseWorkPeriodInput(data, nowMs);
		const saved = await createWorkPeriod({
			db,
			actor: user,
			project,
			projectId,
			input,
			nowMs,
			manager: false,
			employeeId: employee.employeeId,
			disciplineId: data.disciplineId,
			activityId: data.activityId,
			subActivityId: data.subActivityId,
		});
		return mutationSuccess(saved.id);
	} catch (error) {
		return commandFailure(error, 'Failed to save Work Period');
	} finally {
		try {
			db?.release();
		} catch (error) {
			console.warn('[work-periods] failed to release POST connection', error);
		}
	}
}

export async function PUT(request: Request): Promise<Response> {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) return jsonError(401, 'UNAUTHORIZED', 'Unauthorized');
		const body = await readBody(request);
		const scope = parseWorkPeriodSchema(workPeriodMutationScopeSchema, body);
		const manager = scope.manager;
		const id = scope.id;
		const requestedProjectId = scope.projectId;
		db = await dbConnect();
		const access = await requireProjectAccess(request, requestedProjectId, {
			db,
			getLeadPolicy: loadLeadPolicy,
		});
		if ('response' in access) return access.response;
		if (manager) {
			const denied = requireManagerEdit(access.rights);
			if (denied) return denied;
		} else {
			const denied = requireCurrentTeam(access.project, user);
			if (denied) return denied;
		}

		const nowMs = Date.now();
		const data = parseWorkPeriodSchema(updateWorkPeriodSchema, body);
		const input = parseWorkPeriodInput(data, nowMs);
		const project = access.project;
		const projectId = resolvedProjectId(project);
		let employeeId: number | undefined;
		if (!manager) {
			const employee = await getLinkedEmployee(db, user.id);
			if (!employee) {
				return jsonError(
					403,
					'EMPLOYEE_LINK_REQUIRED',
					'Your User Account is not linked to an active Employee. Contact an administrator.'
				);
			}
			employeeId = employee.employeeId;
		}
		const saved = await updateWorkPeriodCommand({
			db,
			actor: user,
			project,
			projectId,
			id,
			input,
			nowMs,
			manager,
			employeeId,
		});
		return mutationSuccess(saved.id);
	} catch (error) {
		return commandFailure(error, 'Failed to update Work Period');
	} finally {
		try {
			db?.release();
		} catch (error) {
			console.warn('[work-periods] failed to release PUT connection', error);
		}
	}
}

export async function DELETE(request: Request): Promise<Response> {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) return jsonError(401, 'UNAUTHORIZED', 'Unauthorized');
		const body = await readBody(request);
		const data = parseWorkPeriodSchema(deleteWorkPeriodSchema, body);
		const manager = data.manager;
		const id = data.id;
		const requestedProjectId = data.projectId;
		db = await dbConnect();
		const access = await requireProjectAccess(request, requestedProjectId, {
			db,
			getLeadPolicy: loadLeadPolicy,
		});
		if ('response' in access) return access.response;
		if (manager) {
			const denied = requireManagerEdit(access.rights);
			if (denied) return denied;
		} else {
			const denied = requireCurrentTeam(access.project, user);
			if (denied) return denied;
		}

		const nowMs = Date.now();
		const project = access.project;
		const projectId = resolvedProjectId(project);
		let employeeId: number | undefined;
		if (!manager) {
			const employee = await getLinkedEmployee(db, user.id);
			if (!employee) {
				return jsonError(
					403,
					'EMPLOYEE_LINK_REQUIRED',
					'Your User Account is not linked to an active Employee. Contact an administrator.'
				);
			}
			employeeId = employee.employeeId;
		}
		const deleted = await deleteWorkPeriodCommand({
			db,
			actor: user,
			project,
			projectId,
			id,
			nowMs,
			manager,
			employeeId,
		});
		return mutationSuccess(deleted.id);
	} catch (error) {
		return commandFailure(error, 'Failed to delete Work Period');
	} finally {
		try {
			db?.release();
		} catch (error) {
			console.warn('[work-periods] failed to release DELETE connection', error);
		}
	}
}
