/**
 * Disposable Leave workflow fixture for the applicant and approver browser
 * journeys.
 *
 * The fixture owns four things and tracks every primary key it creates:
 *
 * - an applicant identity whose custom role grants exactly `leaves:read` and
 *   `leaves:create`, linked to one namespaced Employee row;
 * - an approver identity whose custom role grants exactly `leaves:read` and
 *   `leaves:approve`;
 * - a 2031 Privilege Leave balance for the applicant (10 total, 3 used), so an
 *   approval has a real capped ledger row to update; and
 * - optionally one pending application seeded directly for an independent
 *   approve, reject or withdraw outcome.
 *
 * Fixed dates sit in December 2031, are Monday–Wednesday working days under
 * the shared Weekly Off rule, and are far enough apart that each journey reads
 * only its own row. The harness database starts from migrations only, so no
 * seeded holiday overlaps them; a holiday inserted later would change the
 * server-computed duration and the assertions would fail loudly rather than
 * silently baking in a different result.
 *
 * Cleanup deletes the fixture's applications (including rows created through
 * the UI), notifications addressed to the owned identities, attendance and
 * balance rows, both users, and the Employee row. The caller owns the fixture
 * and must call `cleanup()` in teardown; a partially seeded fixture cleans
 * itself before rethrowing.
 */
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

const APPLICANT_PERMISSIONS = ['leaves:read', 'leaves:create'] as const;
const APPROVER_PERMISSIONS = ['leaves:read', 'leaves:approve'] as const;

/** The leave type both the applicant form and seeded applications use. */
const LEAVE_TYPE_CODE = 'PL';
const LEAVE_BALANCE_YEAR = 2031;
const SEEDED_BALANCE = { total: 10, used: 3 } as const;

/** A two-working-day range the applicant authors through the real form. */
export const SUBMITTED_LEAVE = {
	startDate: '2031-12-01',
	endDate: '2031-12-02',
	reasonPrefix: 'E2E applicant submits two working days',
} as const;

export type SeededLeaveOutcome = 'approve' | 'reject' | 'withdraw';

interface SeededLeaveDefinition {
	startDate: string;
	endDate: string;
	durationDays: number;
	reasonPrefix: string;
}

const SEEDED_LEAVES: Record<SeededLeaveOutcome, SeededLeaveDefinition> = {
	approve: {
		startDate: '2031-12-08',
		endDate: '2031-12-08',
		durationDays: 1,
		reasonPrefix: 'E2E approval pending request',
	},
	reject: {
		startDate: '2031-12-09',
		endDate: '2031-12-09',
		durationDays: 1,
		reasonPrefix: 'E2E rejection pending request',
	},
	withdraw: {
		startDate: '2031-12-10',
		endDate: '2031-12-10',
		durationDays: 1,
		reasonPrefix: 'E2E withdrawal pending request',
	},
};

export interface LeaveWorkflowApplicant extends JourneyUser {
	/** `employees.id`; the approval side-effects write attendance here. */
	employeeId: number;
}

export interface LeaveWorkflowLeaveType {
	id: number;
	name: string;
	code: string;
}

export interface LeaveWorkflowApplication {
	id: number;
	startDate: string;
	endDate: string;
	reason: string;
}

export interface LeaveWorkflowFixture {
	namespace: string;
	applicant: LeaveWorkflowApplicant;
	approver: JourneyUser;
	leaveType: LeaveWorkflowLeaveType;
	seededApplication: LeaveWorkflowApplication | null;
	/** The seeded 2031 ledger row before any approval. */
	balance: { year: number; total: number; used: number; remaining: number };
	/** Delete every owned row. Safe to call more than once. */
	cleanup(): Promise<void>;
}

export interface StoredLeaveApplication {
	id: number;
	userId: number;
	leaveTypeId: number;
	startDate: string;
	endDate: string;
	halfDay: boolean;
	durationDays: number;
	reason: string | null;
	status: string;
	reviewedBy: number | null;
	reviewedAt: string | null;
	reviewNotes: string | null;
	/** Parsed `written_attendance` audit JSON, or null when absent. */
	writtenAttendance: unknown;
	isDelete: number;
}

