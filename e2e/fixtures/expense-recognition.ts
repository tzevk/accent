/**
 * Disposable fixtures for the company-expenditure recognition journeys.
 *
 * Two independent slices, each with its own reserved month and its own
 * namespaced identity, so the direct-cost journey and the petty-cash journey
 * never see each other's figures:
 *
 * - direct cost (`2021-03`): a namespaced finance identity with exactly the
 *   report and expense-ledger grants the Expenditure view needs. The identity
 *   records, submits and recognizes the cost through the real UI; readers here
 *   only state what the database saved and what the module journal holds.
 * - petty cash (`2022-06`): a namespaced petty-cash identity (plus the report
 *   reads needed to prove the company outcome) and a seeded cash voucher with
 *   its mirrored funding row and funding/mirror cost links. The voucher is
 *   starting state, not an expense: the browser draws the spend from it, and
 *   the reads below prove the funding pair never becomes cost.
 *
 * Every row is keyed by an owned primary key or the owned identity, so cleanup
 * cannot touch another worker's data. Expected values are authored literals,
 * never read back from the application.
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** Deterministic, isolated months; neither is the current month. */
export const RECOGNITION_MONTH = '2021-03';
export const RECOGNITION_ADJACENT_MONTH = '2021-02';
export const PETTY_CASH_MONTH = '2022-06';

/** Direct cost: one gross amount, no tax. */
export const RECOGNITION_AMOUNT = '1234.56';
export const RECOGNITION_AMOUNT_DISPLAY = '₹1,234.56';

/** Petty cash: funding, supported spend, and the funding it leaves behind. */
export const PETTY_FUNDING_AMOUNT = '5000.00';
export const PETTY_SPEND_AMOUNT = '1250.50';
export const PETTY_FUNDING_DISPLAY = '₹5,000.00';
export const PETTY_SPEND_DISPLAY = '₹1,250.50';
export const PETTY_REMAINING_DISPLAY = '₹3,749.50';
export const PETTY_ZERO_DISPLAY = '₹0.00';

/** The finance identity: read the report, record, and recognize a cost. */
const RECOGNITION_PERMISSIONS = [
	'reports:read',
	'other_expenses:read',
	'other_expenses:create',
	'other_expenses:approve',
	'payroll:read',
] as const;

/**
 * The petty-cash identity: record and recognize spending in its own register,
 * then read the company report that proves funding stayed outside cost.
 */
const PETTY_CASH_PERMISSIONS = [
	'petty_cash_expenses:read',
	'petty_cash_expenses:create',
	'petty_cash_expenses:approve',
	'reports:read',
	'other_expenses:read',
	'payroll:read',
] as const;

export interface DirectCostFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	sourceReference: string;
	vendorName: string;
	description: string;
	evidenceReference: string;
	servicePeriodStart: string;
	servicePeriodEnd: string;
	billDate: string;
	amount: string;
	amountDisplay: string;
	/** Remove the direct cost rows, their links, events and the identity. */
	dispose(): Promise<void>;
}

export interface PettyCashFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	voucherId: number;
	voucherNumber: string;
	voucherOptionLabel: string;
	transactionDate: string;
	serviceDate: string;
	evidenceReference: string;
	note: string;
	fundingAmount: string;
	spendAmount: string;
	fundingDisplay: string;
	spendDisplay: string;
	remainingDisplay: string;
	zeroDisplay: string;
	/** Remove owned petty rows, funding links, the voucher and the identity. */
	dispose(): Promise<void>;
}

export interface PersistedDirectCost {
	id: number;
	costUid: string | null;
	recognitionState: string | null;
	recognitionPeriod: string | null;
	recognizedAmount: string | null;
	amount: string | null;
	taxAmount: string | null;
	totalAmount: string | null;
	classification: string | null;
	sourceReference: string | null;
	currency: string | null;
	financialVersion: number;
	createdBy: number | null;
}

export interface PersistedCostEvent {
	command: string;
	version: number;
	reason: string | null;
	actorUserId: number | null;
}

