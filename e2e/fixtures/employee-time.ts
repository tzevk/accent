/**
 * Disposable employee-time fixtures for the Timesheet/My Timesheet journeys.
 *
 * Each exported seed creates its own ordinary identities, linked Employees,
 * Projects, project-team records and `user_activity_assignments` rows. The
 * login-to-Employee link is the real `users.employee_id` column, never an
 * email, username or request parameter.
 *
 * Expected hours and clock labels are authored here, independently of the
 * Timesheet renderer. The browser test reads only the visible grid; the
 * persisted readback below proves the seeded `daily_entries` still exist.
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

export const AUTHORED_OVERNIGHT_PERIOD = {
	start: '2024-06-30T23:30',
	end: '2024-07-01T01:30',
	quantity: 3,
	dateCompleted: '2024-07-01',
	remarks: 'Authored Sunday-to-Monday overnight Work Period',
} as const;

const TARGET_LOG_SPEC = [{ day: 10, hours: 2.5 }] as const;

const CURRENT_LOG_SPEC = [{ day: 5, hours: 1.5 }] as const;

const OTHER_LOG_SPEC = [{ day: 3, hours: 8 }] as const;

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
] as const;

/* ── exported fixture contract ─────────────────────────────────────── */

export interface TimeLogin {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
}

export interface FixtureEmployee {
	id: number;
	code: string;
	name: string;
	email: string;
	linkedUserId: number;
}

export interface FixtureProject {
	id: number;
	code: string;
	name: string;
	activityName: string;
}

export interface ExpectedTimeEntry {
	/** Calendar day of the month, for the grid column. */
	day: number;
	/** YYYY-MM-DD */
	date: string;
	hours: number;
	/** The grid's HH:MM cell text. */
	clock: string;
}

export interface ExpectedLogMonth {
	/** YYYY-MM */
	month: string;
	/** e.g. "October 2026" */
	label: string;
	entries: readonly ExpectedTimeEntry[];
	totalHours: number;
	/** The grid's HH:MM:SS total text. */
	totalClock: string;
}

export interface EmployeeSelfTimesheetFixture {
	namespace: string;
	login: TimeLogin;
	employee: FixtureEmployee;
	project: FixtureProject;
	assignmentId: string;
	current: ExpectedLogMonth;
	target: ExpectedLogMonth;
	/** A different Employee's target-month hours that must never leak in. */
	other: {
		employee: FixtureEmployee;
		project: FixtureProject;
		assignmentId: string;
		log: ExpectedLogMonth;
	};
	/** Delete every owned row, then the identities. Safe to call twice. */
	dispose(): Promise<void>;
}

export interface TimesheetReportFixture {
	namespace: string;
	login: TimeLogin;
	employee: FixtureEmployee;
	project: FixtureProject;
	assignmentId: string;
	currentMonth: string;
	currentMonthLabel: string;
	target: ExpectedLogMonth;
	/** Delete every owned row, then the identities. Safe to call twice. */
	dispose(): Promise<void>;
}

export interface WorkPeriodActivity {
	id: string;
	name: string;
	assignmentId: string;
	project: FixtureProject;
}

export interface EmployeeWorkPeriodFixture {
	namespace: string;
	login: TimeLogin;
	manager: TimeLogin;
	employee: FixtureEmployee;
	discipline: { id: string; name: string };
	primary: WorkPeriodActivity;
	secondary: WorkPeriodActivity;
	legacy: ExpectedTimeEntry;
	self: {
		date: string;
		day: number;
		month: string;
		weekStart: string;
		start: string;
		end: string;
		clock: string;
		totalClock: string;
		dateCompleted: string;
		remarks: string;
	};
	/** Delete every owned row, then the identities. Safe to call twice. */
	dispose(): Promise<void>;
}

export interface PersistedWorkPeriod {
	id: string;
	assignmentId: string;
	employeeId: number;
	startMs: number;
	endMs: number;
	quantity: number;
	dateCompleted: string;
	remarks: string;
}

export interface PersistedDailyEntry {
	date: string;
	hours: number;
}

export interface PersistedTimeAssignment {
	id: string;
	userId: number;
	employeeId: number | null;
	projectId: number | null;
	activityName: string;
	dailyEntries: PersistedDailyEntry[];
	totalHours: number;
}

