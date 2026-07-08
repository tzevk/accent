/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import crypto from 'node:crypto';

const TABLE = 'petty_cash_expenses';

const DDL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id CHAR(36) NOT NULL PRIMARY KEY,
    transaction_number VARCHAR(50) UNIQUE NOT NULL,
    transaction_date DATE NOT NULL,
    transaction_type ENUM('receipt', 'payment') NOT NULL DEFAULT 'payment',
    expense_category VARCHAR(100) NULL,
    description VARCHAR(500) NULL,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') DEFAULT 'cash',
    payment_reference VARCHAR(255) NULL,
    recipient_name VARCHAR(255) NULL,
    custodian_employee_id INT NULL,
    custodian_employee_name VARCHAR(255) NULL,
    bill_no VARCHAR(100) NULL,
    bill_date DATE NULL,
    status ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
    approved_by INT NULL,
    approved_by_name VARCHAR(255) NULL,
    approved_at DATETIME NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_transaction_date (transaction_date),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_category (expense_category),
    INDEX idx_status (status),
    INDEX idx_custodian (custodian_employee_id)
  )
`;

async function ensureTable(db: any) {
	await db.execute(DDL);
}

async function nextNumber(db: any): Promise<string> {
	const [rows] = await db.execute(
		`SELECT transaction_number FROM ${TABLE} WHERE transaction_number LIKE 'PCX-%' ORDER BY created_at DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const match = /PCX-(\d+)/.exec(rows[0].transaction_number || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `PCX-${String(next).padStart(5, '0')}`;
}

export async function GET(request: Request) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let db: any;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const category = searchParams.get('expense_category');
		const type = searchParams.get('transaction_type');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();
		await ensureTable(db);

		const where = ['1=1'];
		const params: (string | number)[] = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (category && category !== 'all') {
			where.push('expense_category = ?');
			params.push(category);
		}
		if (type && type !== 'all') {
			where.push('transaction_type = ?');
			params.push(type);
		}
		if (search) {
			where.push(
				'(transaction_number LIKE ? OR description LIKE ? OR recipient_name LIKE ? OR bill_no LIKE ? OR notes LIKE ?)'
			);
			const s = `%${search}%`;
			params.push(s, s, s, s, s);
		}

		const whereSql = where.join(' AND ');
		const [countRows] = await db.execute(
			`SELECT COUNT(*) as total FROM ${TABLE} WHERE ${whereSql}`,
			params
		);
		const total = countRows[0]?.total || 0;

		const [rows] = await db.execute(
			`SELECT *,
			  ROW_NUMBER() OVER (ORDER BY transaction_date, created_at) as sr_no,
			  SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE -amount END)
			    OVER (ORDER BY transaction_date, created_at ROWS UNBOUNDED PRECEDING) as running_balance
			FROM ${TABLE}
			WHERE ${whereSql}
			ORDER BY transaction_date, created_at
			LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				COALESCE(SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END), 0) as totalReceived,
				COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END), 0) as totalPaid,
				COALESCE(SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE -amount END), 0) as currentBalance,
				COALESCE(SUM(CASE WHEN status = 'approved' AND transaction_type = 'receipt' THEN amount WHEN status = 'approved' AND transaction_type = 'payment' THEN -amount ELSE 0 END), 0) as approvedAmount
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
	} catch (error: any) {
		console.error('Error fetching petty cash expenses:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function POST(request: Request) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.CREATE
	);
	if (authResult.authorized === false) return authResult.response;

	let db: any;
	try {
		const body = await request.json();
		const user = authResult.user;

		if (!body.transaction_date) {
			return NextResponse.json(
				{ success: false, error: 'transaction_date is required' },
				{ status: 400 }
			);
		}
		if (!body.amount && body.amount !== 0) {
			return NextResponse.json(
				{ success: false, error: 'amount is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		await ensureTable(db);

		const id = crypto.randomUUID();
		const transactionNumber = body.transaction_number || (await nextNumber(db));
		const amount = Math.abs(Number(body.amount ?? 0));

		let custodianName = body.custodian_employee_name || null;
		const custodianId = body.custodian_employee_id || null;

		if (custodianId && !custodianName) {
			const [eRows] = await db.execute(
				"SELECT CONCAT(first_name, ' ', last_name) as full_name FROM employees WHERE id = ?",
				[custodianId]
			);
			custodianName = eRows[0]?.full_name || null;
		}

		await db.execute(
			`INSERT INTO ${TABLE}
				(id, transaction_number, transaction_date, transaction_type, expense_category,
				 description, amount, payment_mode, payment_reference, recipient_name,
				 custodian_employee_id, custodian_employee_name,
				 bill_no, bill_date, status, notes, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				transactionNumber,
				body.transaction_date,
				body.transaction_type || 'payment',
				body.expense_category || null,
				body.description || null,
				amount,
				body.payment_mode || 'cash',
				body.payment_reference || null,
				body.recipient_name || null,
				custodianId,
				custodianName,
				body.bill_no || null,
				body.bill_date || null,
				body.status || 'submitted',
				body.notes || null,
				user?.id || null,
			]
		);

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'petty_cash_expense',
			resourceId: id,
			description: `Created petty cash ${transactionNumber}: ${body.transaction_type} of ${amount}`,
			request: request as any,
		});

		return NextResponse.json({
			success: true,
			data: { id, transaction_number: transactionNumber },
		});
	} catch (error: any) {
		console.error('Error creating petty cash expense:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
