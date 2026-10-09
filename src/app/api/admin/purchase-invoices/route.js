import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import { R, sub, gte, gt, toNumber } from '@/lib/money';
import { isRetryableNumberError } from '@/utils/db-number-retry';
import { CostError, initializeSupplierCost } from '@/lib/company-expenditure';
import { splitInput } from './input';

const TABLE = 'purchase_invoices';

// Minting is serialized app-wide with a named lock (GET_LOCK, MariaDB/MySQL):
// under six-way concurrency the previous mint+insert section deadlocked (errno
// 1213) no matter which read strategy the generator used, and the bounded retry
// could exhaust into a 500. The lock is held for the whole
// read+insert section and MUST be released before the pooled connection is
// handed back; the unique active invoice-number index stays as the backstop.
const NUMBER_LOCK = 'accent:purchase_invoices:number';

async function acquireNumberLock(db) {
	const [rows] = await db.execute('SELECT GET_LOCK(?, 10) AS acquired', [
		NUMBER_LOCK,
	]);
	if (Number(rows[0]?.acquired) !== 1) {
		throw new Error('Timed out waiting for the purchase-invoice number lock');
	}
}

async function releaseNumberLock(db) {
	await db.execute('SELECT RELEASE_LOCK(?)', [NUMBER_LOCK]);
}

// Purchase-invoice numbers are PI-#####. The read runs inside the caller's
// transaction with a row lock (FOR UPDATE) on the newest row; concurrent POSTs
// serialize on the named lock above, and the unique active invoice-number
// index is the backstop and a collision retries with a fresh read.
async function nextNumber(db) {
	const [rows] = await db.execute(
		`SELECT invoice_number FROM ${TABLE} WHERE invoice_number LIKE 'PI-%' AND isDelete = 0 ORDER BY id DESC LIMIT 1 FOR UPDATE`
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
		RESOURCES.PURCHASE_ORDERS,
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
			WHERE isDelete = 0
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
		RESOURCES.PURCHASE_ORDERS,
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

		const total = R(body.total ?? 0);
		const amountPaid = R(body.amount_paid ?? 0);
		const balanceDue = toNumber(sub(total, amountPaid));
		const paymentStatus =
			body.payment_status ||
			(gte(amountPaid, total) && gt(total, 0)
				? 'paid'
				: gt(amountPaid, 0)
					? 'partial'
					: 'unpaid');

		// The mint + insert section is serialized app-wide by the named lock; a
		// lock timeout surfaces as a 500. Every path releases it in the finally
		// below, before the connection returns to the pool.
		let numberLocked = false;
		let invoiceNumber;
		let result;
		let recordedCost = null;
		try {
			await acquireNumberLock(db);
			numberLocked = true;

			// Number generation and INSERT are one transaction so concurrent POSTs
			// cannot mint the same PI number; the unique active-number index makes a
			// lost race a duplicate-key error, which retries from a fresh read.
			for (let attempt = 1; ; attempt++) {
				await db.beginTransaction();
				try {
					invoiceNumber = body.invoice_number || (await nextNumber(db));

					[result] = await db.execute(
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
							toNumber(total),
							toNumber(amountPaid),
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

					// The financial identity and recognition fields are the
					// shared module's write path; the register owns the native
					// row and its number. One transaction: either the invoice
					// exists with its cost identity, or neither exists.
					recordedCost = await initializeSupplierCost(
						db,
						result.insertId,
						{
							costClassification:
								body.cost_classification === undefined
									? undefined
									: body.cost_classification,
							projectId: body.project_id || null,
							servicePeriodStart: body.service_period_start || null,
							servicePeriodEnd: body.service_period_end || null,
							billDate: body.invoice_date || null,
							currency: body.currency || null,
							grossAmount: body.gross_amount ?? toNumber(total),
							taxAmount: body.tax_amount ?? 0,
							taxTreatment: body.tax_treatment,
							taxEvidenceReference: body.tax_evidence_reference || null,
							sourceReference: body.source_reference || null,
							evidenceReference: body.evidence_reference || null,
							withholdingTaxAmount: body.withholding_tax_amount ?? 0,
							reportingCurrency: body.reporting_currency || null,
							conversionRate:
								body.conversion_rate === undefined ||
								body.conversion_rate === ''
									? null
									: body.conversion_rate,
							conversionDate: body.conversion_date || null,
							conversionEvidenceReference:
								body.conversion_evidence_reference || null,
							submit:
								body.submit === true ||
								body.recognition_state === 'pending_evidence',
							splits: Array.isArray(body.splits)
								? body.splits.map((split) => splitInput(split ?? {}))
								: null,
						},
						{ id: user?.id || null }
					);

					await db.commit();
					break;
				} catch (error) {
					await db.rollback();
					if (
						!body.invoice_number &&
						isRetryableNumberError(error) &&
						attempt < 5
					) {
						await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
						continue;
					}
					throw error;
				}
			}
		} finally {
			if (numberLocked) await releaseNumberLock(db);
		}

		// The logger checks out its own pooled connection; holding this one while
		// it waits can starve the pool when several creates run concurrently.
		// Release first; the `finally` stays as the error-path guard.
		await db.release();
		db = null;

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
			data: {
				id: result.insertId,
				invoice_number: invoiceNumber,
				...(recordedCost ?? {}),
			},
		});
	} catch (error) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('Error creating purchase invoice:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
