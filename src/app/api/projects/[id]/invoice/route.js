import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { isRetryableNumberError } from '@/utils/db-number-retry';

// Invoice numbers are ATS/I/<MM>-<YY>/<NNN>. The sequence is the highest
// ACTIVE number for the current month (floor 228, the historical start), never
// a row count: after a soft delete a count re-mints a live number, which the
// unique active_invoice_number index rejects. Runs inside the caller's
// transaction and locks the matching rows (FOR UPDATE) so concurrent POSTs
// serialize; a duplicate-key collision is the backstop and retries.
async function generateNextInvoiceNumber(db) {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const year = String(now.getFullYear()).slice(-2);

	const [rows] = await db.execute(
		`SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '/', -1) AS UNSIGNED)) AS max_seq
		 FROM project_invoices
		 WHERE invoice_number IS NOT NULL AND invoice_number != ''
		   AND (isDelete = 0 OR isDelete IS NULL)
		   AND invoice_number LIKE ?
		 FOR UPDATE`,
		[`ATS/I/${month}-${year}/%`]
	);

	const maxSeq = Number(rows[0]?.max_seq) || 0;
	const sequenceNumber = maxSeq >= 228 ? maxSeq + 1 : 228;
	return `ATS/I/${month}-${year}/${sequenceNumber}`;
}

// GET - Fetch all invoices for a project
export async function GET(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.INVOICES,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	let connection;
	try {
		const { id } = await params;

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Project ID required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const [invoices] = await connection.execute(
			`SELECT * FROM project_invoices WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL) ORDER BY created_at DESC`,
			[id]
		);

		// Preview of the number the POST will mint (read-only hint).
		const nextInvoiceNumber = await generateNextInvoiceNumber(connection);

		return NextResponse.json({
			success: true,
			invoices: invoices || [],
			nextInvoiceNumber,
		});
	} catch (error) {
		console.error('Error fetching invoices:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}

// POST - Create a new invoice
export async function POST(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.INVOICES,
		PERMISSIONS.CREATE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	let connection;
	try {
		const { id } = await params;
		const data = await request.json();

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Project ID required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const {
			invoice_number: providedInvoiceNumber,
			invoice_date,
			company_name,
			city,
			invoice_amount,
			project_number,
			expenses_head,
			payment,
			purchase_description,
			payment_overdue_days,
			remarks,
			tab_type,
		} = data;

		// Number generation and the INSERT are one transaction so concurrent
		// POSTs cannot mint the same ATS/I number (the sequence is the active
		// row count, locked FOR UPDATE); the unique active invoice-number index
		// makes a lost race a duplicate-key error, which retries.
		let invoiceNumber = null;
		let insertId = null;
		for (let attempt = 1; ; attempt++) {
			await connection.beginTransaction();
			try {
				// Reset per attempt so a generated number that collided is
				// regenerated from a fresh read instead of retried as-is.
				invoiceNumber = providedInvoiceNumber || null;

				if (!invoiceNumber) {
					invoiceNumber = await generateNextInvoiceNumber(connection);
				}

				const [result] = await connection.execute(
					`INSERT INTO project_invoices 
       (project_id, invoice_number, invoice_date, company_name, city, invoice_amount,
        project_number, expenses_head, payment, purchase_description, payment_overdue_days, remarks, tab_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						id,
						invoiceNumber,
						invoice_date || null,
						company_name || null,
						city || null,
						invoice_amount || null,
						project_number || null,
						expenses_head || null,
						payment || null,
						purchase_description || null,
						payment_overdue_days || 0,
						remarks || null,
						tab_type || 'invoice',
					]
				);
				insertId = result.insertId;

				await connection.commit();
				break;
			} catch (error) {
				await connection.rollback();
				if (
					!providedInvoiceNumber &&
					isRetryableNumberError(error) &&
					attempt < 5
				) {
					await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
					continue;
				}
				throw error;
			}
		}

		return NextResponse.json({
			success: true,
			message: 'Invoice created successfully',
			invoiceId: insertId,
		});
	} catch (error) {
		console.error('Error creating invoice:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}

// PUT - Update an existing invoice
export async function PUT(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.INVOICES,
		PERMISSIONS.UPDATE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	let connection;
	try {
		const { id } = await params;
		const data = await request.json();

		if (!id || !data.invoiceId) {
			return NextResponse.json(
				{ success: false, error: 'Project ID and Invoice ID required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const {
			invoiceId,
			invoice_number,
			invoice_date,
			company_name,
			city,
			invoice_amount,
			project_number,
			expenses_head,
			payment,
			purchase_description,
			payment_overdue_days,
			remarks,
			tab_type,
		} = data;

		await connection.execute(
			`UPDATE project_invoices 
       SET invoice_number = ?, invoice_date = ?, company_name = ?, city = ?,
           invoice_amount = ?, project_number = ?, expenses_head = ?, payment = ?,
           purchase_description = ?, payment_overdue_days = ?, remarks = ?, tab_type = ?
       WHERE id = ? AND project_id = ?`,
			[
				invoice_number || null,
				invoice_date || null,
				company_name || null,
				city || null,
				invoice_amount || null,
				project_number || null,
				expenses_head || null,
				payment || null,
				purchase_description || null,
				payment_overdue_days || 0,
				remarks || null,
				tab_type || 'invoice',
				invoiceId,
				id,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Invoice updated successfully',
		});
	} catch (error) {
		console.error('Error updating invoice:', error);
		// Active invoice-number unique index: surface a collision as 409, not 500.
		if (error?.errno === 1062 || error?.code === 'ER_DUP_ENTRY') {
			return NextResponse.json(
				{ success: false, error: 'This invoice number already exists' },
				{ status: 409 }
			);
		}
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}

// DELETE - Delete an invoice
export async function DELETE(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.INVOICES,
		PERMISSIONS.DELETE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	let connection;
	try {
		const { id } = await params;
		const { searchParams } = new URL(request.url);
		const invoiceId = searchParams.get('invoiceId');

		if (!id || !invoiceId) {
			return NextResponse.json(
				{ success: false, error: 'Project ID and Invoice ID required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		await connection.execute(
			`UPDATE project_invoices SET isDelete = 1 WHERE id = ? AND project_id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			[invoiceId, id]
		);

		return NextResponse.json({
			success: true,
			message: 'Invoice deleted successfully',
		});
	} catch (error) {
		console.error('Error deleting invoice:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}
