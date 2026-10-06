/**
 * Petty cash — funding and spending controls for the company expenditure
 * reconciliation (#316).
 *
 * The petty-cash ledger (`petty_cash_expenses`) holds two kinds of row, and
 * this module is the only place their financial meaning is decided:
 *
 *   funding  a cash voucher (`cash_vouchers`) and its mirrored credit are one
 *            funding event: cash into the float. It is never operating cost,
 *            it carries a funding-event identity (`fund-<voucher>`), and it is
 *            never registered as a cost. Repeat mirroring updates the one
 *            funding row instead of adding another.
 *   spend    actual petty-cash spending. Each spend is one underlying cost
 *            (`cost-<uuid>`) with a Recognition Period, an approval state, and
 *            a deliberate Project / Company Overhead / Unallocated
 *            classification; a missing Project stays unallocated or unresolved
 *            and is never inferred from the voucher's free-text project
 *            number. A receipt already linked to another cost (a
 *            `linked_cost_uid` that resolves) settles that cost instead of
 *            creating a second one.
 *
 * The same versioned-command contract as the direct-expense store applies:
 * commands present the version they expect, every accepted command increments
 * `financial_version` and appends one `financial_cost_events` row, and
 * confirmed (recognized) spending is frozen against register edits and
 * soft deletes. Reads and writes take the caller's connection; nothing here
 * opens its own pool or commits.
 */

import { randomUUID } from 'node:crypto';
import { R, toNumber } from '@/lib/money';
import { isRetryableNumberError } from '@/utils/db-number-retry';
import { CostError } from './errors';
import {
	CLASSIFICATIONS,
	TAX_TREATMENTS,
	amountOrNull,
	assertClassificationProject,
	dateOrNull,
	enumOrThrow,
	pickEnum,
	text,
} from './fields';
import { JOURNAL_COMMAND, writeCostEvent } from './journal';
import { inTransaction, type CommandOptions, type CostActor } from './commands';
import {
	evaluateCost,
	nextState,
	recognitionBlockers,
	resolveRecognitionPeriod,
} from './recognition';
import { monthBounds, type SqlConnection } from './records';
import {
	linkCostReference,
	registerCostIdentity,
	resolveCostReference,
} from './sources';
import type {
	CostClassification,
	CostCommandName,
	CostRecord,
	PeriodBasis,
	RecognitionState,
	TaxTreatment,
	PettyCashSummary,
} from './types';

/** The operational lifecycle of the register row (not the recognition state). */
const OPERATIONAL_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
] as const;

const PAYMENT_MODES = [
	'cash',
	'bank',
	'cheque',
	'card',
	'upi',
	'other',
] as const;

const STATE_TO_STATUS: Record<RecognitionState, string> = {
	draft: 'draft',
	pending_evidence: 'submitted',
	recognized: 'approved',
	rejected: 'rejected',
	cancelled: 'submitted',
};

type DbRow = Record<string, unknown>;

function s(row: DbRow, key: string, fallback: string | null = null): string | null {
	const value = row[key];
	if (value === null || value === undefined) return fallback;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'bigint') {
		return String(value);
	}
	return fallback;
}

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/** The funding-event identity of one voucher: cash movement, never a cost. */
export function fundingEventUid(voucherId: number): string {
	return `fund-${voucherId}`;
}

/** The projection the register and the cost source read back. */
const SPEND_SELECT = `
  SELECT p.id, p.numeric_id, p.cost_uid, p.entry_kind, p.transaction_number,
         p.transaction_date, p.bill_no, p.bill_date, p.description,
         p.recipient_name, p.cost_classification, p.project_id,
         p.recognition_state, p.recognition_period, p.period_basis,
         p.service_period_start, p.service_period_end, p.tax_amount,
         p.tax_treatment, p.tax_evidence_reference, p.recognized_amount,
         p.recognized_by, p.recognized_at, p.source_reference,
         p.evidence_reference, p.linked_cost_uid, p.financial_version,
         COALESCE(p.currency, 'INR') AS currency, p.debit_amount,
         pr.project_code, COALESCE(pr.project_title, pr.name) AS project_name,
         pr.client_name
    FROM petty_cash_expenses p
    LEFT JOIN projects pr ON pr.project_id = p.project_id AND pr.isDelete = 0`;

/**
 * One spending row as the financial module sees it. `grossAmount` is the cash
 * paid (`debit_amount`); a missing amount cannot happen here because the
 * register requires one, and tax is held separately exactly as in `expenses`.
 */
export function mapPettyCashRow(row: DbRow): CostRecord {
	const financial = {
		classification:
			(s(row, 'cost_classification') as CostClassification | null) ?? null,
		state:
			(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
		currency: s(row, 'currency', 'INR'),
		grossAmount: num(row, 'debit_amount'),
		taxAmount: num(row, 'tax_amount'),
		taxTreatment:
			(s(row, 'tax_treatment', 'unresolved') as TaxTreatment) ?? 'unresolved',
		taxEvidenceReference: s(row, 'tax_evidence_reference'),
		servicePeriodStart: s(row, 'service_period_start'),
		servicePeriodEnd: s(row, 'service_period_end'),
		billDate: s(row, 'bill_date'),
		sourceReference: s(row, 'source_reference'),
		evidenceReference: s(row, 'evidence_reference'),
		recognitionPeriod: s(row, 'recognition_period'),
		periodBasis:
			(s(row, 'period_basis', 'unresolved') as
				| CostRecord['periodBasis']
				| undefined) ?? 'unresolved',
		recognizedAmount: num(row, 'recognized_amount'),
	};
	return {
		...financial,
		source: 'petty_cash',
		split: null,
		id: Number(num(row, 'numeric_id') ?? 0),
		costUid: s(row, 'cost_uid'),
		expenseNumber: s(row, 'transaction_number', '') ?? '',
		expenseDate: s(row, 'bill_date') ?? s(row, 'transaction_date'),
		vendorName: s(row, 'recipient_name'),
		description: s(row, 'description'),
		projectId: num(row, 'project_id'),
		projectCode: s(row, 'project_code'),
		projectName: s(row, 'project_name'),
		clientName: s(row, 'client_name'),
		financialVersion: Number(num(row, 'financial_version') ?? 1),
		recognizedAt: s(row, 'recognized_at'),
		recognizedBy: num(row, 'recognized_by'),
		evaluation: evaluateCost(financial),
	};
}

/**
 * The spending rows of one month that contribute cost: a receipt already
 * linked to another cost is a settlement of that cost, so it is not a cost row
 * here — the linked cost itself is counted by its own source exactly once.
 */
export async function loadPettyCashRecords(
	db: SqlConnection,
	month: string
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`${SPEND_SELECT}
      WHERE p.isDelete = 0
        AND p.entry_kind = 'spend'
        AND p.linked_cost_uid IS NULL
        AND (p.recognition_period BETWEEN ? AND ?
             OR (p.recognition_period IS NULL AND p.bill_date BETWEEN ? AND ?))
      ORDER BY p.transaction_date DESC, p.numeric_id DESC`,
		[start, end, start, end]
	);
	return (rows as DbRow[]).map(mapPettyCashRow);
}

