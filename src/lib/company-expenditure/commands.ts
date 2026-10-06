/**
 * The write path for direct cost: record a cost, then move it through the
 * explicit recognition states with versioned commands.
 *
 * Invariants this module owns:
 *  - one row per underlying cost, one version, one append-only journal entry
 *    per accepted command;
 *  - a command must present the version it expects, so two operators (or one
 *    replayed request) cannot both apply to the same state;
 *  - a cost becomes confirmed cost only through an explicit `recognize` that
 *    passes the recognition blockers; nothing else sets `recognized`;
 *  - rejected, cancelled, and superseded states keep their history — they are
 *    never deleted;
 *  - a missing amount stays NULL. Nothing here turns unknown into zero.
 *
 * Atomicity: pass `connection` to run inside the caller's transaction (a
 * financial-close or revision check that must commit with this change);
 * otherwise the module opens its own.
 */

import { randomUUID } from 'node:crypto';
import { add, sub, R, toNumber } from '@/lib/money';
import { withTransaction } from '@/utils/database';
import { isRetryableNumberError } from '@/utils/db-number-retry';
import {
	evaluateCost,
	nextState,
	recognitionBlockers,
	resolveRecognitionPeriod,
} from './recognition';
import { mapCostRow, type SqlConnection } from './records';
import type {
	CostCommandInput,
	CostCommandName,
	CostCommandResult,
	CostJournalCommand,
	CostRecord,
	PeriodBasis,
	RecordCostInput,
	RecordedCost,
	RecognitionState,
} from './types';

export interface CostActor {
	id: number | null;
}

export interface CommandOptions {
	/** Use the caller's connection/transaction instead of opening one. */
	connection?: SqlConnection;
}

/** A command or validation failure the route maps onto an HTTP status. */
export class CostError extends Error {
	readonly code: string;
	readonly status: number;
	readonly detail: Record<string, unknown>;

	constructor(
		code: string,
		message: string,
		status: number,
		detail: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'CostError';
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

async function inTransaction<T>(
	options: CommandOptions | undefined,
	work: (db: SqlConnection) => Promise<T>
): Promise<T> {
	if (options?.connection) return work(options.connection);
	return withTransaction((db) => work(db)) as Promise<T>;
}

/**
 * Mint the register's own number (EXP-#####). The read takes a row lock so
 * concurrent creates serialize behind it; the active-number unique index is
 * the backstop and the caller retries on a duplicate key.
 */
async function nextExpenseNumber(db: SqlConnection): Promise<string> {
	const [rows] = (await db.execute(
		`SELECT expense_number FROM expenses
      WHERE expense_number LIKE 'EXP-%' AND isDelete = 0
      ORDER BY id DESC LIMIT 1 FOR UPDATE`
	)) as [Array<{ expense_number: string }>, unknown];
	let next = 1;
	if (rows.length > 0) {
		const parsed = parseInt(rows[0].expense_number.replace('EXP-', ''), 10);
		if (Number.isFinite(parsed)) next = parsed + 1;
	}
	return `EXP-${String(next).padStart(5, '0')}`;
}

/** Stable identity of one underlying cost, minted once at capture. */
function mintCostUid(): string {
	return `cost-${randomUUID()}`;
}

function text(value: unknown, max: number): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function amountOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		throw new CostError('invalid_amount', 'Amount must be a number', 422);
	}
	return parsed;
}

function dateOrNull(value: unknown): string | null {
	const trimmed = text(value, 10);
	if (!trimmed) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new CostError('invalid_date', `Invalid date: ${trimmed}`, 422);
	}
	return trimmed;
}

const STATE_TO_STATUS: Record<RecognitionState, string> = {
	draft: 'draft',
	pending_evidence: 'submitted',
	recognized: 'approved',
	rejected: 'rejected',
	cancelled: 'submitted',
};

/**
 * The one translation from the command API vocabulary (imperative) to the
 * journal's vocabulary (`financial_cost_events.command`, past tense). The
 * column is an ENUM of exactly these values under STRICT_TRANS_TABLES: writing
 * the raw command name would truncate and roll the whole transaction back.
 */
