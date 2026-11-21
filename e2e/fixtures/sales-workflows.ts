/**
 * Disposable sales fixtures for the invoice, receivables and payment browser
 * journeys.
 *
 * Every row is namespaced and tracked by primary key. The two seeded journeys
 * own one company and one invoice each; the UI-created invoice is tracked by
 * its POST response id with a unique client-name/creator fallback so a failure
 * before the response still cleans up. Payment entries are identified by their
 * UUID and unique transaction id; payment issues by their numeric id and the
 * unique payee name. Cleanup never removes a row by name alone unless that name
 * (or transaction id) is unique to this namespace.
 *
 * Amounts, dates and displays are authored literals here. The tests compare
 * them with the browser and an independent MySQL read, so a save that does not
 * persist, a link that opens the wrong document, or a wrong tax/net calculation
 * fails instead of agreeing with itself.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';

export interface InvoiceAmounts {
	gross: number;
	tax: number;
	net: number;
}

/** Invoice authored through the real create form: ₹30,000 + 18% GST. */
export const CREATED_INVOICE_AMOUNTS: InvoiceAmounts = {
	gross: 30_000,
	tax: 5_400,
	net: 35_400,
};
export const CREATED_INVOICE_GROSS_DISPLAY = '₹30,000.00';
export const CREATED_INVOICE_TAX_DISPLAY = '₹5,400.00';
export const CREATED_INVOICE_NET_DISPLAY = '₹35,400.00';
export const CREATED_INVOICE_DATE = '2026-11-05';
export const CREATED_INVOICE_DUE_DATE = '2026-12-05';
export const CREATED_INVOICE_DESCRIPTION =
	'E2E sales invoice: engineering consultancy for the balance-of-plant package';

/** Invoice/company seeded for the register-link and receipt journeys. */
export const SEEDED_INVOICE_AMOUNTS: InvoiceAmounts = {
	gross: 50_000,
	tax: 9_000,
	net: 59_000,
};
export const SEEDED_INVOICE_GROSS_DISPLAY = '₹50,000.00';
export const SEEDED_INVOICE_TAX_DISPLAY = '₹9,000.00';
export const SEEDED_INVOICE_NET_DISPLAY = '₹59,000.00';
export const SEEDED_INVOICE_DATE = '2026-11-05';
export const SEEDED_INVOICE_DUE_DATE = '2026-12-05';

export const RECEIPT_AMOUNT = 20_000;
export const RECEIPT_AMOUNT_DISPLAY = '₹20,000.00';
export const RECEIPT_DATE = '2026-11-18';
export const NET_BALANCE_AFTER_RECEIPT = 39_000;
export const NET_BALANCE_AFTER_RECEIPT_DISPLAY = '₹39,000.00';

export const PAYMENT_ISSUE_AMOUNT = 12_500;
export const PAYMENT_ISSUE_DEDUCTION = 500;
export const PAYMENT_ISSUE_NET = 12_000;
export const PAYMENT_ISSUE_AMOUNT_DISPLAY = '₹12,500.00';
export const PAYMENT_ISSUE_DEDUCTION_DISPLAY = '₹500.00';
export const PAYMENT_ISSUE_NET_DISPLAY = '₹12,000.00';
export const PAYMENT_ISSUE_DATE = '2026-11-10';
export const PAYMENT_ISSUE_DATE_DISPLAY = '10 Nov 2026';

const COMPANY_ADDRESS = 'Plot 11, E2E Sales Estate';
const COMPANY_CITY = 'Pune';
const COMPANY_STATE = 'Maharashtra';
const COMPANY_STATE_CODE = '27';
const COMPANY_COUNTRY = 'India';
const COMPANY_POSTAL_CODE = '411001';
const COMPANY_GSTIN = '27ABCDE1234F1Z5';
const COMPANY_PAN = 'ABCDE1234F';
const COMPANY_CONTACT = 'E2E Sales Contact';

