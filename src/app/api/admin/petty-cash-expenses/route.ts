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
    source_voucher_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_transaction_date (transaction_date),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_category (expense_category),
    INDEX idx_status (status),
    INDEX idx_custodian (custodian_employee_id),
    INDEX idx_source_voucher (source_voucher_id)
  )
`;

async function ensureTable(db: any) {
	await db.execute(DDL);

	const alterStmts = [
		`ALTER TABLE ${TABLE} ADD COLUMN credit_amount DECIMAL(15,2) NOT NULL DEFAULT 0`,
		`ALTER TABLE ${TABLE} ADD COLUMN debit_amount DECIMAL(15,2) NOT NULL DEFAULT 0`,
	];
	for (const stmt of alterStmts) {
		try {
			await db.execute(stmt);
			await db.execute(`
				UPDATE ${TABLE} SET
					credit_amount = IF(transaction_type = 'receipt', amount, 0),
					debit_amount  = IF(transaction_type = 'payment', amount, 0)
			`);
		} catch (e: any) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Petty cash schema migration warning:', e.message);
			}
		}
	}

	try {
		await db.execute(
			`ALTER TABLE ${TABLE} ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0`
		);
	} catch (e: any) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Petty cash isDelete migration warning:', e.message);
		}
	}

	try {
		await db.execute(
			`ALTER TABLE ${TABLE} ADD COLUMN source_voucher_id INT NULL`
		);
	} catch (e: any) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn(
				'Petty cash source_voucher_id migration warning:',
				e.message
			);
		}
	}

	try {
		await db.execute(`
			UPDATE ${TABLE} pce
			INNER JOIN cash_vouchers cv ON pce.transaction_number = cv.voucher_number
			SET pce.source_voucher_id = cv.id
			WHERE pce.source_voucher_id IS NULL
				AND pce.transaction_number IS NOT NULL
				AND pce.isDelete = 0
				AND pce.transaction_number LIKE 'CV-%'
		`);
	} catch {
		/* ignore - tables may not exist yet */
	}
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
		const limit = parseInt(searchParams.get('limit') || '10');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();
		await ensureTable(db);

		// ── Build voucher WHERE ──
		const vWhere: string[] = [];
		const vParams: (string | number)[] = [];

		if (search) {
			const s = `%${search}%`;
			vWhere.push(
				'(cv.voucher_number LIKE ? OR cv.paid_to LIKE ? OR cv.notes LIKE ?)'
			);
			vParams.push(s, s, s);
		}

		const vWhereSql = vWhere.length > 0 ? `WHERE ${vWhere.join(' AND ')}` : '';

		// ── Count vouchers ──
		const [countRows] = await db.execute(
			`SELECT COUNT(*) as total FROM cash_vouchers cv ${vWhereSql}`,
			vParams
		);
		const total = (countRows[0] as any)?.total || 0;

		// ── Query vouchers with balance info (paginated) ──
		const [voucherRows] = await db.execute(
			`SELECT cv.id, cv.voucher_number, cv.voucher_date, cv.voucher_type,
				cv.paid_to, cv.payment_mode, cv.total_amount, cv.status, cv.notes,
				cv.created_at, cv.prepared_by,
				COALESCE(SUM(pce.credit_amount), 0) as total_credited,
				cv.total_amount - COALESCE(SUM(pce.credit_amount), 0) as remaining,
				COUNT(pce.id) as entry_count
			FROM cash_vouchers cv
			LEFT JOIN ${TABLE} pce ON pce.source_voucher_id = cv.id AND pce.isDelete = 0
			${vWhereSql}
			GROUP BY cv.id
			ORDER BY cv.created_at DESC
			LIMIT ? OFFSET ?`,
			[...vParams, limit, offset]
		);

		const entries: any[] = [];
		const allVoucherIds = (voucherRows as any[]).map((v: any) => v.id);

		if (allVoucherIds.length > 0) {
			const placeholders = allVoucherIds.map(() => '?').join(',');
			const [pceRows] = await db.execute(
				`SELECT pce.*, cv.voucher_number as source_voucher_number
				FROM ${TABLE} pce
				LEFT JOIN cash_vouchers cv ON pce.source_voucher_id = cv.id
				WHERE pce.source_voucher_id IN (${placeholders})
					AND pce.isDelete = 0
				ORDER BY pce.transaction_date, pce.created_at`,
				allVoucherIds
			);

			const entriesMap = new Map<number, any[]>();
			for (const e of pceRows as any[]) {
				const vid = e.source_voucher_id;
				if (!entriesMap.has(vid)) entriesMap.set(vid, []);
				entriesMap.get(vid)!.push(e);
			}

			for (const v of voucherRows as any[]) {
				entries.push({
					voucher: {
						id: v.id,
						voucher_number: v.voucher_number,
						voucher_date: v.voucher_date,
						voucher_type: v.voucher_type,
						paid_to: v.paid_to,
						payment_mode: v.payment_mode,
						total_amount: v.total_amount,
						status: v.status,
						notes: v.notes,
						created_at: v.created_at,
						prepared_by: v.prepared_by,
					},
					total_credited: Number(v.total_credited),
					remaining: Number(v.remaining),
					entry_count: v.entry_count,
					pce_entries: entriesMap.get(v.id) || [],
				});
			}
		}

		// ── Global stats ──
		const [statsRows] = await db.execute(
			`SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				COALESCE(SUM(credit_amount), 0) as totalReceived,
				COALESCE(SUM(debit_amount), 0) as totalPaid,
				COALESCE(SUM(debit_amount - credit_amount), 0) as currentBalance,
				COALESCE(SUM(CASE WHEN status = 'approved' THEN debit_amount - credit_amount ELSE 0 END), 0) as approvedAmount
			FROM ${TABLE}
			WHERE isDelete = 0`
		);

		// ── Voucher balances for add-dropdown (remaining > 0) ──
		const [voucherBalances] = await db.execute(
			`SELECT cv.id, cv.voucher_number, cv.total_amount,
				COALESCE(SUM(pce.credit_amount), 0) as total_credited,
				cv.total_amount - COALESCE(SUM(pce.credit_amount), 0) as remaining
			FROM cash_vouchers cv
			LEFT JOIN ${TABLE} pce ON pce.source_voucher_id = cv.id AND pce.isDelete = 0
			GROUP BY cv.id
			HAVING COALESCE(SUM(pce.credit_amount), 0) < cv.total_amount
			ORDER BY cv.voucher_number`
		);

		return NextResponse.json({
			success: true,
			entries,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
			stats: statsRows[0] || {},
			voucherBalances: voucherBalances || [],
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

		const creditAmt = Math.abs(Number(body.credit_amount ?? 0));
		const debitAmt = Math.abs(Number(body.debit_amount ?? 0));
		if (creditAmt === 0 && debitAmt === 0) {
			return NextResponse.json(
				{ success: false, error: 'credit_amount or debit_amount is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		await ensureTable(db);

		const id = crypto.randomUUID();
		const transactionNumber = body.transaction_number || (await nextNumber(db));

		let custodianName = body.custodian_employee_name || null;
		const custodianId = body.custodian_employee_id || null;

		if (custodianId && !custodianName) {
			const [eRows] = await db.execute(
				"SELECT CONCAT(first_name, ' ', last_name) as full_name FROM employees WHERE id = ?",
				[custodianId]
			);
			custodianName = eRows[0]?.full_name || null;
		}

		const sourceVoucherId = body.source_voucher_id
			? parseInt(body.source_voucher_id, 10) || null
			: null;

		await db.execute(
			`INSERT INTO ${TABLE}
				(id, transaction_number, transaction_date, credit_amount, debit_amount, expense_category,
				 description, payment_mode, payment_reference, recipient_name,
				 custodian_employee_id, custodian_employee_name,
				 bill_no, bill_date, status, notes, created_by, source_voucher_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				transactionNumber,
				body.transaction_date,
				creditAmt,
				debitAmt,
				body.expense_category || null,
				body.description || null,
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
				sourceVoucherId,
			]
		);

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'petty_cash_expense',
			resourceId: id,
			description: `Created petty cash ${transactionNumber}: credit ${creditAmt} / debit ${debitAmt}`,
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