export interface PersistedEmployeeTimeState {
	linkedEmployeeId: number | null;
	/** User ids stored in the owned Project's `project_team` JSON. */
	membershipUserIds: number[];
	assignment: PersistedTimeAssignment | null;
}

/* ── seed ──────────────────────────────────────────────────────────── */

interface OwnedRows {
	userIds: number[];
	employeeIds: number[];
	projectIds: number[];
	assignmentIds: string[];
	disciplineIds: string[];
	activityIds: string[];
	identities: JourneyUser[];
}

/**
 * Seed the signed-in Employee, their own current- and previous-month logs, and
 * a second Employee's target-month log. The single login is the self-service
 * Employee.
 */
export async function seedEmployeeSelfTimesheetFixture(
	db: Connection,
	namespace: string
): Promise<EmployeeSelfTimesheetFixture> {
	const owned: OwnedRows = {
		userIds: [],
		employeeIds: [],
		projectIds: [],
		assignmentIds: [],
		disciplineIds: [],
		activityIds: [],
		identities: [],
	};
	const { currentMonth, targetMonth } = relativeMonths();
	const target = buildLogMonth(targetMonth, TARGET_LOG_SPEC);
	const current = buildLogMonth(currentMonth, CURRENT_LOG_SPEC);
	const otherTarget = buildLogMonth(targetMonth, OTHER_LOG_SPEC);

	try {
		const login = await createJourneyUser(db, `${namespace}-time-self`, [], {});
		owned.identities.push(login);
		owned.userIds.push(login.userId);

		const otherLogin = await createJourneyUser(
			db,
			`${namespace}-time-other`,
			[],
			{}
		);
		owned.identities.push(otherLogin);
		owned.userIds.push(otherLogin.userId);

		const employee = await seedLinkedEmployee(
			db,
			owned,
			`${namespace}:self`,
			login,
			'E2E Time Self'
		);
		const otherEmployee = await seedLinkedEmployee(
			db,
			owned,
			`${namespace}:other`,
			otherLogin,
			'E2E Time Other'
		);

		const project = await seedProject(db, owned, {
			token: tokenFor(`${namespace}:self-project`),
			codePrefix: 'E2ETM',
			namePrefix: 'E2E Time Sheet Project',
			member: employee,
			startMonth: target.month,
		});
		const otherProject = await seedProject(db, owned, {
			token: tokenFor(`${namespace}:other-project`),
			codePrefix: 'E2ETO',
			namePrefix: 'E2E Other Time Project',
			member: otherEmployee,
			startMonth: target.month,
		});

		const assignmentId = await seedAssignment(db, owned, {
			employee,
			project,
			entries: [...target.entries, ...current.entries],
		});
		const otherAssignmentId = await seedAssignment(db, owned, {
			employee: otherEmployee,
			project: otherProject,
			entries: otherTarget.entries,
		});

		let disposed = false;
		return {
			namespace,
			login: {
				userId: login.userId,
				username: login.username,
				password: login.password,
			},
			employee,
			project,
			assignmentId,
			current,
			target,
			other: {
				employee: otherEmployee,
				project: otherProject,
				assignmentId: otherAssignmentId,
				log: otherTarget,
			},
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				await cleanupOwned(db, owned);
			},
		};
	} catch (error) {
		await cleanupAfterFailedSeed(db, owned, error);
		throw error;
	}
}

/**
 * Seed the reporting user plus one linked Employee, Project and previous-month
 * log. The reporting user is a different ordinary identity with exactly
 * `reports:read`.
 */
export async function seedTimesheetReportFixture(
	db: Connection,
	namespace: string
): Promise<TimesheetReportFixture> {
	const owned: OwnedRows = {
		userIds: [],
		employeeIds: [],
		projectIds: [],
		assignmentIds: [],
		disciplineIds: [],
		activityIds: [],
		identities: [],
	};
	const { currentMonth, targetMonth } = relativeMonths();
	const currentMonthLabel = monthLabel(currentMonth);
	const target = buildLogMonth(targetMonth, TARGET_LOG_SPEC);

	try {
		const login = await createJourneyUser(
			db,
			`${namespace}-time-reporter`,
			['reports:read'],
			{}
		);
		owned.identities.push(login);
		owned.userIds.push(login.userId);

		const employeeLogin = await createJourneyUser(
			db,
			`${namespace}-time-employee`,
			[],
			{}
		);
		owned.identities.push(employeeLogin);
		owned.userIds.push(employeeLogin.userId);

		const employee = await seedLinkedEmployee(
			db,
			owned,
			`${namespace}:report-employee`,
			employeeLogin,
			'E2E Time Report'
		);
		const project = await seedProject(db, owned, {
			token: tokenFor(`${namespace}:report-project`),
			codePrefix: 'E2ETR',
			namePrefix: 'E2E Time Report Project',
			member: employee,
			startMonth: target.month,
		});
		const assignmentId = await seedAssignment(db, owned, {
			employee,
			project,
			entries: target.entries,
		});

		let disposed = false;
		return {
			namespace,
			login: {
				userId: login.userId,
				username: login.username,
				password: login.password,
			},
			employee,
			project,
			assignmentId,
			currentMonth,
			currentMonthLabel,
			target,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				await cleanupOwned(db, owned);
			},
		};
	} catch (error) {
		await cleanupAfterFailedSeed(db, owned, error);
		throw error;
	}
}