export interface PersistedCostLink {
	role: string;
	sourceTable: string;
	sourceId: string;
}

export interface PersistedPettyCashRow {
	id: string;
	numericId: number;
	transactionNumber: string;
	entryKind: string;
	transactionDate: string;
	debitAmount: string;
	creditAmount: string;
	sourceVoucherId: number | null;
	costUid: string | null;
	recognitionState: string;
	recognitionPeriod: string | null;
	recognizedAmount: string | null;
	classification: string | null;
	financialVersion: number;
	linkedCostUid: string | null;
	currency: string | null;
	createdBy: number | null;
}

interface DirectCostRow extends RowDataPacket {
	id: number | string;
	cost_uid: string | null;
	recognition_state: string | null;
	recognition_period: string | null;
	recognized_amount: string | number | null;
	amount: string | number | null;
	tax_amount: string | number | null;
	total_amount: string | number | null;
	cost_classification: string | null;
	source_reference: string | null;
	currency: string | null;
	financial_version: number | string | null;
	created_by: number | string | null;
}

interface CostEventRow extends RowDataPacket {
	command: string;
	version: number | string;
	reason: string | null;
	actor_user_id: number | string | null;
}

interface CostLinkRow extends RowDataPacket {
	role: string;
	source_table: string;
	source_id: string;
}

interface PettyCashRow extends RowDataPacket {
	id: string;
	numeric_id: number | string;
	transaction_number: string;
	entry_kind: string;
	transaction_date: string;
	debit_amount: string | number;
	credit_amount: string | number;
	source_voucher_id: number | string | null;
	cost_uid: string | null;
	recognition_state: string;
	recognition_period: string | null;
	recognized_amount: string | number | null;
	cost_classification: string | null;
	financial_version: number | string;
	linked_cost_uid: string | null;
	currency: string | null;
	created_by: number | string | null;
}

interface VoucherRow extends RowDataPacket {
	id: number | string;
}

interface OwnedPettyRow extends RowDataPacket {
	id: string;
	cost_uid: string | null;
}

/**
 * Seed only the finance identity. The month starts empty on purpose: the test
 * proves the empty starting state before it records anything.
 */
