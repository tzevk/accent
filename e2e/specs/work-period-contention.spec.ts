/**
 * Issue #468 — authenticated Work Period contention on the owned MariaDB.
 *
 * The HTTP requests use real /api/login sessions. The race is coordinated by
 * an independently owned InnoDB Employee row lock and observed lock waits, not
 * by sleeps or by hoping two promises overlap.
 */
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { expect, test } from '../support/test.ts';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { connectFixtureReader } from '../support/runtime.ts';
import {
	AUTHORED_OVERNIGHT_PERIOD,
	readWorkPeriodProjection,
	readWorkPeriods,
	readWorkPeriodAssignmentIdentity,
	seedEmployeeWorkPeriodFixture,
	type EmployeeWorkPeriodFixture,
	type TimeLogin,
} from '../fixtures/employee-time.ts';

const LOCK_WAIT_TIMEOUT_MS = 20_000;
const LOCK_WAIT_POLL_MS = 20;

test.setTimeout(180_000);

async function signIn(
	client: APIRequestContext,
	login: TimeLogin
): Promise<void> {
	const response = await client.post('/api/login', {
		data: { username: login.username, password: login.password },
	});
	expect(response.status()).toBe(200);
	expect((await response.json()).success).toBe(true);
}

async function expectMutation(response: APIResponse): Promise<string> {
	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	expect(body.affected_rows).toBe(1);
	const id: unknown = body.data.id;
	expect(typeof id).toBe('string');
	if (typeof id !== 'string') {
		throw new Error('[work-period-contention] mutation returned no id');
	}
	return id;
}

function selfPayload(
	fixture: EmployeeWorkPeriodFixture,
	activity: EmployeeWorkPeriodFixture['primary'],
	start: string,
	end: string,
	quantity: number,
	remarks: string
) {
	return {
		projectId: activity.project.id,
		disciplineId: fixture.discipline.id,
		activityId: activity.id,
		subActivityId: null,
		start,
		end,
		quantity,
		dateCompleted: fixture.self.dateCompleted,
		remarks,
	};
}

const TRIGGER_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

async function installSaveMarkerFailure(
	db: Connection,
	fixture: EmployeeWorkPeriodFixture
): Promise<string> {
	const name = fitIdentifier(`WP468-${fixture.namespace}-marker`, 64);
	if (!TRIGGER_NAME_PATTERN.test(name)) {
		throw new Error(`[work-period-contention] unsafe trigger name ${name}`);
	}
	await db.query(`DROP TRIGGER IF EXISTS \`${name}\``);
	await db.query(
		`CREATE TRIGGER \`${name}\` BEFORE INSERT ON user_activity_logs
         FOR EACH ROW
         BEGIN
           IF NEW.user_id = ${fixture.login.userId}
              AND NEW.resource_type = 'project_activity_save' THEN
             SIGNAL SQLSTATE '45000'
               SET MESSAGE_TEXT = 'owned work-period marker rejection';
           END IF;
         END`
	);
	return name;
}

async function dropSaveMarkerFailure(
	db: Connection,
	name: string
): Promise<void> {
	if (TRIGGER_NAME_PATTERN.test(name)) {
		await db.query(`DROP TRIGGER IF EXISTS \`${name}\``);
	}
}

async function saveMarkerCount(
	db: Connection,
	userId: number
): Promise<number> {
	const [rows] = await db.execute<RowDataPacket[]>(
		`SELECT COUNT(*) AS count FROM user_activity_logs
		 WHERE user_id = ? AND resource_type = 'project_activity_save'`,
		[userId]
	);
	return Number(rows[0]?.count ?? 0);
}

function transactionBlocks(status: unknown): string[] {
	return String(status ?? '')
		.split('---TRANSACTION ')
		.slice(1);
}

function blockThreadId(block: string): number | null {
	const id = Number(/MariaDB thread id (\d+),/.exec(block)?.[1]);
	return Number.isInteger(id) && id > 0 ? id : null;
}

function holderLocksEmployee(status: unknown, threadId: number): boolean {
	const holder = transactionBlocks(status).find(
		(block) => blockThreadId(block) === threadId
	);
	return Boolean(holder && /RECORD LOCKS[\s\S]*`?employees`?/i.test(holder));
}

function employeeLockWaitThreads(status: unknown): number[] {
	const threads: number[] = [];
	for (const block of transactionBlocks(status)) {
		const threadId = blockThreadId(block);
		if (threadId === null) continue;
		if (!/(^|\n)LOCK WAIT\b/.test(block)) continue;
		if (!/\bFROM\s+`?employees`?\b/i.test(block)) continue;
		if (!/\bFOR\s+UPDATE\b/i.test(block)) continue;
		threads.push(threadId);
	}
	return threads;
}

