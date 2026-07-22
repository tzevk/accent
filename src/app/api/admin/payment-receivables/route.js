import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'payment_receivables';

async function nextNumber(db) {
	const [rows] = await db.execute(
		`SELECT reference_number FROM ${TABLE} WHERE reference_number LIKE 'PR-%' ORDER BY id DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const match = /PR-(\d+)/.exec(rows[0].reference_number || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `PR-${String(next).padStart(5, '0')}`;
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

		const where = ['1=1 AND isDelete = 0'];
		const params = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (search) {
			where.push(
				'(reference_number LIKE ? OR client_name LIKE ? OR invoice_number LIKE ? OR po_number LIKE ?)'
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
				SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received,
				SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
				COALESCE(SUM(invoice_amount), 0) as totalInvoiced,
				COALESCE(SUM(paid_amount), 0) as totalReceived,
				COALESCE(SUM(balance_due), 0) as totalOutstanding
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
		console.error('Error fetching receivables:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
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

		if (!body.client_name) {
			return NextResponse.json(
				{ success: false, error: 'client_name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const referenceNumber = body.reference_number || (await nextNumber(db));
		const invoiceAmount = Number(body.invoice_amount ?? 0);
		const paidAmount = Number(body.paid_amount ?? 0);
		const balanceDue = Number(body.balance_due ?? invoiceAmount - paidAmount);

		const [result] = await db.execute(
			`INSERT INTO ${TABLE}
				(reference_number, invoice_number, invoice_id, client_name, client_email, client_phone,
				 invoice_date, due_date, invoice_amount, paid_amount, balance_due, currency,
				 project_id, po_number, payment_terms, last_follow_up_date, next_follow_up_date,
				 notes, status, received_date, payment_mode, transaction_reference,
				 assigned_to, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				referenceNumber,
				body.invoice_number || null,
				body.invoice_id || null,
				body.client_name,
				body.client_email || null,
				body.client_phone || null,
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
				body.received_date || null,
				body.payment_mode || null,
				body.transaction_reference || null,
				body.assigned_to || null,
				user?.id || null,
			]
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'payment_receivable',
			resourceId: result.insertId,
			description: `Created receivable ${referenceNumber} for ${body.client_name}`,
			request,
		});

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, reference_number: referenceNumber },
		});
	} catch (error) {
		console.error('Error creating receivable:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