export interface StoredLeaveAttendance {
	id: number;
	employeeId: number;
	date: string;
	status: string | null;
	remarks: string | null;
	approvedBy: number | null;
}

export interface StoredLeaveBalance {
	total: number;
	used: number;
}

interface LeaveTypeRow extends RowDataPacket {
	id: number;
	name: string;
	code: string;
}

interface LeaveApplicationRow extends RowDataPacket {
	id: number;
	user_id: number;
	leave_type_id: number;
	start_date: string | Date;
	end_date: string | Date;
	half_day: number | boolean;
	duration_days: string | number;
	reason: string | null;
	status: string;
	reviewed_by: number | null;
	reviewed_at: string | Date | null;
	review_notes: string | null;
	written_attendance: unknown;
	isDelete: number | boolean;
}

interface AttendanceRow extends RowDataPacket {
	id: number;
	employee_id: number;
	attendance_date: string | Date;
	status: string | null;
	remarks: string | null;
	approved_by: number | null;
}

interface BalanceRow extends RowDataPacket {
	total_leaves: string | number;
	used_leaves: string | number;
}

interface OwnedFixture {
	applicant: JourneyUser | null;
	approver: JourneyUser | null;
	employeeId: number | null;
}

/**
 * Seed one isolated applicant/approver pair and, when requested, one pending
 * application. The caller must clean up in a `finally` block.
 */