export interface SalesCompany {
	companyId: number;
	companyCode: string;
	companyName: string;
	/** Address text the invoice form derives from the company fields. */
	clientAddress: string;
	city: string;
	state: string;
	stateCode: string;
	gstin: string;
	panNumber: string;
	contactPerson: string;
}

export interface SeededInvoice {
	id: number;
	invoiceNumber: string;
	invoiceDate: string;
	dueDate: string;
	gross: number;
	tax: number;
	net: number;
}

export interface StoredInvoice {
	id: number;
	invoiceNumber: string;
	invoiceDate: string | null;
	dueDate: string | null;
	clientName: string;
	clientStateCode: string | null;
	grossAmount: string | number;
	subtotal: string | number;
	taxRate: string | number;
	taxAmount: string | number;
	cgstRate: string | number | null;
	sgstRate: string | number | null;
	igstRate: string | number | null;
	gstType: string | null;
	total: string | number;
	netAmount: string | number;
	amountPaid: string | number;
	balanceDue: string | number;
	status: string;
	createdBy: number | null;
	isDelete: number;
	items: unknown;
	lineItems: unknown;
}

export interface StoredPaymentEntry {
	id: string;
	companyName: string;
	city: string | null;
	receiptNo: string | null;
	receiptDate: string | null;
	amount: string | number;
	paymentDate: string | null;
	transactionId: string | null;
	invoiceNo: string | null;
	invoiceDate: string | null;
	paymentType: string | null;
	tdsAmount: string | number;
	gstAmount: string | number;
	netAmount: string | number;
	createdBy: number | null;
	isDelete: number;
}

export interface StoredPaymentIssue {
	id: number;
	payeeName: string;
	payeeType: string;
	invoiceNumber: string | null;
	invoiceDate: string | null;
	invoiceAmount: string | number;
	amount: string | number;
	deduction: string | number;
	netAmount: string | number;
	issueDate: string | null;
	transactionReference: string | null;
	bankName: string | null;
	status: string;
	notes: string | null;
	isDelete: number;
}

interface InvoiceRow extends RowDataPacket {
	id: number | string;
	invoice_number: string;
	invoice_date: string | null;
	due_date: string | null;
	client_name: string;
	client_state_code: string | null;
	gross_amount: string | number | null;
	subtotal: string | number | null;
	tax_rate: string | number | null;
	tax_amount: string | number | null;
	cgst_rate: string | number | null;
	sgst_rate: string | number | null;
	igst_rate: string | number | null;
	gst_type: string | null;
	total: string | number | null;
	net_amount: string | number | null;
	amount_paid: string | number | null;
	balance_due: string | number | null;
	status: string;
	created_by: number | string | null;
	isDelete: number | string | null;
	items: unknown;
	line_items: unknown;
}

interface PaymentEntryRow extends RowDataPacket {
	id: string;
	company_name: string;
	city: string | null;
	receipt_no: string | null;
	receipt_date: string | null;
	amount: string | number | null;
	payment_date: string | null;
	transaction_id: string | null;
	invoice_no: string | null;
	invoice_date: string | null;
	payment_type: string | null;
	tds_amount: string | number | null;
	gst_amount: string | number | null;
	net_amount: string | number | null;
	created_by: number | string | null;
	isDelete: number | string | null;
}

interface PaymentIssueRow extends RowDataPacket {
	id: number | string;
	payee_name: string;
	payee_type: string;
	invoice_number: string | null;
	invoice_date: string | null;
	invoice_amount: string | number | null;
	amount: string | number | null;
	deduction: string | number | null;
	net_amount: string | number | null;
	issue_date: string | null;
	transaction_reference: string | null;
	bank_name: string | null;
	status: string;
	notes: string | null;
	isDelete: number | string | null;
}

interface CountRow extends RowDataPacket {
	count: number | string;
}

