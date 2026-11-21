/**
 * Disposable company-expenditure months for the Financial Close, Financial
 * Revision, settlement and workbook-evidence journeys.
 *
 * Each fixture creates one ordinary identity with exactly the read grants the
 * expenditure report needs — `reports:read`, `other_expenses:read`, and
 * `payroll:read` — plus `other_expenses:update` only when the journey also
 * closes, revises, or records cash. It then seeds one recognized operating
 * cost (Company Overhead) in a reserved historic month, so the month's close
 * review has confirmed cost and no blocker, and optionally its frozen close
 * snapshot and one recorded settlement.
 *
 * The month is a `YYYY-MM` value below the current month, reserved by the
 * calling spec. Rows are namespaced by `E2EFC-<token>`; cleanup tracks the
 * owned cost, its identity link and journal, any settlement rows and events,
 * revision headers, and the close snapshot by `close_uid`/actor. JSON columns
 * are read with a tolerant parser because mysql2 may return JSON/LONGTEXT
 * columns already parsed or as text.
 */
import { createHash } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { createJourneyUser } from './journey-user.ts';

export const FINANCIAL_CLOSE_MONTH = '2015-02';
export const FINANCIAL_REVISION_MONTH = '2015-04';
export const FINANCIAL_SETTLEMENT_MONTH = '2015-06';
export const FINANCIAL_EXPORT_MONTH = '2015-08';

/** Frozen close amounts and the single correction an operator records. */
export const CLOSE_COST = 12345.67;
export const REVISION_FROZEN_COST = 25000.5;
export const REVISION_CORRECTED_COST = 31000.75;
export const SETTLEMENT_COST = 20000;
export const SETTLEMENT_PAID = 5000;
export const EXPORT_COST = 34567.89;
export const EXPORT_SETTLEMENT = 12345.67;

const READ_PERMISSIONS = [
	'reports:read',
	'other_expenses:read',
	'payroll:read',
] as const;
const EXPENSE_PREFIX = 'E2EFC';
const CLOSE_UID_PREFIX = 'close-e2efc';
const SETTLEMENT_UID_PREFIX = 'settle-e2efc';

export interface SeedFinancialMonthOptions {
	/** Reserved historic month, `YYYY-MM`, below the current calendar month. */
	month: string;
	/** The recognized gross amount, in INR. */
	amount: number;
	/** Grant `other_expenses:update`, needed only by closing/revising/paying. */
	writeAccess: boolean;
	/** Seed an immutable closed snapshot instead of leaving the month open. */
	closed?: boolean;
	/** Seed one dated outward settlement against the recognized cost. */
	seededSettlement?: {
		amount: number;
		settledOn: string;
		reference: string;
		destination: string;
	};
}

export interface FinancialMonthFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	month: string;
	amount: number;
	expenseId: number;
	costUid: string;
	expenseNumber: string;
	/** Frozen snapshot UID when the fixture seeded a closed month. */
	closeUid: string | null;
	seededSettlementUid: string | null;
	/** Delete every owned row; safe to call more than once. */
	dispose(): Promise<void>;
}

export interface PersistedFinancialExpense {
	id: number;
	costUid: string;
	expenseNumber: string;
	state: string | null;
	classification: string | null;
	recognitionPeriod: string | null;
	recognizedAmount: number | null;
	totalAmount: number | null;
	taxAmount: number | null;
	currency: string | null;
	financialVersion: number;
	isDelete: number;
}

export interface PersistedFinancialClose {
	month: string;
	closeUid: string;
	financialVersion: number;
	/** Parsed snapshot JSON; the caller asserts the shape it relies on. */
	snapshot: unknown;
	reviewedBy: number | null;
	reviewReason: string | null;
	evidenceReference: string | null;
}

export interface PersistedFinancialRevision {
	revisionUid: string;
	month: string;
	closeUid: string;
	closeVersion: number;
	targetKind: string;
	targetUid: string;
	command: string;
	priorVersion: number;
	newVersion: number;
	/** Parsed figures JSON; the caller asserts the fields it relies on. */
	priorFigures: unknown;
	newFigures: unknown;
	reason: string | null;
	evidenceReference: string | null;
	actorUserId: number | null;
}

