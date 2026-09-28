import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { sanitizeOptionalRichText } from '@/lib/sanitize-fields';
import { isRetryableNumberError } from '@/utils/db-number-retry';

// Quotation numbers are ATSPL/Q/<MM>/<YY-YY>/<NNN>. The sequence is the
// highest ACTIVE number for the current month/FY (floor 107, the historical
// start), never a row count: after a soft delete a count re-mints a live
// number, which the unique active_quotation_number index rejects. Runs inside
// the caller's transaction and locks the matching rows (FOR UPDATE).
async function generateNextQuotationNumber(db) {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const currentMonthNumber = now.getMonth() + 1;
	const fyStart =
		currentMonthNumber >= 4 ? now.getFullYear() : now.getFullYear() - 1;
	const fyString = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;

	const [rows] = await db.execute(
		`SELECT MAX(CAST(SUBSTRING_INDEX(quotation_number, '/', -1) AS UNSIGNED)) AS max_seq
		 FROM project_quotations
		 WHERE quotation_number IS NOT NULL AND quotation_number != ''
		   AND (isDelete = 0 OR isDelete IS NULL)
		   AND quotation_number LIKE ?
		 FOR UPDATE`,
		[`ATSPL/Q/${month}/${fyString}/%`]
	);

	const maxSeq = Number(rows[0]?.max_seq) || 0;
	const sequenceNumber = maxSeq >= 107 ? maxSeq + 1 : 107;
	return `ATSPL/Q/${month}/${fyString}/${sequenceNumber}`;
}

// GET - Fetch quotation for a project
export async function GET(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.QUOTATIONS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	let connection;
	try {
		const { id } = await params;
		connection = await dbConnect();

		// Fetch quotation for this project
		const [rows] = await connection.execute(
			'SELECT * FROM project_quotations WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL)',
			[id]
		);

		// Preview of the number the POST will mint (read-only hint).
		let nextQuotationNumber = '';
		if (rows.length === 0) {
			nextQuotationNumber = await generateNextQuotationNumber(connection);
		}

		return NextResponse.json({
			success: true,
			data: rows[0] || null,
			nextQuotationNumber,
		});
	} catch (error) {
		console.error('Error fetching project quotation:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// POST - Create or update quotation for a project
export async function POST(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.QUOTATIONS,
		PERMISSIONS.CREATE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	let connection;
	try {
		const { id } = await params;
		const body = await request.json();

		const {
			quotation_number: providedQuotationNumber,
			quotation_date,
			client_name,
			enquiry_number,
			enquiry_quantity,
			scope_of_work: rawScopeOfWork,
			gross_amount,
			gst_percentage = 18,
			gst_amount,
			net_amount,
		} = body;

		// scope_of_work is an HTML-bound column (quotation documents): sanitize
		// at the write boundary (ADR-0012).
		const scope_of_work = sanitizeOptionalRichText(rawScopeOfWork);

		connection = await dbConnect();

		// The existence check, number generation and the upsert are one
		// transaction: the check locks the project's row (FOR UPDATE) so
		// concurrent saves serialize, and a generated number that collides with
		// a concurrent insert (unique active quotation-number index) retries.
		let quotationNumber = providedQuotationNumber || null;
		let existed = false;
		for (let attempt = 1; ; attempt++) {
			await connection.beginTransaction();
			try {
				// Reset per attempt so a generated number that collided is
				// regenerated from a fresh read instead of retried as-is.
				quotationNumber = providedQuotationNumber || null;

				// Check if quotation already exists for this project
				const [existing] = await connection.execute(
					'SELECT id FROM project_quotations WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL) FOR UPDATE',
					[id]
				);
				existed = existing.length > 0;

				if (!quotationNumber) {
					quotationNumber = await generateNextQuotationNumber(connection);
				}

				if (existed) {
					// Update existing quotation
					await connection.execute(
						`UPDATE project_quotations SET
          quotation_number = ?,
          quotation_date = ?,
          client_name = ?,
          enquiry_number = ?,
          enquiry_quantity = ?,
          scope_of_work = ?,
          gross_amount = ?,
          gst_percentage = ?,
          gst_amount = ?,
          net_amount = ?,
          updated_at = NOW()
        WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
						[
							quotationNumber,
							quotation_date || null,
							client_name || null,
							enquiry_number ?? null,
							enquiry_quantity ?? null,
							scope_of_work ?? null,
							gross_amount || 0,
							gst_percentage || 18,
							gst_amount || 0,
							net_amount || 0,
							id,
						]
					);
				} else {
					// Insert new quotation
					await connection.execute(
						`INSERT INTO project_quotations (
          project_id, quotation_number, quotation_date, client_name, enquiry_number,
          enquiry_quantity, scope_of_work, gross_amount, gst_percentage,
          gst_amount, net_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							id,
							quotationNumber,
							quotation_date || null,
							client_name || null,
							enquiry_number ?? null,
							enquiry_quantity ?? null,
							scope_of_work ?? null,
							gross_amount || 0,
							gst_percentage || 18,
							gst_amount || 0,
							net_amount || 0,
						]
					);
				}

				await connection.commit();
				break;
			} catch (error) {
				await connection.rollback();
				if (
					!providedQuotationNumber &&
					isRetryableNumberError(error) &&
					attempt < 5
				) {
					await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
					continue;
				}
				throw error;
			}
		}

		// Fetch updated quotation
		const [rows] = await connection.execute(
			'SELECT * FROM project_quotations WHERE project_id = ? AND (isDelete = 0 OR isDelete IS NULL)',
			[id]
		);

		return NextResponse.json({
			success: true,
			data: rows[0],
			message: existed ? 'Quotation updated' : 'Quotation created',
		});
	} catch (error) {
		console.error('Error saving project quotation:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
