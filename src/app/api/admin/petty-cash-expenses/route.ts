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
	if (authResult.authorized === false) return authResult.response;

	let db: any;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '10');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();

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
				COALESCE(SUM(debit_amount), 0) as pceDebits,
				COALESCE(SUM(debit_amount - credit_amount), 0) as currentBalance,
				COALESCE(SUM(CASE WHEN status = 'approved' THEN debit_amount - credit_amount ELSE 0 END), 0) as approvedAmount
			FROM ${TABLE}
			WHERE isDelete = 0`
		);

		const [voucherTotalRows] = await db.execute(
			`SELECT COALESCE(SUM(total_amount), 0) as voucherTotal FROM cash_vouchers`
		);
		const voucherTotal = (voucherTotalRows[0] as any)?.voucherTotal || 0;

		const mergedStats = {
			...(statsRows[0] || {}),
			totalPaid: voucherTotal,
			currentBalance:
				voucherTotal - Number((statsRows[0] as any)?.totalReceived || 0),
		};

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
			stats: mergedStats,
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