export interface PersistedFinancialSettlement {
	id: number;
	settlementUid: string;
	targetKind: string;
	targetCostUid: string | null;
	amount: number;
	currency: string;
	settledOn: string;
	reference: string | null;
	destination: string | null;
	status: string;
	financialVersion: number;
	createdBy: number | null;
}

export interface PersistedSettlementEvent {
	settlementUid: string;
	version: number;
	command: string;
	actorUserId: number | null;
}

interface IdRow extends RowDataPacket {
	id: number | string;
	cost_uid: string | null;
}

interface ExpenseRow extends RowDataPacket {
	id: number | string;
	cost_uid: string | null;
	expense_number: string | null;
	recognition_state: string | null;
	cost_classification: string | null;
	recognition_period: string | null;
	recognized_amount: string | number | null;
	total_amount: string | number | null;
	tax_amount: string | number | null;
	currency: string | null;
	financial_version: number | string | null;
	isDelete: number | string | null;
}

interface CloseRow extends RowDataPacket {
	month: string;
	close_uid: string;
	financial_version: number | string | null;
	snapshot: unknown;
	reviewed_by: number | string | null;
	review_reason: string | null;
	evidence_reference: string | null;
}

interface RevisionRow extends RowDataPacket {
	revision_uid: string;
	month: string;
	close_uid: string;
	close_version: number | string | null;
	target_kind: string;
	target_uid: string;
	command: string;
	prior_version: number | string | null;
	new_version: number | string | null;
	prior_snapshot: unknown;
	new_snapshot: unknown;
	reason: string | null;
	evidence_reference: string | null;
	actor_user_id: number | string | null;
}

interface SettlementRow extends RowDataPacket {
	id: number | string;
	settlement_uid: string;
	target_kind: string;
	target_cost_uid: string | null;
	amount: string | number;
	currency: string;
	settled_on: string | Date;
	reference: string | null;
	destination: string | null;
	status: string;
	financial_version: number | string | null;
	created_by: number | string | null;
}

interface SettlementEventRow extends RowDataPacket {
	settlement_uid: string;
	version: number | string;
	command: string;
	actor_user_id: number | string | null;
}

/**
 * Seed the identity and the month. The caller owns the fixture and must call
 * `dispose()` in a `finally` block.
 */