/** Insert one owned company the real pickers and invoice form can select. */
export async function seedSalesCompany(
	connection: Connection,
	namespace: string
): Promise<SalesCompany> {
	const companyCode = fitIdentifier(`${namespace}-CO`, 50);
	const companyName = fitIdentifier(`${namespace} Client`, 255);
	const email = `${fitIdentifier(namespace, 60).toLowerCase()}@e2e.invalid`;
	const clientAddress = [
		COMPANY_ADDRESS,
		`${COMPANY_CITY} - ${COMPANY_POSTAL_CODE}`,
		COMPANY_STATE,
		COMPANY_COUNTRY,
	].join(', ');

	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO companies (
        company_id, company_name, address, city, state, country, postal_code,
        gstin, pan_number, contact_person, state_code, email, phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			companyCode,
			companyName,
			COMPANY_ADDRESS,
			COMPANY_CITY,
			COMPANY_STATE,
			COMPANY_COUNTRY,
			COMPANY_POSTAL_CODE,
			COMPANY_GSTIN,
			COMPANY_PAN,
			COMPANY_CONTACT,
			COMPANY_STATE_CODE,
			email,
			'020-4000-1100',
		]
	);

	return {
		companyId: Number(result.insertId),
		companyCode,
		companyName,
		clientAddress,
		city: COMPANY_CITY,
		state: COMPANY_STATE,
		stateCode: COMPANY_STATE_CODE,
		gstin: COMPANY_GSTIN,
		panNumber: COMPANY_PAN,
		contactPerson: COMPANY_CONTACT,
	};
}

/**
 * Insert one owned, already-sent invoice for the register-link and receipt
 * journeys. `line_items` is real JSON so the invoice edit form hydrates it.
 */
export async function seedClientInvoice(
	connection: Connection,
	company: SalesCompany,
	invoiceNumber: string,
	amounts: InvoiceAmounts = SEEDED_INVOICE_AMOUNTS
): Promise<SeededInvoice> {
	const lineItems = [
		{
			sr_no: 1,
			description: `E2E seeded invoice for ${company.companyName}`,
			unit: '1',
			charges: amounts.gross.toFixed(2),
			amount: amounts.gross.toFixed(2),
		},
	];

	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO invoices (
        invoice_number, invoice_date, client_name, client_email, client_phone,
        client_address, client_pan, client_gstin, client_state,
        client_state_code, kind_attn, description, items, line_items,
        subtotal, gross_amount, tax_rate, tax_amount, gst_type, cgst_rate,
        sgst_rate, igst_rate, discount, total, net_amount, amount_paid,
        balance_due, due_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			invoiceNumber,
			SEEDED_INVOICE_DATE,
			company.companyName,
			`${fitIdentifier(invoiceNumber, 60).toLowerCase()}@e2e.invalid`,
			'020-4000-1100',
			company.clientAddress,
			company.panNumber,
			company.gstin,
			company.state,
			company.stateCode,
			company.contactPerson,
			`Seeded sales invoice for ${company.companyName}`,
			JSON.stringify([]),
			JSON.stringify(lineItems),
			amounts.gross.toFixed(2),
			amounts.gross.toFixed(2),
			18,
			amounts.tax.toFixed(2),
			'cgst_sgst',
			9,
			9,
			18,
			0,
			amounts.net.toFixed(2),
			amounts.net.toFixed(2),
			0,
			amounts.net.toFixed(2),
			SEEDED_INVOICE_DUE_DATE,
			'sent',
		]
	);

	return {
		id: Number(result.insertId),
		invoiceNumber,
		invoiceDate: SEEDED_INVOICE_DATE,
		dueDate: SEEDED_INVOICE_DUE_DATE,
		gross: amounts.gross,
		tax: amounts.tax,
		net: amounts.net,
	};
}

