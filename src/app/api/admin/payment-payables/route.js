import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'payment_payables';

const DDL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reference_number VARCHAR(50) UNIQUE NOT NULL,
    vendor_invoice_number VARCHAR(100),
    purchase_invoice_id INT NULL,
    vendor_name VARCHAR(255) NOT NULL,
    vendor_email VARCHAR(255),
    vendor_phone VARCHAR(50),
    invoice_date DATE,
    due_date DATE,
    invoice_amount DECIMAL(15, 2) DEFAULT 0,
    paid_amount DECIMAL(15, 2) DEFAULT 0,
    balance_due DECIMAL(15, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'INR',
    project_id INT NULL,
    po_number VARCHAR(100),
    payment_terms VARCHAR(100),
    last_follow_up_date DATE,
    next_follow_up_date DATE,
    notes TEXT,
    status ENUM('pending', 'partial', 'paid', 'overdue', 'cancelled') DEFAULT 'pending',
    paid_date DATE,
    payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') NULL,
    transaction_reference VARCHAR(255),
    bank_name VARCHAR(255),
    tds_amount DECIMAL(15, 2) DEFAULT 0,
    approved_by INT NULL,
    approved_at DATETIME,
    assigned_to INT NULL,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_vendor (vendor_name),
    INDEX idx_due_date (due_date),
    INDEX idx_purchase_invoice_id (purchase_invoice_id)
  )
`;

async function ensureTable(db) {
	await db.execute(DDL);
}

async function nextNumber(db) {
	const [rows] = await db.execute(
		`SELECT reference_number FROM ${TABLE} WHERE reference_number LIKE 'PP-%' ORDER BY id DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const match = /PP-(\d+)/.exec(rows[0].reference_number || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `PP-${String(next).padStart(5, '0')}`;
}

export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();
		await ensureTable(db);

		const where = ['1=1'];
		const params = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (search) {
			where.push(
				'(reference_number LIKE ? OR vendor_name LIKE ? OR vendor_invoice_number LIKE ? OR po_number LIKE ?)'
			);
			const s = `%${search}%`;
			params.push(s, s, s, s);
		}

		const whereSql = where.join(' AND ');
		const [countRows] = await db.execute(
			`SELECT COUNT(*) as total FROM ${TABLE} WHERE ${whereSql}`,
			params
		);
		const total = countRows[0]?.total || 0;

		const [rows] = await db.execute(
			`SELECT * FROM ${TABLE} WHERE ${whereSql} ORDER BY due_date ASC, created_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
				SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
				SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
				SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
				COALESCE(SUM(invoice_amount), 0) as totalInvoiced,
				COALESCE(SUM(paid_amount), 0) as totalPaid,
				COALESCE(SUM(balance_due), 0) as totalOutstanding,
				COALESCE(SUM(tds_amount), 0) as totalTds
			FROM ${TABLE}
		`);

		return NextResponse.json({
			success: true,
			data: rows,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
			stats: statsRows[0] || {},
		});
	} catch (error) {
		console.error('Error fetching payables:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function POST(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const body = await request.json();
		const user = authResult.user;

		if (!body.vendor_name) {
			return NextResponse.json(
				{ success: false, error: 'vendor_name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		await ensureTable(db);

		const referenceNumber = body.reference_number || (await nextNumber(db));
		const invoiceAmount = Number(body.invoice_amount ?? 0);
		const paidAmount = Number(body.paid_amount ?? 0);
		const balanceDue = Number(body.balance_due ?? invoiceAmount - paidAmount);

		const [result] = await db.execute(
			`INSERT INTO ${TABLE}
				(reference_number, vendor_invoice_number, purchase_invoice_id, vendor_name, vendor_email, vendor_phone,
				 invoice_date, due_date, invoice_amount, paid_amount, balance_due, currency,
				 project_id, po_number, payment_terms, last_follow_up_date, next_follow_up_date,
				 notes, status, paid_date, payment_mode, transaction_reference, bank_name,
				 tds_amount, assigned_to, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				referenceNumber,
				body.vendor_invoice_number || null,
				body.purchase_invoice_id || null,
				body.vendor_name,
				body.vendor_email || null,
				body.vendor_phone || null,
				body.invoice_date || null,
				body.due_date || null,
				invoiceAmount,
				paidAmount,
				balanceDue,
				body.currency || 'INR',
				body.project_id || null,
				body.po_number || null,
				body.payment_terms || null,
				body.last_follow_up_date || null,
				body.next_follow_up_date || null,
				body.notes || null,
				body.status || 'pending',
				body.paid_date || null,
				body.payment_mode || null,
				body.transaction_reference || null,
				body.bank_name || null,
				body.tds_amount || 0,
				body.assigned_to || null,
				user?.id || null,
			]
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'payment_payable',
			resourceId: result.insertId,
			description: `Created payable ${referenceNumber} for ${body.vendor_name}`,
			request,
		});

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, reference_number: referenceNumber },
		});
	} catch (error) {
		console.error('Error creating payable:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