export async function seedDirectCostFixture(
	db: Connection,
	namespace: string
): Promise<DirectCostFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-expense-recognition`,
		RECOGNITION_PERMISSIONS
	);
	const token = tokenOf(namespace);
	const sourceReference = `E2E-DE-${token}`;

	return {
		userId: identity.userId,
		username: identity.username,
		password: identity.password,
		sourceReference,
		vendorName: `E2E Vendor ${token}`,
		description: `E2E direct cost ${token}`,
		evidenceReference: `E2E-DE-RECEIPT-${token}`,
		servicePeriodStart: `${RECOGNITION_MONTH}-10`,
		servicePeriodEnd: `${RECOGNITION_MONTH}-10`,
		billDate: `${RECOGNITION_MONTH}-20`,
		amount: RECOGNITION_AMOUNT,
		amountDisplay: RECOGNITION_AMOUNT_DISPLAY,
		async dispose(): Promise<void> {
			try {
				await deleteOwnedDirectCosts(db, identity.userId, sourceReference);
			} finally {
				await identity.dispose();
			}
		},
	};
}

/**
 * Seed one approved cash voucher and its mirrored funding row, exactly as the
 * funding control writes them: the voucher and the petty-cash credit are one
 * cash funding event, with funding/mirror links and no cost identity.
 */
export async function seedPettyCashFixture(
	db: Connection,
	namespace: string
): Promise<PettyCashFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-petty-cash`,
		PETTY_CASH_PERMISSIONS
	);
	const token = tokenOf(namespace);
	const voucherNumber = `E2E-PC-${token}`;
	const voucherDate = `${PETTY_CASH_MONTH}-05`;
	let voucherId: number | null = null;

	try {
		const [voucherResult] = await db.execute<ResultSetHeader>(
			`INSERT INTO cash_vouchers (
        voucher_number, voucher_date, voucher_type, payee_name, description,
        amount, payment_mode, status, paid_to, total_amount, created_by, isDelete
      ) VALUES (?, ?, 'payment', ?, ?, ?, 'cash', 'approved', ?, ?, ?, 0)`,
			[
				voucherNumber,
				voucherDate,
				`E2E Petty Custodian ${token}`,
				`E2E petty cash float ${token}`,
				PETTY_FUNDING_AMOUNT,
				`E2E Petty Custodian ${token}`,
				PETTY_FUNDING_AMOUNT,
				identity.userId,
			]
		);
		voucherId = Number(voucherResult.insertId);
		if (!Number.isInteger(voucherId) || voucherId <= 0) {
			throw new Error('[petty-cash] the voucher fixture was not inserted');
		}
		const ownedVoucherId = voucherId;
		const fundingCostUid = `fund-${ownedVoucherId}`;

		const fundingRowId = randomUUID();
		await db.execute(
			`INSERT INTO petty_cash_expenses (
        id, transaction_number, transaction_date, credit_amount, debit_amount,
        description, status, created_by, source_voucher_id, entry_kind, cost_uid,
        currency, recognition_state, financial_version
      ) VALUES (?, ?, ?, ?, 0, ?, 'submitted', ?, ?, 'funding', ?, 'INR', 'draft', 1)`,
			[
				fundingRowId,
				voucherNumber,
				voucherDate,
				PETTY_FUNDING_AMOUNT,
				`E2E petty cash float ${token}`,
				identity.userId,
				ownedVoucherId,
				fundingCostUid,
			]
		);

		// The two links the funding control writes. Neither is a `cost` role:
		// this identity can never be registered as an expense.
		await db.execute(
			`INSERT INTO financial_cost_links (
        cost_uid, source_table, source_id, role, basis, review_state,
        evidence_reference, created_by
      ) VALUES (?, 'cash_vouchers', ?, 'funding', 'system', 'confirmed', ?, ?),
               (?, 'petty_cash_expenses', ?, 'mirror', 'system', 'confirmed', ?, ?)`,
			[
				fundingCostUid,
				String(ownedVoucherId),
				voucherNumber,
				identity.userId,
				fundingCostUid,
				fundingRowId,
				voucherNumber,
				identity.userId,
			]
		);

		let disposed = false;
		return {
			userId: identity.userId,
			username: identity.username,
			password: identity.password,
			voucherId: ownedVoucherId,
			voucherNumber,
			voucherOptionLabel: `${voucherNumber} — remaining ${PETTY_FUNDING_DISPLAY}`,
			transactionDate: `${PETTY_CASH_MONTH}-15`,
			serviceDate: `${PETTY_CASH_MONTH}-15`,
			evidenceReference: `E2E-PC-RECEIPT-${token}`,
			note: `E2E petty spend ${token}`,
			fundingAmount: PETTY_FUNDING_AMOUNT,
			spendAmount: PETTY_SPEND_AMOUNT,
			fundingDisplay: PETTY_FUNDING_DISPLAY,
			spendDisplay: PETTY_SPEND_DISPLAY,
			remainingDisplay: PETTY_REMAINING_DISPLAY,
			zeroDisplay: PETTY_ZERO_DISPLAY,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteOwnedPettyCash(db, identity, ownedVoucherId);
				} finally {
					await identity.dispose();
				}
			},
		};
	} catch (error) {
		try {
			if (voucherId !== null) {
				await deleteOwnedPettyCash(db, identity, voucherId);
			}
		} catch {
			// Preserve the seed failure; this run's database is disposable.
		}
		try {
			await identity.dispose();
		} catch {
			// Preserve the seed failure; cleanup cannot mask it.
		}
		throw error;
	}
}

