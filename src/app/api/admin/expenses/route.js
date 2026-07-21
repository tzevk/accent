import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'expenses';

const DDL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_number VARCHAR(50) UNIQUE NOT NULL,
    expense_date DATE,
    category VARCHAR(100) NOT NULL,
    sub_category VARCHAR(100),
    description VARCHAR(500),
    vendor_name VARCHAR(255),
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    total_amount DECIMAL(15, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'INR',
    payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') DEFAULT 'bank',
    payment_reference VARCHAR(255),
    paid_to VARCHAR(255),
    paid_by INT NULL,
    receipt_url VARCHAR(500),
    is_billable TINYINT(1) DEFAULT 0,
    is_reimbursable TINYINT(1) DEFAULT 0,
    project_id INT NULL,
    department VARCHAR(100),
    notes TEXT,
    status ENUM('draft', 'submitted', 'approved', 'rejected', 'reimbursed') DEFAULT 'submitted',
    approved_by INT NULL,
    approved_at DATETIME,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_status (status),
    INDEX idx_expense_date (expense_date),
    INDEX idx_vendor (vendor_name),
    INDEX idx_project_id (project_id)
  )
`;

async function ensureTable(db) {
	await db.execute(DDL);
}

async function nextNumber(db) {
	const [rows] = await db.execute(
		`SELECT expense_number FROM ${TABLE} WHERE expense_number LIKE 'EXP-%' ORDER BY id DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const match = /EXP-(\d+)/.exec(rows[0].expense_number || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `EXP-${String(next).padStart(5, '0')}`;
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
		const category = searchParams.get('category');
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
		if (category && category !== 'all') {
			where.push('category = ?');
			params.push(category);
		}
		if (search) {
			where.push(
				'(expense_number LIKE ? OR vendor_name LIKE ? OR description LIKE ? OR paid_to LIKE ?)'
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
			`SELECT * FROM ${TABLE} WHERE ${whereSql} ORDER BY expense_date DESC, created_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				SUM(CASE WHEN status = 'reimbursed' THEN 1 ELSE 0 END) as reimbursed,
				COALESCE(SUM(total_amount), 0) as totalAmount,
				COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END), 0) as approvedAmount,
				COALESCE(SUM(CASE WHEN status = 'reimbursed' THEN total_amount ELSE 0 END), 0) as reimbursedAmount
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
		console.error('Error fetching expenses:', error);
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

		if (!body.category) {
			return NextResponse.json(
				{ success: false, error: 'category is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		await ensureTable(db);

		const expenseNumber = body.expense_number || (await nextNumber(db));
		const amount = Number(body.amount ?? 0);
		const taxAmount = Number(body.tax_amount ?? 0);
		const totalAmount = body.total_amount ?? amount + taxAmount;

		const [result] = await db.execute(
			`INSERT INTO ${TABLE}
				(expense_number, expense_date, category, sub_category, description, vendor_name,
				 amount, tax_amount, total_amount, currency, payment_mode, payment_reference,
				 paid_to, paid_by, receipt_url, is_billable, is_reimbursable,
				 project_id, department, notes, status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				expenseNumber,
				body.expense_date || null,
				body.category,
				body.sub_category || null,
				body.description || null,
				body.vendor_name || null,
				amount,
				taxAmount,
				totalAmount,
				body.currency || 'INR',
				body.payment_mode || 'bank',
				body.payment_reference || null,
				body.paid_to || null,
				body.paid_by || user?.id || null,
				body.receipt_url || null,
				body.is_billable ? 1 : 0,
				body.is_reimbursable ? 1 : 0,
				body.project_id || null,
				body.department || null,
				body.notes || null,
				body.status || 'submitted',
				user?.id || null,
			]
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'expense',
			resourceId: result.insertId,
			description: `Created expense ${expenseNumber} for ${body.category}`,
			request,
		});

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, expense_number: expenseNumber },
		});
	} catch (error) {
		console.error('Error creating expense:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