/**
 * Confirmed petty-cash Project cost of a month, keyed by Project and currency,
 * for the previous-month comparison. Same shape and null-means-unknown rule as
 * the direct-expense loader.
 */
export async function loadPettyCashProjectCost(
	db: SqlConnection,
	month: string
): Promise<Map<number, Map<string, number | null>>> {
	const { start, end } = monthBounds(month);
	const [rows] = await db.execute(
		`SELECT p.project_id, COALESCE(p.currency, 'INR') AS currency,
              SUM(p.recognized_amount) AS amount,
              SUM(CASE WHEN p.recognized_amount IS NULL THEN 1 ELSE 0 END) AS unknown_amounts
         FROM petty_cash_expenses p
        WHERE p.isDelete = 0
          AND p.entry_kind = 'spend'
          AND p.linked_cost_uid IS NULL
          AND p.recognition_state = 'recognized'
          AND p.cost_classification = 'project'
          AND p.project_id IS NOT NULL
          AND p.recognition_period BETWEEN ? AND ?
        GROUP BY p.project_id, COALESCE(p.currency, 'INR')`,
		[start, end]
	);
	const costs = new Map<number, Map<string, number | null>>();
	for (const row of rows as DbRow[]) {
		const id = num(row, 'project_id');
		if (id === null) continue;
		const currency = s(row, 'currency', 'INR') ?? 'INR';
		const unknownAmounts = num(row, 'unknown_amounts') ?? 0;
		const perCurrency = costs.get(id) ?? new Map<string, number | null>();
		perCurrency.set(currency, unknownAmounts > 0 ? null : num(row, 'amount'));
		costs.set(id, perCurrency);
	}
	return costs;
}

/** Months that carry petty-cash spending, newest first. */
export async function loadPettyCashMonths(db: SqlConnection): Promise<string[]> {
	const [rows] = await db.execute(
		`SELECT DISTINCT DATE_FORMAT(COALESCE(recognition_period, bill_date), '%Y-%m') AS month
       FROM petty_cash_expenses
      WHERE isDelete = 0
        AND entry_kind = 'spend'
        AND (recognition_period IS NOT NULL OR bill_date IS NOT NULL)`
	);
	const months = new Set<string>();
	for (const row of rows as DbRow[]) {
		const month = s(row, 'month');
		if (month) months.add(month);
	}
	return [...months].sort().reverse();
}

interface CashAggregate {
	currency: string;
	amount: number;
	count: number;
	funded: number;
	settled: number;
}

function toAggregateMap(
	rows: DbRow[],
	read: (row: DbRow) => Partial<CashAggregate>
): Map<string, CashAggregate> {
	const map = new Map<string, CashAggregate>();
	for (const row of rows) {
		const currency = s(row, 'currency', 'INR') ?? 'INR';
		const current = map.get(currency) ?? {
			currency,
			amount: 0,
			count: 0,
			funded: 0,
			settled: 0,
		};
		const source = read(row);
		map.set(currency, {
			...current,
			amount: current.amount + (source.amount ?? 0),
			count: current.count + (source.count ?? 0),
			funded: current.funded + (source.funded ?? 0),
			settled: current.settled + (source.settled ?? 0),
		});
	}
	return map;
}

/**
 * Funding, spending, remaining supported funding, and recognized cost for a
 * month, or for all time when `month` is null (the register's own view).
 *
 * Cash figures (funding, spending, remaining) follow the cash date
 * (`transaction_date`); recognized cost follows the Recognition Period. The
 * two are never mixed, and funding never enters incurred operating cost.
 */