export async function seedFinancialMonth(
	db: Connection,
	namespace: string,
	options: SeedFinancialMonthOptions
): Promise<FinancialMonthFixture> {
	const month = options.month;
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
		throw new Error(`[financial-close] invalid fixture month ${month}`);
	}
	await clearStaleFixtureRows(db, month);

	const token = createHash('sha256')
		.update(`${namespace}:${month}`)
		.digest('hex')
		.slice(0, 10)
		.toUpperCase();
	const expenseNumber = `${EXPENSE_PREFIX}-${token}`;
	const costUid = `cost-${EXPENSE_PREFIX.toLowerCase()}-${token}`;
	const closeUid = options.closed ? `${CLOSE_UID_PREFIX}-${token}` : null;
	const settlementUid = options.seededSettlement
		? `${SETTLEMENT_UID_PREFIX}-${token}`
		: null;

	const permissions = options.writeAccess
		? [...READ_PERMISSIONS, 'other_expenses:update']
		: [...READ_PERMISSIONS];
	const identity = await createJourneyUser(
		db,
		`${namespace}-financial-close-${month}`,
		permissions
	);

	let expenseId: number | null = null;
	let seededSettlementId: number | null = null;
	try {
		const ownedExpenseId = await insertRecognizedCost(db, {
			month,
			amount: options.amount,
			expenseNumber,
			costUid,
			userId: identity.userId,
		});
		expenseId = ownedExpenseId;
		await db.execute(
			`INSERT INTO financial_cost_links
         (cost_uid, source_table, source_id, role, basis, review_state, created_by)
       VALUES (?, 'expenses', ?, 'cost', 'system', 'confirmed', ?)`,
			[costUid, String(ownedExpenseId), identity.userId]
		);
		if (closeUid !== null) {
			await db.execute(
				`INSERT INTO financial_close_snapshots
           (month, close_uid, financial_version, status, snapshot, reviewed_by,
            reviewed_at, review_reason, evidence_reference, created_by)
         VALUES (?, ?, 1, 'closed', ?, ?, NOW(), ?, ?, ?)`,
				[
					month,
					closeUid,
					JSON.stringify({
						month,
						company: {
							incurred_cost: options.amount,
							currency: 'INR',
							reporting_currency: 'INR',
							record_count: 1,
							currency_totals: [
								{
									currency: 'INR',
									incurred_cost: options.amount,
								},
							],
						},
						projects: [],
					}),
					identity.userId,
					`Seeded closed month ${month}`,
					`SEED-${token}`,
					identity.userId,
				]
			);
		}
		if (settlementUid !== null && options.seededSettlement) {
			seededSettlementId = await insertSettlement(db, {
				settlementUid,
				costUid,
				...options.seededSettlement,
				userId: identity.userId,
			});
		}

		let disposed = false;
		return {
			userId: identity.userId,
			username: identity.username,
			password: identity.password,
			month,
			amount: options.amount,
			expenseId,
			costUid,
			expenseNumber,
			closeUid,
			seededSettlementUid: settlementUid,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await removeFixtureRows(db, month, {
						expenseIds: [ownedExpenseId],
						costUids: [costUid],
						settlementIds:
							seededSettlementId === null ? [] : [seededSettlementId],
						closeUid,
						reviewedBy: identity.userId,
					});
				} finally {
					await identity.dispose();
				}
			},
		};
	} catch (error) {
		try {
			await removeFixtureRows(db, month, {
				expenseIds: expenseId === null ? [] : [expenseId],
				costUids: [costUid],
				settlementIds: seededSettlementId === null ? [] : [seededSettlementId],
				closeUid,
				reviewedBy: identity.userId,
			});
		} catch {
			// Preserve the seed failure; the disposable database is dropped.
		}
		await identity.dispose();
		throw error;
	}
}

async function insertRecognizedCost(
	db: Connection,
	input: {
		month: string;
		amount: number;
		expenseNumber: string;
		costUid: string;
		userId: number;
	}
): Promise<number> {
	const { month } = input;
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO expenses (
        expense_number, expense_date, category, sub_category, description,
        vendor_name, amount, tax_amount, total_amount, currency,
        payment_mode, paid_to, paid_by, is_billable, is_reimbursable,
        project_id, department, notes, status, created_by, isDelete,
        cost_uid, cost_classification, cost_nature, recognition_state,
        recognition_period, period_basis, service_period_start,
        service_period_end, tax_treatment, tax_evidence_reference,
        recognized_amount, source_reference, evidence_reference,
        financial_version, recognized_by, recognized_at,
        reporting_currency, converted_amount
      ) VALUES (?, ?, 'Direct Expense', 'E2E Financial Close', ?, ?,
        ?, 0, ?, 'INR', 'bank', ?, ?, 0, 0, NULL, 'E2E Financial Close',
        ?, 'approved', ?, 0, ?, 'company_overhead', 'operating',
        'recognized', ?, 'service_period', ?, ?, 'none', NULL, ?,
        ?, ?, 1, ?, NOW(), 'INR', ?)`,
		[
			input.expenseNumber,
			`${month}-15`,
			`E2E financial close fixture ${input.expenseNumber}`,
			'E2E Financial Close Vendor',
			input.amount,
			input.amount,
			input.expenseNumber,
			input.userId,
			`E2E financial close fixture ${input.expenseNumber}`,
			input.userId,
			input.costUid,
			`${month}-01`,
			`${month}-01`,
			`${month}-20`,
			input.amount,
			`E2E-SRC-${input.expenseNumber}`,
			`E2E-EVIDENCE-${input.expenseNumber}`,
			input.userId,
			input.amount,
		]
	);
	const id = Number(result.insertId);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error('[financial-close] the recognized cost was not inserted');
	}
	return id;
}

async function insertSettlement(
	db: Connection,
	input: {
		settlementUid: string;
		costUid: string;
		amount: number;
		settledOn: string;
		reference: string;
		destination: string;
		userId: number;
	}
): Promise<number> {
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO financial_settlements
       (settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
        movement_kind, amount, currency, settled_on, reference, destination,
        status, financial_version, created_by)
     VALUES (?, 'cost', ?, NULL, 'payment', ?, 'INR', ?, ?, ?,
        'recorded', 1, ?)`,
		[
			input.settlementUid,
			input.costUid,
			input.amount,
			input.settledOn,
			input.reference,
			input.destination,
			input.userId,
		]
	);
	const id = Number(result.insertId);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error('[financial-close] the seeded settlement was not inserted');
	}
	await db.execute(
		`INSERT INTO financial_settlement_events
       (settlement_uid, source_table, source_id, version, command,
        actor_user_id, reason, evidence_reference, snapshot)
     VALUES (?, 'financial_settlements', ?, 1, 'recorded', ?, NULL, NULL, ?)`,
		[
			input.settlementUid,
			id,
			input.userId,
			JSON.stringify({
				target_kind: 'cost',
				target_cost_uid: input.costUid,
				movement_kind: 'payment',
				amount: input.amount,
				currency: 'INR',
				settled_on: input.settledOn,
				reference: input.reference,
				destination: input.destination,
				status: 'recorded',
			}),
		]
	);
	await db.execute(
		`INSERT INTO financial_cost_links
       (cost_uid, source_table, source_id, role, basis, review_state,
        evidence_reference, created_by)
     VALUES (?, 'financial_settlements', ?, 'settlement', 'explicit',
        'confirmed', ?, ?)`,
		[input.costUid, String(id), input.reference, input.userId]
	);
	return id;
}

