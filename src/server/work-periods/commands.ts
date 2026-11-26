import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import {
	assertNoWorkPeriodOverlap,
	deleteWorkPeriod,
	getWorkPeriod,
	insertWorkPeriod,
	lockWorkPeriodEmployee,
	updateWorkPeriod,
	type WorkPeriodRecord,
} from '@/server/work-periods/store';
import {
	isSelfServicePeriod,
	istDate,
	parseIstLocal,
} from '@/lib/work-periods';
import { isUserInProjectTeam } from '@/utils/project-access';
import {
	WorkPeriodCommandError,
	type WorkPeriodCommandErrorCode,
	type WorkPeriodRequestFields,
} from '@/server/work-periods/validation';

export { WorkPeriodCommandError };
export type { WorkPeriodCommandErrorCode };

export type WorkPeriodInput = {
	startMs: number;
	endMs: number;
	quantity: string;
	dateCompleted: string;
	remarks: string;
};

export type WorkPeriodActor = {
	id: number;
	email?: string | null;
};

export type LinkedEmployee = {
	employeeId: number;
	employeeName: string;
};

export type ManagerAssignment = {
	id: string;
	employeeName: string;
	activityName: string;
	subActivityName: string;
};

type Db = PoolConnection;
type Row = Record<string, unknown>;
type Project = Record<string, unknown>;
type WorkPeriodDrizzleDb = MySql2Database<Record<string, never>>;

type AssignmentRow = Row & {
	id: string;
	user_id: number;
	employee_id: number;
	project_id: number | string;
	activity_id: string;
	activity_name: string;
	discipline_id: string | null;
	discipline_name: string | null;
	catalog_activity_id: string | null;
	catalog_sub_activity_id: string | null;
	sub_activity_name: string | null;
	default_manhours: string | number | null;
};

type LockedProject = {
	project_team: unknown;
	project_activities_list: unknown;
};

type CreateOptions = {
	db: Db;
	actor: WorkPeriodActor;
	project: Project;
	projectId: number;
	input: WorkPeriodInput;
	nowMs: number;
	manager: boolean;
	employeeId?: number;
	assignmentId?: string;
	disciplineId?: string;
	activityId?: string;
	subActivityId?: string | null;
};

type ExistingMutationOptions = {
	db: Db;
	actor: WorkPeriodActor;
	project: Project;
	projectId: number;
	id: string;
	manager: boolean;
	employeeId?: number;
	nowMs: number;
	input?: WorkPeriodInput;
};

function commandError(
	status: number,
	code: WorkPeriodCommandErrorCode,
	message: string
): WorkPeriodCommandError {
	return new WorkPeriodCommandError(status, code, message);
}

function invalid(message: string): never {
	throw commandError(400, 'INVALID_WORK_PERIOD', message);
}

function rowsOf(result: unknown): Row[] {
	if (Array.isArray(result)) {
		if (Array.isArray(result[0])) return result[0] as Row[];
		return result as Row[];
	}
	if (
		result &&
		typeof result === 'object' &&
		'rows' in result &&
		Array.isArray(result.rows)
	) {
		return result.rows as Row[];
	}
	return [];
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedLabel(value: unknown): string {
	return text(value).trim().toLocaleLowerCase();
}

function sameLabel(left: unknown, right: unknown): boolean {
	return normalizedLabel(left) === normalizedLabel(right);
}

function employeeName(row: Row): string {
	const name = [row.first_name, row.last_name]
		.map((part) => text(part).trim())
		.filter(Boolean)
		.join(' ')
		.trim();
	return name || text(row.full_name).trim() || text(row.username).trim();
}

function projectIdOf(project: Project): number {
	const raw = project.project_id ?? project.id;
	const projectId = Number(raw);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) {
		throw commandError(
			500,
			'WORK_PERIOD_WRITE_FAILED',
			'Project identity is invalid'
		);
	}
	return projectId;
}

function parseJsonArray(value: unknown): Row[] {
	if (value === null || value === undefined || value === '') return [];
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw commandError(
				500,
				'WORK_PERIOD_WRITE_FAILED',
				'Project activity data is invalid'
			);
		}
	}
	if (!Array.isArray(parsed)) {
		throw commandError(
			500,
			'WORK_PERIOD_WRITE_FAILED',
			'Project activity data is invalid'
		);
	}
	return parsed.filter(
		(entry): entry is Row => Boolean(entry) && typeof entry === 'object'
	);
}

function parseDailyEntries(value: unknown): Row[] {
	return parseJsonArray(value);
}

