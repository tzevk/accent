export const INVOICE_STATUSES = [
	'draft',
	'sent',
	'paid',
	'overdue',
	'cancelled',
	'fully_paid',
	'partially_paid',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface LineItem {
	sr_no?: number;
	description?: string;
	unit?: string | number;
	charges?: string | number;
	amount?: number | string;
}

export interface InvoiceFormData {
	invoice_number?: string;
	invoice_date?: string;
	client_name?: string;
	client_email?: string;
	client_phone?: string;
	client_address?: string;
	client_pan?: string;
	client_gstin?: string;
	client_state?: string;
	client_state_code?: string;
	kind_attn?: string;
	po_number?: string;
	po_date?: string;
	original_po_value?: number | string;
	balance_po_value?: number | string;
	line_items?: LineItem[];
	gst_type?: string;
	cgst_rate?: number | string;
	sgst_rate?: number | string;
	igst_rate?: number | string;
	total?: number | string;
	gross_amount?: number | string;
	tax_amount?: number | string;
	tax_rate?: number | string;
	status?: string;
	[key: string]: unknown;
}

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

export function validateInvoice(data: InvoiceFormData): ValidationResult {
	const errors: ValidationError[] = [];

	if (!data.client_name || !String(data.client_name).trim()) {
		errors.push({ field: 'client_name', message: 'Client name is required' });
	}

	if (
		data.invoice_number !== undefined &&
		data.invoice_number !== null &&
		data.invoice_number !== '' &&
		!String(data.invoice_number).trim()
	) {
		errors.push({
			field: 'invoice_number',
			message: 'Invoice number is required',
		});
	}

	if (
		data.invoice_date !== undefined &&
		data.invoice_date !== null &&
		data.invoice_date !== '' &&
		Number.isNaN(Date.parse(String(data.invoice_date)))
	) {
		errors.push({
			field: 'invoice_date',
			message: 'Invoice date is not a valid date',
		});
	}

	if (
		data.due_date !== undefined &&
		data.due_date !== null &&
		data.due_date !== '' &&
		Number.isNaN(Date.parse(String(data.due_date)))
	) {
		errors.push({
			field: 'due_date',
			message: 'Due date is not a valid date',
		});
	}

	if (data.status !== undefined && data.status !== null && data.status !== '') {
		if (!INVOICE_STATUSES.includes(data.status as InvoiceStatus)) {
			errors.push({
				field: 'status',
				message: `Status must be one of: ${INVOICE_STATUSES.join(', ')}`,
			});
		}
	}

	return { valid: errors.length === 0, errors };
}

export function formatValidationErrors(
	errors: ValidationError[],
	serverMessage?: string
): string {
	if (errors.length === 0) return serverMessage || 'Invalid invoice data';
	const parts = errors.map((e) => e.message);
	const head = serverMessage ? `${serverMessage}: ` : '';
	return `${head}${parts.join('; ')}`;
}

export function extractServerError(
	data: { message?: string; error?: string; errors?: ValidationError[] } | null,
	fallback: string
): string {
	if (!data) return fallback;
	const parts: string[] = [];
	if (data.message) parts.push(data.message);
	if (data.errors && data.errors.length > 0) {
		parts.push(data.errors.map((e) => e.message).join('; '));
	} else if (data.error) {
		parts.push(data.error);
	}
	return parts.length > 0 ? parts.join(' — ') : fallback;
}

export interface DuplicateClassification {
	field: 'invoice_number' | 'po_number';
	message: string;
	status: 409;
}

const DUPLICATE_KEY_PATTERNS: Array<{
	pattern: RegExp;
	field: DuplicateClassification['field'];
	buildMessage: (matched: string) => string;
}> = [
	{
		// purchase_orders.po_number (single-column unique, from purchase-orders/route.js:37)
		pattern: /for key ['"]?po_number['"]?/i,
		field: 'po_number',
		buildMessage: () => 'Purchase order number already exists',
	},
	{
		// purchase_orders composite unique (po_number, client_name) — from invoices/route.js:40
		pattern: /for key ['"]?unique_po['"]?/i,
		field: 'po_number',
		buildMessage: () =>
			'Purchase order number already exists for a different client',
	},
	{
		// invoices.invoice_number
		pattern: /for key ['"]?invoice_number['"]?/i,
		field: 'invoice_number',
		buildMessage: () => 'Invoice number already exists',
	},
];

export function classifyDuplicateError(
	error: { code?: string; errno?: number; sqlMessage?: string } | null
): DuplicateClassification | null {
	if (!error) return null;
	const isDup = error.code === 'ER_DUP_ENTRY' || error.errno === 1062;
	if (!isDup) return null;

	const sqlMessage = error.sqlMessage || '';
	for (const { pattern, field, buildMessage } of DUPLICATE_KEY_PATTERNS) {
		if (pattern.test(sqlMessage)) {
			return {
				field,
				message: buildMessage(sqlMessage),
				status: 409,
			};
		}
	}

	return {
		field: 'invoice_number',
		message: 'Duplicate entry',
		status: 409,
	};
}