export async function seedLeaveWorkflowFixture(
	connection: Connection,
	namespace: string,
	seededOutcome?: SeededLeaveOutcome
): Promise<LeaveWorkflowFixture> {
	const fixtureNamespace = namespace.trim();
	if (!fixtureNamespace) {
		throw new Error('[leave-workflows] namespace must not be empty.');
	}

	const owned: OwnedFixture = {
		applicant: null,
		approver: null,
		employeeId: null,
	};

	try {
		const applicant = await createJourneyUser(
			connection,
			`${fixtureNamespace}-applicant`,
			APPLICANT_PERMISSIONS
		);
		owned.applicant = applicant;

		const approver = await createJourneyUser(
			connection,
			`${fixtureNamespace}-approver`,
			APPROVER_PERMISSIONS
		);
		owned.approver = approver;

		const employeeCode = fitIdentifier(`LV-${fixtureNamespace}`, 20);
		const employeeId = await insertRow(
			connection,
			`INSERT INTO employees (
          employee_id, first_name, last_name, email, department, position,
          employee_type, status, isDelete
        ) VALUES (?, 'E2E', ?, ?, 'E2E Leave', 'E2E Leave Applicant',
                  'Contract', 'active', 0)`,
			[
				employeeCode,
				fitIdentifier(`Leave ${fixtureNamespace}`, 50),
				`${fitIdentifier(
					`${fixtureNamespace}-employee`,
					80
				).toLowerCase()}@e2e.invalid`,
			]
		);
		owned.employeeId = employeeId;

		const [linkResult] = await connection.execute<ResultSetHeader>(
			'UPDATE users SET employee_id = ? WHERE id = ?',
			[employeeId, applicant.userId]
		);
		if (linkResult.affectedRows !== 1) {
			throw new Error(
				'[leave-workflows] applicant employee link was not stored.'
			);
		}

		const leaveType = await readLeaveType(connection);
		await connection.execute(
			`INSERT INTO employee_leaves (
          employee_id, leave_type_id, year, total_leaves, used_leaves
        ) VALUES (?, ?, ?, ?, ?)`,
			[
				employeeId,
				leaveType.id,
				LEAVE_BALANCE_YEAR,
				SEEDED_BALANCE.total,
				SEEDED_BALANCE.used,
			]
		);

		let seededApplication: LeaveWorkflowApplication | null = null;
		if (seededOutcome !== undefined) {
			const definition = SEEDED_LEAVES[seededOutcome];
			const reason = `${definition.reasonPrefix} ${fixtureNamespace}`;
			const id = await insertRow(
				connection,
				`INSERT INTO leave_applications (
            user_id, leave_type_id, start_date, end_date, half_day,
            duration_days, reason, status
          ) VALUES (?, ?, ?, ?, 0, ?, ?, 'pending')`,
				[
					applicant.userId,
					leaveType.id,
					definition.startDate,
					definition.endDate,
					definition.durationDays,
					reason,
				]
			);
			seededApplication = {
				id,
				startDate: definition.startDate,
				endDate: definition.endDate,
				reason,
			};
		}

		let cleaned = false;
		return {
			namespace: fixtureNamespace,
			applicant: {
				userId: applicant.userId,
				username: applicant.username,
				password: applicant.password,
				dispose: applicant.dispose,
				employeeId,
			},
			approver,
			leaveType,
			seededApplication,
			balance: {
				year: LEAVE_BALANCE_YEAR,
				total: SEEDED_BALANCE.total,
				used: SEEDED_BALANCE.used,
				remaining: SEEDED_BALANCE.total - SEEDED_BALANCE.used,
			},
			async cleanup(): Promise<void> {
				if (cleaned) return;
				cleaned = true;
				await cleanupOwned(connection, owned);
			},
		};
	} catch (error) {
		try {
			await cleanupOwned(connection, owned);
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; leave-workflows fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

/**
 * Read one application by its owned primary key through the caller's
 * independent connection. Deleted rows are included so withdrawal is visible.
 */
export async function readLeaveApplicationById(
	connection: Connection,
	id: number
): Promise<StoredLeaveApplication | null> {
	const rows = await queryRows<LeaveApplicationRow>(
		connection,
		`${LEAVE_APPLICATION_SELECT}
        WHERE la.id = ?
        LIMIT 1`,
		[id]
	);
	return rows[0] ? mapLeaveApplication(rows[0]) : null;
}

/**
 * Read the newest active application for one owned applicant and reason. This
 * finds a form-created row without trusting its redirect or toast.
 */
export async function readLeaveApplicationByReason(
	connection: Connection,
	userId: number,
	reason: string
): Promise<StoredLeaveApplication | null> {
	const rows = await queryRows<LeaveApplicationRow>(
		connection,
		`${LEAVE_APPLICATION_SELECT}
        WHERE la.user_id = ? AND la.reason = ? AND la.isDelete = 0
        ORDER BY la.id DESC
        LIMIT 1`,
		[userId, reason]
	);
	return rows[0] ? mapLeaveApplication(rows[0]) : null;
}

/** Every application row owned by one applicant, including withdrawn rows. */
export async function readLeaveApplicationsForUser(
	connection: Connection,
	userId: number
): Promise<StoredLeaveApplication[]> {
	const rows = await queryRows<LeaveApplicationRow>(
		connection,
		`${LEAVE_APPLICATION_SELECT}
        WHERE la.user_id = ?
        ORDER BY la.id`,
		[userId]
	);
	return rows.map(mapLeaveApplication);
}

/** Attendance rows written into one employee's calendar by an approval. */
export async function readLeaveAttendanceForRange(
	connection: Connection,
	employeeId: number,
	startDate: string,
	endDate: string
): Promise<StoredLeaveAttendance[]> {
	const rows = await queryRows<AttendanceRow>(
		connection,
		`SELECT id, employee_id, attendance_date, status, remarks, approved_by
       FROM employee_attendance
      WHERE employee_id = ? AND attendance_date BETWEEN ? AND ?
      ORDER BY attendance_date`,
		[employeeId, startDate, endDate]
	);
	return rows.map((row) => ({
		id: Number(row.id),
		employeeId: Number(row.employee_id),
		date: dateOnly(row.attendance_date) ?? '',
		status: row.status === null ? null : String(row.status),
		remarks: row.remarks === null ? null : String(row.remarks),
		approvedBy: row.approved_by === null ? null : Number(row.approved_by),
	}));
}

/** The seeded ledger row after an approval may have incremented `used`. */
export async function readLeaveBalance(
	connection: Connection,
	employeeId: number,
	leaveTypeId: number,
	year: number
): Promise<StoredLeaveBalance | null> {
	const rows = await queryRows<BalanceRow>(
		connection,
		`SELECT total_leaves, used_leaves
       FROM employee_leaves
      WHERE employee_id = ? AND leave_type_id = ? AND year = ?
      LIMIT 1`,
		[employeeId, leaveTypeId, year]
	);
	const row = rows[0];
	if (!row) return null;
	return {
		total: Number(row.total_leaves),
		used: Number(row.used_leaves),
	};
}

/* ── seed internals ────────────────────────────────────────────────── */

async function readLeaveType(
	connection: Connection
): Promise<LeaveWorkflowLeaveType> {
	const rows = await queryRows<LeaveTypeRow>(
		connection,
		`SELECT id, name, code
       FROM leave_types
      WHERE code = ? AND isDelete = 0
      LIMIT 1`,
		[LEAVE_TYPE_CODE]
	);
	const row = rows[0];
	if (!row) {
		throw new Error(
			`[leave-workflows] leave type ${LEAVE_TYPE_CODE} is not seeded.`
		);
	}
	return { id: Number(row.id), name: String(row.name), code: String(row.code) };
}

async function cleanupOwned(
	connection: Connection,
	owned: OwnedFixture
): Promise<void> {
	const userIds = [owned.applicant?.userId, owned.approver?.userId].filter(
		(id): id is number => typeof id === 'number'
	);
	if (userIds.length > 0) {
		const placeholders = userIds.map(() => '?').join(', ');
		await connection.execute(
			`DELETE FROM leave_applications WHERE user_id IN (${placeholders})`,
			userIds
		);
		await connection.execute(
			`DELETE FROM notifications WHERE user_id IN (${placeholders})`,
			userIds
		);
	}
	if (owned.employeeId !== null) {
		await connection.execute(
			'DELETE FROM employee_attendance WHERE employee_id = ?',
			[owned.employeeId]
		);
		await connection.execute(
			'DELETE FROM employee_leaves WHERE employee_id = ?',
			[owned.employeeId]
		);
	}

	if (owned.applicant !== null) await owned.applicant.dispose();
	if (owned.approver !== null) await owned.approver.dispose();

	if (owned.employeeId !== null) {
		await connection.execute('DELETE FROM employees WHERE id = ?', [
			owned.employeeId,
		]);
	}
}

/* ── read mapping ──────────────────────────────────────────────────── */

const LEAVE_APPLICATION_SELECT = `SELECT la.id, la.user_id, la.leave_type_id,
        la.start_date, la.end_date, la.half_day, la.duration_days,
        la.reason, la.status, la.reviewed_by, la.reviewed_at,
        la.review_notes, la.written_attendance, la.isDelete
   FROM leave_applications la`;

function mapLeaveApplication(row: LeaveApplicationRow): StoredLeaveApplication {
	return {
		id: Number(row.id),
		userId: Number(row.user_id),
		leaveTypeId: Number(row.leave_type_id),
		startDate: dateOnly(row.start_date) ?? '',
		endDate: dateOnly(row.end_date) ?? '',
		halfDay: Number(row.half_day) === 1,
		durationDays: Number(row.duration_days),
		reason: row.reason === null ? null : String(row.reason),
		status: String(row.status),
		reviewedBy: row.reviewed_by === null ? null : Number(row.reviewed_by),
		reviewedAt: dateTimeText(row.reviewed_at),
		reviewNotes: row.review_notes === null ? null : String(row.review_notes),
		writtenAttendance: parseJsonColumn(row.written_attendance),
		isDelete: Number(row.isDelete) === 1 ? 1 : 0,
	};
}

function parseJsonColumn(value: unknown): unknown {
	// MariaDB may hand JSON/LONGTEXT columns back as text or already parsed;
	// never call JSON.parse on a non-string.
	if (typeof value !== 'string') return value ?? null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

function dateOnly(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	const text = String(value);
	return text.length >= 10 ? text.slice(0, 10) : text;
}

function dateTimeText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) {
		return value.toISOString().slice(0, 19).replace('T', ' ');
	}
	return String(value);
}

/* ── small helpers ─────────────────────────────────────────────────── */

async function queryRows<T extends RowDataPacket>(
	connection: Connection,
	sql: string,
	params: ExecuteValues[] = []
): Promise<T[]> {
	const [rows] = await connection.execute<T[]>(sql, params);
	return rows;
}

async function insertRow(
	connection: Connection,
	sql: string,
	params: ExecuteValues[]
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(sql, params);
	return Number(result.insertId);
}
