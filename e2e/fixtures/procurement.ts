/**
 * Disposable procurement fixtures for the Orders and Supplier Invoice browser
 * journeys.
 *
 * The two specs prove different outcomes, so each seeds only what its own
 * starting state needs:
 *
 * - a supplier order that is an approved, supported commitment (no browser
 *   creation) for the consumption journey;
 * - a recognized supplier invoice, registered under its own cost identity, so
 *   the Orders page offers exactly that native slice as a consumption
 *   candidate;
 * - a draft supplier invoice for the recognition journey, including its cost
 *   registry row and one recorded journal entry, so the real Save → Submit →
 *   Recognize commands continue the same cost history.
 *
 * Money is authored here independently of the UI calculators: a gross-basis
 * order of 100000.00 with 20000.00 tax leaves a net of 80000.00; a recognized
 * invoice of 23600.00 with 3600.00 recoverable tax is 20000.00 of cost.
 * Recognition/service months are fixed at 2027-01 so no shared payroll or
 * expense spec can close them.
 *
 * Every row is tracked by primary key. Cleanup removes only rows this module
 * seeded: the invoice (by id and cost identity), its registry and journal
 * rows, and the order with its consumption and event rows.
 */
import { randomUUID } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';

/** An open month no other shared fixture reserves. */
export const PROCUREMENT_RECOGNITION_PERIOD = '2027-01-01';
export const PROCUREMENT_SERVICE_START = '2027-01-01';
export const PROCUREMENT_SERVICE_END = '2027-01-31';

/** Recognized cost offered to a supplier order for consumption. */
export const PROCUREMENT_INVOICE_GROSS = '23600.00';
export const PROCUREMENT_INVOICE_TAX = '3600.00';
export const PROCUREMENT_INVOICE_NET = '20000.00';
export const PROCUREMENT_INVOICE_RECOGNIZED = '20000.00';

/** Approved supplier commitment used by the consumption journey. */
export const PROCUREMENT_ORDER_GROSS = '100000.00';
export const PROCUREMENT_ORDER_TAX = '20000.00';
export const PROCUREMENT_ORDER_NET = '80000.00';

/** 100000.00 stated value minus the 23600.00 gross slice. */
export const PROCUREMENT_REMAINING_AFTER_CONSUMPTION = '76400.00';

export interface ProcurementOrderFixture {
	orderUid: string;
	orderNumber: string;
	counterpartyName: string;
	currency: string;
	grossAmount: string;
	taxAmount: string;
	netAmount: string;
	/** Safe to call more than once. */
	dispose(): Promise<void>;
}

export interface ProcurementInvoiceFixture {
	invoiceId: number;
	invoiceNumber: string;
	vendorName: string;
	costUid: string;
	currency: string;
	grossAmount: string;
	taxAmount: string;
	recognizedAmount: string | null;
	recognitionPeriod: string | null;
	financialVersion: number;
	/** Safe to call more than once. */
	dispose(): Promise<void>;
}

interface OrderUidRow extends RowDataPacket {
	order_uid: string;
}

/**
 * Seed one approved gross-basis supplier order. No browser action depends on
 * another test: the consumption journey opens this owned row by number.
 */