/** Every direct cost this identity recorded, with its saved recognition state. */
export async function readDirectCostsBySourceReference(
	db: Connection,
	sourceReference: string
): Promise<PersistedDirectCost[]> {
	const [rows] = await db.execute<DirectCostRow[]>(
		`SELECT id, cost_uid, recognition_state, recognition_period,
        recognized_amount, amount, tax_amount, total_amount,
        cost_classification, source_reference, currency, financial_version,
        created_by
       FROM expenses
      WHERE source_reference = ?
        AND isDelete = 0
      ORDER BY id ASC`,
		[sourceReference]
	);
	return rows.map((row) => ({
		id: Number(row.id),
		costUid: textOrNull(row.cost_uid),
		recognitionState: textOrNull(row.recognition_state),
		recognitionPeriod: textOrNull(row.recognition_period),
		recognizedAmount: textOrNull(row.recognized_amount),
		amount: textOrNull(row.amount),
		taxAmount: textOrNull(row.tax_amount),
		totalAmount: textOrNull(row.total_amount),
		classification: textOrNull(row.cost_classification),
		sourceReference: textOrNull(row.source_reference),
		currency: textOrNull(row.currency),
		financialVersion: Number(row.financial_version ?? 0),
		createdBy: nullableNumber(row.created_by),
	}));
}

/** The append-only command journal of one cost identity, oldest first. */
export async function readCostEvents(
	db: Connection,
	costUid: string
): Promise<PersistedCostEvent[]> {
	const [rows] = await db.execute<CostEventRow[]>(
		`SELECT command, version, reason, actor_user_id
       FROM financial_cost_events
      WHERE cost_uid = ?
      ORDER BY version ASC`,
		[costUid]
	);
	return rows.map((row) => ({
		command: row.command,
		version: Number(row.version),
		reason: textOrNull(row.reason),
		actorUserId: nullableNumber(row.actor_user_id),
	}));
}

/** The authoritative source links of one cost identity. */
export async function readCostLinks(
	db: Connection,
	costUid: string
): Promise<PersistedCostLink[]> {
	const [rows] = await db.execute<CostLinkRow[]>(
		`SELECT role, source_table, source_id
       FROM financial_cost_links
      WHERE cost_uid = ?
      ORDER BY id ASC`,
		[costUid]
	);
	return rows.map((row) => ({
		role: row.role,
		sourceTable: row.source_table,
		sourceId: row.source_id,
	}));
}

/** Every petty-cash spending row this identity created. */
export async function readPettyCashSpendsByCreator(
	db: Connection,
	userId: number
): Promise<PersistedPettyCashRow[]> {
	const [rows] = await db.execute<PettyCashRow[]>(
		`${PETTY_SELECT}
      WHERE created_by = ?
        AND entry_kind = 'spend'
        AND isDelete = 0
      ORDER BY numeric_id ASC`,
		[userId]
	);
	return rows.map(mapPettyCashRow);
}

/** The one funding credit mirrored from a voucher. */
export async function readPettyCashFundingByVoucher(
	db: Connection,
	voucherId: number
): Promise<PersistedPettyCashRow[]> {
	const [rows] = await db.execute<PettyCashRow[]>(
		`${PETTY_SELECT}
      WHERE source_voucher_id = ?
        AND entry_kind = 'funding'
        AND isDelete = 0
      ORDER BY numeric_id ASC`,
		[voucherId]
	);
	return rows.map(mapPettyCashRow);
}

const PETTY_SELECT = `
  SELECT id, numeric_id, transaction_number, entry_kind, transaction_date,
         debit_amount, credit_amount, source_voucher_id, cost_uid,
         recognition_state, recognition_period, recognized_amount,
         cost_classification, financial_version, linked_cost_uid, currency,
         created_by
    FROM petty_cash_expenses`;