/** Independent read of one invoice, with both JSON columns parsed safely. */
export async function readInvoiceById(
	connection: Connection,
	id: number
): Promise<StoredInvoice> {
	const [rows] = await connection.execute<InvoiceRow[]>(
		`SELECT id, invoice_number, invoice_date, due_date, client_name,
            client_state_code, gross_amount, subtotal, tax_rate, tax_amount,
            cgst_rate, sgst_rate, igst_rate, gst_type, total, net_amount,
            amount_paid, balance_due, status, created_by, isDelete, items,
            line_items
       FROM invoices
      WHERE id = ?`,
		[id]
	);
	if (!rows[0]) {
		throw new Error(`[sales-workflows] invoice ${id} is missing`);
	}
	const row = rows[0];
	return {
		id: Number(row.id),
		invoiceNumber: row.invoice_number,
		invoiceDate: row.invoice_date,
		dueDate: row.due_date,
		clientName: row.client_name,
		clientStateCode: row.client_state_code,
		grossAmount: row.gross_amount ?? 0,
		subtotal: row.subtotal ?? 0,
		taxRate: row.tax_rate ?? 0,
		taxAmount: row.tax_amount ?? 0,
		cgstRate: row.cgst_rate,
		sgstRate: row.sgst_rate,
		igstRate: row.igst_rate,
		gstType: row.gst_type,
		total: row.total ?? 0,
		netAmount: row.net_amount ?? 0,
		amountPaid: row.amount_paid ?? 0,
		balanceDue: row.balance_due ?? 0,
		status: row.status,
		createdBy: row.created_by === null ? null : Number(row.created_by),
		isDelete: Number(row.isDelete ?? 0),
		items: parseJsonColumn(row.items),
		lineItems: parseJsonColumn(row.line_items),
	};
}

/** Independent read of one receipt, including its generated receipt number. */
export async function readPaymentEntryById(
	connection: Connection,
	id: string
): Promise<StoredPaymentEntry> {
	const [rows] = await connection.execute<PaymentEntryRow[]>(
		`SELECT id, company_name, city, receipt_no, receipt_date, amount,
            payment_date, transaction_id, invoice_no, invoice_date,
            payment_type, tds_amount, gst_amount, net_amount, created_by,
            isDelete
       FROM payment_entries
      WHERE id = ?`,
		[id]
	);
	if (!rows[0]) {
		throw new Error(`[sales-workflows] payment entry ${id} is missing`);
	}
	const row = rows[0];
	return {
		id: row.id,
		companyName: row.company_name,
		city: row.city,
		receiptNo: row.receipt_no,
		receiptDate: row.receipt_date,
		amount: row.amount ?? 0,
		paymentDate: row.payment_date,
		transactionId: row.transaction_id,
		invoiceNo: row.invoice_no,
		invoiceDate: row.invoice_date,
		paymentType: row.payment_type,
		tdsAmount: row.tds_amount ?? 0,
		gstAmount: row.gst_amount ?? 0,
		netAmount: row.net_amount ?? 0,
		createdBy: row.created_by === null ? null : Number(row.created_by),
		isDelete: Number(row.isDelete ?? 0),
	};
}

/** Independent read of one issued payment. */
export async function readPaymentIssueById(
	connection: Connection,
	id: number
): Promise<StoredPaymentIssue> {
	const [rows] = await connection.execute<PaymentIssueRow[]>(
		`SELECT id, payee_name, payee_type, invoice_number, invoice_date,
            invoice_amount, amount, deduction, net_amount, issue_date,
            transaction_reference, bank_name, status, notes, isDelete
       FROM payment_issues
      WHERE id = ?`,
		[id]
	);
	if (!rows[0]) {
		throw new Error(`[sales-workflows] payment issue ${id} is missing`);
	}
	const row = rows[0];
	return {
		id: Number(row.id),
		payeeName: row.payee_name,
		payeeType: row.payee_type,
		invoiceNumber: row.invoice_number,
		invoiceDate: row.invoice_date,
		invoiceAmount: row.invoice_amount ?? 0,
		amount: row.amount ?? 0,
		deduction: row.deduction ?? 0,
		netAmount: row.net_amount ?? 0,
		issueDate: row.issue_date,
		transactionReference: row.transaction_reference,
		bankName: row.bank_name,
		status: row.status,
		notes: row.notes,
		isDelete: Number(row.isDelete ?? 0),
	};
}

