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

const TABLE = 'other_expenses';

async function nextNumber(db: any): Promise<string> {
	const [rows] = await db.execute(
		`SELECT voucher_number FROM ${TABLE} WHERE voucher_number LIKE 'OEX-%' ORDER BY created_at DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const match = /OEX-(\d+)/.exec(rows[0].voucher_number || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `OEX-${String(next).padStart(5, '0')}`;
}

export async function GET(request: Request) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: any;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const category = searchParams.get('expense_category');
		const payeeType = searchParams.get('payee_type');
		const search = searchParams.get('search');
		const offset = (page - 1) * limit;

		db = await dbConnect();

		const where = ['1=1 AND isDelete = 0'];
		const params: (string | number)[] = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (category && category !== 'all') {
			where.push('expense_category = ?');
			params.push(category);
		}
		if (payeeType && payeeType !== 'all') {
			where.push('payee_type = ?');
			params.push(payeeType);
		}
		if (search) {
			where.push(
				'(voucher_number LIKE ? OR bill_no LIKE ? OR vendor_name LIKE ? OR employee_name LIKE ? OR description LIKE ?)'
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
			`SELECT *, ROW_NUMBER() OVER (ORDER BY voucher_date DESC, created_at DESC) as sr_no FROM ${TABLE} WHERE ${whereSql} ORDER BY voucher_date DESC, created_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				COALESCE(SUM(net_amount), 0) as totalAmount,
				COALESCE(SUM(CASE WHEN status = 'approved' THEN net_amount ELSE 0 END), 0) as approvedAmount
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
		console.error('Error fetching other expenses:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

export async function POST(request: Request) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: any;
	try {
		const body = await request.json();
		const user = authResult.user;

		if (!body.voucher_date) {
			return NextResponse.json(
				{ success: false, error: 'voucher_date is required' },
				{ status: 400 }
			);
		}
		if (!body.expense_category) {
			return NextResponse.json(
				{ success: false, error: 'expense_category is required' },
				{ status: 400 }
			);
		}
		if (!body.payee_type) {
			return NextResponse.json(
				{ success: false, error: 'payee_type is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const id = crypto.randomUUID();
		const voucherNumber = body.voucher_number || (await nextNumber(db));
		const billAmount = Number(body.bill_amount ?? 0);
		const gstAmount = Number(body.gst_amount ?? 0);
		const netAmount = body.net_amount ?? billAmount + gstAmount;

		let vendorName = body.vendor_name || null;
		const vendorId = body.vendor_id || null;
		let employeeName = body.employee_name || null;
		const employeeId = body.employee_id || null;

		if (body.payee_type === 'vendor' && vendorId && !vendorName) {
			const [vRows] = await db.execute(
				'SELECT vendor_name FROM vendors WHERE id = ?',
				[vendorId]
			);
			vendorName = vRows[0]?.vendor_name || null;
		}
		if (body.payee_type === 'employee' && employeeId && !employeeName) {
			const [eRows] = await db.execute(
				"SELECT CONCAT(first_name, ' ', last_name) as full_name FROM employees WHERE id = ?",
				[employeeId]
			);
			employeeName = eRows[0]?.full_name || null;
		}

		await db.execute(
			`INSERT INTO ${TABLE}
				(id, voucher_number, voucher_date, expense_category, payee_type,
				 vendor_id, vendor_name, employee_id, employee_name,
				 bill_no, bill_date, bill_amount, gst_amount, net_amount,
				 description, status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				voucherNumber,
				body.voucher_date,
				body.expense_category,
				body.payee_type,
				vendorId,
				vendorName,
				employeeId,
				employeeName,
				body.bill_no || null,
				body.bill_date || null,
				billAmount,
				gstAmount,
				netAmount,
				body.description || null,
				body.status || 'submitted',
				user?.id || null,
			]
		);

		const payeeLabel =
			body.payee_type === 'vendor'
				? `vendor ${vendorName || vendorId || ''}`
				: `employee ${employeeName || employeeId || ''}`;

		await (logActivity as any)({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'other_expense',
			resourceId: id,
			description: `Created other expense ${voucherNumber} for ${body.expense_category} (${payeeLabel})`,
			request: request as any,
		});

		return NextResponse.json({
			success: true,
			data: { id, voucher_number: voucherNumber },
		});
	} catch (error: any) {
		console.error('Error creating other expense:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
