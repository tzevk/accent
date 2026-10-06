/**
 * Supplier invoice recognition (#311). Contract:
 * C:/Files/OCDSE/Work/expenditure-source-contract.md.
 *
 * One supplier liability is one `purchase_invoices` row carrying its canonical
 * `cost_uid`. Recognition follows the same rules as the direct-expense source
 * (received-work period wins, the invoice date is only a disclosed fallback;
 * gross liability is separate from the cost; missing is not zero) and adds the
 * supplier-specific ones:
 *
 *  - a payable follow-up, a receipt copy, or a settlement references the
 *    invoice's `cost_uid` through `financial_cost_links`; it never becomes a
 *    second cost. Text identity stays reviewable evidence, never identity;
 *  - an invoice covering several service periods gets
 *    `supplier_invoice_periods` slices whose gross amounts total the invoice
 *    exactly. The cost of each month is that month's slice — the full invoice
 *    is never repeated per period, and recognition is refused while the slices
 *    do not total the invoice;
 *  - withholding tax (TDS) is settlement information and never reduces cost.
 *
 * Reads and writes take the caller's `SqlConnection`; a command, its split
 * replacement, and its journal row are one transaction.
 */

import { randomUUID } from 'node:crypto';
import type Decimal from 'decimal.js';
import { add, sub, R, toNumber } from '@/lib/money';
import { withTransaction } from '@/utils/database';
import {
	convertToReporting,
	currencyCodeOf,
	evidenceOf,
	resolveConversion,
} from './currency';
import { CostError } from './errors';
import {
	evaluateCost,
	firstOfMonth,
	nextState,
	recognitionBlockers,
	resolveRecognitionPeriod,
} from './recognition';
import {
	linkCostReference,
	registerCostIdentity,
	type CostSourceAdapter,
	type SqlConnection,
} from './sources';
import { monthBounds } from './records';
import type {
	CostClassification,
	CostCommandName,
	CostCommandResult,
	CostJournalCommand,
	CostRecord,
	PeriodBasis,
	RecognitionState,
	TaxTreatment,
} from './types';

export const SUPPLIER_TABLE = 'purchase_invoices';
export const SUPPLIER_SOURCE = 'supplier_invoice' as const;

type DbRow = Record<string, unknown>;

function s(row: DbRow, key: string, fallback: string | null = null): string | null {
	const value = row[key];
	if (value === null || value === undefined) return fallback;
	return typeof value === 'string' ? value : String(value);
}