/** Read one owned cost for the independent persisted-state assertion. */
export async function readFinancialExpense(
	db: Connection,
	costUid: string
): Promise<PersistedFinancialExpense | null> {
	const [rows] = await db.execute<ExpenseRow[]>(
		`SELECT id, cost_uid, expense_number, recognition_state,
        cost_classification, recognition_period, recognized_amount,
        total_amount, tax_amount, currency, financial_version, isDelete
       FROM expenses
      WHERE cost_uid = ?`,
		[costUid]
	);
	const row = rows[0];
	if (!row) return null;
	return {
		id: Number(row.id),
		costUid: row.cost_uid ?? '',
		expenseNumber: row.expense_number ?? '',
		state: row.recognition_state,
		classification: row.cost_classification,
		recognitionPeriod: row.recognition_period,
		recognizedAmount: nullableNumber(row.recognized_amount),
		totalAmount: nullableNumber(row.total_amount),
		taxAmount: nullableNumber(row.tax_amount),
		currency: row.currency,
		financialVersion: Number(row.financial_version ?? 0),
		isDelete: Number(row.isDelete ?? 0),
	};
}

/** Read the frozen close for a month, if one exists. */
export async function readFinancialClose(
	db: Connection,
	month: string
): Promise<PersistedFinancialClose | null> {
	const [rows] = await db.execute<CloseRow[]>(
		`SELECT month, close_uid, financial_version, snapshot, reviewed_by,
        review_reason, evidence_reference
       FROM financial_close_snapshots
      WHERE month = ? AND isDelete = 0
      LIMIT 1`,
		[month]
	);
	const row = rows[0];
	if (!row) return null;
	return {
		month: row.month,
		closeUid: row.close_uid,
		financialVersion: Number(row.financial_version ?? 0),
		snapshot: parseJsonColumn(row.snapshot),
		reviewedBy: nullableNumber(row.reviewed_by),
		reviewReason: row.review_reason,
		evidenceReference: row.evidence_reference,
	};
}