export function parseWorkPeriodInput(
	body: WorkPeriodRequestFields,
	nowMs: number
): WorkPeriodInput {
	const startMs = parseIstLocal(body.start);
	const endMs = parseIstLocal(body.end);
	if (startMs === null || endMs === null) {
		invalid('Start and End are required and must use YYYY-MM-DDTHH:mm in IST.');
	}
	if (endMs <= startMs) invalid('End must be after Start.');
	if (endMs > nowMs) invalid('End cannot be in the future.');

	const quantity = body.quantity ?? 0;
	if (!Number.isFinite(quantity) || quantity < 0) {
		invalid('Quantity must be a non-negative number.');
	}

	const today = istDate(nowMs);
	const suppliedDateCompleted = body.dateCompleted?.trim();
	const dateCompleted =
		suppliedDateCompleted === undefined ||
		suppliedDateCompleted === null ||
		suppliedDateCompleted === ''
			? istDate(endMs)
			: suppliedDateCompleted;
	const dateMs = parseIstLocal(`${dateCompleted}T00:00`);
	if (!dateCompleted || dateMs === null || istDate(dateMs) !== dateCompleted) {
		invalid('Date Completed must be a valid IST date in YYYY-MM-DD format.');
	}
	if (dateCompleted > today) invalid('Date Completed cannot be in the future.');

	return {
		startMs,
		endMs,
		quantity: String(quantity),
		dateCompleted,
		remarks: body.remarks?.trim() ?? '',
	};
}

export async function getLinkedEmployee(
	db: Db,
	userId: number
): Promise<LinkedEmployee | null> {
	const ddb = drizzle({ client: db });
	const result = await ddb.execute(sql`
		SELECT e.id AS employee_id,
		       CONCAT_WS(' ', NULLIF(e.first_name, ''), NULLIF(e.last_name, '')) AS employee_name
		FROM users u
		JOIN employees e ON e.id = u.employee_id
		WHERE u.id = ${userId}
		  AND u.isDelete = 0
		  AND e.isDelete = 0
		LIMIT 1
	`);
	const row = rowsOf(result)[0];
	if (!row || row.employee_id === null || row.employee_id === undefined)
		return null;
	return {
		employeeId: Number(row.employee_id),
		employeeName: text(row.employee_name),
	};
}

export async function listCurrentProjectIds(
	db: Db,
	userId: number,
	email?: string | null
): Promise<Set<number>> {
	const ddb = drizzle({ client: db });
	const result = await ddb.execute(sql`
		SELECT project_id, id, project_team
		FROM projects
		WHERE isDelete = 0
		  AND project_team IS NOT NULL
		  AND project_team != ''
	`);
	const projectIds = new Set<number>();
	for (const row of rowsOf(result)) {
		if (!isUserInProjectTeam(row.project_team, userId, email)) continue;
		const projectId = Number(row.project_id ?? row.id);
		if (Number.isSafeInteger(projectId) && projectId > 0)
			projectIds.add(projectId);
	}
	return projectIds;
}

async function loadValidAssignment(
	ddb: WorkPeriodDrizzleDb,
	assignmentId: string,
	projectId: number,
	forUpdate = false
): Promise<AssignmentRow | null> {
	const result = await ddb.execute(sql`
		SELECT uaa.*,
		       u.email AS linked_user_email,
		       u.full_name AS linked_user_name,
		       e.first_name AS first_name,
		       e.last_name AS last_name
		FROM user_activity_assignments uaa
		JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
		JOIN employees e ON e.id = uaa.employee_id AND e.isDelete = 0
		WHERE uaa.id = ${assignmentId}
		  AND uaa.project_id = ${projectId}
		  AND u.employee_id = uaa.employee_id
		  AND uaa.employee_id IS NOT NULL
		  AND uaa.activity_id IS NOT NULL
		  AND uaa.activity_id != ''
		LIMIT 1
		${forUpdate ? sql`FOR UPDATE` : sql``}
	`);
	return (rowsOf(result)[0] as AssignmentRow | undefined) ?? null;
}

export async function listManagerAssignments(
	db: Db,
	projectId: number,
	projectTeam: unknown
): Promise<ManagerAssignment[]> {
	const ddb = drizzle({ client: db });
	const result = await ddb.execute(sql`
		SELECT uaa.id,
		       uaa.activity_name,
		       uaa.sub_activity_name,
		       u.id AS user_id,
		       u.email AS linked_user_email,
		       e.first_name,
		       e.last_name,
		       u.full_name
		FROM user_activity_assignments uaa
		JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
		JOIN employees e ON e.id = uaa.employee_id AND e.isDelete = 0
		WHERE uaa.project_id = ${projectId}
		  AND u.employee_id = uaa.employee_id
		  AND uaa.employee_id IS NOT NULL
		  AND uaa.activity_id IS NOT NULL
		  AND uaa.activity_id != ''
		ORDER BY u.full_name, uaa.activity_name, uaa.id
	`);
	return rowsOf(result)
		.filter((row) =>
			isUserInProjectTeam(
				projectTeam,
				Number(row.user_id),
				text(row.linked_user_email)
			)
		)
		.map((row) => ({
			id: text(row.id),
			employeeName: employeeName(row),
			activityName: text(row.activity_name),
			subActivityName: text(row.sub_activity_name),
		}));
}

async function lockProject(
	ddb: WorkPeriodDrizzleDb,
	projectId: number
): Promise<LockedProject | null> {
	const result = await ddb.execute(sql`
		SELECT project_team, project_activities_list
		FROM projects
		WHERE project_id = ${projectId}
		  AND isDelete = 0
		LIMIT 1
		FOR UPDATE
	`);
	return (rowsOf(result)[0] as LockedProject | undefined) ?? null;
}