function num(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** A DECIMAL kept as its exact text (a rate holds more digits than a number). */
function dec(row: DbRow, key: string): string | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text.length === 0 ? null : text;
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

const CLASSIFICATIONS = ['project', 'company_overhead', 'unallocated'] as const;
const TAX_TREATMENTS = [
	'none',
	'recoverable',
	'non_recoverable',
	'unresolved',
] as const;

function enumOrThrow<T extends string>(
	value: unknown,
	allowed: readonly T[],
	code: string,
	field: string
): T | null {
	if (value === null || value === undefined) return null;
	const candidate = String(value).trim();
	if (candidate === '') return null;
	if (!(allowed as readonly string[]).includes(candidate)) {
		throw new CostError(code, `Unknown ${field}: ${candidate}`, 422, { field });
	}
	return candidate as T;
}

const SUPPLIER_STATUS: Record<RecognitionState, string> = {
	draft: 'draft',
	pending_evidence: 'pending',
	recognized: 'approved',
	rejected: 'cancelled',
	cancelled: 'cancelled',
};

const JOURNAL_COMMAND: Record<CostCommandName, CostJournalCommand> = {
	update: 'updated',
	submit: 'submitted',
	recognize: 'recognized',
	reject: 'rejected',
	cancel: 'cancelled',
};

export interface SupplierSplitInput {
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	amount?: number | string | null;
	taxAmount?: number | string | null;
	note?: string | null;
}

/** The financial fields a supplier invoice may carry or change. */
export interface SupplierInvoicePatch {
	costClassification?: CostClassification | null;
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
	withholdingTaxAmount?: number | null;
	/** Reporting target; null keeps the default company reporting currency. */
	reportingCurrency?: string | null;
	/** Effective original → reporting rate, with its date and evidence. */
	conversionRate?: number | string | null;
	conversionDate?: string | null;
	conversionEvidenceReference?: string | null;
	/** Replace the service-period slices; null/[] clears them. */
	splits?: SupplierSplitInput[] | null;
}

export interface InitializeSupplierCostInput extends SupplierInvoicePatch {
	/** Submit straight into the recognition queue instead of staying a draft. */
	submit?: boolean;
}

export interface SupplierCommandInput {
	/** `purchase_invoices.id`. */
	id: number;
	command: CostCommandName;
	expectedVersion: number;
	reason?: string | null;
	evidenceReference?: string | null;
	patch?: SupplierInvoicePatch;
}

export interface RecordedSupplierCost {
	id: number;
	invoice_number: string;
	cost_uid: string;
	recognition_state: RecognitionState;
	financial_version: number;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	recognized_amount: number | null;
	cost_classification: CostClassification | null;
}

export interface SupplierSplitRow {
	id: number;
	service_period_start: string | null;
	service_period_end: string;
	recognition_period: string;
	amount: number;
	tax_amount: number;
	recognized_amount: number | null;
	note: string | null;
}

export interface SupplierLinkRow {
	cost_uid: string;
	source_table: string;
	source_id: string;
	role: string;
	basis: string;
	review_state: string;
	evidence_reference: string | null;
}

export interface SupplierLinkCandidate {
	source_table: string;
	source_id: string;
	reference_number: string;
	vendor_name: string;
	vendor_invoice_number: string | null;
	invoice_amount: number | null;
	cost_uid: string | null;
	match_basis: string;
}

export interface SupplierInvoiceDetail {
	id: number;
	invoice_number: string;
	cost_uid: string | null;
	recognition_state: RecognitionState;
	financial_version: number;
	cost_classification: CostClassification | null;
	project_id: number | null;
	service_period_start: string | null;
	service_period_end: string | null;
	recognition_period: string | null;
	period_basis: PeriodBasis | null;
	currency: string;
	gross_amount: number | null;
	tax_amount: number | null;
	withholding_tax_amount: number;
	tax_treatment: TaxTreatment;
	tax_evidence_reference: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	recognized_amount: number | null;
	reporting_currency: string | null;
	conversion_rate: string | null;
	conversion_date: string | null;
	conversion_evidence_reference: string | null;
	converted_amount: number | null;
	splits: SupplierSplitRow[];
	links: SupplierLinkRow[];
	link_candidates: SupplierLinkCandidate[];
}

const INVOICE_SELECT = `SELECT i.*,
    p.project_code,
    COALESCE(p.project_title, p.name) AS project_name,
    p.client_name`;

const INVOICE_FROM = `FROM purchase_invoices i
    LEFT JOIN projects p ON p.project_id = i.project_id AND p.isDelete = 0`;

/**
 * Register the supplier source's cost rows so `resolveCostReference` can read
 * them (the cost registry in `financial_cost_links` names this table).
 */
export const SUPPLIER_INVOICE_ADAPTER: CostSourceAdapter = {
	source: SUPPLIER_SOURCE,
	table: SUPPLIER_TABLE,
	async load(db, sourceId) {
		const id = Number(sourceId);
		if (!Number.isInteger(id) || id <= 0) return null;
		const [rows] = (await db.execute(
			`SELECT cost_uid, invoice_number, currency, total, tax_amount,
              recognized_amount, recognition_state, cost_classification, project_id
         FROM purchase_invoices
        WHERE id = ? AND isDelete = 0`,
			[id]
		)) as [DbRow[], unknown];
		if (rows.length === 0) return null;
		const row = rows[0];
		return {
			cost_uid: s(row, 'cost_uid', '') ?? '',
			source: SUPPLIER_SOURCE,
			source_table: SUPPLIER_TABLE,
			source_id: String(id),
			label: s(row, 'invoice_number'),
			currency: s(row, 'currency', 'INR'),
			gross_amount: num(row, 'total'),
			tax_amount: num(row, 'tax_amount'),
			recognized_amount: num(row, 'recognized_amount'),
			recognition_state:
				(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
			classification:
				(s(row, 'cost_classification') as CostClassification | null) ?? null,
			project_id: num(row, 'project_id'),
		};
	},
};

async function loadInvoiceForUpdate(
	db: SqlConnection,
	id: number
): Promise<DbRow | null> {
	const [rows] = (await db.execute(
		`${INVOICE_SELECT}
       ${INVOICE_FROM}
      WHERE i.id = ? AND i.isDelete = 0
      FOR UPDATE`,
		[id]
	)) as [DbRow[], unknown];
	return rows.length > 0 ? rows[0] : null;
}

async function writeSupplierJournal(
	db: SqlConnection,
	entry: {
		costUid: string;
		sourceId: number;
		version: number;
		command: CostJournalCommand;
		actorId: number | null;
		reason: string | null;
		evidenceReference: string | null;
		snapshot: Record<string, unknown>;
	}
): Promise<void> {
	await db.execute(
		`INSERT INTO financial_cost_events
       (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
        evidence_reference, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.costUid,
			SUPPLIER_TABLE,
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

interface NormalizedSplit {
	servicePeriodStart: string | null;
	servicePeriodEnd: string;
	recognitionPeriod: string;
	amount: number;
	taxAmount: number;
	note: string | null;
}

function normalizeSplits(
	splits: SupplierSplitInput[] | null | undefined
): NormalizedSplit[] {
	if (splits === null || splits === undefined) return [];
	if (!Array.isArray(splits)) {
		throw new CostError('invalid_splits', 'splits must be a list', 422);
	}
	return splits.map((split, index) => {
		const servicePeriodEnd = dateOrNull(split.servicePeriodEnd);
		if (!servicePeriodEnd) {
			throw new CostError(
				'invalid_split',
				`Split ${index + 1} needs a service period end`,
				422,
				{ index }
			);
		}
		const servicePeriodStart = dateOrNull(split.servicePeriodStart);
		if (servicePeriodStart && servicePeriodStart > servicePeriodEnd) {
			throw new CostError(
				'invalid_split',
				`Split ${index + 1} ends before it starts`,
				422,
				{ index }
			);
		}
		const amount = amountOrNull(split.amount);
		if (amount === null || amount < 0) {
			throw new CostError(
				'invalid_split',
				`Split ${index + 1} needs a non-negative amount`,
				422,
				{ index }
			);
		}
		const taxAmount = amountOrNull(split.taxAmount) ?? 0;
		if (taxAmount < 0) {
			throw new CostError(
				'invalid_split',
				`Split ${index + 1} has a negative tax amount`,
				422,
				{ index }
			);
		}
		return {
			servicePeriodStart,
			servicePeriodEnd,
			recognitionPeriod: firstOfMonth(servicePeriodStart ?? servicePeriodEnd),
			amount,
			taxAmount,
			note: text(split.note, 500),
		};
	});
}

async function replaceSplits(
	db: SqlConnection,
	invoiceId: number,
	splits: NormalizedSplit[],
	actorId: number | null
): Promise<void> {
	await db.execute(
		`DELETE FROM supplier_invoice_periods WHERE invoice_id = ?`,
		[invoiceId]
	);
	for (const split of splits) {
		await db.execute(
			`INSERT INTO supplier_invoice_periods
         (invoice_id, service_period_start, service_period_end, recognition_period,
          amount, tax_amount, recognized_amount, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
			[
				invoiceId,
				split.servicePeriodStart,
				split.servicePeriodEnd,
				split.recognitionPeriod,
				split.amount,
				split.taxAmount,
				split.note,
				actorId,
			]
		);
	}
}

async function loadSplitRows(
	db: SqlConnection,
	invoiceId: number
): Promise<SupplierSplitRow[]> {
	const [rows] = (await db.execute(
		`SELECT id, service_period_start, service_period_end, recognition_period,
            amount, tax_amount, recognized_amount, note
       FROM supplier_invoice_periods
      WHERE invoice_id = ?
      ORDER BY recognition_period, id`,
		[invoiceId]
	)) as [DbRow[], unknown];
	return rows.map((row) => ({
		id: Number(num(row, 'id') ?? 0),
		service_period_start: s(row, 'service_period_start'),
		service_period_end: s(row, 'service_period_end', '') ?? '',
		recognition_period: s(row, 'recognition_period', '') ?? '',
		amount: num(row, 'amount') ?? 0,
		tax_amount: num(row, 'tax_amount') ?? 0,
		recognized_amount: num(row, 'recognized_amount'),
		note: s(row, 'note'),
	}));
}

/**
 * Initialize the financial identity of a freshly inserted invoice: canonical
 * `cost_uid`, classification, service period, currency, tax treatment, and the
 * version-1 journal row. The caller owns the transaction (the register route's
 * insert); nothing here opens one.
 */
export async function initializeSupplierCost(
	db: SqlConnection,
	invoiceId: number,
	input: InitializeSupplierCostInput,
	actor: { id: number | null }
): Promise<RecordedSupplierCost> {
	const row = await loadInvoiceForUpdate(db, invoiceId);
	if (!row) {
		throw new CostError('not_found', 'Supplier invoice not found', 404);
	}
	if (s(row, 'cost_uid')) {
		throw new CostError(
			'cost_identity_exists',
			'This invoice already has its cost identity',
			409
		);
	}
	const projectId = input.projectId ?? null;
	// A destination chosen at entry is explicit: a provided Project is a
	// Project classification, never an inference from anywhere else.
	const classification =
		enumOrThrow(
			input.costClassification,
			CLASSIFICATIONS,
			'invalid_classification',
			'cost_classification'
		) ?? (projectId ? ('project' as const) : null);
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
	const currency =
		currencyCodeOf(input.currency) ??
		currencyCodeOf(s(row, 'currency')) ??
		s(row, 'currency', 'INR') ??
		'INR';
	const conversion = resolveConversion({
		currency,
		reportingCurrency: input.reportingCurrency,
		conversionRate: input.conversionRate,
		conversionDate: input.conversionDate,
		conversionEvidenceReference: input.conversionEvidenceReference,
	});
	const grossAmount =
		input.grossAmount !== undefined ? amountOrNull(input.grossAmount) : num(row, 'total');
	const taxAmount =
		input.taxAmount !== undefined
			? amountOrNull(input.taxAmount)
			: num(row, 'tax_amount');
	const taxTreatment =
		enumOrThrow(
			input.taxTreatment,
			TAX_TREATMENTS,
			'invalid_tax_treatment',
			'tax_treatment'
		) ?? 'unresolved';
	const servicePeriodStart = dateOrNull(input.servicePeriodStart);
	const servicePeriodEnd = dateOrNull(input.servicePeriodEnd);
	const billDate =
		dateOrNull(input.billDate) ?? s(row, 'invoice_date', null);
	const withholdingTaxAmount = amountOrNull(input.withholdingTaxAmount) ?? 0;
	const sourceReference =
		text(input.sourceReference, 191) ?? null;
	const evidenceReference = text(input.evidenceReference, 500);
	const { period, basis } = resolveRecognitionPeriod({
		servicePeriodStart,
		servicePeriodEnd,
		billDate,
	});
	const state: RecognitionState = input.submit ? 'pending_evidence' : 'draft';
	const splits = normalizeSplits(input.splits);
	const costUid = `cost-${randomUUID()}`;
	const netAmount =
		grossAmount === null
			? null
			: toNumber(sub(R(grossAmount), R(taxAmount ?? 0)));
	const financial = {
		classification,
		state,
		currency,
		reportingCurrency: conversion.reportingCurrency,
		conversionRate: conversion.conversionRate,
		conversionDate: conversion.conversionDate,
		conversionEvidenceReference: conversion.conversionEvidenceReference,
		convertedAmount: null,
		grossAmount,
		taxAmount,
		taxTreatment,
		taxEvidenceReference: text(input.taxEvidenceReference, 255),
		servicePeriodStart,
		servicePeriodEnd,
		billDate,
		sourceReference,
		evidenceReference,
		recognitionPeriod: period,
		periodBasis: basis,
		recognizedAmount: null,
	};
	const evaluation = evaluateCost(financial);
	const status = s(row, 'status', 'draft') ?? 'draft';
	const nextStatus =
		state === 'pending_evidence' && status === 'draft' ? 'pending' : status;

	await db.execute(
		`UPDATE purchase_invoices
        SET cost_uid = ?, cost_classification = ?, recognition_state = ?,
            recognition_period = ?, period_basis = ?, service_period_start = ?,
            service_period_end = ?, tax_treatment = ?, tax_evidence_reference = ?,
            currency = ?, reporting_currency = ?, conversion_rate = ?,
            conversion_date = ?, conversion_evidence_reference = ?, converted_amount = NULL,
            subtotal = ?, tax_amount = ?, total = ?,
            withholding_tax_amount = ?, source_reference = ?, evidence_reference = ?,
            status = ?, financial_version = 1
      WHERE id = ? AND isDelete = 0`,
		[
			costUid,
			classification,
			state,
			period,
			basis,
			servicePeriodStart,
			servicePeriodEnd,
			financial.taxTreatment,
			financial.taxEvidenceReference,
			currency,
			conversion.reportingCurrency,
			conversion.conversionRate,
			conversion.conversionDate,
			conversion.conversionEvidenceReference,
			netAmount,
			taxAmount,
			grossAmount,
			withholdingTaxAmount,
			sourceReference,
			evidenceReference,
			nextStatus,
			invoiceId,
		]
	);
	if (splits.length > 0) {
		await replaceSplits(db, invoiceId, splits, actor.id);
	}
	await registerCostIdentity(db, {
		costUid,
		sourceTable: SUPPLIER_TABLE,
		sourceId: invoiceId,
		createdBy: actor.id,
	});
	await writeSupplierJournal(db, {
		costUid,
		sourceId: invoiceId,
		version: 1,
		command: 'recorded',
		actorId: actor.id,
		reason: state === 'pending_evidence' ? 'Submitted for recognition' : null,
		evidenceReference,
		snapshot: {
			classification,
			recognition_period: period,
			period_basis: basis,
			currency,
			reporting_currency: conversion.reportingCurrency,
			conversion_rate: conversion.conversionRate,
			conversion_date: conversion.conversionDate,
			conversion_evidence_reference: conversion.conversionEvidenceReference,
			converted_amount: null,
			gross_amount: grossAmount,
			tax_amount: taxAmount,
			recognized_amount: null,
			state,
			splits: splits.map((split) => ({
				service_period_start: split.servicePeriodStart,
				service_period_end: split.servicePeriodEnd,
				recognition_period: split.recognitionPeriod,
				amount: split.amount,
				tax_amount: split.taxAmount,
			})),
			exceptions: evaluation.exceptions,
		},
	});
	return {
		id: invoiceId,
		invoice_number: s(row, 'invoice_number', '') ?? '',
		cost_uid: costUid,
		recognition_state: state,
		financial_version: 1,
		recognition_period: period,
		period_basis: basis,
		recognized_amount: null,
		cost_classification: classification,
	};
}

/**
 * Apply one versioned command to a supplier cost. Everything happens in one
 * transaction: state check, version check, split replacement, update, journal.
 */
export async function executeSupplierCommand(
	input: SupplierCommandInput,
	actor: { id: number | null },
	options?: { connection?: SqlConnection }
): Promise<CostCommandResult> {
	const run = async (db: SqlConnection): Promise<CostCommandResult> => {
		const row = await loadInvoiceForUpdate(db, input.id);
		if (!row) {
			throw new CostError('not_found', 'Supplier invoice not found', 404);
		}
		const state = (s(row, 'recognition_state', 'draft') ??
			'draft') as RecognitionState;
		const version = Number(num(row, 'financial_version') ?? 1);
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
				patch.costClassification !== undefined
					? enumOrThrow(
							patch.costClassification,
							CLASSIFICATIONS,
							'invalid_classification',
							'cost_classification'
						)
					: ((s(row, 'cost_classification') as CostClassification | null) ??
						null),
			projectId:
				patch.projectId !== undefined
					? patch.projectId
					: num(row, 'project_id'),
			servicePeriodStart:
				patch.servicePeriodStart !== undefined
					? dateOrNull(patch.servicePeriodStart)
					: dateOrNull(s(row, 'service_period_start')),
			servicePeriodEnd:
				patch.servicePeriodEnd !== undefined
					? dateOrNull(patch.servicePeriodEnd)
					: dateOrNull(s(row, 'service_period_end')),
			billDate:
				patch.billDate !== undefined
					? dateOrNull(patch.billDate)
					: dateOrNull(s(row, 'invoice_date')),
			currency:
				patch.currency !== undefined
					? (text(patch.currency, 3) ?? 'INR').toUpperCase()
					: (s(row, 'currency', 'INR') ?? 'INR'),
			grossAmount:
				patch.grossAmount !== undefined
					? amountOrNull(patch.grossAmount)
					: num(row, 'total'),
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
					: ((s(row, 'tax_treatment', 'unresolved') ??
							'unresolved') as TaxTreatment),
			taxEvidenceReference:
				patch.taxEvidenceReference !== undefined
					? text(patch.taxEvidenceReference, 255)
					: text(s(row, 'tax_evidence_reference'), 255),
			sourceReference:
				patch.sourceReference !== undefined
					? text(patch.sourceReference, 191)
					: text(s(row, 'source_reference'), 191),
			evidenceReference:
				patch.evidenceReference !== undefined
					? text(patch.evidenceReference, 500)
					: input.evidenceReference !== undefined
						? text(input.evidenceReference, 500)
						: text(s(row, 'evidence_reference'), 500),
			withholdingTaxAmount:
				patch.withholdingTaxAmount !== undefined
					? (amountOrNull(patch.withholdingTaxAmount) ?? 0)
					: (num(row, 'withholding_tax_amount') ?? 0),
		};

		const rawConversion = {
			currency: merged.currency,
			reportingCurrency:
				patch.reportingCurrency !== undefined
					? patch.reportingCurrency
					: s(row, 'reporting_currency'),
			conversionRate:
				patch.conversionRate !== undefined
					? patch.conversionRate
					: dec(row, 'conversion_rate'),
			conversionDate:
				patch.conversionDate !== undefined
					? patch.conversionDate
					: s(row, 'conversion_date'),
			conversionEvidenceReference:
				patch.conversionEvidenceReference !== undefined
					? patch.conversionEvidenceReference
					: s(row, 'conversion_evidence_reference'),
		};
		const conversion = resolveConversion(rawConversion);

		if (!merged.classification && merged.projectId) {
			// A destination chosen explicitly is a Project classification.
			merged.classification = 'project';
		}
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

		const datesChanged =
			patch.servicePeriodStart !== undefined ||
			patch.servicePeriodEnd !== undefined ||
			patch.billDate !== undefined;
		const resolved = datesChanged
			? resolveRecognitionPeriod(merged)
			: {
					period: s(row, 'recognition_period'),
					basis: (s(row, 'period_basis', 'unresolved') ??
						'unresolved') as PeriodBasis,
				};

		let effectiveSplits =
			patch.splits !== undefined
				? normalizeSplits(patch.splits)
				: null;
		const financial = {
			...merged,
			reportingCurrency: conversion.reportingCurrency,
			conversionRate: conversion.conversionRate,
			conversionDate: conversion.conversionDate,
			conversionEvidenceReference: conversion.conversionEvidenceReference,
			convertedAmount: null,
			state: target,
			recognitionPeriod: resolved.period,
			periodBasis: resolved.basis,
			recognizedAmount: null,
		};

		let recognizedAmount: number | null = num(row, 'recognized_amount');
		const recognizedAt: string | null = s(row, 'recognized_at');
		let recognizedBy: number | null = num(row, 'recognized_by');
		const splitRecognizedAmounts: number[] = [];

		if (input.command === 'recognize') {
			const blockers = recognitionBlockers({
				grossAmount: merged.grossAmount,
				classification: merged.classification,
				projectId: merged.projectId,
				recognitionPeriod: resolved.period,
				currency: merged.currency,
			});
			const splitRows: NormalizedSplit[] =
				effectiveSplits ??
				(await loadSplitRows(db, input.id)).map((loaded) => ({
					servicePeriodStart: loaded.service_period_start,
					servicePeriodEnd: loaded.service_period_end,
					recognitionPeriod: loaded.recognition_period,
					amount: loaded.amount,
					taxAmount: loaded.tax_amount,
					note: loaded.note,
				}));
			if (splitRows.length > 0) {
				const splitTotal = splitRows.reduce<Decimal>(
					(total, split) => add(total, split.amount),
					R(0)
				);
				const gross = merged.grossAmount;
				if (gross === null || !splitTotal.equals(R(gross))) {
					blockers.push('split_total_mismatch');
				}
				const taxTotal = splitRows.reduce<Decimal>(
					(total, split) => add(total, split.taxAmount),
					R(0)
				);
				if (!taxTotal.equals(R(merged.taxAmount ?? 0))) {
					blockers.push('split_tax_mismatch');
				}
			}
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
			if (splitRows.length > 0) {
				const treatment = evaluateCost(financial).effectiveTaxTreatment;
				for (const split of splitRows) {
					splitRecognizedAmounts.push(
						toNumber(
							treatment === 'recoverable'
								? sub(R(split.amount), R(split.taxAmount))
								: R(split.amount)
						)
					);
				}
			}
		}

		const nextVersion = version + 1;
		const netAmount =
			merged.grossAmount === null
				? null
				: toNumber(sub(R(merged.grossAmount), R(merged.taxAmount ?? 0)));
		// The reporting-currency statement follows the same evidence rule as a
		// direct expense: computed on recognition, kept as history through a
		// later cancel, and null while the amount or evidence is unknown.
		const convertedAmount: number | null =
			target === 'recognized'
				? convertToReporting(
						recognizedAmount,
						evidenceOf({
							currency: merged.currency,
							reportingCurrency: conversion.reportingCurrency,
							conversionRate: conversion.conversionRate,
							conversionDate: conversion.conversionDate,
							conversionEvidenceReference:
								conversion.conversionEvidenceReference,
						})
					).amount
				: state === 'recognized'
					? num(row, 'converted_amount')
					: null;
		await db.execute(
			`UPDATE purchase_invoices
          SET cost_classification = ?, recognition_state = ?, recognition_period = ?,
              period_basis = ?, service_period_start = ?, service_period_end = ?,
              tax_treatment = ?, tax_evidence_reference = ?, currency = ?,
              reporting_currency = ?, conversion_rate = ?, conversion_date = ?,
              conversion_evidence_reference = ?, converted_amount = ?,
              subtotal = ?, tax_amount = ?, total = ?, withholding_tax_amount = ?,
              source_reference = ?, evidence_reference = ?, recognized_amount = ?,
              recognized_by = ?, recognized_at = IF(?, NOW(), ?), financial_version = ?,
              status = ?
        WHERE id = ? AND isDelete = 0 AND financial_version = ?`,
			[
				merged.classification,
				target,
				resolved.period,
				resolved.basis,
				merged.servicePeriodStart,
				merged.servicePeriodEnd,
				merged.taxTreatment,
				merged.taxEvidenceReference,
				merged.currency,
				conversion.reportingCurrency,
				conversion.conversionRate,
				conversion.conversionDate,
				conversion.conversionEvidenceReference,
				convertedAmount,
				netAmount,
				merged.taxAmount,
				merged.grossAmount,
				merged.withholdingTaxAmount,
				merged.sourceReference,
				merged.evidenceReference,
				recognizedAmount,
				recognizedBy,
				input.command === 'recognize' ? 1 : 0,
				recognizedAt,
				nextVersion,
				SUPPLIER_STATUS[target],
				input.id,
				version,
			]
		);
		// The row lock was taken at load; this check is the backstop for a
		// concurrent writer outside the lock.
		if (effectiveSplits !== null) {
			await replaceSplits(db, input.id, effectiveSplits, actor.id);
			effectiveSplits = null;
		}
		if (input.command === 'recognize' && splitRecognizedAmounts.length > 0) {
			const [rows] = (await db.execute(
				`SELECT id FROM supplier_invoice_periods
            WHERE invoice_id = ? ORDER BY recognition_period, id`,
				[input.id]
			)) as [DbRow[], unknown];
			for (let index = 0; index < rows.length; index++) {
				await db.execute(
					`UPDATE supplier_invoice_periods SET recognized_amount = ?
              WHERE id = ?`,
					[splitRecognizedAmounts[index] ?? null, Number(rows[index].id)]
				);
			}
		}

		await writeSupplierJournal(db, {
			costUid: s(row, 'cost_uid', '') ?? '',
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
				reporting_currency: conversion.reportingCurrency,
				conversion_rate: conversion.conversionRate,
				conversion_date: conversion.conversionDate,
				conversion_evidence_reference: conversion.conversionEvidenceReference,
				converted_amount: convertedAmount,
				gross_amount: merged.grossAmount,
				tax_amount: merged.taxAmount,
				tax_treatment: merged.taxTreatment,
				recognized_amount: recognizedAmount,
				state: target,
			},
		});

		return {
			id: input.id,
			cost_uid: s(row, 'cost_uid'),
			recognition_state: target,
			financial_version: nextVersion,
			recognized_amount: recognizedAmount,
			recognition_period: resolved.period,
			component: input.command,
		};
	};

	if (options?.connection) return run(options.connection);
	return withTransaction((db) => run(db)) as Promise<CostCommandResult>;
}