function mapPettyCashRow(row: PettyCashRow): PersistedPettyCashRow {
	return {
		id: String(row.id),
		numericId: Number(row.numeric_id ?? 0),
		transactionNumber: String(row.transaction_number ?? ''),
		entryKind: String(row.entry_kind ?? ''),
		transactionDate: String(row.transaction_date ?? ''),
		debitAmount: String(row.debit_amount ?? ''),
		creditAmount: String(row.credit_amount ?? ''),
		sourceVoucherId: nullableNumber(row.source_voucher_id),
		costUid: textOrNull(row.cost_uid),
		recognitionState: String(row.recognition_state ?? ''),
		recognitionPeriod: textOrNull(row.recognition_period),
		recognizedAmount: textOrNull(row.recognized_amount),
		classification: textOrNull(row.cost_classification),
		financialVersion: Number(row.financial_version ?? 0),
		linkedCostUid: textOrNull(row.linked_cost_uid),
		currency: textOrNull(row.currency),
		createdBy: nullableNumber(row.created_by),
	};
}

async function deleteOwnedDirectCosts(
	db: Connection,
	userId: number,
	sourceReference: string
): Promise<void> {
	const [rows] = await db.execute<DirectCostRow[]>(
		`SELECT id, cost_uid FROM expenses
      WHERE created_by = ?
        AND source_reference = ?`,
		[userId, sourceReference]
	);
	await deleteCostRows(db, 'expenses', rows, userId);
}

async function deleteOwnedPettyCash(
	db: Connection,
	identity: JourneyUser,
	voucherId: number
): Promise<void> {
	const [rows] = await db.execute<OwnedPettyRow[]>(
		`SELECT id, cost_uid FROM petty_cash_expenses
      WHERE created_by = ?
         OR source_voucher_id = ?`,
		[identity.userId, voucherId]
	);
	const rowIds = rows.map((row) => String(row.id));

	await deleteCostRows(db, 'petty_cash_expenses', rows, identity.userId, [
		voucherId,
	]);

	if (rowIds.length > 0) {
		await db.execute(
			`DELETE FROM petty_cash_expenses
        WHERE id IN (${placeholders(rowIds.length)})`,
			rowIds
		);
	}
	const [vouchers] = await db.execute<VoucherRow[]>(
		`SELECT id FROM cash_vouchers WHERE id = ? AND created_by = ?`,
		[voucherId, identity.userId]
	);
	if (vouchers.length > 0) {
		await db.execute(
			`DELETE FROM cash_vouchers WHERE id = ? AND created_by = ?`,
			[voucherId, identity.userId]
		);
	}
}

/**
 * Remove the authoritative links and journal entries of the owned rows before
 * the rows themselves. An empty list is a no-op, never a wildcard.
 */
async function deleteCostRows(
	db: Connection,
	sourceTable: string,
	rows: Array<{ id: number | string; cost_uid: string | null }>,
	userId: number,
	voucherIds: number[] = []
): Promise<void> {
	const rowIds = rows.map((row) => String(row.id));
	const costUids = [
		...new Set(
			rows
				.map((row) => textOrNull(row.cost_uid))
				.filter((uid): uid is string => uid !== null)
		),
	];

	if (costUids.length > 0) {
		await db.execute(
			`DELETE FROM financial_cost_links
        WHERE cost_uid IN (${placeholders(costUids.length)})`,
			costUids
		);
		await db.execute(
			`DELETE FROM financial_cost_events
        WHERE cost_uid IN (${placeholders(costUids.length)})`,
			costUids
		);
	}

	if (rowIds.length > 0) {
		await db.execute(
			`DELETE FROM financial_cost_links
        WHERE source_table = ?
          AND source_id IN (${placeholders(rowIds.length)})`,
			[sourceTable, ...rowIds]
		);
	}

	if (voucherIds.length > 0) {
		await db.execute(
			`DELETE FROM financial_cost_links
        WHERE source_table = 'cash_vouchers'
          AND source_id IN (${placeholders(voucherIds.length)})`,
			voucherIds.map(String)
		);
	}

	if (sourceTable === 'expenses' && rowIds.length > 0) {
		await db.execute(
			`DELETE FROM expenses
        WHERE id IN (${placeholders(rowIds.length)})
          AND created_by = ?`,
			[...rowIds, userId]
		);
	}
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

function tokenOf(namespace: string): string {
	return createHash('sha256')
		.update(namespace)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase();
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
