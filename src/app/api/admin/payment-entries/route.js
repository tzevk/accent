import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { updateInvoicePaymentStatus } from '@/utils/payment-utils';

export async function GET(request) {
	let db;

	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.READ
		);
		if (authResult.authorized === false) return authResult.response;

		const user = authResult.user;

		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const search = (searchParams.get('search') || '').trim();
		const offset = (page - 1) * limit;

		db = await dbConnect();

		const whereClauses = ['isDelete = 0'];
		const queryParams = [];

		if (search) {
			const like = `%${search}%`;
			whereClauses.push(
				'(company_name LIKE ? OR receipt_no LIKE ? OR transaction_id LIKE ?)'
			);
			queryParams.push(like, like, like);
		}

		const whereSQL = whereClauses.length
			? `WHERE ${whereClauses.join(' AND ')}`
			: '';

		// Get entries with pagination
		const [entries] = await db.execute(
			`SELECT * FROM payment_entries ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			[...queryParams, limit, offset]
		);

		// Get total count for pagination
		const [countResult] = await db.execute(
			`SELECT COUNT(*) as total FROM payment_entries ${whereSQL}`,
			queryParams
		);
		const total = countResult[0]?.total || 0;

		return NextResponse.json({
			success: true,
			data: entries,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error('Payment entries list error:', error?.message);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch payment entries',
				details: error?.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}

export async function POST(request) {
	let db;

	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.CREATE
		);
		if (authResult.authorized === false) return authResult.response;

		const user = authResult.user;

		const data = await request.json();

		db = await dbConnect();

		const id = crypto.randomUUID();

		const date = new Date();
		const currentMonth = String(date.getMonth() + 1).padStart(2, '0');
		const currentYear = date.getFullYear();
		const prefix = `R-${currentMonth}-`;

		const [rows] = await db.execute(
			`SELECT receipt_no FROM payment_entries 
             WHERE receipt_no LIKE ? AND YEAR(created_at) = ? AND isDelete = 0
             ORDER BY CAST(SUBSTRING_INDEX(receipt_no, '-', -1) AS UNSIGNED) DESC LIMIT 1`,
			[`${prefix}%`, currentYear]
		);

		let nextNum = 1;
		if (rows.length > 0 && rows[0].receipt_no) {
			const lastReceipt = rows[0].receipt_no;
			const lastNum = parseInt(lastReceipt.split('-').pop(), 10);
			if (!isNaN(lastNum)) {
				nextNum = lastNum + 1;
			}
		}

		const autogenReceiptNo = `${prefix}${String(nextNum).padStart(3, '0')}`;

		await db.execute(
			`INSERT INTO payment_entries (
        id, company_name, city, receipt_no, receipt_date, amount, payment_date, transaction_id, bank_name, remark, invoice_no, invoice_date, payment_type, tds_amount, gst_amount, net_amount, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.company_name || '',
				data.city || '',
				autogenReceiptNo,
				data.receipt_date || null,
				data.amount || 0,
				data.payment_date || null,
				data.transaction_id || '',
				data.bank_name || '',
				data.remark || '',
				data.invoice_no || '',
				data.invoice_date || null,
				data.payment_type || null,
				data.tds_amount || 0,
				data.gst_amount || 0,
				data.net_amount || 0,
				user.id || null,
			]
		);

		if (data.invoice_no) {
			await updateInvoicePaymentStatus(db, data.invoice_no);
		}

		return NextResponse.json({
			success: true,
			data: { id },
			message: 'Payment entry created successfully',
		});
	} catch (error) {
		console.error('Create payment entry error:', error?.message);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to create payment entry',
				details: error?.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}

export async function PUT(request) {
	let db;

	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.UPDATE
		);
		if (authResult.authorized === false) return authResult.response;

		const user = authResult.user;

		const data = await request.json();
		if (!data.id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [result] = await db.execute(
			`UPDATE payment_entries SET
        company_name = ?, city = ?, receipt_no = ?, receipt_date = ?, amount = ?, payment_date = ?, transaction_id = ?, bank_name = ?, remark = ?, invoice_no = ?, invoice_date = ?, payment_type = ?, tds_amount = ?, gst_amount = ?, net_amount = ?
       WHERE id = ?`,
			[
				data.company_name || '',
				data.city || '',
				data.receipt_no || '',
				data.receipt_date || null,
				data.amount || 0,
				data.payment_date || null,
				data.transaction_id || '',
				data.bank_name || '',
				data.remark || '',
				data.invoice_no || '',
				data.invoice_date || null,
				data.payment_type || null,
				data.tds_amount || 0,
				data.gst_amount || 0,
				data.net_amount || 0,
				data.id,
			]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment entry not found' },
				{ status: 404 }
			);
		}

		if (data.invoice_no) {
			await updateInvoicePaymentStatus(db, data.invoice_no);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment entry updated successfully',
		});
	} catch (error) {
		console.error('Update payment entry error:', error?.message);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update payment entry',
				details: error?.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}

export async function DELETE(request) {
	let db;

	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.ADMIN,
			PERMISSIONS.DELETE
		);
		if (authResult.authorized === false) return authResult.response;

		const user = authResult.user;

		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [entries] = await db.execute(
			'SELECT invoice_no FROM payment_entries WHERE id = ? AND isDelete = 0',
			[id]
		);
		const invoiceNo = entries.length > 0 ? entries[0].invoice_no : '';

		const [result] = await db.execute(
			'UPDATE payment_entries SET isDelete = 1 WHERE id = ? AND isDelete = 0',
			[id]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment entry not found' },
				{ status: 404 }
			);
		}

		if (invoiceNo) {
			await updateInvoicePaymentStatus(db, invoiceNo);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment entry deleted successfully',
		});
	} catch (error) {
		console.error('Delete payment entry error:', error?.message);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete payment entry',
				details: error?.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch {
				/* ignore */
			}
		}
	}
}