export async function loadPettyCashSummary(
	db: SqlConnection,
	month: string | null
): Promise<PettyCashSummary> {
	const bounds = month ? monthBounds(month) : null;
	const cashFilter = bounds ? 'AND p.transaction_date BETWEEN ? AND ?' : '';
	const cashParams = bounds ? [bounds.start, bounds.end] : [];
	const costFilter = bounds
		? `AND (p.recognition_period BETWEEN ? AND ?
            OR (p.recognition_period IS NULL AND p.bill_date BETWEEN ? AND ?))`
		: '';
	const costParams = bounds
		? [bounds.start, bounds.end, bounds.start, bounds.end]
		: [];

	const [fundingRows] = await db.execute(
		`SELECT COALESCE(p.currency, 'INR') AS currency, COUNT(*) AS count,
              COALESCE(SUM(p.credit_amount), 0) AS amount
         FROM petty_cash_expenses p
        WHERE p.isDelete = 0 AND p.entry_kind = 'funding' ${cashFilter}
        GROUP BY COALESCE(p.currency, 'INR')`,
		cashParams
	);
	const [spendRows] = await db.execute(
		`SELECT COALESCE(p.currency, 'INR') AS currency, COUNT(*) AS count,
              COALESCE(SUM(p.debit_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN p.source_voucher_id IS NOT NULL THEN p.debit_amount ELSE 0 END), 0) AS funded,
              COALESCE(SUM(CASE WHEN p.linked_cost_uid IS NOT NULL THEN p.debit_amount ELSE 0 END), 0) AS settled
         FROM petty_cash_expenses p
        WHERE p.isDelete = 0 AND p.entry_kind = 'spend' ${cashFilter}
        GROUP BY COALESCE(p.currency, 'INR')`,
		cashParams
	);
	const [costRows] = await db.execute(
		`SELECT COALESCE(p.currency, 'INR') AS currency,
              COALESCE(SUM(CASE WHEN p.recognition_state = 'recognized' AND p.linked_cost_uid IS NULL
                                THEN p.recognized_amount ELSE 0 END), 0) AS amount,
              COALESCE(SUM(CASE WHEN p.recognition_state IN ('draft','pending_evidence')
                                 AND p.linked_cost_uid IS NULL
                                THEN p.debit_amount ELSE 0 END), 0) AS funded
         FROM petty_cash_expenses p
        WHERE p.isDelete = 0 AND p.entry_kind = 'spend' ${costFilter}
        GROUP BY COALESCE(p.currency, 'INR')`,
		costParams
	);
	const [linkedRows] = await db.execute(
		`SELECT p.linked_cost_uid, p.debit_amount, COALESCE(p.currency, 'INR') AS currency
         FROM petty_cash_expenses p
        WHERE p.isDelete = 0 AND p.entry_kind = 'spend'
          AND p.linked_cost_uid IS NOT NULL ${cashFilter}`,
		cashParams
	);

	const funding = toAggregateMap(fundingRows as DbRow[], (row) => ({
		amount: num(row, 'amount') ?? 0,
		count: num(row, 'count') ?? 0,
	}));
	const spend = toAggregateMap(spendRows as DbRow[], (row) => ({
		amount: num(row, 'amount') ?? 0,
		count: num(row, 'count') ?? 0,
		funded: num(row, 'funded') ?? 0,
		settled: num(row, 'settled') ?? 0,
	}));
	const cost = toAggregateMap(costRows as DbRow[], (row) => ({
		amount: num(row, 'amount') ?? 0,
		funded: num(row, 'funded') ?? 0,
	}));

	const currencies = [
		...new Set([...funding.keys(), ...spend.keys(), ...cost.keys()]),
	].sort();
	const byCurrency = currencies.map((currency) => {
		const fund = funding.get(currency);
		const out = spend.get(currency);
		const recognized = cost.get(currency);
		const fundedSpend = out?.funded ?? 0;
		return {
			currency,
			funding: rounded(fund?.amount ?? 0),
			funding_event_count: fund?.count ?? 0,
			spend: rounded(out?.amount ?? 0),
			spend_count: out?.count ?? 0,
			funded_spend: rounded(fundedSpend),
			settled_spend: rounded(out?.settled ?? 0),
			remaining_funding: rounded((fund?.amount ?? 0) - fundedSpend),
			recognized_cost: rounded(recognized?.amount ?? 0),
			unconfirmed_spend: rounded(recognized?.funded ?? 0),
		};
	});

	const single = currencies.length === 1;
	const total = (value: number | undefined): number | null =>
		single ? rounded(value ?? 0) : null;

	// A receipt linked to another cost settles that cost; when the reference
	// does not resolve to a recognized cost it stays visible instead of being
	// counted as cost or silently dropped.
	let unresolvedCount = 0;
	let unresolvedAmount = 0;
	const unresolvedCurrencies = new Set<string>();
	for (const row of linkedRows as DbRow[]) {
		const uid = s(row, 'linked_cost_uid');
		if (!uid) continue;
		const reference = await resolveCostReference(db, uid);
		if (reference && reference.recognition_state === 'recognized') continue;
		unresolvedCount += 1;
		unresolvedAmount += num(row, 'debit_amount') ?? 0;
		unresolvedCurrencies.add(s(row, 'currency', 'INR') ?? 'INR');
	}

	const [unlinkedRows] = await db.execute(
		`SELECT COUNT(*) AS count, COALESCE(SUM(p.debit_amount), 0) AS amount,
              COUNT(DISTINCT COALESCE(p.currency, 'INR')) AS currencies
         FROM petty_cash_expenses p
        WHERE p.isDelete = 0 AND p.entry_kind = 'spend'
          AND p.linked_cost_uid IS NULL
          AND p.source_voucher_id IS NULL ${cashFilter}`,
		cashParams
	);
	const unlinkedRow = (unlinkedRows as DbRow[])[0] ?? {};

	const currencyOfSet = (set: Set<string>): string | null =>
		set.size === 1 ? [...set][0] : null;

	return {
		month,
		currency: single ? currencies[0] : null,
		funding: total(funding.get(currencies[0])?.amount),
		spend: total(spend.get(currencies[0])?.amount),
		settled_spend: total(spend.get(currencies[0])?.settled),
		unconfirmed_spend: total(cost.get(currencies[0])?.funded),
		remaining_funding: single ? byCurrency[0].remaining_funding : null,
		recognized_cost: total(cost.get(currencies[0])?.amount),
		by_currency: byCurrency,
		unresolved_settlements: {
			count: unresolvedCount,
			amount: currencyOfSet(unresolvedCurrencies)
				? rounded(unresolvedAmount)
				: null,
		},
		unlinked_spend: {
			count: num(unlinkedRow, 'count') ?? 0,
			amount:
				(num(unlinkedRow, 'currencies') ?? 0) > 1
					? null
					: rounded(num(unlinkedRow, 'amount') ?? 0),
		},
	};
}

// ── Recording ───────────────────────────────────────────────────────────────