export async function seedSupplierOrder(
	connection: Connection,
	namespace: string
): Promise<ProcurementOrderFixture> {
	const orderUid = `ord-${randomUUID()}`;
	const orderNumber = fitIdentifier(`${namespace}-SO`, 100);
	const counterpartyName = fitIdentifier(`${namespace} Supplier`, 255);
	const evidenceReference = fitIdentifier(`${namespace}-SO-FIRM`, 255);

	await connection.execute(
		`INSERT INTO orders (
        order_uid, order_number, direction, counterparty_name, currency,
        amount_basis, gross_amount, tax_amount, net_amount, order_date, status,
        firmness, firmness_evidence_reference, source_document_reference,
        remarks, created_from, financial_version, created_by, isDelete
      ) VALUES (?, ?, 'supplier', ?, 'INR', 'gross', ?, ?, ?, '2026-11-10',
        'approved', 'firm', ?, ?, ?, 'entry', 1, NULL, 0)`,
		[
			orderUid,
			orderNumber,
			counterpartyName,
			PROCUREMENT_ORDER_GROSS,
			PROCUREMENT_ORDER_TAX,
			PROCUREMENT_ORDER_NET,
			evidenceReference,
			fitIdentifier(`${namespace}-SO-DOC`, 255),
			'E2E procurement supplier commitment',
		]
	);
	await connection.execute(
		`INSERT INTO order_events (
        order_uid, version, event, amount, reference, actor_id, payload
      ) VALUES (?, 1, 'created', ?, ?, NULL, ?)`,
		[
			orderUid,
			PROCUREMENT_ORDER_GROSS,
			orderNumber,
			JSON.stringify({
				direction: 'supplier',
				order_number: orderNumber,
				status: 'approved',
				amount_basis: 'gross',
				gross_amount: PROCUREMENT_ORDER_GROSS,
				net_amount: PROCUREMENT_ORDER_NET,
				currency: 'INR',
			}),
		]
	);

	let disposed = false;
	return {
		orderUid,
		orderNumber,
		counterpartyName,
		currency: 'INR',
		grossAmount: PROCUREMENT_ORDER_GROSS,
		taxAmount: PROCUREMENT_ORDER_TAX,
		netAmount: PROCUREMENT_ORDER_NET,
		async dispose(): Promise<void> {
			if (disposed) return;
			await deleteOrderByUid(connection, orderUid);
			disposed = true;
		},
	};
}

/**
 * Seed one recognized supplier cost with a native slice in
 * `2027-01`. The order page can offer it because its currency, basis-mounted
 * gross amount and period are all explicit.
 */
export async function seedRecognizedSupplierInvoice(
	connection: Connection,
	namespace: string
): Promise<ProcurementInvoiceFixture> {
	return insertInvoice(connection, namespace, 'recognized');
}

/**
 * Seed one draft supplier invoice whose financial fields are still unset, so
 * the recognition dialog must author the destination, period and tax evidence
 * through its real commands.
 */
export async function seedDraftSupplierInvoice(
	connection: Connection,
	namespace: string
): Promise<ProcurementInvoiceFixture> {
	return insertInvoice(connection, namespace, 'draft');
}

/**
 * Remove orders this spec created through the UI, matched only by the
 * namespaced order numbers it authored. Consumption and journal rows are
 * deleted first so a failed journey leaves no owned evidence behind.
 */
export async function cleanupOrdersByNumber(
	connection: Connection,
	orderNumbers: readonly string[]
): Promise<void> {
	if (orderNumbers.length === 0) return;
	const placeholders = orderNumbers.map(() => '?').join(', ');
	const [rows] = await connection.execute<OrderUidRow[]>(
		`SELECT order_uid FROM orders WHERE order_number IN (${placeholders})`,
		[...orderNumbers]
	);
	for (const row of rows) {
		await deleteOrderByUid(connection, row.order_uid);
	}
}