/** Read the revision headers of a month, oldest first. */
export async function readFinancialRevisions(
	db: Connection,
	month: string
): Promise<PersistedFinancialRevision[]> {
	const [rows] = await db.execute<RevisionRow[]>(
		`SELECT revision_uid, month, close_uid, close_version, target_kind,
        target_uid, command, prior_version, new_version, prior_snapshot,
        new_snapshot, reason, evidence_reference, actor_user_id
       FROM financial_revision_events
      WHERE month = ? AND isDelete = 0
      ORDER BY id ASC`,
		[month]
	);
	return rows.map((row) => ({
		revisionUid: row.revision_uid,
		month: row.month,
		closeUid: row.close_uid,
		closeVersion: Number(row.close_version ?? 0),
		targetKind: row.target_kind,
		targetUid: row.target_uid,
		command: row.command,
		priorVersion: Number(row.prior_version ?? 0),
		newVersion: Number(row.new_version ?? 0),
		priorFigures: parseJsonColumn(row.prior_snapshot),
		newFigures: parseJsonColumn(row.new_snapshot),
		reason: row.reason,
		evidenceReference: row.evidence_reference,
		actorUserId: nullableNumber(row.actor_user_id),
	}));
}

/** Read every settlement recorded against one cost, oldest first. */
export async function readFinancialSettlementsForCost(
	db: Connection,
	costUid: string
): Promise<PersistedFinancialSettlement[]> {
	const [rows] = await db.execute<SettlementRow[]>(
		`SELECT id, settlement_uid, target_kind, target_cost_uid, amount,
        currency, settled_on, reference, destination, status,
        financial_version, created_by
       FROM financial_settlements
      WHERE target_cost_uid = ? AND isDelete = 0
      ORDER BY id ASC`,
		[costUid]
	);
	return rows.map((row) => ({
		id: Number(row.id),
		settlementUid: row.settlement_uid,
		targetKind: row.target_kind,
		targetCostUid: row.target_cost_uid,
		amount: Number(row.amount),
		currency: row.currency,
		settledOn:
			row.settled_on instanceof Date
				? row.settled_on.toISOString().slice(0, 10)
				: String(row.settled_on).slice(0, 10),
		reference: row.reference,
		destination: row.destination,
		status: row.status,
		financialVersion: Number(row.financial_version ?? 0),
		createdBy: nullableNumber(row.created_by),
	}));
}

/** Read one settlement's append-only command journal, oldest first. */
export async function readSettlementEvents(
	db: Connection,
	settlementUid: string
): Promise<PersistedSettlementEvent[]> {
	const [rows] = await db.execute<SettlementEventRow[]>(
		`SELECT settlement_uid, version, command, actor_user_id
       FROM financial_settlement_events
      WHERE settlement_uid = ?
      ORDER BY version ASC`,
		[settlementUid]
	);
	return rows.map((row) => ({
		settlementUid: row.settlement_uid,
		version: Number(row.version),
		command: row.command,
		actorUserId: nullableNumber(row.actor_user_id),
	}));
}

/**
 * Remove fixture leftovers from an earlier interrupted attempt on this
 * reserved month. Only rows carrying this suite's `E2EFC-` expense prefix or
 * actor-tagged close snapshots are touched, so a parallel suite's month is
 * never cleared.
 */