/**
 * Seed the Work Period browser and contention actors: one linked Employee, one
 * Project Lead, two Projects and two catalog Activities without children. The
 * secondary assignment owns exactly one historical duration-only row.
 */
export async function seedEmployeeWorkPeriodFixture(
	db: Connection,
	namespace: string
): Promise<EmployeeWorkPeriodFixture> {
	const owned: OwnedRows = {
		userIds: [],
		employeeIds: [],
		projectIds: [],
		assignmentIds: [],
		disciplineIds: [],
		activityIds: [],
		identities: [],
	};
	const nowMs = Date.now();
	// Before 00:16 IST, yesterday is the only safe finished interval. After
	// that, use today so a midnight rollover during the browser journey merely
	// turns today into yesterday instead of expiring the record.
	const istNow = new Date(nowMs + IST_OFFSET_MS);
	const minuteOfDay = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
	const today = istDate(nowMs);
	const useToday = minuteOfDay >= 16;
	const selfDate = useToday ? today : shiftIstDate(today, -1);
	const selfStart = minuteOfDay >= 631 || !useToday ? '09:00' : '00:00';
	const selfEnd = minuteOfDay >= 631 || !useToday ? '10:30' : '00:15';
	const selfDurationSeconds = selfEnd === '10:30' ? 5_400 : 900;
	const selfWeekStart = weekStartFor(selfDate);
	const selfRemarks = `${namespace} finished self-service Work Period`;

	try {
		const login = await createJourneyUser(
			db,
			`${namespace}-work-period-self`,
			[],
			{}
		);
		owned.identities.push(login);
		owned.userIds.push(login.userId);
		const manager = await createJourneyUser(
			db,
			`${namespace}-work-period-manager`,
			[],
			{}
		);
		owned.identities.push(manager);
		owned.userIds.push(manager.userId);
		const employee = await seedLinkedEmployee(
			db,
			owned,
			`${namespace}:work-period-employee`,
			login,
			'E2E Work Period Employee'
		);
		const managerTeam = {
			user_id: manager.userId,
			id: manager.userId,
			name: manager.username,
			email: `${manager.username.toLowerCase()}@e2e.invalid`,
			role: 'Project Lead',
		};
		const baselineSchedule = {
			id: `${namespace}-baseline-schedule`,
			sr_no: '1',
			activity_description: 'Authored baseline schedule',
			legend: 'accent_activities',
			status_completed: 'Ongoing',
			remarks: 'Present before the stale Project snapshot',
		};
		const primaryProject = await seedProject(db, owned, {
			token: tokenFor(`${namespace}:work-period-primary`),
			codePrefix: 'E2EWP',
			namePrefix: 'E2E Work Period Primary',
			member: employee,
			additionalTeam: [managerTeam],
			scheduleRows: [baselineSchedule],
			startMonth: '2024-01',
		});
		const secondaryProject = await seedProject(db, owned, {
			token: tokenFor(`${namespace}:work-period-secondary`),
			codePrefix: 'E2EWL',
			namePrefix: 'E2E Work Period Legacy',
			member: employee,
			additionalTeam: [managerTeam],
			scheduleRows: [baselineSchedule],
			startMonth: '2024-01',
		});

		const disciplineId = randomUUID();
		const disciplineName = fitIdentifier(
			`${namespace} Work Period Discipline`,
			100
		);
		await db.execute(
			`INSERT INTO functions_master (id, function_name, status, description)
			 VALUES (?, ?, 'active', ?)`,
			[disciplineId, disciplineName, 'Owned Work Period e2e discipline']
		);
		owned.disciplineIds.push(disciplineId);

		const primary = await seedWorkPeriodActivity(db, owned, {
			employee,
			project: primaryProject,
			disciplineId,
			disciplineName,
			entries: [],
		});
		const legacy: ExpectedTimeEntry = {
			day: 1,
			date: '2024-07-01',
			hours: 1.25,
			clock: '01:15',
		};
		const secondary = await seedWorkPeriodActivity(db, owned, {
			employee,
			project: secondaryProject,
			disciplineId,
			disciplineName,
			entries: [legacy],
		});

		let disposed = false;
		return {
			namespace,
			login: {
				userId: login.userId,
				username: login.username,
				password: login.password,
			},
			manager: {
				userId: manager.userId,
				username: manager.username,
				password: manager.password,
			},
			employee,
			discipline: { id: disciplineId, name: disciplineName },
			primary,
			secondary,
			legacy,
			self: {
				date: selfDate,
				day: Number(selfDate.slice(8, 10)),
				month: selfDate.slice(0, 7),
				weekStart: selfWeekStart,
				start: `${selfDate}T${selfStart}`,
				end: `${selfDate}T${selfEnd}`,
				clock: selfDurationSeconds === 5_400 ? '01:30' : '00:15',
				totalClock: selfDurationSeconds === 5_400 ? '1:30:00' : '0:15:00',
				dateCompleted: selfDate,
				remarks: selfRemarks,
			},
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				await cleanupOwned(db, owned);
			},
		};
	} catch (error) {
		await cleanupAfterFailedSeed(db, owned, error);
		throw error;
	}
}