async function waitForEmployeeLockWaits(
	observer: Connection,
	holderThreadId: number,
	expectedWaiters: number,
	label: string
): Promise<void> {
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
	for (;;) {
		const [rows] = await observer.query<RowDataPacket[]>(
			'SHOW ENGINE INNODB STATUS'
		);
		const status = rows[0]?.Status;
		if (holderLocksEmployee(status, holderThreadId)) {
			const waiters = employeeLockWaitThreads(status);
			if (waiters.length >= expectedWaiters) {
				console.log(
					`[work-period-contention] ${label}: holder ${holderThreadId}; Employee FOR UPDATE waiters ${waiters.join(', ')}`
				);
				return;
			}
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`[work-period-contention] ${label}: did not observe ${expectedWaiters} Employee lock wait(s)`
			);
		}
		const tick = Promise.withResolvers<void>();
		setTimeout(tick.resolve, LOCK_WAIT_POLL_MS);
		await tick.promise;
	}
}

function scheduleRows(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		return value.filter(
			(row): row is Record<string, unknown> =>
				Boolean(row) && typeof row === 'object'
		);
	}
	if (value && typeof value === 'object' && 'rows' in value) {
		const rows = value.rows;
		if (Array.isArray(rows)) return scheduleRows(rows);
	}
	return [];
}

test('concurrent cross-project overlap leaves exactly one persisted Work Period', async ({
	db,
	runtime,
	namespace,
	playwright,
}) => {
	const fixture = await seedEmployeeWorkPeriodFixture(db, namespace);
	const client = await playwright.request.newContext({
		baseURL: runtime.baseUrl,
	});
	let locker: Connection | null = null;
	let observer: Connection | null = null;
	const pending: Promise<APIResponse>[] = [];
	try {
		await signIn(client, fixture.login);
		locker = await connectFixtureReader(runtime);
		observer = await connectFixtureReader(runtime);
		await locker.beginTransaction();
		await locker.execute('SELECT id FROM employees WHERE id = ? FOR UPDATE', [
			fixture.employee.id,
		]);
		const [holderRows] = await locker.query<RowDataPacket[]>(
			'SELECT CONNECTION_ID() AS id'
		);
		const holderThreadId = Number(holderRows[0]?.id);
		expect(holderThreadId).toBeGreaterThan(0);

		const firstPayload = selfPayload(
			fixture,
			fixture.primary,
			`${fixture.self.date}T00:00`,
			`${fixture.self.date}T00:10`,
			2,
			`${fixture.namespace} first overlapping save`
		);
		const secondPayload = selfPayload(
			fixture,
			fixture.secondary,
			`${fixture.self.date}T00:05`,
			`${fixture.self.date}T00:15`,
			3,
			`${fixture.namespace} second overlapping save`
		);
		pending.push(client.post('/api/work-periods', { data: firstPayload }));
		await waitForEmployeeLockWaits(
			observer,
			holderThreadId,
			1,
			'first cross-project save'
		);
		pending.push(client.post('/api/work-periods', { data: secondPayload }));
		await waitForEmployeeLockWaits(
			observer,
			holderThreadId,
			2,
			'second cross-project save'
		);

		await locker.commit();
		locker.destroy();
		locker = null;
		const responses = await Promise.all(pending);
		const outcomes = await Promise.all(
			responses.map(async (response) => ({
				status: response.status(),
				body: await response.json(),
			}))
		);
		expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
			200, 409,
		]);
		const winner = outcomes.find(
			(outcome) => outcome.status === 200 && outcome.body.success === true
		);
		const loser = outcomes.find((outcome) => outcome.status === 409);
		if (!winner || !loser) {
			throw new Error(
				'[work-period-contention] expected one successful and one overlapping save'
			);
		}
		const winnerIndex = outcomes.indexOf(winner);
		expect(winner.body.affected_rows).toBe(1);
		expect(loser.body.code).toBe('WORK_PERIOD_OVERLAP');
		expect(String(loser.body.error)).toMatch(/overlap/i);

		const persisted = await readWorkPeriods(db, {
			employeeId: fixture.employee.id,
		});
		expect(persisted).toHaveLength(1);
		const expectedPayload = winnerIndex === 0 ? firstPayload : secondPayload;
		const expectedActivity =
			winnerIndex === 0 ? fixture.primary : fixture.secondary;
		expect(persisted[0]).toMatchObject({
			id: winner.body.data.id,
			assignmentId: expectedActivity.assignmentId,
			employeeId: fixture.employee.id,
			startMs: Date.parse(`${expectedPayload.start}:00+05:30`),
			endMs: Date.parse(`${expectedPayload.end}:00+05:30`),
			quantity: expectedPayload.quantity,
			dateCompleted: expectedPayload.dateCompleted,
			remarks: expectedPayload.remarks,
		});
	} finally {
		locker?.destroy();
		observer?.destroy();
		await Promise.allSettled(pending);
		await client.dispose();
		await fixture.dispose();
	}
});

