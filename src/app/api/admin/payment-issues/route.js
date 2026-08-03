import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
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
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const search = (searchParams.get('search') || '').trim();
		const status = searchParams.get('status');
		const offset = (page - 1) * limit;

		db = await dbConnect();

		const whereClauses = ['isDelete = 0'];
		const queryParams = [];

		if (search) {
			whereClauses.push(
				'(payee_name LIKE ? OR invoice_number LIKE ? OR transaction_reference LIKE ? OR bank_name LIKE ?)'
			);
			const like = `%${search}%`;
			queryParams.push(like, like, like, like);
		}

		if (status && status !== 'all') {
			whereClauses.push('status = ?');
			queryParams.push(status);
		}

		const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

		const [entries] = await db.execute(
			`SELECT * FROM payment_issues ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			[...queryParams, limit, offset]
		);

		const [countResult] = await db.execute(
			`SELECT COUNT(*) as total FROM payment_issues ${whereSQL}`,
			queryParams
		);
		const total = countResult[0]?.total || 0;

		// Stats
		let stats = { total: 0, full: 0, part: 0, totalAmount: 0 };
		try {
			const [statsResult] = await db.execute(
				`SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'full' THEN 1 ELSE 0 END) as full,
          SUM(CASE WHEN status = 'part' THEN 1 ELSE 0 END) as part,
          COALESCE(SUM(net_amount), 0) as totalAmount
        FROM payment_issues WHERE isDelete = 0`
			);
			stats = { ...stats, ...statsResult[0] };
		} catch (e) {
			/* stats table may not exist yet */
		}

		return NextResponse.json({
			success: true,
			data: entries,
			pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
			stats,
		});
	} catch (error) {
		console.error('Error fetching payment issues:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch payment issues' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
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
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const body = await request.json();
		const {
			payee_name,
			payee_type = 'company',
			invoice_number,
			invoice_date,
			invoice_amount,
			amount,
			deduction,
			net_amount,
			issue_date,
			transaction_reference,
			bank_name,
			status = 'full',
			notes,
		} = body;

		if (!payee_name) {
			return NextResponse.json(
				{ success: false, error: 'Client/Vendor name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [result] = await db.execute(
			`INSERT INTO payment_issues
       (payee_name, payee_type, invoice_number, invoice_date, invoice_amount, amount, deduction, net_amount, issue_date, transaction_reference, bank_name, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				payee_name,
				payee_type || 'company',
				invoice_number || null,
				invoice_date || null,
				invoice_amount || 0,
				amount || invoice_amount || 0,
				deduction || 0,
				net_amount || (amount || invoice_amount || 0) - (deduction || 0),
				issue_date || null,
				transaction_reference || null,
				bank_name || null,
				status || 'full',
				notes || null,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Payment issue created',
			id: result.insertId,
		});
	} catch (error) {
		console.error('Error creating payment issue:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to create payment issue' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
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
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		const body = await request.json();
		db = await dbConnect();

		const [result] = await db.execute(
			`UPDATE payment_issues SET
        payee_name = ?, payee_type = ?, invoice_number = ?, invoice_date = ?,
        invoice_amount = ?, amount = ?, deduction = ?, net_amount = ?,
        issue_date = ?, transaction_reference = ?, bank_name = ?, status = ?, notes = ?
       WHERE id = ? AND isDelete = 0`,
			[
				body.payee_name,
				body.payee_type || 'company',
				body.invoice_number || null,
				body.invoice_date || null,
				body.invoice_amount || 0,
				body.amount || 0,
				body.deduction || 0,
				body.net_amount || 0,
				body.issue_date || null,
				body.transaction_reference || null,
				body.bank_name || null,
				body.status || 'full',
				body.notes || null,
				id,
			]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment issue not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment issue updated',
		});
	} catch (error) {
		console.error('Error updating payment issue:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update payment issue' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
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
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

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
			`UPDATE payment_issues SET isDelete = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND isDelete = 0`,
			[authResult.user?.id ?? null, id]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Payment issue not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Payment issue deleted',
		});
	} catch (error) {
		console.error('Error deleting payment issue:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete payment issue' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