interface WorkPeriodRow extends RowDataPacket {
	id: string;
	assignment_id: string;
	employee_id: number | string;
	start_ms: number | string;
	end_ms: number | string;
	quantity: number | string;
	date_completed: string | Date;
	remarks: string | null;
}

interface WorkPeriodProjectionRow extends RowDataPacket {
	work_period_entries: unknown;
}

/** Independent committed-state readback; never derives browser expectations. */
export async function readWorkPeriods(
	db: Connection,
	input: { employeeId: number; assignmentId?: string }
): Promise<PersistedWorkPeriod[]> {
	const params: (number | string)[] = [input.employeeId];
	let assignmentClause = '';
	if (input.assignmentId !== undefined) {
		assignmentClause = ' AND assignment_id = ?';
		params.push(input.assignmentId);
	}
	const [rows] = await db.execute<WorkPeriodRow[]>(
		`SELECT id, assignment_id, employee_id, start_ms, end_ms, quantity,
		        date_completed, remarks
		   FROM work_periods
		  WHERE employee_id = ?${assignmentClause}
		  ORDER BY start_ms, id`,
		params
	);
	return rows.map((row) => ({
		id: String(row.id),
		assignmentId: String(row.assignment_id),
		employeeId: Number(row.employee_id),
		startMs: Number(row.start_ms),
		endMs: Number(row.end_ms),
		quantity: Number(row.quantity),
		dateCompleted: dateOnly(row.date_completed),
		remarks: String(row.remarks ?? ''),
	}));
}

/** Read the assignment projection so a stale Project save cannot erase it. */
export async function readWorkPeriodProjection(
	db: Connection,
	assignmentId: string
): Promise<unknown> {
	const [rows] = await db.execute<WorkPeriodProjectionRow[]>(
		`SELECT work_period_entries FROM user_activity_assignments WHERE id = ?`,
		[assignmentId]
	);
	return rows[0] ? parseJsonValue(rows[0].work_period_entries) : null;
}

/* ── independent persisted readback ────────────────────────────────── */

/**
 * Read the login-to-Employee link, the Project team list and the seeded
 * assignment with a tolerant JSON decode (MariaDB may return a JSON column
 * already parsed). This does not derive any expected browser value from the
 * database; it only proves the starting state that the test authored.
 */