export interface PettyCashSpendInput {
	/** Cash date of the spending (`transaction_date`). */
	transactionDate: string;
	/** Gross cash paid; the register's `debit_amount`. */
	amount: number | null;
	description?: string | null;
	category?: string | null;
	recipientName?: string | null;
	custodianEmployeeId?: number | null;
	custodianEmployeeName?: string | null;
	paymentMode?: string | null;
	paymentReference?: string | null;
	billNo?: string | null;
	billDate?: string | null;
	notes?: string | null;
	operationalStatus?: string | null;
	/** The funding voucher this spending is drawn from, when evidenced. */
	sourceVoucherId?: number | null;
	classification?: CostClassification | null;
	projectId?: number | null;
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	currency?: string | null;
	taxAmount?: number | null;
	taxTreatment?: TaxTreatment;
	taxEvidenceReference?: string | null;
	sourceReference?: string | null;
	evidenceReference?: string | null;
	/** A receipt already linked to this cost settles it instead of adding one. */
	linkedCostUid?: string | null;
	submit?: boolean;
	/** Actor-supplied number; the module mints one when absent. */
	transactionNumber?: string | null;
}

export interface RecordedPettyCashSpend {
	id: string;
	transaction_number: string;
	cost_uid: string;
	entry_kind: 'spend';
	recognition_state: RecognitionState;
	financial_version: number;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	recognized_amount: number | null;
	cost_classification: CostClassification | null;
	linked_cost_uid: string | null;
}

/** A JSON id field: a positive integer, null for absent, refused otherwise. */
function jsonId(value: unknown, field: string): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new CostError(
			'invalid_id',
			`${field} must be a positive integer`,
			422,
			{ field }
		);
	}
	return parsed;
}

/**
 * Map the register route's JSON body onto `PettyCashSpendInput`. This is the
 * untrusted boundary: each field is narrowed here, and the values that reach
 * the input are typed — numbers are numbers, not unvalidated `unknown`.
 */
export function pettyCashSpendInputFromJson(
	body: Record<string, unknown>
): PettyCashSpendInput {
	const optionalNumber = (value: unknown): number | null =>
		value === null || value === undefined || value === ''
			? null
			: amountOrNull(value);
	return {
		transactionDate: String(body.transaction_date ?? ''),
		amount: optionalNumber(body.debit_amount ?? body.amount),
		description: text(body.description, 500),
		category: text(body.expense_category, 100),
		recipientName: text(body.recipient_name, 255),
		custodianEmployeeId: jsonId(body.custodian_employee_id, 'custodian_employee_id'),
		custodianEmployeeName: text(body.custodian_employee_name, 255),
		paymentMode: text(body.payment_mode, 20),
		paymentReference: text(body.payment_reference, 255),
		billNo: text(body.bill_no, 100),
		billDate: dateOrNull(body.bill_date),
		notes: text(body.notes, 65535),
		operationalStatus: text(body.status, 20),
		sourceVoucherId: jsonId(body.source_voucher_id, 'source_voucher_id'),
		classification: enumOrThrow(
			body.cost_classification,
			CLASSIFICATIONS,
			'invalid_classification',
			'cost_classification'
		),
		projectId: jsonId(body.project_id, 'project_id'),
		servicePeriodStart: dateOrNull(body.service_period_start),
		servicePeriodEnd: dateOrNull(body.service_period_end),
		currency: text(body.currency, 3),
		taxAmount: optionalNumber(body.tax_amount),
		taxTreatment:
			enumOrThrow(
				body.tax_treatment,
				TAX_TREATMENTS,
				'invalid_tax_treatment',
				'tax_treatment'
			) ?? undefined,
		taxEvidenceReference: text(body.tax_evidence_reference, 255),
		sourceReference: text(body.source_reference, 191),
		evidenceReference: text(body.evidence_reference, 500),
		linkedCostUid: text(body.linked_cost_uid, 64),
		submit:
			body.submit === true || body.recognition_state === 'pending_evidence',
		transactionNumber: text(body.transaction_number, 50),
	};
}

const COMMANDS: readonly CostCommandName[] = [
	'update',
	'submit',
	'recognize',
	'reject',
	'cancel',
];

/** Whether a JSON value names a command the versioned path accepts. */
export function isPettyCashCommand(value: unknown): value is CostCommandName {
	return (
		typeof value === 'string' && (COMMANDS as readonly string[]).includes(value)
	);
}

/**
 * Map a command route's JSON body onto `PettyCashCommandInput`; the `patch`
 * object is narrowed field by field like the record boundary.
 */
export function pettyCashCommandInputFromJson(
	id: string,
	body: Record<string, unknown>
): PettyCashCommandInput {
	const rawPatch =
		body.patch && typeof body.patch === 'object'
			? (body.patch as Record<string, unknown>)
			: null;
	const patch: PettyCashSpendPatch | undefined = rawPatch
		? {
				classification:
					rawPatch.classification !== undefined
						? enumOrThrow(
								rawPatch.classification,
								CLASSIFICATIONS,
								'invalid_classification',
								'cost_classification'
							)
						: undefined,
				projectId:
					rawPatch.projectId !== undefined
						? jsonId(rawPatch.projectId, 'project_id')
						: undefined,
				servicePeriodStart:
					rawPatch.servicePeriodStart !== undefined
						? dateOrNull(rawPatch.servicePeriodStart)
						: undefined,
				servicePeriodEnd:
					rawPatch.servicePeriodEnd !== undefined
						? dateOrNull(rawPatch.servicePeriodEnd)
						: undefined,
				billDate:
					rawPatch.billDate !== undefined
						? dateOrNull(rawPatch.billDate)
						: undefined,
				currency:
					rawPatch.currency !== undefined
						? text(rawPatch.currency, 3)
						: undefined,
				grossAmount:
					rawPatch.grossAmount !== undefined
						? amountOrNull(rawPatch.grossAmount)
						: undefined,
				taxAmount:
					rawPatch.taxAmount !== undefined
						? amountOrNull(rawPatch.taxAmount)
						: undefined,
				taxTreatment:
					rawPatch.taxTreatment !== undefined
						? (enumOrThrow(
								rawPatch.taxTreatment,
								TAX_TREATMENTS,
								'invalid_tax_treatment',
								'tax_treatment'
							) ?? undefined)
						: undefined,
				taxEvidenceReference:
					rawPatch.taxEvidenceReference !== undefined
						? text(rawPatch.taxEvidenceReference, 255)
						: undefined,
				sourceReference:
					rawPatch.sourceReference !== undefined
						? text(rawPatch.sourceReference, 191)
						: undefined,
				evidenceReference:
					rawPatch.evidenceReference !== undefined
						? text(rawPatch.evidenceReference, 500)
						: undefined,
				linkedCostUid:
					rawPatch.linkedCostUid !== undefined
						? text(rawPatch.linkedCostUid, 64)
						: undefined,
			}
		: undefined;
	const expectedVersion = Number(body.expected_version);
	if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
		throw new CostError(
			'version_required',
			'expected_version is required',
			400
		);
	}
	if (!isPettyCashCommand(body.command)) {
		throw new CostError(
			'invalid_command',
			`Unknown command: ${String(body.command ?? '')}`,
			400
		);
	}
	return {
		id,
		command: body.command,
		expectedVersion,
		reason: body.reason === undefined ? null : String(body.reason),
		evidenceReference:
			body.evidence_reference === undefined
				? undefined
				: String(body.evidence_reference),
		patch,
	};
}