function requireTeam(
	project: LockedProject,
	actor: WorkPeriodActor,
	target?: { userId: number; email?: string | null }
): void {
	const userId = target?.userId ?? actor.id;
	const email = target?.email ?? actor.email;
	if (!isUserInProjectTeam(project.project_team, userId, email)) {
		throw commandError(
			403,
			'PROJECT_ACCESS_DENIED',
			'You do not have permission to access this project'
		);
	}
}

type CatalogSelection = {
	disciplineId: string;
	disciplineName: string;
	catalogActivityId: string;
	activityName: string;
	catalogSubActivityId: string | null;
	subActivityName: string;
	defaultManhours: number;
};

async function loadCatalogSelection(
	ddb: WorkPeriodDrizzleDb,
	disciplineId: string,
	activityId: string,
	subActivityId: string | null
): Promise<CatalogSelection> {
	const catalogResult = await ddb.execute(sql`
		SELECT f.id AS discipline_id,
		       f.function_name AS discipline_name,
		       a.id AS activity_id,
		       a.activity_name,
		       COALESCE(a.default_manhours, 0) AS default_manhours
		FROM functions_master f
		JOIN activities_master a ON a.function_id = f.id
		WHERE f.id = ${disciplineId}
		  AND a.id = ${activityId}
		  AND (f.status = 'active' OR f.status IS NULL)
		LIMIT 1
	`);
	const catalog = rowsOf(catalogResult)[0];
	if (!catalog) {
		throw commandError(
			400,
			'INVALID_ACTIVITY_SELECTION',
			'Select a valid Discipline and Activity.'
		);
	}

	const subResult = await ddb.execute(sql`
		SELECT id, name
		FROM sub_activities
		WHERE activity_id = ${activityId}
		ORDER BY name, id
	`);
	const subActivities = rowsOf(subResult);
	if (subActivities.length === 0) {
		if (subActivityId !== null) {
			throw commandError(
				400,
				'INVALID_ACTIVITY_SELECTION',
				'Choose No sub-activity for an Activity without children.'
			);
		}
	} else {
		if (subActivityId === null) {
			throw commandError(
				400,
				'INVALID_ACTIVITY_SELECTION',
				'Select a Sub-activity for this Activity.'
			);
		}
		if (!subActivities.some((row) => text(row.id) === subActivityId)) {
			throw commandError(
				400,
				'INVALID_ACTIVITY_SELECTION',
				'Select a valid Sub-activity for this Activity.'
			);
		}
	}

	const selectedSub = subActivities.find(
		(row) => text(row.id) === subActivityId
	);
	return {
		disciplineId,
		disciplineName: text(catalog.discipline_name),
		catalogActivityId: activityId,
		activityName: text(catalog.activity_name),
		catalogSubActivityId: subActivityId,
		subActivityName: text(selectedSub?.name),
		defaultManhours: numberValue(catalog.default_manhours),
	};
}

function compatibleDisciplineId(
	value: unknown,
	catalog: CatalogSelection
): boolean {
	const disciplineId = text(value);
	return !disciplineId || disciplineId === catalog.disciplineId;
}

function compatibleSubActivity(
	id: unknown,
	label: unknown,
	catalog: CatalogSelection
): boolean {
	const subActivityId = text(id);
	return subActivityId
		? subActivityId === catalog.catalogSubActivityId
		: sameLabel(label, catalog.subActivityName);
}

function matchesStableCatalog(
	assignment: AssignmentRow,
	catalog: CatalogSelection
): boolean {
	return (
		text(assignment.activity_id) !== '' &&
		text(assignment.catalog_activity_id) === catalog.catalogActivityId &&
		compatibleDisciplineId(assignment.discipline_id, catalog) &&
		compatibleSubActivity(
			assignment.catalog_sub_activity_id,
			assignment.sub_activity_name,
			catalog
		)
	);
}

function matchesLegacyCatalog(
	assignment: AssignmentRow,
	catalog: CatalogSelection
): boolean {
	return (
		text(assignment.activity_id) !== '' &&
		text(assignment.activity_id) !== catalog.catalogActivityId &&
		!text(assignment.catalog_activity_id) &&
		compatibleDisciplineId(assignment.discipline_id, catalog) &&
		sameLabel(assignment.discipline_name, catalog.disciplineName) &&
		sameLabel(assignment.activity_name, catalog.activityName) &&
		sameLabel(assignment.sub_activity_name, catalog.subActivityName)
	);
}