export async function readEmployeeTimeState(
	db: Connection,
	input: { userId: number; projectId: number; assignmentId: string }
): Promise<PersistedEmployeeTimeState> {
	const [linkRows] = await db.execute<LinkRow[]>(
		`SELECT employee_id FROM users WHERE id = ? AND isDelete = 0`,
		[input.userId]
	);
	const [projectRows] = await db.execute<ProjectTeamRow[]>(
		`SELECT project_team FROM projects WHERE project_id = ? AND isDelete = 0`,
		[input.projectId]
	);
	const [assignmentRows] = await db.execute<AssignmentRow[]>(
		`SELECT id, user_id, employee_id, project_id, activity_name, daily_entries
       FROM user_activity_assignments
      WHERE id = ? AND user_id = ? AND project_id = ?`,
		[input.assignmentId, input.userId, input.projectId]
	);
	const assignmentRow = assignmentRows[0];
	const dailyEntries = assignmentRow
		? normalizeDailyEntries(assignmentRow.daily_entries)
		: [];

	return {
		linkedEmployeeId: nullableNumber(linkRows[0]?.employee_id),
		membershipUserIds: projectRows[0]
			? membershipUserIds(projectRows[0].project_team)
			: [],
		assignment: assignmentRow
			? {
					id: String(assignmentRow.id),
					userId: Number(assignmentRow.user_id),
					employeeId: nullableNumber(assignmentRow.employee_id),
					projectId: nullableNumber(assignmentRow.project_id),
					activityName: String(assignmentRow.activity_name),
					dailyEntries,
					totalHours: round2(
						dailyEntries.reduce((sum, entry) => sum + entry.hours, 0)
					),
				}
			: null,
	};
}

/* ── seed internals ────────────────────────────────────────────────── */

async function seedLinkedEmployee(
	db: Connection,
	owned: OwnedRows,
	identityKey: string,
	login: JourneyUser,
	label: string
): Promise<FixtureEmployee> {
	const token = tokenFor(identityKey);
	const code = fitIdentifier(`E2ETM${token}`, 20);
	const name = `${label} ${token}`;
	const email = `e2etime-${token.toLowerCase()}@e2e.invalid`;
	const [firstName, ...lastNameParts] = name.split(' ');
	const lastName = lastNameParts.join(' ');

	const employeeId = await insertEmployeeRow(db, {
		code,
		firstName,
		lastName,
		email,
	});
	owned.employeeIds.push(employeeId);

	const [result] = await db.execute<ResultSetHeader>(
		`UPDATE users
        SET employee_id = ?
      WHERE id = ? AND isDelete = 0 AND username = ?`,
		[employeeId, login.userId, login.username]
	);
	if (Number(result.affectedRows) !== 1) {
		throw new Error(
			`[employee-time] failed to link ${login.username} to Employee ${employeeId}`
		);
	}

	return {
		id: employeeId,
		code,
		name,
		email,
		linkedUserId: login.userId,
	};
}

async function insertEmployeeRow(
	db: Connection,
	input: {
		code: string;
		firstName: string;
		lastName: string;
		email: string;
	}
): Promise<number> {
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO employees (
        employee_id, first_name, last_name, email, department, position,
        designation, status, employee_type, isDelete
      ) VALUES (?, ?, ?, ?, 'E2E Time', 'Timekeeper',
                'Timekeeper', 'active', 'Permanent', 0)`,
		[input.code, input.firstName, input.lastName, input.email]
	);
	const employeeId = Number(result.insertId);
	if (!Number.isInteger(employeeId) || employeeId <= 0) {
		throw new Error('[employee-time] the Employee fixture was not inserted');
	}
	return employeeId;
}

async function seedProject(
	db: Connection,
	owned: OwnedRows,
	input: {
		token: string;
		codePrefix: string;
		namePrefix: string;
		member: FixtureEmployee;
		startMonth: string;
		additionalTeam?: readonly Record<string, unknown>[];
		scheduleRows?: readonly Record<string, unknown>[];
	}
): Promise<FixtureProject> {
	const code = fitIdentifier(`${input.codePrefix}-${input.token}`, 100);
	const name = `${input.namePrefix} ${input.token}`;
	const activityName = `Logged hours ${input.token}`;
	const projectTeam = JSON.stringify([
		{
			user_id: input.member.linkedUserId,
			id: input.member.linkedUserId,
			name: input.member.name,
			email: input.member.email,
			role: 'Team Member',
		},
		...(input.additionalTeam ?? []),
	]);
	const schedule = input.scheduleRows
		? JSON.stringify({ locked: false, rows: input.scheduleRows })
		: null;

	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO projects (
        project_title, name, project_code, status, start_date,
        project_team, project_schedule_list, isDelete
      ) VALUES (?, ?, ?, 'ONGOING', ?, ?, ?, 0)`,
		[name, name, code, `${input.startMonth}-01`, projectTeam, schedule]
	);
	const projectId = Number(result.insertId);
	if (!Number.isInteger(projectId) || projectId <= 0) {
		throw new Error('[employee-time] the Project fixture was not inserted');
	}
	owned.projectIds.push(projectId);

	return { id: projectId, code, name, activityName };
}

