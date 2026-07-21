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
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: any;
	try {
		const { searchParams } = new URL(request.url);
		const search = searchParams.get('search');
		const unsettled = searchParams.get('unsettled') === 'true';

		db = await dbConnect();

		// ── Build WHERE ──
		const where: string[] = ['pce.isDelete = 0'];
		const params: (string | number)[] = [];

		if (search) {
			const s = `%${search}%`;
			where.push(
				'(pce.transaction_number LIKE ? OR pce.description LIKE ? OR pce.recipient_name LIKE ? OR pce.bill_no LIKE ? OR pce.notes LIKE ?)'
			);
			params.push(s, s, s, s, s);
		}

		if (unsettled) {
			where.push(
				'pce.source_voucher_id IS NULL AND pce.debit_amount > 0 AND pce.credit_amount = 0'
			);
		}

		const whereSql = `WHERE ${where.join(' AND ')}`;

		const [rows] = await db.execute(
			`WITH ordered AS (
			  SELECT pce.*, cv.voucher_number as source_voucher_number,
			    SUM(pce.debit_amount - pce.credit_amount)
			      OVER (ORDER BY pce.transaction_date, pce.created_at ROWS UNBOUNDED PRECEDING) as running_balance
			  FROM ${TABLE} pce
			  LEFT JOIN cash_vouchers cv ON pce.source_voucher_id = cv.id
			  ${whereSql}
			)
			SELECT *, ROW_NUMBER() OVER (ORDER BY transaction_date DESC, created_at DESC) as sr_no
			FROM ordered
			ORDER BY transaction_date DESC, created_at DESC`,
			params
		);

		// ── Global stats ──
		const [statsRows] = await db.execute(
			`SELECT
				COALESCE(SUM(debit_amount), 0) as totalDebits,
				COALESCE(SUM(credit_amount), 0) as totalCredits,
				COALESCE(SUM(debit_amount - credit_amount), 0) as balance
			FROM ${TABLE}
			WHERE isDelete = 0`
		);

		// ── Voucher balances for add-dropdown (remaining > 0) ──
		const [voucherBalances] = await db.execute(
			`SELECT cv.id, cv.voucher_number, cv.total_amount, cv.paid_to, cv.notes, cv.description,
				COALESCE(SUM(pce.debit_amount), 0) as total_debited,
				cv.total_amount - COALESCE(SUM(pce.debit_amount), 0) as remaining
			FROM cash_vouchers cv
			LEFT JOIN ${TABLE} pce ON pce.source_voucher_id = cv.id AND pce.isDelete = 0
			GROUP BY cv.id
			HAVING COALESCE(SUM(pce.debit_amount), 0) < cv.total_amount
			ORDER BY cv.voucher_number`
		);

		return NextResponse.json({
			success: true,
			data: rows,
			stats: statsRows[0] || { totalDebits: 0, totalCredits: 0, balance: 0 },
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
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

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