async function persistMissingCatalogIdentity(
	ddb: WorkPeriodDrizzleDb,
	assignment: AssignmentRow,
	catalog: CatalogSelection
): Promise<AssignmentRow> {
	if (
		text(assignment.discipline_id) &&
		text(assignment.catalog_activity_id) &&
		(text(assignment.catalog_sub_activity_id) ||
			catalog.catalogSubActivityId === null)
	) {
		return assignment;
	}
	await ddb.execute(sql`
		UPDATE user_activity_assignments
		SET discipline_id = COALESCE(discipline_id, ${catalog.disciplineId}),
		    catalog_activity_id = COALESCE(catalog_activity_id, ${catalog.catalogActivityId}),
		    catalog_sub_activity_id = CASE
		      WHEN ${catalog.catalogSubActivityId} IS NULL THEN catalog_sub_activity_id
		      ELSE COALESCE(catalog_sub_activity_id, ${catalog.catalogSubActivityId})
		    END
		WHERE id = ${assignment.id}
	`);
	const updated = await loadValidAssignment(
		ddb,
		assignment.id,
		Number(assignment.project_id)
	);
	if (!updated) {
		throw commandError(
			404,
			'ASSIGNMENT_NOT_AVAILABLE',
			'The Project Activity assignment is no longer available.'
		);
	}
	return updated;
}

async function findSelfAssignment(
	ddb: WorkPeriodDrizzleDb,
	userId: number,
	employeeId: number,
	projectId: number,
	catalog: CatalogSelection
): Promise<AssignmentRow | null> {
	const result = await ddb.execute(sql`
		SELECT *
		FROM user_activity_assignments
		WHERE user_id = ${userId}
		  AND employee_id = ${employeeId}
		  AND project_id = ${projectId}
		ORDER BY created_at, id
		FOR UPDATE
	`);
	const candidates = rowsOf(result).map((row) => row as AssignmentRow);
	const stable = candidates.find((assignment) =>
		matchesStableCatalog(assignment, catalog)
	);
	if (stable) return persistMissingCatalogIdentity(ddb, stable, catalog);
	const legacy = candidates.filter((assignment) =>
		matchesLegacyCatalog(assignment, catalog)
	);
	return legacy.length === 1
		? persistMissingCatalogIdentity(ddb, legacy[0], catalog)
		: null;
}

function findBlobActivity(
	activities: Row[],
	catalog: CatalogSelection
): Row | undefined {
	const stable = activities.filter(
		(activity) =>
			text(activity.id) &&
			text(activity.catalog_activity_id) === catalog.catalogActivityId &&
			compatibleDisciplineId(activity.discipline_id, catalog) &&
			compatibleSubActivity(
				activity.catalog_sub_activity_id,
				activity.sub_activity_name,
				catalog
			)
	);
	if (stable.length === 1) return stable[0];
	const legacy = activities.filter(
		(activity) =>
			text(activity.id) &&
			text(activity.id) !== catalog.catalogActivityId &&
			!text(activity.catalog_activity_id) &&
			compatibleDisciplineId(activity.discipline_id, catalog) &&
			sameLabel(
				activity.discipline ?? activity.function_name,
				catalog.disciplineName
			) &&
			sameLabel(activity.activity_name, catalog.activityName) &&
			sameLabel(activity.sub_activity_name, catalog.subActivityName)
	);
	return legacy.length === 1 ? legacy[0] : undefined;
}

function zeroBlobAssignment(userId: number): Row {
	return {
		user_id: userId,
		qty_assigned: 0,
		qty_completed: 0,
		planned_hours: 0,
		actual_hours: 0,
		status: 'Not Started',
		due_date: null,
		start_date: null,
		remarks: '',
		notes: '',
		description: '',
		progress_percentage: 0,
		daily_entries: [],
	};
}

function newBlobActivity(catalog: CatalogSelection, userId: number): Row {
	return {
		id: randomUUID(),
		discipline_id: catalog.disciplineId,
		catalog_activity_id: catalog.catalogActivityId,
		catalog_sub_activity_id: catalog.catalogSubActivityId,
		activity_name: catalog.activityName,
		function_name: catalog.disciplineName,
		discipline: catalog.disciplineName,
		sub_activity_name: catalog.subActivityName,
		default_manhours: catalog.defaultManhours,
		activity_description: '',
		assigned_users: [zeroBlobAssignment(userId)],
	};
}