async function seedAssignment(
	db: Connection,
	owned: OwnedRows,
	input: {
		employee: FixtureEmployee;
		project: FixtureProject;
		entries: readonly ExpectedTimeEntry[];
		disciplineId?: string;
		disciplineName?: string;
		activityId?: string;
	}
): Promise<string> {
	const assignmentId = randomUUID();
	const entries = input.entries.map(({ date, hours }) => ({ date, hours }));
	const totalHours = round2(
		entries.reduce((sum, entry) => sum + entry.hours, 0)
	);
	const firstDate = entries[0]?.date ?? null;

	await db.execute(
		`INSERT INTO user_activity_assignments (
        id, user_id, employee_id, project_id, activity_id, activity_name,
        discipline_id, discipline_name, assigned_by, status, estimated_hours,
        actual_hours, qty_assigned, qty_completed, start_date, daily_entries,
        description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress', 10, ?,
                10, 4, ?, ?, ?)`,
		[
			assignmentId,
			input.employee.linkedUserId,
			input.employee.id,
			input.project.id,
			input.activityId ?? null,
			input.project.activityName,
			input.disciplineId ?? null,
			input.disciplineName ?? 'E2E Time',
			input.employee.linkedUserId,
			totalHours,
			firstDate,
			JSON.stringify(entries),
			`Seeded logged hours for ${input.project.code}`,
		]
	);
	owned.assignmentIds.push(assignmentId);
	return assignmentId;
}

async function seedWorkPeriodActivity(
	db: Connection,
	owned: OwnedRows,
	input: {
		employee: FixtureEmployee;
		project: FixtureProject;
		disciplineId: string;
		disciplineName: string;
		entries: readonly ExpectedTimeEntry[];
	}
): Promise<WorkPeriodActivity> {
	const activityId = randomUUID();
	await db.execute(
		`INSERT INTO activities_master (
        id, function_id, activity_name, default_manhours
      ) VALUES (?, ?, ?, 0)`,
		[activityId, input.disciplineId, input.project.activityName]
	);
	owned.activityIds.push(activityId);
	const assignmentId = await seedAssignment(db, owned, {
		employee: input.employee,
		project: input.project,
		entries: input.entries,
		disciplineId: input.disciplineId,
		disciplineName: input.disciplineName,
		activityId,
	});
	return {
		id: activityId,
		name: input.project.activityName,
		assignmentId,
		project: input.project,
	};
}

/* ── cleanup ───────────────────────────────────────────────────────── */

async function cleanupAfterFailedSeed(
	db: Connection,
	owned: OwnedRows,
	error: unknown
): Promise<void> {
	try {
		await cleanupOwned(db, owned);
	} catch (cleanupError) {
		const original = error instanceof Error ? error.message : String(error);
		const cleanup =
			cleanupError instanceof Error
				? cleanupError.message
				: String(cleanupError);
		throw new Error(
			`${original}; employee-time fixture cleanup also failed: ${cleanup}`
		);
	}
}

async function cleanupOwned(db: Connection, owned: OwnedRows): Promise<void> {
	await deleteByValues(
		db,
		'work_periods',
		'assignment_id',
		owned.assignmentIds
	);
	await deleteByValues(
		db,
		'user_activity_assignments',
		'id',
		owned.assignmentIds
	);
	await deleteByValues(db, 'projects', 'project_id', owned.projectIds);
	await deleteByValues(db, 'activities_master', 'id', owned.activityIds);
	await deleteByValues(db, 'functions_master', 'id', owned.disciplineIds);

	if (owned.userIds.length > 0) {
		const slots = owned.userIds.map(() => '?').join(', ');
		// Keep the Employee row deletable even if a future FK is added to the
		// login link; the owned login rows are removed by their disposers.
		await db.execute(
			`UPDATE users SET employee_id = NULL
        WHERE id IN (${slots})`,
			owned.userIds
		);
	}
	await deleteByValues(
		db,
		'employee_attendance',
		'employee_id',
		owned.employeeIds
	);
	await deleteByValues(
		db,
		'employee_attendance_summary',
		'employee_id',
		owned.employeeIds
	);
	await deleteByValues(db, 'employees', 'id', owned.employeeIds);

	let firstDisposeError: unknown = null;
	for (const identity of owned.identities) {
		try {
			await identity.dispose();
		} catch (error) {
			firstDisposeError ??= error;
		}
	}
	if (firstDisposeError) throw firstDisposeError;
}