const JOURNAL_COMMAND: Record<CostCommandName, CostJournalCommand> = {
	update: 'updated',
	submit: 'submitted',
	recognize: 'recognized',
	reject: 'rejected',
	cancel: 'cancelled',
};

const CLASSIFICATIONS = [
	'project',
	'company_overhead',
	'unallocated',
] as const;
const TAX_TREATMENTS = [
	'none',
	'recoverable',
	'non_recoverable',
	'unresolved',
] as const;
const PAYMENT_MODES = ['cash', 'bank', 'cheque', 'card', 'upi', 'other'] as const;
const OPERATIONAL_STATUSES = [
	'draft',
	'submitted',
	'approved',
	'rejected',
	'reimbursed',
] as const;

/** One of `allowed`, or null for anything else — request bodies are untrusted. */
function pickEnum<T extends string>(
	value: unknown,
	allowed: readonly T[]
): T | null {
	if (value === null || value === undefined) return null;
	const candidate = String(value).trim();
	return (allowed as readonly string[]).includes(candidate)
		? (candidate as T)
		: null;
}

function enumOrThrow<T extends string>(
	value: unknown,
	allowed: readonly T[],
	code: string,
	field: string
): T | null {
	const picked = pickEnum(value, allowed);
	if (value !== null && value !== undefined && String(value).trim() !== '' && !picked) {
		throw new CostError(code, `Unknown ${field}: ${String(value)}`, 422, {
			field,
		});
	}
	return picked;
}

