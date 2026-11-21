/**
 * Disposable cash-voucher fixture for the browser round trip.
 *
 * The fixture creates:
 *
 * - a namespaced ordinary identity that reuses the hook's read-only `admin`
 *   reference role with no additional grants. The cash-voucher routes gate on
 *   the role code, and the employee picker needs only an authenticated reader;
 *   the journey deliberately needs no accounts/settings master grants because
 *   its single line is identified by a bill number and rupees/paise amounts;
 * - one active Employee with a unique, search-friendly payee name for the
 *   `Paid to` picker.
 *
 * Expected amounts and the words conversion are authored literals here, not
 * read back from the application. The test creates the voucher through the
 * browser; cleanup finds it by the owned `created_by` user id, so a failed
 * browser step cannot leave the voucher, its funding mirror or its cost links
 * behind. The employee and identity are tracked by primary key.
 */
import { createHash } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser } from './journey-user.ts';

export const VOUCHER_RUPEES = 4321;
export const VOUCHER_PAISE = 87;
export const VOUCHER_TOTAL = '4321.87';
export const VOUCHER_TOTAL_DISPLAY = '₹4,321.87';
export const VOUCHER_AMOUNT_IN_WORDS =
	'Four Thousand Three Hundred Twenty One Rupees and Eighty Seven Paise Only';

export interface CashVoucherFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	employeeId: number;
	employeeCode: string;
	/** Unique visible label in the employee picker and the register. */
	payeeName: string;
	billNo: string;
	rupees: number;
	paise: number;
	total: string;
	totalDisplay: string;
	amountInWords: string;
	/** Remove the owned voucher, funding mirror, employee and identity. */
	dispose(): Promise<void>;
}

export interface PersistedCashVoucher {
	id: number;
	voucherNumber: string | null;
	voucherDate: string | null;
	voucherType: string | null;
	paidTo: string | null;
	totalAmount: string | null;
	amountInWords: string | null;
	status: string | null;
	isDelete: number;
	createdBy: number | null;
	lineItems: unknown;
}

export interface PersistedFundingMirror {
	id: string;
	transactionNumber: string;
	transactionDate: string;
	creditAmount: string;
	debitAmount: string;
	entryKind: string | null;
	currency: string | null;
	sourceVoucherId: number | null;
	costUid: string | null;
}

interface VoucherRow extends RowDataPacket {
	id: number | string;
	voucher_number: string | null;
	voucher_date: string | null;
	voucher_type: string | null;
	paid_to: string | null;
	total_amount: string | number | null;
	amount_in_words: string | null;
	status: string | null;
	isDelete: number | string | null;
	created_by: number | string | null;
	line_items: unknown;
}

interface FundingRow extends RowDataPacket {
	id: string;
	transaction_number: string;
	transaction_date: string;
	credit_amount: string | number;
	debit_amount: string | number;
	entry_kind: string | null;
	currency: string | null;
	source_voucher_id: number | string | null;
	cost_uid: string | null;
}

interface IdRow extends RowDataPacket {
	id: number | string;
}

interface MirrorIdRow extends RowDataPacket {
	id: string;
}

/**
 * Seed the identity and payee. The caller owns the fixture and must call
 * `dispose()` in a `finally` block.
 */