test('manager correction is scoped and a stale unrelated Project save preserves self-service work', async ({
	db,
	runtime,
	namespace,
	playwright,
}) => {
	const fixture = await seedEmployeeWorkPeriodFixture(db, namespace);
	const managerClient = await playwright.request.newContext({
		baseURL: runtime.baseUrl,
	});
	const employeeClient = await playwright.request.newContext({
		baseURL: runtime.baseUrl,
	});
	try {
		await signIn(managerClient, fixture.manager);
		await signIn(employeeClient, fixture.login);

		const snapshotResponse = await managerClient.get(
			`/api/projects/${fixture.primary.project.id}`
		);
		expect(snapshotResponse.status()).toBe(200);
		const snapshot = await snapshotResponse.json();
		expect(snapshot.success).toBe(true);
		const staleSchedule: unknown = snapshot.data.project_schedule_list;
		const staleRows = scheduleRows(staleSchedule);

		const selfId = await expectMutation(
			await employeeClient.post('/api/work-periods', {
				data: selfPayload(
					fixture,
					fixture.primary,
					`${fixture.self.date}T00:00`,
					`${fixture.self.date}T00:05`,
					2.5,
					`${fixture.namespace} survives stale Project save`
				),
			})
		);
		const projectionBeforeStaleSave = await readWorkPeriodProjection(
			db,
			fixture.primary.assignmentId
		);

		const changedSchedule = {
			locked: false,
			rows: [
				...staleRows,
				{
					id: `${fixture.namespace}-newer-schedule-row`,
					sr_no: String(staleRows.length + 1),
					activity_description: 'Schedule changed after the stale read',
					legend: 'accent_activities',
					status_completed: 'Ongoing',
					remarks: 'Owned concurrent Project edit',
				},
			],
		};
		const changedResponse = await managerClient.put(
			`/api/projects/${fixture.primary.project.id}`,
			{
				data: {
					section: 'project_schedule',
					values: { project_schedule_list: changedSchedule },
				},
			}
		);
		expect(changedResponse.status()).toBe(200);
		expect((await changedResponse.json()).success).toBe(true);
		const staleResponse = await managerClient.put(
			`/api/projects/${fixture.primary.project.id}`,
			{
				data: {
					section: 'project_schedule',
					values: { project_schedule_list: staleSchedule },
				},
			}
		);
		expect(staleResponse.status()).toBe(200);
		expect((await staleResponse.json()).success).toBe(true);

		const preserved = await readWorkPeriods(db, {
			employeeId: fixture.employee.id,
		});
		expect(preserved).toHaveLength(1);
		expect(preserved[0]).toMatchObject({
			id: selfId,
			assignmentId: fixture.primary.assignmentId,
			quantity: 2.5,
			dateCompleted: fixture.self.dateCompleted,
			remarks: `${fixture.namespace} survives stale Project save`,
		});
		expect(
			await readWorkPeriodProjection(db, fixture.primary.assignmentId)
		).toEqual(projectionBeforeStaleSave);

		const olderId = await expectMutation(
			await managerClient.post('/api/work-periods', {
				data: {
					manager: true,
					projectId: fixture.primary.project.id,
					assignmentId: fixture.primary.assignmentId,
					...AUTHORED_OVERNIGHT_PERIOD,
				},
			})
		);
		const correctedFields = {
			start: AUTHORED_OVERNIGHT_PERIOD.start,
			end: '2024-07-01T02:00',
			quantity: 4,
			dateCompleted: '2024-07-01',
			remarks: `${fixture.namespace} manager correction`,
		};
		expectMutation(
			await managerClient.put('/api/work-periods', {
				data: {
					id: olderId,
					projectId: fixture.primary.project.id,
					manager: true,
					...correctedFields,
				},
			})
		);

		const denied = await employeeClient.put('/api/work-periods', {
			data: {
				id: olderId,
				projectId: fixture.primary.project.id,
				manager: true,
				...correctedFields,
				end: '2024-07-01T03:00',
				quantity: 9,
				remarks: `${fixture.namespace} denied correction`,
			},
		});
		expect(denied.status()).toBe(403);
		const deniedBody = await denied.json();
		expect(deniedBody.success).toBe(false);
		expect(deniedBody.code).toBe('PROJECT_ACCESS_DENIED');
		const afterDenied = await readWorkPeriods(db, {
			employeeId: fixture.employee.id,
		});
		expect(afterDenied).toHaveLength(2);
		expect(afterDenied.find((period) => period.id === olderId)).toMatchObject({
			assignmentId: fixture.primary.assignmentId,
			startMs: Date.parse(`${correctedFields.start}:00+05:30`),
			endMs: Date.parse(`${correctedFields.end}:00+05:30`),
			quantity: 4,
			dateCompleted: '2024-07-01',
			remarks: correctedFields.remarks,
		});
	} finally {
		await managerClient.dispose();
		await employeeClient.dispose();
		await fixture.dispose();
	}
});

