import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

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
		const offset = (page - 1) * limit;

		db = await dbConnect();

		// Ensure table exists
		await db.execute(`
      CREATE TABLE IF NOT EXISTS payment_entries (
        id VARCHAR(255) PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        city VARCHAR(255),
        receipt_no VARCHAR(100),
        receipt_date DATE,
        amount DECIMAL(15, 2) DEFAULT 0,
        payment_date DATE,
        transaction_id VARCHAR(100),
        bank_name VARCHAR(255),
        remark TEXT,
        invoice_no VARCHAR(100),
        invoice_date DATE,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

		try {
			await db.execute(
				'ALTER TABLE payment_entries CHANGE client_name company_name VARCHAR(255) NOT NULL'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN city VARCHAR(255)'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN receipt_no VARCHAR(100)'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN receipt_date DATE'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN payment_date DATE'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN bank_name VARCHAR(255)'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries CHANGE remarks remark TEXT'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN invoice_no VARCHAR(100)'
			);
		} catch (e) {}
		try {
			await db.execute(
				'ALTER TABLE payment_entries ADD COLUMN invoice_date DATE'
			);
		} catch (e) {}

		// Get entries with pagination
		const [entries] = await db.execute(
			`SELECT * FROM payment_entries ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			[limit, offset]
		);

		// Get total count for pagination
		const [countResult] = await db.execute(
			`SELECT COUNT(*) as total FROM payment_entries`
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
             WHERE receipt_no LIKE ? AND YEAR(created_at) = ? 
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
        id, company_name, city, receipt_no, receipt_date, amount, payment_date, transaction_id, bank_name, remark, invoice_no, invoice_date, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				user.id || null,
			]
		);

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
        company_name = ?, city = ?, receipt_no = ?, receipt_date = ?, amount = ?, payment_date = ?, transaction_id = ?, bank_name = ?, remark = ?, invoice_no = ?, invoice_date = ?
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
				data.id,
			]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment entry not found' },
				{ status: 404 }
			);
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

		const [result] = await db.execute(
			'DELETE FROM payment_entries WHERE id = ?',
			[id]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment entry not found' },
				{ status: 404 }
			);
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