/** Count active invoices for a unique fixture client before the journey. */
export async function countInvoicesForClient(
	connection: Connection,
	clientName: string
): Promise<number> {
	const [rows] = await connection.execute<CountRow[]>(
		`SELECT COUNT(*) AS count
       FROM invoices
      WHERE client_name = ? AND isDelete = 0`,
		[clientName]
	);
	return Number(rows[0]?.count ?? 0);
}

/** Count active receipts linked to an invoice before the browser action. */
export async function countPaymentEntriesForInvoice(
	connection: Connection,
	invoiceNumber: string
): Promise<number> {
	const [rows] = await connection.execute<CountRow[]>(
		`SELECT COUNT(*) AS count
       FROM payment_entries
      WHERE invoice_no = ? AND isDelete = 0`,
		[invoiceNumber]
	);
	return Number(rows[0]?.count ?? 0);
}

/**
 * Remove the invoice this journey created through the browser. The create
 * route does not populate `created_by`, so the exact id is bounded by the
 * unique fixture client name; the fallback catches a run that failed before
 * reading the POST response id. The client name is namespaced per worker and
 * journey, so it cannot match another worker's row.
 */
export async function cleanupUiCreatedInvoice(
	connection: Connection,
	clientName: string,
	invoiceId: number | null
): Promise<void> {
	if (invoiceId !== null) {
		await connection.execute(
			'DELETE FROM invoices WHERE id = ? AND client_name = ?',
			[invoiceId, clientName]
		);
	}
	await connection.execute(
		'DELETE FROM invoices WHERE client_name = ? AND isDelete = 0',
		[clientName]
	);
}

/** Remove one seeded invoice by its captured id and number. */
export async function cleanupSeededInvoice(
	connection: Connection,
	invoiceId: number,
	invoiceNumber: string
): Promise<void> {
	await connection.execute(
		'DELETE FROM invoices WHERE id = ? AND invoice_number = ?',
		[invoiceId, invoiceNumber]
	);
}

/** Remove one receipt by id, with its unique transaction id as the fallback. */
export async function cleanupPaymentEntry(
	connection: Connection,
	paymentEntryId: string | null,
	transactionId: string
): Promise<void> {
	if (paymentEntryId !== null) {
		await connection.execute(
			'DELETE FROM payment_entries WHERE id = ? AND transaction_id = ?',
			[paymentEntryId, transactionId]
		);
	}
	await connection.execute(
		'DELETE FROM payment_entries WHERE transaction_id = ? AND isDelete = 0',
		[transactionId]
	);
}

/** Remove one issued payment by id, bounded by its unique payee and date. */
export async function cleanupPaymentIssue(
	connection: Connection,
	paymentIssueId: number | null,
	payeeName: string,
	issueDate: string
): Promise<void> {
	if (paymentIssueId !== null) {
		await connection.execute(
			'DELETE FROM payment_issues WHERE id = ? AND payee_name = ?',
			[paymentIssueId, payeeName]
		);
	}
	await connection.execute(
		'DELETE FROM payment_issues WHERE payee_name = ? AND issue_date = ?',
		[payeeName, issueDate]
	);
}

/** Remove the owned company after every row that references it is gone. */
export async function cleanupSalesCompany(
	connection: Connection,
	company: SalesCompany
): Promise<void> {
	await connection.execute(
		'DELETE FROM companies WHERE id = ? AND company_id = ?',
		[company.companyId, company.companyCode]
	);
}

function parseJsonColumn(raw: unknown): unknown {
	if (typeof raw !== 'string') return raw;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return raw;
	}
}