async function loadCostForUpdate(
	db: SqlConnection,
	id: number
): Promise<Record<string, unknown> | null> {
	const [rows] = (await db.execute(
		`SELECT id, cost_uid, expense_number, expense_date, cost_classification,
            recognition_state, recognition_period, period_basis,
            service_period_start, service_period_end, tax_treatment,
            tax_evidence_reference, recognized_amount, source_reference,
            evidence_reference, financial_version, recognized_by, recognized_at,
            currency, amount, tax_amount, total_amount, vendor_name, description,
            project_id
       FROM expenses
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [Record<string, unknown>[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

interface JournalInput {
	costUid: string;
	sourceId: number;
	version: number;
	command: CostJournalCommand;
	actorId: number | null;
	reason: string | null;
	evidenceReference: string | null;
	snapshot: Record<string, unknown>;
}

async function writeJournal(db: SqlConnection, entry: JournalInput) {
	await db.execute(
		`INSERT INTO financial_cost_events
       (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
        evidence_reference, snapshot)
     VALUES (?, 'expenses', ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.costUid,
			entry.sourceId,
			entry.version,
			entry.command,
			entry.actorId,
			entry.reason,
			entry.evidenceReference,
			JSON.stringify(entry.snapshot),
		]
	);
}

function financialSnapshot(row: Record<string, unknown>): Record<string, unknown> {
	return {
		classification: row.cost_classification ?? null,
		recognition_period: row.recognition_period ?? null,
		period_basis: row.period_basis ?? null,
		currency: row.currency ?? null,
		gross_amount: row.total_amount ?? null,
		tax_amount: row.tax_amount ?? null,
		tax_treatment: row.tax_treatment ?? null,
		recognized_amount: row.recognized_amount ?? null,
		state: row.recognition_state ?? null,
	};
}

/**
 * Record a direct cost. Without a classification the cost lands in the
 * explicit unresolved state; with `submit` it enters the recognition queue.
 */
export async function recordCost(
	input: RecordCostInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<RecordedCost> {
	const currency = (text(input.currency, 3) ?? 'INR').toUpperCase();
	const taxAmount = amountOrNull(input.taxAmount);
	// A caller that speaks the register's own shape gives the net amount; the
	// gross liability is then net + tax. A caller that states the gross keeps it.
	const statedGross = amountOrNull(input.grossAmount);
	const legacyNet = amountOrNull(input.amount);
	const grossAmount =
		statedGross !== null
			? statedGross
			: legacyNet !== null
				? toNumber(add(R(legacyNet), R(taxAmount ?? 0)))
				: null;
	const servicePeriodStart = dateOrNull(input.servicePeriodStart);
	const servicePeriodEnd = dateOrNull(input.servicePeriodEnd);
	const billDate = dateOrNull(input.billDate);
	const classification = enumOrThrow(
		input.classification,
		CLASSIFICATIONS,
		'invalid_classification',
		'cost_classification'
	);
	const taxTreatment =
		enumOrThrow(
			input.taxTreatment,
			TAX_TREATMENTS,
			'invalid_tax_treatment',
			'tax_treatment'
		) ?? 'unresolved';
	const paymentMode =
		pickEnum(input.paymentMode, PAYMENT_MODES) ?? 'bank';
	const operationalStatus = pickEnum(
		input.operationalStatus,
		OPERATIONAL_STATUSES
	);
	const projectId = input.projectId ?? null;

	if (classification === 'project' && !projectId) {
		throw new CostError(
			'classification_conflict',
			'A Project classification needs a project_id',
			422,
			{ missing: ['project_id'] }
		);
	}
	if (classification && classification !== 'project' && projectId) {
		throw new CostError(
			'classification_conflict',
			'Company Overhead and Unallocated Cost cannot carry a project_id',
			422,
			{ missing: ['project_id_not_allowed'] }
		);
	}
	if (grossAmount !== null && grossAmount < 0 && taxAmount === null) {
		throw new CostError(
			'invalid_amount',
			'A negative gross amount needs its tax amount',
			422
		);
	}

	const { period, basis } = resolveRecognitionPeriod({
		servicePeriodStart,
		servicePeriodEnd,
		billDate,
	});
	const state: RecognitionState = input.submit ? 'pending_evidence' : 'draft';
	const expenseDate = dateOrNull(input.expenseDate) ?? billDate;

	const financial = {
		classification,
		state,
		currency,
		grossAmount,
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
	};
	const evaluation = evaluateCost(financial);
	// `amount` keeps the register's meaning: the base amount, with tax held
	// separately in `tax_amount` and the gross liability in `total_amount`.
	const netAmount =
		grossAmount === null
			? null
			: toNumber(sub(R(grossAmount), R(taxAmount ?? 0)));

	// Minting the number is a `SELECT ... FOR UPDATE` race: a concurrent create
	// can make the INSERT collide (duplicate key), deadlock, or hit a lock-wait
	// timeout. Each attempt runs its own transaction from a fresh read, as the
	// register's create loop always did, and only when the module owns the
	// transaction — a caller-supplied connection is never silently retried.
	const ownsTransaction = !options?.connection;
	for (let attempt = 1; ; attempt++) {
		try {
			return await inTransaction(options, async (db) => {
				const costUid = mintCostUid();
				const expenseNumber =
					text(input.expenseNumber, 50) ?? (await nextExpenseNumber(db));
				const [result] = (await db.execute(
					`INSERT INTO expenses
             (expense_number, expense_date, category, sub_category, description, vendor_name,
              amount, tax_amount, total_amount, currency, payment_mode, payment_reference,
              paid_to, paid_by, receipt_url, is_billable, is_reimbursable,
              project_id, department, notes, status, created_by, isDelete,
              cost_uid, cost_classification, recognition_state, recognition_period,
              period_basis, service_period_start, service_period_end, tax_treatment,
              tax_evidence_reference, recognized_amount, source_reference,
              evidence_reference, financial_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
					[
						expenseNumber,
						expenseDate,
						text(input.category, 100) ?? 'Direct Expense',
						text(input.subCategory, 100),
						text(input.description, 500),
						text(input.vendorName, 255),
						netAmount,
						taxAmount,
						grossAmount,
						currency,
						paymentMode,
						text(input.paymentReference, 255),
						text(input.paidTo, 255),
						input.paidBy ?? actor.id,
						text(input.receiptUrl, 500),
						input.isBillable ? 1 : 0,
						input.isReimbursable ? 1 : 0,
						projectId,
						text(input.department, 100),
						text(input.notes, 65535),
						operationalStatus ?? STATE_TO_STATUS[state],
						actor.id,
						costUid,
						classification,
						state,
						period,
						basis,
						servicePeriodStart,
						servicePeriodEnd,
						financial.taxTreatment,
						financial.taxEvidenceReference,
						null,
						financial.sourceReference,
						financial.evidenceReference,
					]
				)) as [Record<string, unknown>, unknown];
				const insertId = Number(result.insertId);

				await writeJournal(db, {
					costUid,
					sourceId: insertId,
					version: 1,
					command: 'recorded',
					actorId: actor.id,
					reason:
						state === 'pending_evidence' ? 'Submitted for recognition' : null,
					evidenceReference: financial.evidenceReference,
					snapshot: {
						classification,
						recognition_period: period,
						period_basis: basis,
						currency,
						gross_amount: grossAmount,
						tax_amount: taxAmount,
						recognized_amount: null,
						state,
						exceptions: evaluation.exceptions,
					},
				});

				return {
					id: insertId,
					expense_number: expenseNumber,
					cost_uid: costUid,
					recognition_state: state,
					financial_version: 1,
					recognition_period: period,
					period_basis: basis,
					recognized_amount: null,
					cost_classification: classification,
				};
			});
		} catch (error) {
			if (
				ownsTransaction &&
				!input.expenseNumber &&
				isRetryableNumberError(error) &&
				attempt < 5
			) {
				// Separate the attempts so two racing creates do not collide again
				// in lockstep.
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 15 * attempt);
				await promise;
				continue;
			}
			throw error;
		}
	}
}

/** The cost a command targets, in the module's own shape. */
export async function loadCost(
	db: SqlConnection,
	id: number
): Promise<CostRecord | null> {
	const [rows] = (await db.execute(
		`SELECT e.id, e.cost_uid, e.expense_number, e.expense_date, e.cost_classification,
            e.recognition_state, e.recognition_period, e.period_basis,
            e.service_period_start, e.service_period_end, e.tax_treatment,
            e.tax_evidence_reference, e.recognized_amount, e.source_reference,
            e.evidence_reference, e.financial_version, e.recognized_by, e.recognized_at,
            e.currency, e.amount, e.tax_amount, e.total_amount,
            e.vendor_name, e.description,
            e.project_id, p.project_code,
            COALESCE(p.project_title, p.name) AS project_name, p.client_name
       FROM expenses e
       LEFT JOIN projects p ON p.project_id = e.project_id AND p.isDelete = 0
      WHERE e.id = ? AND e.isDelete = 0`,
		[id]
	)) as [Record<string, unknown>[], unknown];
	return rows.length > 0 ? mapCostRow(rows[0]) : null;
}

/**
 * Apply one versioned command to a cost. Everything happens in one
 * transaction: the state check, the version check, the update, and the journal
 * entry. A failure leaves no partial write.
 */
export async function executeCommand(
	input: CostCommandInput,
	actor: CostActor,
	options?: CommandOptions
): Promise<CostCommandResult> {
	return inTransaction(options, async (db) => {
		const row = await loadCostForUpdate(db, input.id);
		if (!row) {
			throw new CostError('not_found', 'Cost not found', 404);
		}
		const state = String(row.recognition_state ?? 'draft') as RecognitionState;
		const version = Number(row.financial_version ?? 1);
		if (version !== input.expectedVersion) {
			throw new CostError(
				'version_conflict',
				`This cost changed since it was read (current version ${version})`,
				409,
				{ current_version: version }
			);
		}
		const target = nextState(state, input.command);
		if (!target) {
			throw new CostError(
				'command_not_allowed',
				`${input.command} is not allowed while the cost is ${state}`,
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
				`A reason is required to ${input.command} a cost`,
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
					: ((row.cost_classification ?? null) as CostRecord['classification']),
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
					: dateOrNull(row.expense_date),
			currency:
				patch.currency !== undefined
					? (text(patch.currency, 3) ?? 'INR').toUpperCase()
					: (text(row.currency, 3) ?? 'INR'),
			grossAmount:
				patch.grossAmount !== undefined
					? amountOrNull(patch.grossAmount)
					: amountOrNull(row.total_amount),
			taxAmount:
				patch.taxAmount !== undefined
					? amountOrNull(patch.taxAmount)
					: amountOrNull(row.tax_amount),
			taxTreatment:
				patch.taxTreatment !== undefined
					? (enumOrThrow(
							patch.taxTreatment,
							TAX_TREATMENTS,
							'invalid_tax_treatment',
							'tax_treatment'
						) ?? 'unresolved')
					: ((row.tax_treatment ?? 'unresolved') as CostRecord['taxTreatment']),
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
		};

		if (merged.classification === 'project' && !merged.projectId) {
			throw new CostError(
				'classification_conflict',
				'A Project classification needs a project_id',
				422,
				{ missing: ['project_id'] }
			);
		}
		if (
			merged.classification &&
			merged.classification !== 'project' &&
			merged.projectId
		) {
			throw new CostError(
				'classification_conflict',
				'Company Overhead and Unallocated Cost cannot carry a project_id',
				422,
				{ missing: ['project_id_not_allowed'] }
			);
		}

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

		const financial = {
			...merged,
			state: target,
			recognitionPeriod: resolved.period,
			periodBasis: resolved.basis,
			recognizedAmount: null,
		};

		let recognizedAmount: number | null =
			row.recognized_amount === null || row.recognized_amount === undefined
				? null
				: Number(row.recognized_amount);
		let recognizedAt: string | null = (row.recognized_at ?? null) as string | null;
		let recognizedBy: number | null =
			row.recognized_by === null || row.recognized_by === undefined
				? null
				: Number(row.recognized_by);

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
					'This cost cannot become confirmed cost yet',
					422,
					{ missing: blockers }
				);
			}
			recognizedAmount = evaluateCost(financial).recognizedAmount;
			recognizedBy = actor.id;
		}
		// A cancellation stops the cost counting as confirmed cost (the state
		// filter does that) without erasing the recorded amount: the row and its
		// journal stay as the evidence of what was recognized before.

		const nextVersion = version + 1;
		const netAmount =
			merged.grossAmount === null
				? null
				: toNumber(sub(R(merged.grossAmount), R(merged.taxAmount ?? 0)));
		const [updated] = (await db.execute(
			`UPDATE expenses
          SET cost_classification = ?, recognition_state = ?, recognition_period = ?,
              period_basis = ?, service_period_start = ?, service_period_end = ?,
              expense_date = ?, tax_treatment = ?, tax_evidence_reference = ?,
              currency = ?, amount = ?, total_amount = ?, tax_amount = ?,
              source_reference = ?, evidence_reference = ?, recognized_amount = ?,
              recognized_by = ?,
              recognized_at = IF(?, NOW(), ?),
              financial_version = ?
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
				netAmount,
				merged.grossAmount,
				merged.taxAmount,
				merged.sourceReference,
				merged.evidenceReference,
				recognizedAmount,
				recognizedBy,
				input.command === 'recognize' ? 1 : 0,
				recognizedAt,
				nextVersion,
				input.id,
				version,
			]
		)) as [Record<string, unknown>, unknown];
		if (Number(updated.affectedRows ?? 0) === 0) {
			throw new CostError(
				'version_conflict',
				'This cost changed while the command was applied',
				409
			);
		}

		await writeJournal(db, {
			costUid: String(row.cost_uid ?? ''),
			sourceId: input.id,
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
				state: target,
			},
		});

		return {
			id: input.id,
			cost_uid: (row.cost_uid ?? null) as string | null,
			recognition_state: target,
			financial_version: nextVersion,
			recognized_amount: recognizedAmount,
			recognition_period: resolved.period,
			component: input.command,
		};
	});
}

/** The effective tax treatment of a stored row, for reporting callers. */
export { effectiveTaxTreatment };