/** The SQL month predicate for split-aware supplier cost. */
const SUPPLIER_MONTH_PREDICATE = `(
  (sp.id IS NULL AND COALESCE(i.recognition_period, i.invoice_date) BETWEEN ? AND ?)
  OR (sp.id IS NOT NULL AND sp.recognition_period BETWEEN ? AND ?)
)`;

const SPLIT_SELECT = `${INVOICE_SELECT},
    sp.id AS split_id, sp.service_period_start AS split_start,
    sp.service_period_end AS split_end, sp.recognition_period AS split_period,
    sp.amount AS split_amount, sp.tax_amount AS split_tax_amount,
    sp.recognized_amount AS split_recognized_amount, sp.note AS split_note,
    (SELECT COUNT(*) FROM supplier_invoice_periods sp2 WHERE sp2.invoice_id = i.id) AS split_count,
    (SELECT COUNT(*) FROM supplier_invoice_periods sp3
      WHERE sp3.invoice_id = i.id
        AND (sp3.recognition_period < sp.recognition_period
             OR (sp3.recognition_period = sp.recognition_period AND sp3.id <= sp.id))) AS split_index`;

const SPLIT_FROM = `${INVOICE_FROM}
    LEFT JOIN supplier_invoice_periods sp ON sp.invoice_id = i.id`;