async function nextTransactionNumber(db: SqlConnection): Promise<string> {
	const [rows] = await db.execute(
		`SELECT transaction_number FROM petty_cash_expenses
      WHERE transaction_number LIKE 'PCX-%' AND isDelete = 0
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
	);
	let next = 1;
	const first = (rows as DbRow[])[0];
	if (first) {
		const match = /PCX-(\d+)/.exec(s(first, 'transaction_number', '') ?? '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `PCX-${String(next).padStart(5, '0')}`;
}

async function resolveVoucherReference(
	db: SqlConnection,
	voucherId: number
): Promise<{ voucher_number: string | null }> {
	const [rows] = await db.execute(
		`SELECT voucher_number FROM cash_vouchers WHERE id = ? AND (isDelete IS NULL OR isDelete = 0)`,
		[voucherId]
	);
	const row = (rows as DbRow[])[0];
	if (!row) {
		throw new CostError(
			'unknown_voucher_reference',
			`Cash voucher ${voucherId} does not exist`,
			422,
			{ field: 'source_voucher_id' }
		);
	}
	return { voucher_number: s(row, 'voucher_number') };
}

/**
 * Record actual petty-cash spending: one cost-bearing row with its identity,
 * evidence, Recognition Period, and destination. The row is never registered
 * as funding, and a resolvable `linkedCostUid` makes it a settlement of that
 * cost instead.
 */
export async function recordPettyCashSpend(
	input: PettyCashSpendInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<RecordedPettyCashSpend> {
	const transactionDate = dateOrNull(input.transactionDate);
	if (!transactionDate) {
		throw new CostError(
			'invalid_date',
			'transaction_date is required (YYYY-MM-DD)',
			422,
			{ field: 'transaction_date' }
		);
	}
	const amount = amountOrNull(input.amount);
	if (amount === null || amount <= 0) {
		throw new CostError(
			'invalid_amount',
			'A petty-cash spend needs a positive amount',
			422,
			{ field: 'debit_amount' }
		);
	}
	const classification = enumOrThrow(
		input.classification,
		CLASSIFICATIONS,
		'invalid_classification',
		'cost_classification'
	);
	const projectId = input.projectId ?? null;
	assertClassificationProject(classification, projectId);
	const taxAmount = amountOrNull(input.taxAmount);
	const taxTreatment =
		enumOrThrow(
			input.taxTreatment,
			TAX_TREATMENTS,
			'invalid_tax_treatment',
			'tax_treatment'
		) ?? 'unresolved';
	const currency = (text(input.currency, 3) ?? 'INR').toUpperCase();
	const servicePeriodStart = dateOrNull(input.servicePeriodStart);
	const servicePeriodEnd = dateOrNull(input.servicePeriodEnd);
	const billDate = dateOrNull(input.billDate);
	const { period, basis } = resolveRecognitionPeriod({
		servicePeriodStart,
		servicePeriodEnd,
		billDate,
	});
	const linkedCostUid = text(input.linkedCostUid, 64);
	const sourceVoucherId = input.sourceVoucherId ?? null;
	const paymentMode = pickEnum(input.paymentMode, PAYMENT_MODES) ?? 'cash';
	const state: RecognitionState = input.submit ? 'pending_evidence' : 'draft';
	const operationalStatus =
		pickEnum(input.operationalStatus, OPERATIONAL_STATUSES) ?? 'submitted';
	const costUid = `cost-${randomUUID()}`;

	const ownsTransaction = !options?.connection;
	for (let attempt = 1; ; attempt++) {
		try {
			return await inTransaction(options, async (db) => {
				// Reliable references only: the voucher must exist, and a link to
				// another cost must resolve to a real cost identity. A failed
				// resolution is never treated as a new cost.
				let voucherNumber: string | null = null;
				if (sourceVoucherId !== null) {
					voucherNumber = (await resolveVoucherReference(db, sourceVoucherId))
						.voucher_number;
				}
				let resolvedLinkedUid: string | null = null;
				if (linkedCostUid) {
					const reference = await resolveCostReference(db, linkedCostUid);
					if (!reference) {
						throw new CostError(
							'unknown_source_reference',
							`The linked cost ${linkedCostUid} does not resolve`,
							422,
							{ field: 'linked_cost_uid' }
						);
					}
					resolvedLinkedUid = reference.cost_uid;
				}

				const id = randomUUID();
				const transactionNumber =
					text(input.transactionNumber, 50) ??
					(await nextTransactionNumber(db));

				const [result] = (await db.execute(
					`INSERT INTO petty_cash_expenses
             (id, transaction_number, transaction_date, credit_amount, debit_amount,
              expense_category, description, payment_mode, payment_reference,
              recipient_name, custodian_employee_id, custodian_employee_name,
              bill_no, bill_date, status, notes, created_by, source_voucher_id,
              entry_kind, cost_uid, cost_classification, project_id,
              recognition_state, recognition_period, period_basis,
              service_period_start, service_period_end, currency, tax_amount,
              tax_treatment, tax_evidence_reference, source_reference,
              evidence_reference, linked_cost_uid, financial_version)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'spend', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
					[
						id,
						transactionNumber,
						transactionDate,
						amount,
						text(input.category, 100),
						text(input.description, 500) ?? text(voucherNumber, 500),
						paymentMode,
						text(input.paymentReference, 255),
						text(input.recipientName, 255),
						input.custodianEmployeeId ?? null,
						text(input.custodianEmployeeName, 255),
						text(input.billNo, 100),
						billDate,
						operationalStatus,
						text(input.notes, 65535),
						actor.id,
						sourceVoucherId,
						costUid,
						classification,
						projectId,
						state,
						period,
						basis,
						servicePeriodStart,
						servicePeriodEnd,
						currency,
						taxAmount,
						taxTreatment,
						text(input.taxEvidenceReference, 255),
						text(input.sourceReference, 191),
						text(input.evidenceReference, 500),
						resolvedLinkedUid,
					]
				)) as [Record<string, unknown>, unknown];
				const numericId = Number(result.insertId);

				const evaluation = evaluateCost({
					classification,
					state,
					currency,
					grossAmount: amount,
					taxAmount,
					taxTreatment,
					taxEvidenceReference: text(input.taxEvidenceReference, 255),
					servicePeriodStart,
					servicePeriodEnd,
					billDate,
					sourceReference: text(input.sourceReference, 191),
					evidenceReference: text(input.evidenceReference, 500),
					recognitionPeriod: period,
					periodBasis: basis,
					recognizedAmount: null,
				});

				if (resolvedLinkedUid) {
					// The receipt settles an existing cost: a reference, not a
					// second cost. Nothing registers a new cost identity.
					await linkCostReference(db, {
						costUid: resolvedLinkedUid,
						sourceTable: 'petty_cash_expenses',
						sourceId: id,
						role: 'settlement',
						basis: 'document',
						evidenceReference: text(input.evidenceReference, 500),
						createdBy: actor.id,
					});
				} else {
					await registerCostIdentity(db, {
						costUid,
						sourceTable: 'petty_cash_expenses',
						sourceId: id,
						createdBy: actor.id,
					});
				}

				await writeCostEvent(db, {
					costUid,
					sourceTable: 'petty_cash_expenses',
					sourceId: numericId,
					version: 1,
					command: 'recorded',
					actorId: actor.id,
					reason:
						state === 'pending_evidence' ? 'Submitted for recognition' : null,
					evidenceReference: text(input.evidenceReference, 500),
					snapshot: {
						classification,
						recognition_period: period,
						period_basis: basis,
						currency,
						gross_amount: amount,
						tax_amount: taxAmount,
						recognized_amount: null,
						state,
						linked_cost_uid: resolvedLinkedUid,
						source_voucher_id: sourceVoucherId,
						exceptions: evaluation.exceptions,
					},
				});

				return {
					id,
					transaction_number: transactionNumber,
					cost_uid: costUid,
					entry_kind: 'spend' as const,
					recognition_state: state,
					financial_version: 1,
					recognition_period: period,
					period_basis: basis,
					recognized_amount: null,
					cost_classification: classification,
					linked_cost_uid: resolvedLinkedUid,
				};
			});
		} catch (error) {
			if (
				ownsTransaction &&
				!input.transactionNumber &&
				isRetryableNumberError(error) &&
				attempt < 5
			) {
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 15 * attempt);
				await promise;
				continue;
			}
			throw error;
		}
	}
}