test('self service creates a separate Project Activity identity for a catalog selection', async ({
	db,
	runtime,
	namespace,
	playwright,
}) => {
	const fixture = await seedEmployeeWorkPeriodFixture(db, namespace);
	const employeeClient = await playwright.request.newContext({
		baseURL: runtime.baseUrl,
	});
	const catalogActivityId = randomUUID();
	let createdAssignmentId: string | null = null;
	try {
		await db.execute(
			`INSERT INTO activities_master (id, function_id, activity_name, default_manhours)
			 VALUES (?, ?, ?, 0)`,
			[
				catalogActivityId,
				fixture.discipline.id,
				`${fixture.namespace} catalog identity`,
			]
		);
		await signIn(employeeClient, fixture.login);
		const remarks = `${fixture.namespace} separate catalog identity`;
		await expectMutation(
			await employeeClient.post('/api/work-periods', {
				data: selfPayload(
					fixture,
					{ ...fixture.primary, id: catalogActivityId },
					`${fixture.self.date}T00:00`,
					`${fixture.self.date}T00:05`,
					1,
					remarks
				),
			})
		);
		const saved = (
			await readWorkPeriods(db, { employeeId: fixture.employee.id })
		).find((period) => period.remarks === remarks);
		expect(saved).toBeDefined();
		createdAssignmentId = saved?.assignmentId ?? null;
		expect(createdAssignmentId).not.toBeNull();
		const identity = await readWorkPeriodAssignmentIdentity(
			db,
			createdAssignmentId as string
		);
		expect(identity.projectActivityId).not.toBe(catalogActivityId);
		expect(identity).toMatchObject({
			disciplineId: fixture.discipline.id,
			catalogActivityId,
			catalogSubActivityId: null,
		});
	} finally {
		if (!createdAssignmentId) {
			const [rows] = await db.execute<RowDataPacket[]>(
				'SELECT id FROM user_activity_assignments WHERE catalog_activity_id = ?',
				[catalogActivityId]
			);
			createdAssignmentId = rows[0]?.id ? String(rows[0].id) : null;
		}
		if (createdAssignmentId) {
			await db.execute('DELETE FROM work_periods WHERE assignment_id = ?', [
				createdAssignmentId,
			]);
			await db.execute('DELETE FROM user_activity_assignments WHERE id = ?', [
				createdAssignmentId,
			]);
		}
		await db.execute('DELETE FROM activities_master WHERE id = ?', [
			catalogActivityId,
		]);
		await employeeClient.dispose();
		await fixture.dispose();
	}
});

test('a rejected self-save marker rolls back the period and projection', async ({
	db,
	runtime,
	namespace,
	playwright,
}) => {
	const fixture = await seedEmployeeWorkPeriodFixture(db, namespace);
	const employeeClient = await playwright.request.newContext({
		baseURL: runtime.baseUrl,
	});
	let triggerName: string | null = null;
	try {
		await signIn(employeeClient, fixture.login);
		const periodsBefore = await readWorkPeriods(db, {
			employeeId: fixture.employee.id,
		});
		const projectionBefore = await readWorkPeriodProjection(
			db,
			fixture.primary.assignmentId
		);
		const markersBefore = await saveMarkerCount(db, fixture.login.userId);
		triggerName = await installSaveMarkerFailure(db, fixture);

		const response = await employeeClient.post('/api/work-periods', {
			data: selfPayload(
				fixture,
				fixture.primary,
				`${fixture.self.date}T00:00`,
				`${fixture.self.date}T00:05`,
				2.5,
				`${fixture.namespace} marker failure must roll back`
			),
		});

		expect(response.status()).toBe(500);
		expect(await response.json()).toMatchObject({
			success: false,
			error: 'Failed to save Work Period',
		});
		expect(
			await readWorkPeriods(db, { employeeId: fixture.employee.id })
		).toEqual(periodsBefore);
		expect(
			await readWorkPeriodProjection(db, fixture.primary.assignmentId)
		).toEqual(projectionBefore);
		expect(await saveMarkerCount(db, fixture.login.userId)).toBe(markersBefore);
	} finally {
		if (triggerName) await dropSaveMarkerFailure(db, triggerName);
		await employeeClient.dispose();
		await fixture.dispose();
	}
});