export async function seedCashVoucherFixture(
	db: Connection,
	namespace: string
): Promise<CashVoucherFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-cash-voucher`,
		[],
		{ admin: true }
	);

	const token = createHash('sha256')
		.update(namespace)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase();
	const employeeCode = fitIdentifier(`E2ECV${token}`, 20);
	const payeeName = `E2E CV Payee ${token}`;
	const billNo = `BILL-${token}`;
	const email = `e2ecv-${token.toLowerCase()}@e2e.invalid`;
	const [firstName, ...lastNameParts] = payeeName.split(' ');
	const lastName = lastNameParts.join(' ');

	let employeeId: number | null = null;
	try {
		const [result] = await db.execute<ResultSetHeader>(
			`INSERT INTO employees (
        employee_id, first_name, last_name, email, position, department,
        status, employee_type, grade, designation, company_name, isDelete
      ) VALUES (?, ?, ?, ?, 'Fixture Payee', 'E2E Cash Voucher',
                'active', 'Contract', 'E2E', 'Fixture Payee',
                'Accent Techno Solutions Pvt Ltd', 0)`,
			[employeeCode, firstName, lastName, email]
		);
		const insertedId = Number(result.insertId);
		if (!Number.isInteger(insertedId) || insertedId <= 0) {
			throw new Error('[cash-voucher] the payee fixture was not inserted');
		}
		employeeId = insertedId;

		let disposed = false;
		return {
			userId: identity.userId,
			username: identity.username,
			password: identity.password,
			employeeId: insertedId,
			employeeCode,
			payeeName,
			billNo,
			rupees: VOUCHER_RUPEES,
			paise: VOUCHER_PAISE,
			total: VOUCHER_TOTAL,
			totalDisplay: VOUCHER_TOTAL_DISPLAY,
			amountInWords: VOUCHER_AMOUNT_IN_WORDS,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteOwnedVoucherRows(db, identity.userId);
				} finally {
					try {
						await db.execute(
							`DELETE FROM employees
                WHERE id = ?
                  AND employee_id = ?`,
							[insertedId, employeeCode]
						);
					} finally {
						await identity.dispose();
					}
				}
			},
		};
	} catch (error) {
		if (employeeId !== null) {
			try {
				await db.execute(
					`DELETE FROM employees WHERE id = ? AND employee_id = ?`,
					[employeeId, employeeCode]
				);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		await identity.dispose();
		throw error;
	}
}

/**
 * Find the vouchers this journey's unique identity created. The identity is
 * used by no other fixture, so this finds the browser-created row even when
 * the test has not read its server-allocated number yet.
 */
export async function findCashVouchersByCreator(
	db: Connection,
	userId: number
): Promise<PersistedCashVoucher[]> {
	const [rows] = await db.execute<VoucherRow[]>(
		`SELECT id, voucher_number, voucher_date, voucher_type, paid_to,
        total_amount, amount_in_words, status, isDelete, created_by, line_items
       FROM cash_vouchers
      WHERE created_by = ?
      ORDER BY id ASC`,
		[userId]
	);
	return rows.map(mapVoucherRow);
}

function mapVoucherRow(row: VoucherRow): PersistedCashVoucher {
	return {
		id: Number(row.id),
		voucherNumber: textOrNull(row.voucher_number),
		voucherDate: textOrNull(row.voucher_date),
		voucherType: textOrNull(row.voucher_type),
		paidTo: textOrNull(row.paid_to),
		totalAmount: decimalText(row.total_amount),
		amountInWords: textOrNull(row.amount_in_words),
		status: textOrNull(row.status),
		isDelete: Number(row.isDelete ?? 0),
		createdBy: nullableNumber(row.created_by),
		lineItems: parseJson(row.line_items),
	};
}

/**
 * Read the one funding credit the voucher transaction mirrors into petty cash.
 * Selecting by `source_voucher_id` proves the side effect is tied to this
 * voucher rather than to a same-amount row from another journey.
 */
export async function readFundingMirror(
	db: Connection,
	voucherId: number
): Promise<PersistedFundingMirror[]> {
	const [rows] = await db.execute<FundingRow[]>(
		`SELECT id, transaction_number, transaction_date, credit_amount,
        debit_amount, entry_kind, currency, source_voucher_id, cost_uid
       FROM petty_cash_expenses
      WHERE source_voucher_id = ?
        AND entry_kind = 'funding'
        AND isDelete = 0
      ORDER BY id ASC`,
		[voucherId]
	);
	return rows.map((row) => ({
		id: row.id,
		transactionNumber: row.transaction_number,
		transactionDate: textOrNull(row.transaction_date) ?? '',
		creditAmount: decimalText(row.credit_amount) ?? '',
		debitAmount: decimalText(row.debit_amount) ?? '',
		entryKind: textOrNull(row.entry_kind),
		currency: textOrNull(row.currency),
		sourceVoucherId: nullableNumber(row.source_voucher_id),
		costUid: textOrNull(row.cost_uid),
	}));
}

async function deleteOwnedVoucherRows(
	db: Connection,
	userId: number
): Promise<void> {
	const [voucherRows] = await db.execute<IdRow[]>(
		`SELECT id FROM cash_vouchers WHERE created_by = ?`,
		[userId]
	);
	const voucherIds = voucherRows
		.map((row) => Number(row.id))
		.filter((id) => Number.isInteger(id) && id > 0);
	if (voucherIds.length === 0) return;

	const voucherSlots = placeholders(voucherIds.length);
	const [mirrorRows] = await db.execute<MirrorIdRow[]>(
		`SELECT id FROM petty_cash_expenses
      WHERE source_voucher_id IN (${voucherSlots})`,
		voucherIds
	);
	const mirrorIds = mirrorRows.map((row) => String(row.id));
	if (mirrorIds.length > 0) {
		await db.execute(
			`DELETE FROM financial_cost_links
        WHERE source_table = 'petty_cash_expenses'
          AND source_id IN (${placeholders(mirrorIds.length)})`,
			mirrorIds
		);
	}
	await db.execute(
		`DELETE FROM financial_cost_links
      WHERE source_table = 'cash_vouchers'
        AND source_id IN (${voucherSlots})`,
		voucherIds
	);
	await db.execute(
		`DELETE FROM petty_cash_expenses
      WHERE source_voucher_id IN (${voucherSlots})`,
		voucherIds
	);
	await db.execute(
		`DELETE FROM cash_vouchers WHERE id IN (${voucherSlots})`,
		voucherIds
	);
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

function parseJson(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function decimalText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