export function mapSupplierRecordRow(row: DbRow): CostRecord {
	const hasSplit = row.split_id !== null && row.split_id !== undefined;
	const classification =
		(s(row, 'cost_classification') as CostClassification | null) ?? null;
	const state =
		(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft';
	const grossAmount = hasSplit ? num(row, 'split_amount') : num(row, 'total');
	const taxAmount = hasSplit ? num(row, 'split_tax_amount') : num(row, 'tax_amount');
	const servicePeriodStart = hasSplit
		? s(row, 'split_start')
		: s(row, 'service_period_start');
	const servicePeriodEnd = hasSplit
		? s(row, 'split_end')
		: s(row, 'service_period_end');
	const recognitionPeriod = hasSplit
		? s(row, 'split_period')
		: s(row, 'recognition_period');
	const periodBasis: PeriodBasis = hasSplit
		? servicePeriodStart
			? 'service_period'
			: 'service_period_end'
		: ((s(row, 'period_basis', 'unresolved') ?? 'unresolved') as PeriodBasis);
	const financial = {
		classification,
		state,
		currency: currencyCodeOf(s(row, 'currency', 'INR')),
		reportingCurrency: currencyCodeOf(s(row, 'reporting_currency')),
		conversionRate: dec(row, 'conversion_rate'),
		conversionDate: s(row, 'conversion_date'),
		conversionEvidenceReference: s(row, 'conversion_evidence_reference'),
		convertedAmount: num(row, 'converted_amount'),
		grossAmount,
		taxAmount,
		taxTreatment:
			(s(row, 'tax_treatment', 'unresolved') as TaxTreatment) ?? 'unresolved',
		taxEvidenceReference: s(row, 'tax_evidence_reference'),
		servicePeriodStart,
		servicePeriodEnd,
		billDate: s(row, 'invoice_date'),
		sourceReference: s(row, 'source_reference'),
		evidenceReference: s(row, 'evidence_reference'),
		recognitionPeriod,
		periodBasis,
		recognizedAmount: hasSplit
			? num(row, 'split_recognized_amount')
			: num(row, 'recognized_amount'),
	};
	return {
		...financial,
		source: SUPPLIER_SOURCE,
		split: hasSplit
			? {
					id: Number(num(row, 'split_id') ?? 0),
					index: Number(num(row, 'split_index') ?? 0),
					count: Number(num(row, 'split_count') ?? 0),
				}
			: null,
		id: Number(num(row, 'id') ?? 0),
		costUid: s(row, 'cost_uid'),
		expenseNumber: s(row, 'invoice_number', '') ?? '',
		expenseDate: s(row, 'invoice_date'),
		vendorName: s(row, 'vendor_name'),
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

/** Every supplier cost slice that belongs to one month, any state. */
export async function loadSupplierMonthRecords(
	db: SqlConnection,
	month: string
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(month);
	const [rows] = (await db.execute(
		`${SPLIT_SELECT}
       ${SPLIT_FROM}
      WHERE i.isDelete = 0 AND ${SUPPLIER_MONTH_PREDICATE}
      ORDER BY i.id, sp.recognition_period, sp.id`,
		[start, end, start, end]
	)) as [DbRow[], unknown];
	return rows.map(mapSupplierRecordRow);
}

function supplierStateFilter(state: string | undefined): {
	clause: string;
	params: Array<string | number>;
} {
	if (!state || state === 'all') return { clause: '1=1', params: [] };
	if (state === 'unconfirmed') {
		return {
			clause: "i.recognition_state IN ('draft','pending_evidence')",
			params: [],
		};
	}
	if (state === 'unresolved') {
		return { clause: 'i.cost_classification IS NULL', params: [] };
	}
	return { clause: 'i.recognition_state = ?', params: [state] };
}

/** The supplier source's records matching a drilldown query, unpaginated. */
export async function loadFilteredSupplierRecords(
	db: SqlConnection,
	query: {
		month: string;
		state?: string;
		classification?: string;
		projectId?: number | null;
	}
): Promise<CostRecord[]> {
	const { start, end } = monthBounds(query.month);
	const state = supplierStateFilter(query.state);
	const where = ['i.isDelete = 0', SUPPLIER_MONTH_PREDICATE, state.clause];
	const params: Array<string | number> = [start, end, start, end, ...state.params];
	if (query.classification && query.classification !== 'all') {
		if (query.classification === 'unresolved') {
			where.push('i.cost_classification IS NULL');
		} else {
			where.push('i.cost_classification = ?');
			params.push(query.classification);
		}
	}
	if (query.projectId !== undefined && query.projectId !== null) {
		where.push('i.project_id = ?');
		params.push(query.projectId);
	}
	const [rows] = (await db.execute(
		`${SPLIT_SELECT}
       ${SPLIT_FROM}
      WHERE ${where.join(' AND ')}
      ORDER BY i.id, sp.recognition_period, sp.id`,
		params
	)) as [DbRow[], unknown];
	return rows.map(mapSupplierRecordRow);
}

/** Months with supplier cost recorded, newest first. */
export async function loadSupplierInvoiceMonths(
	db: SqlConnection,
	currentMonth: string
): Promise<string[]> {
	const [rows] = (await db.execute(
		`SELECT DISTINCT month FROM (
        SELECT DATE_FORMAT(sp.recognition_period, '%Y-%m') AS month
          FROM supplier_invoice_periods sp
          JOIN purchase_invoices i ON i.id = sp.invoice_id AND i.isDelete = 0
        UNION
        SELECT DATE_FORMAT(COALESCE(i.recognition_period, i.invoice_date), '%Y-%m') AS month
          FROM purchase_invoices i
         WHERE i.isDelete = 0
           AND NOT EXISTS (SELECT 1 FROM supplier_invoice_periods sp WHERE sp.invoice_id = i.id)
           AND COALESCE(i.recognition_period, i.invoice_date) IS NOT NULL
      ) months
      WHERE month IS NOT NULL`
	)) as [DbRow[], unknown];
	const months = new Set<string>([currentMonth]);
	for (const row of rows) {
		const month = s(row, 'month');
		if (month) months.add(month);
	}
	return [...months].sort().reverse();
}

/** One invoice's financial detail: identity, splits, and its source links. */
export async function loadSupplierInvoiceDetail(
	db: SqlConnection,
	id: number
): Promise<SupplierInvoiceDetail | null> {
	const [rows] = (await db.execute(
		`${INVOICE_SELECT}
       ${INVOICE_FROM}
      WHERE i.id = ? AND i.isDelete = 0`,
		[id]
	)) as [DbRow[], unknown];
	if (rows.length === 0) return null;
	const row = rows[0];
	const costUid = s(row, 'cost_uid');
	const splits = await loadSplitRows(db, id);
	const links: SupplierLinkRow[] = [];
	if (costUid) {
		const [linkRows] = (await db.execute(
			`SELECT cost_uid, source_table, source_id, role, basis, review_state,
              evidence_reference
         FROM financial_cost_links
        WHERE cost_uid = ?
        ORDER BY role, source_table, source_id`,
			[costUid]
		)) as [DbRow[], unknown];
		for (const link of linkRows) {
			links.push({
				cost_uid: s(link, 'cost_uid', '') ?? '',
				source_table: s(link, 'source_table', '') ?? '',
				source_id: s(link, 'source_id', '') ?? '',
				role: s(link, 'role', '') ?? '',
				basis: s(link, 'basis', '') ?? '',
				review_state: s(link, 'review_state', '') ?? '',
				evidence_reference: s(link, 'evidence_reference'),
			});
		}
	}
	// Unlinked payables whose own document number names this invoice. A text
	// match is preserved for review; it is never applied on its own.
	const [candidateRows] = (await db.execute(
		`SELECT pp.id, pp.reference_number, pp.vendor_name, pp.vendor_invoice_number,
            pp.invoice_amount, pp.cost_uid,
            CASE WHEN pp.vendor_invoice_number = i.source_reference
                 THEN 'vendor_invoice_number' ELSE 'invoice_number' END AS match_basis
       FROM payment_payables pp
       JOIN purchase_invoices i ON i.id = ?
      WHERE pp.isDelete = 0 AND pp.cost_uid IS NULL
        AND pp.vendor_invoice_number IS NOT NULL AND pp.vendor_invoice_number <> ''
        AND (pp.vendor_invoice_number = i.source_reference
             OR pp.vendor_invoice_number = i.invoice_number)
      ORDER BY pp.id`,
		[id]
	)) as [DbRow[], unknown];
	const link_candidates: SupplierLinkCandidate[] = candidateRows.map((candidate) => ({
		source_table: 'payment_payables',
		source_id: String(num(candidate, 'id') ?? ''),
		reference_number: s(candidate, 'reference_number', '') ?? '',
		vendor_name: s(candidate, 'vendor_name', '') ?? '',
		vendor_invoice_number: s(candidate, 'vendor_invoice_number'),
		invoice_amount: num(candidate, 'invoice_amount'),
		cost_uid: s(candidate, 'cost_uid'),
		match_basis: s(candidate, 'match_basis', 'vendor_invoice_number') ?? '',
	}));
	return {
		id: Number(num(row, 'id') ?? 0),
		invoice_number: s(row, 'invoice_number', '') ?? '',
		cost_uid: costUid,
		recognition_state:
			(s(row, 'recognition_state', 'draft') as RecognitionState) ?? 'draft',
		financial_version: Number(num(row, 'financial_version') ?? 1),
		cost_classification:
			(s(row, 'cost_classification') as CostClassification | null) ?? null,
		project_id: num(row, 'project_id'),
		service_period_start: s(row, 'service_period_start'),
		service_period_end: s(row, 'service_period_end'),
		recognition_period: s(row, 'recognition_period'),
		period_basis: (s(row, 'period_basis') as PeriodBasis | null) ?? null,
		currency: s(row, 'currency', 'INR') ?? 'INR',
		gross_amount: num(row, 'total'),
		tax_amount: num(row, 'tax_amount'),
		withholding_tax_amount: num(row, 'withholding_tax_amount') ?? 0,
		tax_treatment:
			(s(row, 'tax_treatment', 'unresolved') as TaxTreatment) ?? 'unresolved',
		tax_evidence_reference: s(row, 'tax_evidence_reference'),
		source_reference: s(row, 'source_reference'),
		evidence_reference: s(row, 'evidence_reference'),
		recognized_amount: num(row, 'recognized_amount'),
		reporting_currency: currencyCodeOf(s(row, 'reporting_currency')),
		conversion_rate: dec(row, 'conversion_rate'),
		conversion_date: s(row, 'conversion_date'),
		conversion_evidence_reference: s(row, 'conversion_evidence_reference'),
		converted_amount: num(row, 'converted_amount'),
		splits,
		links,
		link_candidates,
	};
}

/**
 * Confirm or reject a preserved text mapping between a payable and this
 * invoice. A confirmed mapping is document-backed: the payable's own document
 * number must name the invoice, and the decision is recorded in the shared
 * link table (`basis='document'`). A rejection keeps the evidence but points
 * the link row at the reviewed candidate with `review_state='rejected'`.
 */
export async function decideSupplierLink(
	db: SqlConnection,
	input: {
		invoiceId: number;
		payableId: number;
		action: 'confirm' | 'reject';
		evidenceReference?: string | null;
		reason?: string | null;
		actor: { id: number | null };
	}
): Promise<SupplierLinkRow> {
	const invoice = await loadInvoiceForUpdate(db, input.invoiceId);
	if (!invoice) {
		throw new CostError('not_found', 'Supplier invoice not found', 404);
	}
	const costUid = s(invoice, 'cost_uid');
	if (!costUid) {
		throw new CostError(
			'cost_identity_missing',
			'This invoice has no cost identity yet',
			422
		);
	}
	const [payableRows] = (await db.execute(
		`SELECT id, reference_number, vendor_invoice_number, cost_uid
       FROM payment_payables
      WHERE id = ? AND isDelete = 0
      FOR UPDATE`,
		[input.payableId]
	)) as [DbRow[], unknown];
	if (payableRows.length === 0) {
		throw new CostError('not_found', 'Payable not found', 404);
	}
	const payable = payableRows[0];
	const payableUid = s(payable, 'cost_uid');
	if (input.action === 'confirm' && payableUid && payableUid !== costUid) {
		throw new CostError(
			'link_conflict',
			'This payable already tracks another cost',
			409,
			{ cost_uid: payableUid }
		);
	}
	if (input.action === 'reject' && !text(input.reason, 500)) {
		throw new CostError(
			'reason_required',
			'A reason is required to reject this mapping',
			422
		);
	}
	const documentNumber = s(payable, 'vendor_invoice_number');
	const invoiceNumber = s(invoice, 'invoice_number');
	const sourceReference = s(invoice, 'source_reference');
	const matches =
		!!documentNumber &&
		(documentNumber === invoiceNumber || documentNumber === sourceReference);
	if (!matches) {
		throw new CostError(
			'link_candidate_mismatch',
			'This payable does not name this invoice',
			422
		);
	}
	const evidenceReference =
		text(input.evidenceReference, 500) ??
		(input.action === 'confirm' ? documentNumber : null);
	if (input.action === 'confirm') {
		await db.execute(
			`UPDATE payment_payables SET cost_uid = ? WHERE id = ? AND isDelete = 0`,
			[costUid, input.payableId]
		);
		await linkCostReference(db, {
			costUid,
			sourceTable: 'payment_payables',
			sourceId: input.payableId,
			role: 'liability',
			basis: 'document',
			reviewState: 'confirmed',
			evidenceReference,
			createdBy: input.actor.id,
		});
	} else {
		await linkCostReference(db, {
			costUid,
			sourceTable: 'payment_payables',
			sourceId: input.payableId,
			role: 'liability',
			basis: 'candidate',
			reviewState: 'rejected',
			evidenceReference,
			createdBy: input.actor.id,
		});
	}
	return {
		cost_uid: costUid,
		source_table: 'payment_payables',
		source_id: String(input.payableId),
		role: 'liability',
		basis: input.action === 'confirm' ? 'document' : 'candidate',
		review_state: input.action === 'confirm' ? 'confirmed' : 'rejected',
		evidence_reference: evidenceReference,
	};
}