async function insertInvoice(
	connection: Connection,
	namespace: string,
	kind: 'recognized' | 'draft'
): Promise<ProcurementInvoiceFixture> {
	const invoiceNumber = fitIdentifier(`${namespace}-SI`, 50);
	const vendorName = fitIdentifier(`${namespace} Supplier`, 255);
	const costUid = `cost-e2e-${randomUUID()}`;
	const evidenceReference = fitIdentifier(`${namespace}-SI-EVID`, 500);
	const sourceReference = fitIdentifier(`${namespace}-SI-SRC`, 191);
	const recognized = kind === 'recognized';
	const recognizedAmount = recognized ? PROCUREMENT_INVOICE_RECOGNIZED : null;
	const recognitionPeriod = recognized ? PROCUREMENT_RECOGNITION_PERIOD : null;
	const serviceStart = recognized ? PROCUREMENT_SERVICE_START : null;
	const serviceEnd = recognized ? PROCUREMENT_SERVICE_END : null;

	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO purchase_invoices (
        invoice_number, invoice_date, due_date, vendor_name, description,
        subtotal, tax_rate, tax_amount, total, amount_paid, balance_due,
        payment_status, status, currency, cost_uid, cost_classification,
        recognition_state, recognition_period, period_basis,
        service_period_start, service_period_end, tax_treatment,
        tax_evidence_reference, recognized_amount, recognized_at,
        evidence_reference, source_reference, withholding_tax_amount,
        financial_version, isDelete
      ) VALUES (?, '2026-11-10', '2026-12-10', ?, 'E2E procurement supplier cost',
        ?, 18, ?, ?, 0, ?, 'unpaid', ?, 'INR', ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0)`,
		[
			invoiceNumber,
			vendorName,
			PROCUREMENT_INVOICE_NET,
			PROCUREMENT_INVOICE_TAX,
			PROCUREMENT_INVOICE_GROSS,
			PROCUREMENT_INVOICE_GROSS,
			recognized ? 'approved' : 'draft',
			costUid,
			recognized ? 'company_overhead' : null,
			recognized ? 'recognized' : 'draft',
			recognitionPeriod,
			recognized ? 'service_period' : 'unresolved',
			serviceStart,
			serviceEnd,
			recognized ? 'recoverable' : 'unresolved',
			recognized ? evidenceReference : null,
			recognizedAmount,
			recognized ? '2026-11-20 10:00:00' : null,
			evidenceReference,
			sourceReference,
		]
	);
	const invoiceId = Number(result.insertId);

	await connection.execute(
		`INSERT INTO financial_cost_links
        (cost_uid, source_table, source_id, role, basis, review_state)
      VALUES (?, 'purchase_invoices', ?, 'cost', 'system', 'confirmed')`,
		[costUid, String(invoiceId)]
	);
	if (kind === 'draft') {
		// The real commands continue this seeded history at versions 2, 3, 4.
		await connection.execute(
			`INSERT INTO financial_cost_events
          (cost_uid, source_table, source_id, version, command, actor_user_id,
           reason, evidence_reference, snapshot)
        VALUES (?, 'purchase_invoices', ?, 1, 'recorded', NULL, NULL, ?, ?)`,
			[
				costUid,
				invoiceId,
				evidenceReference,
				JSON.stringify({ fixture: 'e2e_draft_supplier_invoice' }),
			]
		);
	}

	let disposed = false;
	return {
		invoiceId,
		invoiceNumber,
		vendorName,
		costUid,
		currency: 'INR',
		grossAmount: PROCUREMENT_INVOICE_GROSS,
		taxAmount: PROCUREMENT_INVOICE_TAX,
		recognizedAmount,
		recognitionPeriod,
		financialVersion: 1,
		async dispose(): Promise<void> {
			if (disposed) return;
			await connection.execute(
				'DELETE FROM supplier_invoice_periods WHERE invoice_id = ?',
				[invoiceId]
			);
			await connection.execute(
				'DELETE FROM financial_cost_events WHERE cost_uid = ?',
				[costUid]
			);
			await connection.execute(
				'DELETE FROM financial_cost_links WHERE cost_uid = ?',
				[costUid]
			);
			await connection.execute('DELETE FROM purchase_invoices WHERE id = ?', [
				invoiceId,
			]);
			disposed = true;
		},
	};
}

async function deleteOrderByUid(
	connection: Connection,
	orderUid: string
): Promise<void> {
	await connection.execute(
		'DELETE FROM order_consumption_events WHERE order_uid = ?',
		[orderUid]
	);
	await connection.execute(
		'DELETE FROM order_consumptions WHERE order_uid = ?',
		[orderUid]
	);
	await connection.execute('DELETE FROM order_events WHERE order_uid = ?', [
		orderUid,
	]);
	await connection.execute('DELETE FROM orders WHERE order_uid = ?', [
		orderUid,
	]);
}
