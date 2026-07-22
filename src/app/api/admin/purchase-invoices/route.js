import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'purchase_invoices';

async function nextNumber(db) {
	const [rows] = await db.execute(
		`SELECT invoice_number FROM ${TABLE} WHERE invoice_number LIKE 'PI-%' ORDER BY id DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const match = /PI-(\d+)/.exec(rows[0].invoice_number || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `PI-${String(next).padStart(5, '0')}`;
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
				'(invoice_number LIKE ? OR vendor_name LIKE ? OR po_number LIKE ?)'
			);
			const s = `%${search}%`;
			params.push(s, s, s);
		}

		const whereSql = where.join(' AND ');
		const [countRows] = await db.execute(
			`SELECT COUNT(*) as total FROM ${TABLE} WHERE ${whereSql}`,
			params
		);
		const total = countRows[0]?.total || 0;

		const [rows] = await db.execute(
			`SELECT * FROM ${TABLE} WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);

		const [statsRows] = await db.execute(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
				SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
				SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
				COALESCE(SUM(total), 0) as totalValue,
				COALESCE(SUM(amount_paid), 0) as totalPaid,
				COALESCE(SUM(balance_due), 0) as totalBalance
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
		console.error('Error fetching purchase invoices:', error);
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

		if (!body.vendor_name) {
			return NextResponse.json(
				{ success: false, error: 'vendor_name is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const invoiceNumber = body.invoice_number || (await nextNumber(db));
		const total = Number(body.total ?? 0);
		const amountPaid = Number(body.amount_paid ?? 0);
		const balanceDue = total - amountPaid;
		const paymentStatus =
			body.payment_status ||
			(amountPaid >= total && total > 0
				? 'paid'
				: amountPaid > 0
					? 'partial'
					: 'unpaid');

		const [result] = await db.execute(
			`INSERT INTO ${TABLE}
				(invoice_number, invoice_date, due_date, vendor_name, vendor_email, vendor_phone, vendor_address,
				 vendor_gstin, vendor_pan, po_number, po_date, po_id, description, items,
				 subtotal, tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount,
				 discount, total, amount_paid, balance_due, payment_status,
				 notes, terms, attachment_url, status, project_id, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				invoiceNumber,
				body.invoice_date || null,
				body.due_date || null,
				body.vendor_name,
				body.vendor_email || null,
				body.vendor_phone || null,
				body.vendor_address || null,
				body.vendor_gstin || null,
				body.vendor_pan || null,
				body.po_number || null,
				body.po_date || null,
				body.po_id || null,
				body.description || null,
				body.items ? JSON.stringify(body.items) : null,
				body.subtotal ?? 0,
				body.tax_rate ?? 18,
				body.tax_amount ?? 0,
				body.cgst_amount ?? 0,
				body.sgst_amount ?? 0,
				body.igst_amount ?? 0,
				body.discount ?? 0,
				total,
				amountPaid,
				balanceDue,
				paymentStatus,
				body.notes || null,
				body.terms || null,
				body.attachment_url || null,
				body.status || 'draft',
				body.project_id || null,
				user?.id || null,
			]
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'purchase_invoice',
			resourceId: result.insertId,
			description: `Created purchase invoice ${invoiceNumber} for ${body.vendor_name}`,
			request,
		});

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, invoice_number: invoiceNumber },
		});
	} catch (error) {
		console.error('Error creating purchase invoice:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