async function insertAssignment(
	ddb: WorkPeriodDrizzleDb,
	{
		assignmentId,
		activityId,
		userId,
		employeeId,
		projectId,
		actorId,
		catalog,
		source,
	}: {
		assignmentId: string;
		activityId: string;
		userId: number;
		employeeId: number;
		projectId: number;
		actorId: number;
		catalog: CatalogSelection;
		source: Row;
	}
): Promise<AssignmentRow> {
	const dailyEntries = parseDailyEntries(source.daily_entries);
	await ddb.execute(sql`
		INSERT INTO user_activity_assignments
			(id, user_id, employee_id, project_id, activity_id, activity_name,
			 discipline_id, catalog_activity_id, catalog_sub_activity_id,
			 discipline_name, sub_activity_name, assigned_by,
			 due_date, start_date, status, progress_percentage, estimated_hours,
			 actual_hours, qty_assigned, qty_completed, notes, remarks,
			 description, default_manhours, daily_entries)
		VALUES
			(${assignmentId}, ${userId}, ${employeeId}, ${projectId}, ${activityId},
			 ${catalog.activityName}, ${catalog.disciplineId},
			 ${catalog.catalogActivityId}, ${catalog.catalogSubActivityId},
			 ${catalog.disciplineName}, ${catalog.subActivityName || null}, ${actorId},
			 ${text(source.due_date) || null}, ${text(source.start_date) || null},
			 ${text(source.status) || 'Not Started'}, ${numberValue(source.progress_percentage)},
			 ${numberValue(source.planned_hours)}, ${numberValue(source.actual_hours)},
			 ${numberValue(source.qty_assigned)}, ${numberValue(source.qty_completed)},
			 ${text(source.notes)}, ${text(source.remarks)}, ${text(source.description)},
			 ${catalog.defaultManhours}, ${JSON.stringify(dailyEntries)})
	`);
	const assignment = await loadValidAssignment(ddb, assignmentId, projectId);
	if (!assignment) {
		throw commandError(
			500,
			'WORK_PERIOD_WRITE_FAILED',
			'Failed to create the Project Activity assignment'
		);
	}
	return assignment;
}

async function resolveSelfAssignment(
	ddb: WorkPeriodDrizzleDb,
	options: CreateOptions,
	lockedProject: LockedProject,
	catalog: CatalogSelection
): Promise<{ assignment: AssignmentRow; projectBlob: string }> {
	const existing = await findSelfAssignment(
		ddb,
		options.actor.id,
		options.employeeId as number,
		options.projectId,
		catalog
	);
	const activities = parseJsonArray(lockedProject.project_activities_list);
	if (existing) {
		return {
			assignment: existing,
			projectBlob: JSON.stringify(activities),
		};
	}

	let activity = findBlobActivity(activities, catalog);
	let projectBlob: string;
	if (activity) {
		if (!text(activity.discipline_id))
			activity.discipline_id = catalog.disciplineId;
		if (!text(activity.catalog_activity_id)) {
			activity.catalog_activity_id = catalog.catalogActivityId;
		}
		if (!text(activity.catalog_sub_activity_id)) {
			activity.catalog_sub_activity_id = catalog.catalogSubActivityId;
		}
		projectBlob = JSON.stringify(activities);
	} else {
		activity = newBlobActivity(catalog, options.actor.id);
		activities.push(activity);
		projectBlob = JSON.stringify(activities);
	}

	const activityId = text(activity.id);
	if (!activityId) {
		throw commandError(
			500,
			'WORK_PERIOD_WRITE_FAILED',
			'Project activity data is invalid'
		);
	}
	const assignedUsers = Array.isArray(activity.assigned_users)
		? activity.assigned_users.filter(
				(entry): entry is Row => Boolean(entry) && typeof entry === 'object'
			)
		: [];
	let source = assignedUsers.find(
		(entry) => String(entry.user_id) === String(options.actor.id)
	);
	if (!source) {
		source = zeroBlobAssignment(options.actor.id);
		assignedUsers.push(source);
		activity.assigned_users = assignedUsers;
		projectBlob = JSON.stringify(activities);
	}

	const assignment = await insertAssignment(ddb, {
		assignmentId: randomUUID(),
		activityId,
		userId: options.actor.id,
		employeeId: options.employeeId as number,
		projectId: options.projectId,
		actorId: options.actor.id,
		catalog,
		source,
	});
	return { assignment, projectBlob };
}

async function loadAssignmentForProjection(
	ddb: WorkPeriodDrizzleDb,
	assignmentId: string
): Promise<AssignmentRow | null> {
	const result = await ddb.execute(sql`
		SELECT * FROM user_activity_assignments WHERE id = ${assignmentId} LIMIT 1
	`);
	return (rowsOf(result)[0] as AssignmentRow | undefined) ?? null;
}

function effectiveAssignmentTotals(assignment: AssignmentRow) {
	let hours = 0;
	let quantity = 0;
	for (const payload of [
		assignment.daily_entries,
		assignment.work_period_entries,
	]) {
		for (const entry of parseDailyEntries(payload)) {
			hours += numberValue(entry.hours);
			quantity += numberValue(entry.qty_done);
		}
	}
	return { hours, quantity };
}