async function clearStaleFixtureRows(
	db: Connection,
	month: string
): Promise<void> {
	const [year, monthNumber] = month.split('-').map(Number);
	const nextMonth =
		monthNumber === 12
			? `${year + 1}-01`
			: `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
	const start = `${month}-01`;
	const [rows] = await db.execute<IdRow[]>(
		`SELECT id, cost_uid FROM expenses
      WHERE isDelete = 0
        AND expense_number LIKE ?
        AND (
          (recognition_period >= ? AND recognition_period < ?)
          OR (
            recognition_period IS NULL
            AND expense_date >= ?
            AND expense_date < ?
          )
        )`,
		[`${EXPENSE_PREFIX}-%`, start, nextMonth, start, nextMonth]
	);
	if (rows.length > 0) {
		await removeFixtureRows(db, month, {
			expenseIds: rows.map((row) => Number(row.id)),
			costUids: rows
				.map((row) => row.cost_uid)
				.filter((uid): uid is string => typeof uid === 'string' && uid !== ''),
			settlementIds: [],
			closeUid: null,
			reviewedBy: null,
		});
	}
	// A prior attempt that closed the month leaves a snapshot owned by an E2E
	// identity. Clear it so a retry reaches its authored starting state.
	await db.execute(
		`DELETE FROM financial_close_snapshots
      WHERE month = ?
        AND (
          reviewed_by IS NULL
          OR reviewed_by IN (SELECT id FROM users WHERE username LIKE 'E2E%')
        )`,
		[month]
	);
}

async function removeFixtureRows(
	db: Connection,
	month: string,
	owned: {
		expenseIds: number[];
		costUids: string[];
		settlementIds: number[];
		closeUid: string | null;
		reviewedBy: number | null;
	}
): Promise<void> {
	const costUids = [
		...new Set(
			owned.costUids.filter(
				(value): value is string => typeof value === 'string' && value !== ''
			)
		),
	];
	const expenseIds = [
		...new Set(
			owned.expenseIds.filter((value) => Number.isInteger(value) && value > 0)
		),
	];
	let settlementIds = [
		...new Set(
			owned.settlementIds.filter(
				(value) => Number.isInteger(value) && value > 0
			)
		),
	];
	const settlementUids = new Set<string>();

	const settlementSlots = costUids.length
		? placeholders(costUids.length)
		: null;
	if (settlementSlots !== null) {
		const [rows] = await db.execute<SettlementRow[]>(
			`SELECT id, settlement_uid FROM financial_settlements
        WHERE target_cost_uid IN (${settlementSlots})`,
			costUids
		);
		for (const row of rows) {
			settlementUids.add(row.settlement_uid);
			settlementIds.push(Number(row.id));
		}
	}
	settlementIds = [
		...new Set(
			settlementIds.filter((value) => Number.isInteger(value) && value > 0)
		),
	];

	if (settlementUids.size > 0) {
		const uids = [...settlementUids];
		await db.execute(
			`DELETE FROM financial_settlement_events
        WHERE settlement_uid IN (${placeholders(uids.length)})`,
			uids
		);
	}
	if (settlementIds.length > 0) {
		await db.execute(
			`DELETE FROM financial_cost_links
        WHERE source_table = 'financial_settlements'
          AND source_id IN (${placeholders(settlementIds.length)})`,
			settlementIds.map((id) => String(id))
		);
		await db.execute(
			`DELETE FROM financial_settlements
        WHERE id IN (${placeholders(settlementIds.length)})`,
			settlementIds
		);
	}
	if (costUids.length > 0) {
		const slots = placeholders(costUids.length);
		await db.execute(
			`DELETE FROM financial_revision_events WHERE target_uid IN (${slots})`,
			costUids
		);
		await db.execute(
			`DELETE FROM financial_cost_events WHERE cost_uid IN (${slots})`,
			costUids
		);
		await db.execute(
			`DELETE FROM financial_cost_links WHERE cost_uid IN (${slots})`,
			costUids
		);
	}
	if (expenseIds.length > 0) {
		await db.execute(
			`DELETE FROM financial_cost_links
        WHERE source_table = 'expenses'
          AND source_id IN (${placeholders(expenseIds.length)})`,
			expenseIds.map((id) => String(id))
		);
		await db.execute(
			`DELETE FROM expenses WHERE id IN (${placeholders(expenseIds.length)})`,
			expenseIds
		);
	}
	if (owned.closeUid !== null) {
		await db.execute(
			`DELETE FROM financial_close_snapshots
        WHERE month = ? AND close_uid = ?`,
			[month, owned.closeUid]
		);
	}
	if (owned.reviewedBy !== null) {
		await db.execute(
			`DELETE FROM financial_close_snapshots
        WHERE month = ? AND reviewed_by = ?`,
			[month, owned.reviewedBy]
		);
	}
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * mysql2 may already decode a JSON/LONGTEXT column. Only text is parsed; a
 * plain object, array, or null is returned as-is so a fixture never turns a
 * parsed object into the string `[object Object]`.
 */
export function parseJsonColumn(value: unknown): unknown {
	if (typeof value === 'string') {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
		try {
			return JSON.parse(value.toString('utf8'));
		} catch {
			return value.toString('utf8');
		}
	}
	return value;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
