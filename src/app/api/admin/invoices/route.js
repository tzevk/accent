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

// GET - Fetch invoices
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const offset = (page - 1) * limit;

		connection = await dbConnect();

		// Create purchase_orders table
		await connection.execute(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_number VARCHAR(100) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        original_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
        remaining_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
        po_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_po (po_number(100), client_name(255))
      )
    `);
		for (const col of [
			{ name: 'po_number', definition: 'VARCHAR(100) NOT NULL' },
			{ name: 'client_name', definition: 'VARCHAR(255) NOT NULL' },
			{
				name: 'original_value',
				definition: 'DECIMAL(15, 2) NOT NULL DEFAULT 0',
			},
			{
				name: 'remaining_balance',
				definition: 'DECIMAL(15, 2) NOT NULL DEFAULT 0',
			},
			{ name: 'po_date', definition: 'DATE NULL' },
		]) {
			try {
				await connection.execute(
					`ALTER TABLE purchase_orders ADD COLUMN ${col.name} ${col.definition}`
				);
			} catch (_) {}
		}
		try {
			await connection.execute(
				`ALTER TABLE purchase_orders MODIFY COLUMN vendor_name VARCHAR(255) NULL`
			);
		} catch (_) {}
		try {
			await connection.execute(
				`ALTER TABLE purchase_orders ALTER COLUMN vendor_name SET DEFAULT ''`
			);
		} catch (_) {}

		// Check if table exists, create if not
		await connection.execute(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        invoice_date DATE,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        client_phone VARCHAR(50),
        client_address TEXT,
        client_pan VARCHAR(20),
        client_gstin VARCHAR(20),
        client_state VARCHAR(100),
        client_state_code VARCHAR(10),
        kind_attn VARCHAR(255),
        po_number VARCHAR(100),
        po_date DATE,
        po_value DECIMAL(15, 2),
        original_po_value DECIMAL(15, 2),
        balance_po_value DECIMAL(15, 2),
        description VARCHAR(500),
        items JSON,
        line_items JSON,
        subtotal DECIMAL(15, 2) DEFAULT 0,
        gross_amount DECIMAL(15, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 2) DEFAULT 18,
        tax_amount DECIMAL(15, 2) DEFAULT 0,
        gst_type VARCHAR(20) DEFAULT 'cgst_sgst',
        cgst_rate DECIMAL(5, 2) DEFAULT 9,
        sgst_rate DECIMAL(5, 2) DEFAULT 9,
        igst_rate DECIMAL(5, 2) DEFAULT 18,
        discount DECIMAL(15, 2) DEFAULT 0,
        total DECIMAL(15, 2) DEFAULT 0,
        net_amount DECIMAL(15, 2) DEFAULT 0,
        amount_in_words VARCHAR(500),
        gst_number VARCHAR(20),
        pan_number VARCHAR(20),
        tan_number VARCHAR(20),
        service_category VARCHAR(500),
        bank_address VARCHAR(500),
        amount_paid DECIMAL(15, 2) DEFAULT 0,
        balance_due DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        due_date DATE,
        status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled') DEFAULT 'draft',
        po_id INT NULL,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_due_date (due_date)
      )
    `);

		// Add new columns if they don't exist (for existing tables)
		const newColumns = [
			{ name: 'po_id', definition: 'INT NULL AFTER status' },
			{ name: 'client_pan', definition: 'VARCHAR(20) AFTER client_address' },
			{ name: 'client_gstin', definition: 'VARCHAR(20) AFTER client_pan' },
			{ name: 'client_state', definition: 'VARCHAR(100) AFTER client_gstin' },
			{
				name: 'client_state_code',
				definition: 'VARCHAR(10) AFTER client_state',
			},
			{ name: 'kind_attn', definition: 'VARCHAR(255) AFTER client_state_code' },
			{ name: 'po_number', definition: 'VARCHAR(100) AFTER kind_attn' },
			{ name: 'po_date', definition: 'DATE AFTER po_number' },
			{ name: 'po_value', definition: 'DECIMAL(15, 2) AFTER po_date' },
			{ name: 'balance_po_value', definition: 'DECIMAL(15, 2) AFTER po_value' },
			{
				name: 'gst_type',
				definition: "VARCHAR(20) DEFAULT 'cgst_sgst' AFTER tax_amount",
			},
			{ name: 'invoice_date', definition: 'DATE AFTER created_at' },
			{
				name: 'original_po_value',
				definition: 'DECIMAL(15, 2) AFTER po_value',
			},
			{ name: 'gross_amount', definition: 'DECIMAL(15, 2) AFTER subtotal' },
			{ name: 'net_amount', definition: 'DECIMAL(15, 2) AFTER total' },
			{
				name: 'cgst_rate',
				definition: 'DECIMAL(5, 2) DEFAULT 9 AFTER gst_type',
			},
			{
				name: 'sgst_rate',
				definition: 'DECIMAL(5, 2) DEFAULT 9 AFTER cgst_rate',
			},
			{
				name: 'igst_rate',
				definition: 'DECIMAL(5, 2) DEFAULT 18 AFTER sgst_rate',
			},
			{ name: 'line_items', definition: 'JSON AFTER items' },
			{ name: 'gst_number', definition: 'VARCHAR(20) AFTER line_items' },
			{ name: 'pan_number', definition: 'VARCHAR(20) AFTER gst_number' },
			{ name: 'tan_number', definition: 'VARCHAR(20) AFTER pan_number' },
			{
				name: 'service_category',
				definition: 'VARCHAR(500) AFTER tan_number',
			},
			{
				name: 'bank_address',
				definition: 'VARCHAR(500) AFTER service_category',
			},
			{
				name: 'amount_in_words',
				definition: 'VARCHAR(500) AFTER bank_address',
			},
		];

		for (const col of newColumns) {
			try {
				await connection.execute(
					`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.definition}`
				);
			} catch (alterError) {
				// Column likely already exists, ignore
			}
		}

		// Build query
		let query = 'SELECT * FROM invoices WHERE 1=1';
		const params = [];

		if (status && status !== 'all') {
			query += ' AND status = ?';
			params.push(status);
		}

		// Get total count
		const countQuery = query.replace('*', 'COUNT(*) as total');
		const [countResult] = await connection.execute(countQuery, params);
		const total = countResult?.[0]?.total || 0;

		// Get paginated results
		query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
		params.push(limit, offset);

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
		};
		try {
			const [statsResult] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM invoices
      `);
			stats = statsResult[0] || stats;
		} catch (statsError) {
			console.error('Error fetching stats:', statsError);
		}

		return NextResponse.json({
			success: true,
			data: parsedInvoices,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
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

function generateInvoiceNumber(count) {
	const date = new Date();
	const year = date.getFullYear().toString().slice(-2);
	const month = MONTHS[date.getMonth()];
	const num = (count + 1).toString().padStart(3, '0');
	return `ATS-I/${month}-${year}/${num}`;
}

// POST - Create new invoice
export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.WRITE
	);
	if (authResult.authorized === false) return authResult.response;

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

		// Ensure schema has all columns
		const postColumns = [
			{ name: 'invoice_date', definition: 'DATE' },
			{ name: 'original_po_value', definition: 'DECIMAL(15, 2)' },
			{ name: 'gross_amount', definition: 'DECIMAL(15, 2) DEFAULT 0' },
			{ name: 'net_amount', definition: 'DECIMAL(15, 2) DEFAULT 0' },
			{ name: 'cgst_rate', definition: 'DECIMAL(5, 2) DEFAULT 9' },
			{ name: 'sgst_rate', definition: 'DECIMAL(5, 2) DEFAULT 9' },
			{ name: 'igst_rate', definition: 'DECIMAL(5, 2) DEFAULT 18' },
			{ name: 'line_items', definition: 'JSON' },
			{ name: 'gst_number', definition: 'VARCHAR(20)' },
			{ name: 'pan_number', definition: 'VARCHAR(20)' },
			{ name: 'tan_number', definition: 'VARCHAR(20)' },
			{ name: 'service_category', definition: 'VARCHAR(500)' },
			{ name: 'bank_address', definition: 'VARCHAR(500)' },
			{ name: 'amount_in_words', definition: 'VARCHAR(500)' },
			{ name: 'po_id', definition: 'INT NULL' },
		];
		for (const col of postColumns) {
			try {
				await connection.execute(
					`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.definition}`
				);
			} catch (_) {}
		}

		// Create purchase_orders table if not exists
		await connection.execute(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_number VARCHAR(100) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        original_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
        remaining_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
        po_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_po (po_number(100), client_name(255))
      )
    `);
		for (const col of [
			{ name: 'po_number', definition: 'VARCHAR(100) NOT NULL' },
			{ name: 'client_name', definition: 'VARCHAR(255) NOT NULL' },
			{
				name: 'original_value',
				definition: 'DECIMAL(15, 2) NOT NULL DEFAULT 0',
			},
			{
				name: 'remaining_balance',
				definition: 'DECIMAL(15, 2) NOT NULL DEFAULT 0',
			},
			{ name: 'po_date', definition: 'DATE NULL' },
		]) {
			try {
				await connection.execute(
					`ALTER TABLE purchase_orders ADD COLUMN ${col.name} ${col.definition}`
				);
			} catch (_) {}
		}
		try {
			await connection.execute(
				`ALTER TABLE purchase_orders MODIFY COLUMN vendor_name VARCHAR(255) NULL`
			);
		} catch (_) {}
		try {
			await connection.execute(
				`ALTER TABLE purchase_orders ALTER COLUMN vendor_name SET DEFAULT ''`
			);
		} catch (_) {}

		// Use pre-generated invoice number from client, or generate one
		let invoiceNumber = bodyInvoiceNumber;
		if (!invoiceNumber) {
			const [countResult] = await connection.execute(
				'SELECT COUNT(*) as count FROM invoices'
			);
			const count = countResult?.[0]?.count || 0;
			invoiceNumber = generateInvoiceNumber(count);
		}

		// Check for duplicate invoice_number before INSERT to give a friendly 409
		const [existingInvoice] = await connection.execute(
			'SELECT id FROM invoices WHERE invoice_number = ? LIMIT 1',
			[invoiceNumber]
		);
		if (existingInvoice.length > 0) {
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

		// Upsert purchase order and calculate balance_po_value.
		// purchase_orders.po_number is globally unique (single-column index from
		// purchase-orders/route.js:37), so we look it up by po_number alone.
		let poId = null;
		let calculatedBalance = balance_po_value;
		if (po_number && client_name) {
			const [existingPO] = await connection.execute(
				'SELECT id, original_value, remaining_balance FROM purchase_orders WHERE po_number = ?',
				[po_number]
			);

			if (existingPO.length > 0) {
				poId = existingPO[0].id;
				const oldRemaining = parseFloat(existingPO[0].remaining_balance) || 0;
				const invoiceTotal = parseFloat(total) || 0;
				calculatedBalance = oldRemaining - invoiceTotal;

				await connection.execute(
					'UPDATE purchase_orders SET remaining_balance = ? WHERE id = ?',
					[calculatedBalance, poId]
				);
			} else {
				const poValue = parseFloat(original_po_value) || 0;
				const invoiceTotal = parseFloat(total) || 0;
				calculatedBalance = poValue - invoiceTotal;

				await connection.execute(
					`INSERT INTO purchase_orders (po_number, client_name, original_value, remaining_balance, po_date)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             remaining_balance = VALUES(remaining_balance),
             original_value = VALUES(original_value),
             client_name = VALUES(client_name),
             po_date = VALUES(po_date)`,
					[po_number, client_name, poValue, calculatedBalance, po_date || null]
				);

				// Re-fetch id: on UPDATE path, insertId is 0 and we need the real id.
				const [poRow] = await connection.execute(
					'SELECT id FROM purchase_orders WHERE po_number = ?',
					[po_number]
				);
				poId = poRow?.[0]?.id ?? null;
			}
		}

		// Insert invoice
		const [result] = await connection.execute(
			`INSERT INTO invoices (
        invoice_number, invoice_date, client_name, client_email, client_phone, client_address,
        client_pan, client_gstin, client_state, client_state_code, kind_attn,
        po_number, po_date, po_value, original_po_value, balance_po_value, po_id,
        description, items, line_items, subtotal, gross_amount, tax_rate, tax_amount, gst_type,
        cgst_rate, sgst_rate, igst_rate, discount, total, net_amount, amount_in_words,
        gst_number, pan_number, tan_number, service_category, bank_address,
        amount_paid, balance_due, notes, terms, due_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				calculatedBalance,
				poId,
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