async function syncProjectAssignmentBlob(
	ddb: WorkPeriodDrizzleDb,
	projectId: number,
	projectBlob: string,
	assignment: AssignmentRow
): Promise<void> {
	const activities = parseJsonArray(projectBlob);
	let activity = activities.find(
		(entry) => text(entry.id) === text(assignment.activity_id)
	);
	if (!activity) {
		activity = {
			id: assignment.activity_id,
			discipline_id: assignment.discipline_id,
			catalog_activity_id: assignment.catalog_activity_id,
			catalog_sub_activity_id: assignment.catalog_sub_activity_id,
			activity_name: assignment.activity_name,
			function_name: assignment.discipline_name || '',
			discipline: assignment.discipline_name || '',
			sub_activity_name: assignment.sub_activity_name || '',
			default_manhours: numberValue(assignment.default_manhours),
			activity_description: '',
			assigned_users: [],
		};
		activities.push(activity);
	}

	const totals = effectiveAssignmentTotals(assignment);
	activity.discipline_id = assignment.discipline_id;
	activity.catalog_activity_id = assignment.catalog_activity_id;
	activity.catalog_sub_activity_id = assignment.catalog_sub_activity_id;

	activity.activity_name = assignment.activity_name;
	activity.function_name = assignment.discipline_name || '';
	activity.discipline = assignment.discipline_name || '';
	activity.sub_activity_name = assignment.sub_activity_name || '';
	activity.default_manhours = numberValue(assignment.default_manhours);

	const assignedUsers = Array.isArray(activity.assigned_users)
		? activity.assigned_users.filter(
				(entry): entry is Row => Boolean(entry) && typeof entry === 'object'
			)
		: [];
	const existingIndex = assignedUsers.findIndex(
		(entry) => String(entry.user_id) === String(assignment.user_id)
	);
	const projected = {
		...(existingIndex >= 0 ? assignedUsers[existingIndex] : {}),
		user_id: assignment.user_id,
		qty_assigned: numberValue(assignment.qty_assigned),
		qty_completed: totals.quantity,
		planned_hours: numberValue(assignment.estimated_hours),
		actual_hours: totals.hours,
		status: text(assignment.status) || 'Not Started',
		due_date: assignment.due_date ?? null,
		start_date: assignment.start_date ?? null,
		remarks: text(assignment.remarks),
		notes: text(assignment.notes),
		description: text(assignment.description),
		progress_percentage: numberValue(assignment.progress_percentage),
		daily_entries: parseDailyEntries(assignment.daily_entries),
	};
	if (existingIndex >= 0) assignedUsers[existingIndex] = projected;
	else assignedUsers.push(projected);
	activity.assigned_users = assignedUsers;

	await ddb.execute(sql`
		UPDATE projects
		SET project_activities_list = ${JSON.stringify(activities)},
		    updated_at = CURRENT_TIMESTAMP
		WHERE project_id = ${projectId}
		  AND isDelete = 0
	`);
}

async function syncAssignmentAfterMutation(
	ddb: WorkPeriodDrizzleDb,
	projectId: number,
	projectBlob: string,
	assignmentId: string
): Promise<AssignmentRow> {
	const assignment = await loadAssignmentForProjection(ddb, assignmentId);
	if (!assignment) {
		throw commandError(
			404,
			'ASSIGNMENT_NOT_AVAILABLE',
			'The Project Activity assignment is no longer available.'
		);
	}
	await syncProjectAssignmentBlob(ddb, projectId, projectBlob, assignment);
	return assignment;
}

async function insertSelfSaveEvidence(
	ddb: WorkPeriodDrizzleDb,
	actorId: number,
	actionType: 'create' | 'update',
	projectId: number,
	assignment: AssignmentRow
): Promise<void> {
	await ddb.execute(sql`
		INSERT INTO user_activity_logs
			(user_id, action_type, resource_type, description, details, status)
		VALUES
			(${actorId}, ${actionType}, 'project_activity_save',
			 ${`Activity progress saved for project ${projectId}`},
			 ${JSON.stringify({ projectId, activityId: assignment.activity_id })},
			 'success')
	`);
}

async function transaction<T>(db: Db, work: () => Promise<T>): Promise<T> {
	await db.beginTransaction();
	try {
		const result = await work();
		await db.commit();
		return result;
	} catch (error) {
		try {
			await db.rollback();
		} catch {
			// Preserve the original failure.
		}
		throw error;
	}
}

function requireIdentifier(value: unknown, label: string): string {
	const identifier = text(value).trim();
	if (!identifier) invalid(`${label} is required.`);
	return identifier;
}