async function deleteByValues(
	db: Connection,
	table: string,
	column: string,
	values: readonly (string | number)[]
): Promise<void> {
	const unique = [...new Set(values)];
	if (unique.length === 0) return;
	const slots = unique.map(() => '?').join(', ');
	await db.execute(
		`DELETE FROM ${table} WHERE ${column} IN (${slots})`,
		unique
	);
}

/* ── data-source readback helpers ──────────────────────────────────── */

interface LinkRow extends RowDataPacket {
	employee_id: number | string | null;
}

interface ProjectTeamRow extends RowDataPacket {
	project_team: unknown;
}

interface AssignmentRow extends RowDataPacket {
	id: string;
	user_id: number | string;
	employee_id: number | string | null;
	project_id: number | string | null;
	activity_name: string;
	daily_entries: unknown;
}

function normalizeDailyEntries(value: unknown): PersistedDailyEntry[] {
	const parsed = parseJsonValue(value);
	if (!Array.isArray(parsed)) return [];

	const entries: PersistedDailyEntry[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		if (typeof record.date !== 'string') continue;
		const day = record.date.slice(0, 10);
		const hours = Number(record.hours);
		if (!day || !Number.isFinite(hours) || hours <= 0) continue;
		entries.push({ date: day, hours });
	}
	return entries;
}

function membershipUserIds(value: unknown): number[] {
	const parsed = parseJsonValue(value);
	if (!Array.isArray(parsed)) return [];

	const ids = new Set<number>();
	for (const item of parsed) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		for (const key of ['user_id', 'id']) {
			const id = Number(record[key]);
			if (Number.isInteger(id) && id > 0) ids.add(id);
		}
	}
	return [...ids].sort((a, b) => a - b);
}

function parseJsonValue(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/* ── date and display helpers ──────────────────────────────────────── */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

function istDate(nowMs: number): string {
	return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftIstDate(date: string, days: number): string {
	const shifted = new Date(`${date}T00:00:00Z`);
	shifted.setUTCDate(shifted.getUTCDate() + days);
	return shifted.toISOString().slice(0, 10);
}

function weekStartFor(date: string): string {
	const anchor = new Date(`${date}T00:00:00Z`);
	const weekday = anchor.getUTCDay();
	return shiftIstDate(date, weekday === 0 ? -6 : 1 - weekday);
}

function dateOnly(value: string | Date): string {
	return value instanceof Date
		? value.toISOString().slice(0, 10)
		: value.slice(0, 10);
}

function relativeMonths(now = new Date()): {
	currentMonth: string;
	targetMonth: string;
} {
	const currentMonth = `${now.getFullYear()}-${String(
		now.getMonth() + 1
	).padStart(2, '0')}`;
	const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	return {
		currentMonth,
		targetMonth: `${previous.getFullYear()}-${String(
			previous.getMonth() + 1
		).padStart(2, '0')}`,
	};
}

function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

function buildLogMonth(
	month: string,
	spec: readonly { day: number; hours: number }[]
): ExpectedLogMonth {
	const entries = spec.map(({ day, hours }) => ({
		day,
		date: `${month}-${String(day).padStart(2, '0')}`,
		hours,
		clock: clockForHours(hours),
	}));
	const totalHours = round2(
		entries.reduce((sum, entry) => sum + entry.hours, 0)
	);
	return {
		month,
		label: monthLabel(month),
		entries,
		totalHours,
		totalClock: elapsedForHours(totalHours),
	};
}

function clockForHours(hours: number): string {
	const minutes = Math.round(hours * 60);
	const hh = Math.floor(minutes / 60);
	const mm = minutes % 60;
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function elapsedForHours(hours: number): string {
	const seconds = Math.round(hours * 3600);
	const hh = Math.floor(seconds / 3600);
	const mm = Math.floor((seconds % 3600) / 60);
	const ss = seconds % 60;
	return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isInteger(number) ? number : null;
}

function tokenFor(value: string): string {
	return createHash('sha256')
		.update(value)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase();
}
