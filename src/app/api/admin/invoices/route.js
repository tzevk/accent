import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	validateInvoice,
	classifyDuplicateError,
} from '@/utils/invoice-validation';

import { R, toNumber } from '@/lib/money';
import { isRetryableNumberError } from '@/utils/db-number-retry';
import { linkClientInvoice, OrderError } from '@/lib/company-expenditure';

// GET - Fetch invoices
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.INVOICES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const status = searchParams.get('status');
		const search = searchParams.get('search') || '';

		connection = await dbConnect();

		// Build query
		let query = 'SELECT * FROM invoices WHERE isDelete = 0';
		const params = [];

		if (status && status !== 'all') {
			query += ' AND status = ?';
			params.push(status);
		}

		if (search) {
			const like = `%${search}%`;
			query +=
				' AND (invoice_number LIKE ? OR client_name LIKE ? OR description LIKE ?)';
			params.push(like, like, like);
		}

		query += ' ORDER BY created_at DESC';

		const [invoices] = await connection.execute(query, params);

		// Parse JSON items/line_items for each invoice
		const parsedInvoices = invoices.map((inv) => {
			const parsed = { ...inv };
			if (parsed.items && typeof parsed.items === 'string') {
				try {
					parsed.items = JSON.parse(parsed.items);
				} catch {
					parsed.items = [];
				}
			}
			if (parsed.line_items && typeof parsed.line_items === 'string') {
				try {
					parsed.line_items = JSON.parse(parsed.line_items);
				} catch {
					parsed.line_items = [];
				}
			}
			return parsed;
		});

		// Get stats
		let stats = {
			total: 0,
			draft: 0,
			sent: 0,
			paid: 0,
			overdue: 0,
			cancelled: 0,
			totalGross: 0,
			totalTax: 0,
			totalNet: 0,
		};
		try {
			const [statsResult] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
          COALESCE(SUM(gross_amount), 0) as totalGross,
          COALESCE(SUM(tax_amount), 0) as totalTax,
          COALESCE(SUM(net_amount), 0) as totalNet
        FROM invoices WHERE isDelete = 0
      `);
			stats = statsResult[0] || stats;
		} catch (statsError) {
			console.error('Error fetching stats:', statsError);
		}

		return NextResponse.json({
			success: true,
			data: parsedInvoices,
			stats,
		});
	} catch (error) {
		console.error('Error fetching invoices:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch invoices',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// Helper function to generate invoice number
const MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC',
];

// Invoice numbers are ATS/I/<MON>-<YY>/<NNN>. The sequence is read from the
// newest active invoice of the current month inside the caller's transaction
// with a row lock (FOR UPDATE), so concurrent POSTs serialize behind the last
// row instead of minting the same number. The unique index on
// active_invoice_number is the backstop (caller retries on ER_DUP_ENTRY).
async function generateInvoiceNumber(db) {
	const date = new Date();
	const year = date.getFullYear().toString().slice(-2);
	const month = MONTHS[date.getMonth()];
	const prefix = `${month}-${year}/`;

	// Check both old (ATS-I/) and new (ATS/I/) formats.
	const [rows] = await db.execute(
		`SELECT invoice_number FROM invoices
		 WHERE (invoice_number LIKE CONCAT('ATS/I/', ?, '%')
		    OR invoice_number LIKE CONCAT('ATS-I/', ?, '%'))
		   AND isDelete = 0
		 ORDER BY id DESC LIMIT 1
		 FOR UPDATE`,
		[prefix, prefix]
	);

	let sequence = 1;
	if (rows.length > 0 && rows[0].invoice_number) {
		const match = rows[0].invoice_number.match(
			new RegExp(`ATS[/-]I/${month}-${year}/(\\d+)`)
		);
		if (match) sequence = parseInt(match[1], 10) + 1;
	}

	return `ATS/I/${month}-${year}/${String(sequence).padStart(3, '0')}`;
}

// POST - Create new invoice
export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.INVOICES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const body = await request.json();

		const {
			invoice_number: bodyInvoiceNumber,
			invoice_date,
			client_name,
			client_email,
			client_phone,
			client_address,
			client_pan,
			client_gstin,
			client_state,
			client_state_code,
			kind_attn,
			order_uid,
			po_number,
			po_date,
			po_value,
			original_po_value,
			balance_po_value,
			description,
			items,
			line_items,
			subtotal,
			gross_amount,
			tax_rate,
			tax_amount,
			gst_type,
			cgst_rate,
			sgst_rate,
			igst_rate,
			discount,
			total,
			net_amount,
			amount_in_words,
			gst_number,
			pan_number,
			tan_number,
			service_category,
			bank_address,
			amount_paid,
			balance_due,
			notes,
			terms,
			due_date,
			status,
		} = body;

		if (!client_name || !String(client_name).trim()) {
			return NextResponse.json(
				{
					success: false,
					message: 'Client name is required',
					errors: [
						{ field: 'client_name', message: 'Client name is required' },
					],
				},
				{ status: 400 }
			);
		}

		const validation = validateInvoice({
			invoice_number: bodyInvoiceNumber,
			invoice_date,
			client_name,
			client_email,
			client_phone,
			client_address,
			client_pan,
			client_gstin,
			client_state,
			client_state_code,
			kind_attn,
			po_number,
			po_date,
			original_po_value,
			balance_po_value,
			line_items,
			gst_type,
			cgst_rate,
			sgst_rate,
			igst_rate,
			total,
			gross_amount,
			tax_amount,
			tax_rate,
			status,
		});
		if (!validation.valid) {
			return NextResponse.json(
				{
					success: false,
					message: 'Validation failed',
					errors: validation.errors,
				},
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		// The PO balance update and the invoice INSERT must be atomic, and the
		// PO balance must never be written from a stale read: the PO row is
		// locked (FOR UPDATE) and its balance is decremented relatively, so
		// concurrent invoice POSTs cannot lose updates. Number generation runs
		// inside the same transaction behind the same lock; the unique
		// active_invoice_number index is the backstop and a collision retries
		// with a fresh read.
		let invoiceNumber;
		let result;
		for (let attempt = 1; ; attempt++) {
			await connection.beginTransaction();
			try {
				// Use pre-generated invoice number from client, or generate one
				invoiceNumber = bodyInvoiceNumber;

				if (invoiceNumber) {
					// Check for duplicate invoice_number before INSERT to give a friendly 409
					const [existingInvoice] = await connection.execute(
						'SELECT id FROM invoices WHERE invoice_number = ? AND isDelete = 0 LIMIT 1',
						[invoiceNumber]
					);
					if (existingInvoice.length > 0) {
						await connection.rollback();
						return NextResponse.json(
							{
								success: false,
								message: `Invoice number "${invoiceNumber}" already exists`,
								errors: [
									{
										field: 'invoice_number',
										message: `Invoice number "${invoiceNumber}" already exists`,
									},
								],
							},
							{ status: 409 }
						);
					}
				} else {
					invoiceNumber = await generateInvoiceNumber(connection);
				}

				// Canonical order reference (#310): a client invoice links one
				// client order by its durable `order_uid`. The order's invoiced
				// rollup and the invoice row are written in this transaction, so
				// a refusal (e.g. a supplier order) leaves no invoice behind.
				// Legacy `purchase_orders` text matching and row creation are
				// gone — an unlinked PO number is display text only.
				const canonicalOrderUid =
					typeof order_uid === 'string' && order_uid.trim()
						? order_uid.trim().slice(0, 64)
						: null;
				let calculatedBalance = balance_po_value ?? null;
				if (canonicalOrderUid) {
					const link = await linkClientInvoice(
						{
							orderUid: canonicalOrderUid,
							amountDelta: toNumber(R(total)),
							invoiceId: null,
							invoiceNumber: invoiceNumber,
							actorId: authResult.user?.id ?? null,
						},
						connection
					);
					calculatedBalance = link.clientRemainingValue;
				}

				// Insert invoice
				[result] = await connection.execute(
					`INSERT INTO invoices (
        invoice_number, invoice_date, client_name, client_email, client_phone, client_address,
        client_pan, client_gstin, client_state, client_state_code, kind_attn,
        po_number, po_date, po_value, original_po_value, balance_po_value, po_id,
        order_uid,
        description, items, line_items, subtotal, gross_amount, tax_rate, tax_amount, gst_type,
        cgst_rate, sgst_rate, igst_rate, discount, total, net_amount, amount_in_words,
        gst_number, pan_number, tan_number, service_category, bank_address,
        amount_paid, balance_due, notes, terms, due_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						invoiceNumber,
						invoice_date || null,
						client_name,
						client_email || null,
						client_phone || null,
						client_address || null,
						client_pan || null,
						client_gstin || null,
						client_state || null,
						client_state_code || null,
						kind_attn || null,
						po_number || null,
						po_date || null,
						po_value || null,
						original_po_value || null,
						calculatedBalance || null,
						null,
						canonicalOrderUid,
						description || null,
						JSON.stringify(items || []),
						line_items ? JSON.stringify(line_items) : null,
						subtotal || 0,
						gross_amount || 0,
						tax_rate || 18,
						tax_amount || 0,
						gst_type || 'cgst_sgst',
						cgst_rate || 9,
						sgst_rate || 9,
						igst_rate || 18,
						discount || 0,
						total || 0,
						net_amount || 0,
						amount_in_words || null,
						gst_number || null,
						pan_number || null,
						tan_number || null,
						service_category || null,
						bank_address || null,
						amount_paid || 0,
						balance_due || total || 0,
						notes || null,
						terms || null,
						due_date || null,
						status || 'draft',
					]
				);

				await connection.commit();
				break;
			} catch (error) {
				await connection.rollback();
				// A freshly generated number collided with a concurrent insert
				// (unique active_invoice_number index): retry from a fresh read.
				if (
					!bodyInvoiceNumber &&
					isRetryableNumberError(error) &&
					attempt < 5
				) {
					await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
					continue;
				}
				throw error;
			}
		}

		return NextResponse.json({
			success: true,
			message: 'Invoice created successfully',
			data: {
				id: result.insertId,
				invoice_number: invoiceNumber,
			},
		});
	} catch (error) {
		console.error('Error creating invoice:', error);
		if (error instanceof OrderError) {
			return NextResponse.json(
				{
					success: false,
					message: error.message,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		const dup = classifyDuplicateError(error);
		if (dup) {
			return NextResponse.json(
				{
					success: false,
					message: dup.message,
					errors: [{ field: dup.field, message: dup.message }],
				},
				{ status: dup.status }
			);
		}
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to create invoice',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