// ── Funding mirror ──────────────────────────────────────────────────────────

export interface FundingMirrorInput {
	voucherId: number;
	voucherNumber: string | null;
	voucherDate: string | null;
	totalAmount: number;
	description?: string | null;
	currency?: string | null;
	actorId: number | null;
}

export interface FundingMirrorResult {
	/** `petty_cash_expenses.id` of the mirrored credit row. */
	id: string;
	/** The funding-event identity shared by the voucher and its mirror. */
	costUid: string;
	created: boolean;
	creditAmount: number;
}

/**
 * Keep exactly one funding credit for a voucher. Creating a voucher inserts
 * the mirror; editing it updates the same row instead of adding another, so
 * repeated mirroring can never create a second funding event or a second cost.
 * Runs on the caller's connection (the voucher route's transaction).
 */
export async function ensureFundingMirror(
	db: SqlConnection,
	input: FundingMirrorInput
): Promise<FundingMirrorResult | null> {
	const costUid = fundingEventUid(input.voucherId);
	const currency = (text(input.currency, 3) ?? 'INR').toUpperCase();
	const [rows] = (await db.execute(
		`SELECT id, credit_amount FROM petty_cash_expenses
      WHERE source_voucher_id = ? AND entry_kind = 'funding' AND isDelete = 0
      ORDER BY created_at, id
      LIMIT 1 FOR UPDATE`,
		[input.voucherId]
	)) as [DbRow[], unknown];

	const existing = rows[0];
	let mirrorId: string;
	let created = false;
	if (existing) {
		mirrorId = String(existing.id);
		await db.execute(
			`UPDATE petty_cash_expenses
          SET credit_amount = ?, description = ?, cost_uid = ?, currency = ?,
              transaction_date = COALESCE(?, transaction_date)
        WHERE id = ?`,
			[
				input.totalAmount,
				text(input.description, 500),
				costUid,
				currency,
				input.voucherDate,
				mirrorId,
			]
		);
	} else {
		if (input.totalAmount <= 0) return null;
		mirrorId = randomUUID();
		created = true;
		await db.execute(
			`INSERT INTO petty_cash_expenses
         (id, transaction_number, transaction_date, credit_amount, debit_amount,
          description, status, created_by, source_voucher_id, entry_kind, cost_uid,
          currency)
       VALUES (?, ?, ?, ?, 0, ?, 'submitted', ?, ?, 'funding', ?, ?)`,
			[
				mirrorId,
				// The register number is NOT NULL and unique: a legacy voucher
				// without a number still gets a deterministic funding reference.
				input.voucherNumber ?? `FUND-${input.voucherId}`,
				input.voucherDate ?? new Date().toISOString().slice(0, 10),
				input.totalAmount,
				text(input.description, 500),
				input.actorId,
				input.voucherId,
				costUid,
				currency,
			]
		);
	}

	// The funding pair is cash movement, never cost: both link rows carry the
	// funding-event identity and no role='cost' row is written for it.
	await linkCostReference(db, {
		costUid,
		sourceTable: 'cash_vouchers',
		sourceId: input.voucherId,
		role: 'funding',
		basis: 'system',
		evidenceReference: input.voucherNumber,
		createdBy: input.actorId,
	});
	await linkCostReference(db, {
		costUid,
		sourceTable: 'petty_cash_expenses',
		sourceId: mirrorId,
		role: 'mirror',
		basis: 'system',
		evidenceReference: input.voucherNumber,
		createdBy: input.actorId,
	});

	return {
		id: mirrorId,
		costUid,
		created,
		creditAmount: input.totalAmount,
	};
}