export async function createWorkPeriod(
	options: CreateOptions
): Promise<{ id: string }> {
	const { db, actor, project, input, nowMs, manager } = options;
	const projectId = projectIdOf(project);
	const managerAssignmentId = manager
		? requireIdentifier(options.assignmentId, 'Assignment')
		: null;
	const prelookupDb = drizzle({ client: db });
	const managerPrelookup = managerAssignmentId
		? await loadValidAssignment(prelookupDb, managerAssignmentId, projectId)
		: null;
	let employeeId: number;
	if (manager) {
		if (!managerPrelookup) {
			throw commandError(
				404,
				'ASSIGNMENT_NOT_AVAILABLE',
				'The selected Project Activity assignment is no longer available.'
			);
		}
		employeeId = managerPrelookup.employee_id;
	} else {
		employeeId = requireSelfEmployee(options.employeeId);
	}

	return transaction(db, async () => {
		const ddb = drizzle({ client: db });
		const locked = await lockWorkPeriodEmployee(ddb, employeeId);
		if (!locked) {
			throw manager
				? commandError(
						404,
						'ASSIGNMENT_NOT_AVAILABLE',
						'The selected Project Activity assignment is no longer available.'
					)
				: commandError(
						403,
						'EMPLOYEE_LINK_REQUIRED',
						'Your User Account is not linked to an active Employee. Contact an administrator.'
					);
		}
		if (!manager) await assertSelfEmployeeLink(ddb, actor.id, employeeId);
		const lockedProject = await lockProject(ddb, projectId);
		if (!lockedProject) {
			throw commandError(
				403,
				'PROJECT_ACCESS_DENIED',
				'You do not have permission to access this project'
			);
		}

		let assignment: AssignmentRow;
		let projectBlob: string;
		if (manager) {
			assignment = await requireManagerAssignment(
				ddb,
				managerAssignmentId as string,
				projectId,
				lockedProject
			);
			if (assignment.employee_id !== employeeId) {
				throw commandError(
					409,
					'WORK_PERIOD_WRITE_FAILED',
					'The Project Activity assignment changed. Retry the save.'
				);
			}
			projectBlob = JSON.stringify(
				parseJsonArray(lockedProject.project_activities_list)
			);
		} else {
			requireTeam(lockedProject, actor);
			requireSelfEndpoints(input.startMs, input.endMs, nowMs);
			const disciplineId = requireIdentifier(
				options.disciplineId,
				'Discipline'
			);
			const activityId = requireIdentifier(options.activityId, 'Activity');
			if (
				options.subActivityId !== null &&
				typeof options.subActivityId !== 'string'
			) {
				invalid('Select a valid Sub-activity or No sub-activity.');
			}
			const catalog = await loadCatalogSelection(
				ddb,
				disciplineId,
				activityId,
				options.subActivityId ?? null
			);
			const resolved = await resolveSelfAssignment(
				ddb,
				options,
				lockedProject,
				catalog
			);
			assignment = resolved.assignment;
			projectBlob = resolved.projectBlob;
		}

		const clear = await assertNoWorkPeriodOverlap(ddb, {
			employeeId,
			startMs: input.startMs,
			endMs: input.endMs,
		});
		if (!clear) {
			throw commandError(
				409,
				'WORK_PERIOD_OVERLAP',
				'This Work Period overlaps another Work Period. Adjust the Start or End.'
			);
		}

		const id = randomUUID();
		const saved = await insertWorkPeriod(ddb, {
			id,
			assignmentId: assignment.id,
			employeeId,
			startMs: input.startMs,
			endMs: input.endMs,
			quantity: input.quantity,
			dateCompleted: input.dateCompleted,
			remarks: input.remarks,
		});
		const projected = await syncAssignmentAfterMutation(
			ddb,
			projectId,
			projectBlob,
			assignment.id
		);
		if (!manager) {
			await insertSelfSaveEvidence(
				ddb,
				actor.id,
				'create',
				projectId,
				projected
			);
		}
		return { id: saved.id };
	});
}

function requireSelfEmployee(employeeId?: number): number {
	if (employeeId === undefined) {
		throw commandError(
			403,
			'EMPLOYEE_LINK_REQUIRED',
			'Your User Account is not linked to an active Employee. Contact an administrator.'
		);
	}
	return employeeId;
}

async function assertSelfEmployeeLink(
	ddb: WorkPeriodDrizzleDb,
	userId: number,
	employeeId: number
): Promise<void> {
	const result = await ddb.execute(sql`
		SELECT u.id
		FROM users u
		JOIN employees e ON e.id = u.employee_id
		WHERE u.id = ${userId}
		  AND u.employee_id = ${employeeId}
		  AND u.isDelete = 0
		  AND e.isDelete = 0
		LIMIT 1
	`);
	if (rowsOf(result).length === 0) {
		throw commandError(
			403,
			'EMPLOYEE_LINK_REQUIRED',
			'Your User Account is not linked to an active Employee. Contact an administrator.'
		);
	}
}

async function requireManagerAssignment(
	ddb: WorkPeriodDrizzleDb,
	assignmentId: string,
	projectId: number,
	lockedProject: LockedProject
): Promise<AssignmentRow> {
	const assignment = await loadValidAssignment(
		ddb,
		assignmentId,
		projectId,
		true
	);
	if (!assignment) {
		throw commandError(
			404,
			'ASSIGNMENT_NOT_AVAILABLE',
			'The selected Project Activity assignment is no longer available.'
		);
	}
	requireTeam(
		lockedProject,
		{ id: 0 },
		{
			userId: Number(assignment.user_id),
			email: text(assignment.linked_user_email),
		}
	);
	return assignment;
}

async function locateExistingPeriod(
	ddb: WorkPeriodDrizzleDb,
	options: ExistingMutationOptions,
	forUpdate = false
): Promise<{ period: WorkPeriodRecord; assignment: AssignmentRow }> {
	const period = await getWorkPeriod(ddb, options.id);
	if (!period) throw workPeriodNotFound();
	const assignment = await loadValidAssignment(
		ddb,
		period.assignmentId,
		options.projectId,
		forUpdate
	);
	if (
		!assignment ||
		Number(assignment.project_id) !== options.projectId ||
		Number(assignment.employee_id) !== period.employeeId
	) {
		throw workPeriodNotFound();
	}
	if (!options.manager) {
		const employeeId = requireSelfEmployee(options.employeeId);
		if (
			period.employeeId !== employeeId ||
			Number(assignment.user_id) !== options.actor.id
		) {
			throw workPeriodNotFound();
		}
	}
	return { period, assignment };
}