// ── Versioned commands ──────────────────────────────────────────────────────

export interface PettyCashSpendPatch {
	classification?: CostClassification | null;
	projectId?: number | null;
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	billDate?: string | null;
	currency?: string | null;
	grossAmount?: number | null;
	taxAmount?: number | null;
	taxTreatment?: TaxTreatment;
	taxEvidenceReference?: string | null;
	sourceReference?: string | null;
	evidenceReference?: string | null;
	linkedCostUid?: string | null;
}

export interface PettyCashCommandInput {
	/** `petty_cash_expenses.id` of the spending row. */
	id: string;
	command: CostCommandName;
	expectedVersion: number;
	reason?: string | null;
	evidenceReference?: string | null;
	patch?: PettyCashSpendPatch;
}

export interface PettyCashCommandResult {
	id: string;
	cost_uid: string | null;
	recognition_state: RecognitionState;
	financial_version: number;
	recognized_amount: number | null;
	recognition_period: string | null;
	component: CostCommandName;
}

async function loadSpendForUpdate(
	db: SqlConnection,
	id: string
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`SELECT id, numeric_id, entry_kind, cost_uid, cost_classification,
            project_id, recognition_state, recognition_period, period_basis,
            service_period_start, service_period_end, bill_date, transaction_date,
            currency, debit_amount, tax_amount, tax_treatment,
            tax_evidence_reference, recognized_amount, source_reference,
            evidence_reference, linked_cost_uid, financial_version,
            recognized_by, recognized_at
       FROM petty_cash_expenses
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * One versioned command on a petty-cash spend. State check, version check,
 * update, and journal append are one transaction; a failure leaves no partial
 * write, and a repeated or stale command changes nothing.
 */
export async function executePettyCashCommand(
	input: PettyCashCommandInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<PettyCashCommandResult> {
	return inTransaction(options, async (db) => {
		const row = await loadSpendForUpdate(db, input.id);
		if (!row) {
			throw new CostError('not_found', 'Petty-cash entry not found', 404);
		}
		if (row.entry_kind === 'funding') {
			throw new CostError(
				'funding_event_managed_by_voucher',
				'A funding credit is cash movement managed through its cash voucher; it is never cost',
				409
			);
		}
		const costUid = text(row.cost_uid, 64);
		if (!costUid) {
			throw new CostError(
				'missing_cost_identity',
				'This petty-cash row has no cost identity',
				409
			);
		}
		const state = (s(row, 'recognition_state', 'draft') ??
			'draft') as RecognitionState;
		const version = Number(num(row, 'financial_version') ?? 1);
		if (version !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				`This petty-cash spend changed since it was read (current version ${version})`,
				409,
				{ current_version: version }
			);
		}
		const target = nextState(state, input.command);
		if (!target) {
			throw new CostError(
				'command_not_allowed',
				`${input.command} is not allowed while the spend is ${state}`,
				422,
				{ state }
			);
		}
		if (
			(input.command === 'reject' || input.command === 'cancel') &&
			!text(input.reason, 500)
		) {
			throw new CostError(
				'reason_required',
				`A reason is required to ${input.command} spending`,
				422
			);
		}

		const patch = input.patch ?? {};
		const merged = {
			classification:
				patch.classification !== undefined
					? enumOrThrow(
							patch.classification,
							CLASSIFICATIONS,
							'invalid_classification',
							'cost_classification'
						)
					: ((row.cost_classification ?? null) as
							| CostClassification
							| null),
			projectId:
				patch.projectId !== undefined
					? patch.projectId
					: row.project_id === null || row.project_id === undefined
						? null
						: Number(row.project_id),
			servicePeriodStart:
				patch.servicePeriodStart !== undefined
					? dateOrNull(patch.servicePeriodStart)
					: dateOrNull(row.service_period_start),
			servicePeriodEnd:
				patch.servicePeriodEnd !== undefined
					? dateOrNull(patch.servicePeriodEnd)
					: dateOrNull(row.service_period_end),
			billDate:
				patch.billDate !== undefined
					? dateOrNull(patch.billDate)
					: dateOrNull(row.bill_date),
			currency:
				patch.currency !== undefined
					? (text(patch.currency, 3) ?? 'INR').toUpperCase()
					: (text(row.currency, 3) ?? 'INR'),
			grossAmount:
				patch.grossAmount !== undefined
					? amountOrNull(patch.grossAmount)
					: num(row, 'debit_amount'),
			taxAmount:
				patch.taxAmount !== undefined
					? amountOrNull(patch.taxAmount)
					: num(row, 'tax_amount'),
			taxTreatment:
				patch.taxTreatment !== undefined
					? (enumOrThrow(
							patch.taxTreatment,
							TAX_TREATMENTS,
							'invalid_tax_treatment',
							'tax_treatment'
						) ?? 'unresolved')
					: ((row.tax_treatment ?? 'unresolved') as TaxTreatment),
			taxEvidenceReference:
				patch.taxEvidenceReference !== undefined
					? text(patch.taxEvidenceReference, 255)
					: text(row.tax_evidence_reference, 255),
			sourceReference:
				patch.sourceReference !== undefined
					? text(patch.sourceReference, 191)
					: text(row.source_reference, 191),
			evidenceReference:
				patch.evidenceReference !== undefined
					? text(patch.evidenceReference, 500)
					: input.evidenceReference !== undefined
						? text(input.evidenceReference, 500)
						: text(row.evidence_reference, 500),
			linkedCostUid:
				patch.linkedCostUid !== undefined
					? text(patch.linkedCostUid, 64)
					: text(row.linked_cost_uid, 64),
		};

		assertClassificationProject(merged.classification, merged.projectId);

		const existingBasis = (row.period_basis ?? 'unresolved') as PeriodBasis;
		const datesChanged =
			patch.servicePeriodStart !== undefined ||
			patch.servicePeriodEnd !== undefined ||
			patch.billDate !== undefined;
		const resolved = datesChanged
			? resolveRecognitionPeriod(merged)
			: {
					period: (row.recognition_period ?? null) as string | null,
					basis: existingBasis,
				};

		// A linked receipt settles one existing cost. The reference must resolve
		// whenever it is set or relied on; a broken link never becomes a new cost.
		let linkedCostUid: string | null = merged.linkedCostUid;
		if (linkedCostUid) {
			const reference = await resolveCostReference(db, linkedCostUid);
			if (!reference) {
				throw new CostError(
					'unknown_source_reference',
					`The linked cost ${linkedCostUid} does not resolve`,
					422,
					{ field: 'linked_cost_uid' }
				);
			}
			linkedCostUid = reference.cost_uid;
		}

		const financial = {
			...merged,
			state: target,
			recognitionPeriod: resolved.period,
			periodBasis: resolved.basis,
			recognizedAmount: null,
		};

		let recognizedAmount: number | null = num(row, 'recognized_amount');
		let recognizedBy: number | null = num(row, 'recognized_by');
		const recognizedAt: string | null = (row.recognized_at ?? null) as
			| string
			| null;

		if (input.command === 'recognize') {
			const blockers = recognitionBlockers({
				grossAmount: merged.grossAmount,
				classification: merged.classification,
				projectId: merged.projectId,
				recognitionPeriod: resolved.period,
				currency: merged.currency,
			});
			if (blockers.length > 0) {
				throw new CostError(
					'not_ready_for_recognition',
					'This petty-cash spend cannot become confirmed cost yet',
					422,
					{ missing: blockers }
				);
			}
			// A settlement recognizes no new cost; only a receipt that creates
			// its own cost carries a recognized amount.
			recognizedAmount = linkedCostUid
				? null
				: evaluateCost(financial).recognizedAmount;
			recognizedBy = actor.id;
		}

		const nextVersion = version + 1;
		const operationalStatus = STATE_TO_STATUS[target];
		const [updated] = (await db.execute(
			`UPDATE petty_cash_expenses
          SET cost_classification = ?, recognition_state = ?, recognition_period = ?,
              period_basis = ?, service_period_start = ?, service_period_end = ?,
              bill_date = ?, tax_treatment = ?, tax_evidence_reference = ?,
              currency = ?, debit_amount = ?, tax_amount = ?, source_reference = ?,
              evidence_reference = ?, linked_cost_uid = ?, recognized_amount = ?,
              recognized_by = ?,
              recognized_at = IF(?, NOW(), ?),
              financial_version = ?, status = ?,
              approved_by = IF(?, ?, approved_by),
              approved_at = IF(?, NOW(), approved_at)
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[
				merged.classification,
				target,
				resolved.period,
				resolved.basis,
				merged.servicePeriodStart,
				merged.servicePeriodEnd,
				merged.billDate,
				merged.taxTreatment,
				merged.taxEvidenceReference,
				merged.currency,
				merged.grossAmount,
				merged.taxAmount,
				merged.sourceReference,
				merged.evidenceReference,
				linkedCostUid,
				recognizedAmount,
				recognizedBy,
				input.command === 'recognize' ? 1 : 0,
				recognizedAt,
				nextVersion,
				operationalStatus,
				input.command === 'recognize' ? 1 : 0,
				recognizedBy,
				input.command === 'recognize' ? 1 : 0,
				input.id,
				version,
			]
		)) as [Record<string, unknown>, unknown];
		if (Number(updated.affectedRows ?? 0) === 0) {
			throw new CostError(
				'version_conflict',
				'This petty-cash spend changed while the command was applied',
				409
			);
		}

		await writeCostEvent(db, {
			costUid,
			sourceTable: 'petty_cash_expenses',
			sourceId: Number(num(row, 'numeric_id') ?? 0),
			version: nextVersion,
			command: JOURNAL_COMMAND[input.command],
			actorId: actor.id,
			reason: text(input.reason, 500),
			evidenceReference: merged.evidenceReference,
			snapshot: {
				classification: merged.classification,
				recognition_period: resolved.period,
				period_basis: resolved.basis,
				currency: merged.currency,
				gross_amount: merged.grossAmount,
				tax_amount: merged.taxAmount,
				tax_treatment: merged.taxTreatment,
				recognized_amount: recognizedAmount,
				linked_cost_uid: linkedCostUid,
				state: target,
			},
		});

		return {
			id: input.id,
			cost_uid: costUid,
			recognition_state: target,
			financial_version: nextVersion,
			recognized_amount: recognizedAmount,
			recognition_period: resolved.period,
			component: input.command,
		};
	});
}