function workPeriodNotFound(): WorkPeriodCommandError {
	return commandError(404, 'WORK_PERIOD_NOT_FOUND', 'Work Period not found');
}

function requireSelfEndpoints(
	startMs: number,
	endMs: number,
	nowMs: number
): void {
	if (!isSelfServicePeriod(startMs, endMs, nowMs)) {
		throw commandError(
			403,
			'OUTSIDE_SELF_SERVICE_WINDOW',
			'Both Start and End must fall today or yesterday in IST. Contact an authorized manager for older work.'
		);
	}
}

function requireSelfWindow(
	period: WorkPeriodRecord,
	input: WorkPeriodInput | undefined,
	nowMs: number
): void {
	requireSelfEndpoints(period.startMs, period.endMs, nowMs);
	if (input) requireSelfEndpoints(input.startMs, input.endMs, nowMs);
}

export async function updateWorkPeriodCommand(
	options: ExistingMutationOptions
): Promise<{ id: string }> {
	const { db, actor, project, input, nowMs, manager } = options;
	const projectId = projectIdOf(project);
	const prelookupDb = drizzle({ client: db });
	const located = await locateExistingPeriod(prelookupDb, options);
	if (!input) invalid('Start and End are required.');

	return transaction(db, async () => {
		const ddb = drizzle({ client: db });
		const locked = await lockWorkPeriodEmployee(ddb, located.period.employeeId);
		if (!locked) throw workPeriodNotFound();
		if (!manager) {
			await assertSelfEmployeeLink(ddb, actor.id, located.period.employeeId);
		}
		const lockedProject = await lockProject(ddb, projectId);
		if (!lockedProject) {
			throw commandError(
				403,
				'PROJECT_ACCESS_DENIED',
				'You do not have permission to access this project'
			);
		}
		const current = await locateExistingPeriod(ddb, options, true);
		if (!manager) {
			requireTeam(lockedProject, actor);
			requireSelfWindow(current.period, input, nowMs);
		} else {
			await requireManagerAssignment(
				ddb,
				current.assignment.id,
				projectId,
				lockedProject
			);
		}

		const clear = await assertNoWorkPeriodOverlap(ddb, {
			employeeId: current.period.employeeId,
			startMs: input.startMs,
			endMs: input.endMs,
			excludeId: options.id,
		});
		if (!clear) {
			throw commandError(
				409,
				'WORK_PERIOD_OVERLAP',
				'This Work Period overlaps another Work Period. Adjust the Start or End.'
			);
		}

		const saved = await updateWorkPeriod(ddb, {
			id: options.id,
			assignmentId: current.period.assignmentId,
			employeeId: current.period.employeeId,
			startMs: input.startMs,
			endMs: input.endMs,
			quantity: input.quantity,
			dateCompleted: input.dateCompleted,
			remarks: input.remarks,
		});
		if (!saved) throw workPeriodNotFound();
		const projected = await syncAssignmentAfterMutation(
			ddb,
			projectId,
			JSON.stringify(parseJsonArray(lockedProject.project_activities_list)),
			current.assignment.id
		);
		if (!manager) {
			await insertSelfSaveEvidence(
				ddb,
				actor.id,
				'update',
				projectId,
				projected
			);
		}
		return { id: saved.id };
	});
}

export async function deleteWorkPeriodCommand(
	options: ExistingMutationOptions
): Promise<{ id: string }> {
	const { db, actor, project, nowMs, manager } = options;
	const projectId = projectIdOf(project);
	const prelookupDb = drizzle({ client: db });
	const located = await locateExistingPeriod(prelookupDb, options);

	return transaction(db, async () => {
		const ddb = drizzle({ client: db });
		const locked = await lockWorkPeriodEmployee(ddb, located.period.employeeId);
		if (!locked) throw workPeriodNotFound();
		if (!manager) {
			await assertSelfEmployeeLink(ddb, actor.id, located.period.employeeId);
		}
		const lockedProject = await lockProject(ddb, projectId);
		if (!lockedProject) {
			throw commandError(
				403,
				'PROJECT_ACCESS_DENIED',
				'You do not have permission to access this project'
			);
		}
		const current = await locateExistingPeriod(ddb, options, true);
		if (!manager) {
			requireTeam(lockedProject, actor);
			requireSelfWindow(current.period, undefined, nowMs);
		} else {
			await requireManagerAssignment(
				ddb,
				current.assignment.id,
				projectId,
				lockedProject
			);
		}

		const deleted = await deleteWorkPeriod(ddb, options.id);
		if (!deleted) throw workPeriodNotFound();
		await syncAssignmentAfterMutation(
			ddb,
			projectId,
			JSON.stringify(parseJsonArray(lockedProject.project_activities_list)),
			current.assignment.id
		);
		return { id: options.id };
	});
}
