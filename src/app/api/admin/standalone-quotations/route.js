import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	sanitizeJsonStrings,
	sanitizeOptionalRichText,
} from '@/lib/sanitize-fields';
import { isRetryableNumberError } from '@/utils/db-number-retry';

const parseFloatOrZero = (val) => {
	const parsed = parseFloat(val);
	return isNaN(parsed) ? 0 : parsed;
};

const formatDateOrNull = (dateVal) => {
	if (!dateVal || String(dateVal).trim() === '') return null;
	try {
		const d = new Date(dateVal);
		if (isNaN(d.getTime())) return null;
		return d.toISOString().split('T')[0];
	} catch (e) {
		return null;
	}
};

// Quotation numbers are ATSPL/Q/<MM>/<YY-YY>/<NNN>. The read runs inside the
// caller's transaction with a row lock (FOR UPDATE) on the newest row of the
// month/FY so concurrent POSTs serialize behind it; the unique active
// quotation-number index is the backstop and a collision retries.
async function nextQuotationNumber(db) {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');

	// Financial year (April start)
	const currentYear = now.getFullYear();
	const currentMonthNumber = now.getMonth() + 1;
	const fyStart = currentMonthNumber >= 4 ? currentYear : currentYear - 1;
	const fyString = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
	const pattern = `ATSPL/Q/${month}/${fyString}/%`;

	const [rows] = await db.execute(
		`SELECT quotation_number FROM quotations
		 WHERE quotation_number LIKE ?
		 AND (isDelete = 0 OR isDelete IS NULL)
		 ORDER BY id DESC LIMIT 1
		 FOR UPDATE`,
		[pattern]
	);

	let sequence = 1;
	if (rows.length > 0 && rows[0].quotation_number) {
		const match = rows[0].quotation_number.match(
			new RegExp(`ATSPL/Q/${month}/${fyString}/(\\d+)`)
		);
		if (match) sequence = parseInt(match[1], 10) + 1;
	}

	return `ATSPL/Q/${month}/${fyString}/${String(sequence).padStart(3, '0')}`;
}

// POST - Create standalone quotation
export async function POST(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const body = await request.json();
		const { quotation_number: providedQuotationNumber, client_name } = body;

		if (!client_name) {
			return NextResponse.json(
				{
					success: false,
					error: 'Client name is required',
				},
				{ status: 400 }
			);
		}

		// HTML-bound columns are sanitized at the write boundary (ADR-0012):
		// subject/scope_items carry rich text, as do terms_and_conditions and
		// every annexure_* column.
		const sanitizedScopeItems = JSON.stringify(
			sanitizeJsonStrings(body.scope_items || [])
		);
		const sanitizedFirstItemDescription =
			sanitizeOptionalRichText(body.scope_items?.[0]?.description) || null;
		const sanitizedTerms =
			sanitizeOptionalRichText(body.terms_and_conditions) || null;
		const annexure = {
			annexure_scope_of_work:
				sanitizeOptionalRichText(body.annexure_scope_of_work) || null,
			annexure_input_document:
				sanitizeOptionalRichText(body.annexure_input_document) || null,
			annexure_deliverables:
				sanitizeOptionalRichText(body.annexure_deliverables) || null,
			annexure_software:
				sanitizeOptionalRichText(body.annexure_software) || null,
			annexure_duration:
				sanitizeOptionalRichText(body.annexure_duration) || null,
			annexure_site_visit:
				sanitizeOptionalRichText(body.annexure_site_visit) || null,
			annexure_quotation_validity:
				sanitizeOptionalRichText(body.annexure_quotation_validity) || null,
			annexure_mode_of_delivery:
				sanitizeOptionalRichText(body.annexure_mode_of_delivery) || null,
			annexure_revision:
				sanitizeOptionalRichText(body.annexure_revision) || null,
			annexure_exclusions:
				sanitizeOptionalRichText(body.annexure_exclusions) || null,
			annexure_billing_payment_terms:
				sanitizeOptionalRichText(body.annexure_billing_payment_terms) || null,
			annexure_taxation:
				sanitizeOptionalRichText(body.annexure_taxation) || null,
			annexure_payment_milestone:
				sanitizeOptionalRichText(body.annexure_payment_milestone) || null,
			annexure_confidentiality:
				sanitizeOptionalRichText(body.annexure_confidentiality) || null,
			annexure_codes_standards:
				sanitizeOptionalRichText(body.annexure_codes_standards) || null,
			annexure_dispute_resolution:
				sanitizeOptionalRichText(body.annexure_dispute_resolution) || null,
		};

		connection = await dbConnect();

		const qDate = formatDateOrNull(body.quotation_date);
		const validUntil = qDate
			? new Date(new Date(qDate).getTime() + 30 * 24 * 60 * 60 * 1000)
					.toISOString()
					.split('T')[0]
			: null;

		const INSERT_SQL = `INSERT INTO quotations 
       (quotation_number, quotation_date, client_name, client_email, client_phone, client_address, kind_attn, enquiry_number, enquiry_date, subject, items, scope_items, gross_amount, gst_percentage, gst_amount, net_amount, subtotal, tax_rate, tax_amount, total, amount_in_words, gst_number, pan_number, tan_number, terms_and_conditions, annexure_scope_of_work, annexure_input_document, annexure_deliverables, annexure_software, annexure_duration, annexure_site_visit, annexure_quotation_validity, annexure_mode_of_delivery, annexure_revision, annexure_exclusions, annexure_billing_payment_terms, annexure_taxation, annexure_payment_milestone, annexure_confidentiality, annexure_codes_standards, annexure_dispute_resolution, valid_until, status, project_id, gst_type, created_by, isDelete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;

		// Number generation and the INSERT are one transaction so concurrent
		// POSTs cannot mint the same quotation number. A client-supplied number
		// keeps the historical upsert (idempotent save); a generated number uses
		// a plain INSERT so a lost race surfaces as ER_DUP_ENTRY and retries.
		let quotationNumber = providedQuotationNumber || null;
		let insertedId = null;
		for (let attempt = 1; ; attempt++) {
			await connection.beginTransaction();
			try {
				// Reset per attempt so a generated number that collided is
				// regenerated from a fresh read instead of retried as-is.
				quotationNumber = providedQuotationNumber || null;

				if (!quotationNumber) {
					quotationNumber = await nextQuotationNumber(connection);
				}

				const [result] = await connection.execute(
					providedQuotationNumber
						? `${INSERT_SQL}
       ON DUPLICATE KEY UPDATE
         isDelete = 0,
         quotation_date = VALUES(quotation_date),
         client_name = VALUES(client_name),
         client_email = VALUES(client_email),
         client_phone = VALUES(client_phone),
         client_address = VALUES(client_address),
         kind_attn = VALUES(kind_attn),
         enquiry_number = VALUES(enquiry_number),
         enquiry_date = VALUES(enquiry_date),
         subject = VALUES(subject),
         items = VALUES(items),
         scope_items = VALUES(scope_items),
         gross_amount = VALUES(gross_amount),
         gst_percentage = VALUES(gst_percentage),
         gst_amount = VALUES(gst_amount),
         net_amount = VALUES(net_amount),
         subtotal = VALUES(subtotal),
         tax_rate = VALUES(tax_rate),
         tax_amount = VALUES(tax_amount),
         total = VALUES(total),
         amount_in_words = VALUES(amount_in_words),
         gst_number = VALUES(gst_number),
         pan_number = VALUES(pan_number),
         tan_number = VALUES(tan_number),
         terms_and_conditions = VALUES(terms_and_conditions),
         annexure_scope_of_work = VALUES(annexure_scope_of_work),
         annexure_input_document = VALUES(annexure_input_document),
         annexure_deliverables = VALUES(annexure_deliverables),
         annexure_software = VALUES(annexure_software),
         annexure_duration = VALUES(annexure_duration),
         annexure_site_visit = VALUES(annexure_site_visit),
         annexure_quotation_validity = VALUES(annexure_quotation_validity),
         annexure_mode_of_delivery = VALUES(annexure_mode_of_delivery),
         annexure_revision = VALUES(annexure_revision),
         annexure_exclusions = VALUES(annexure_exclusions),
         annexure_billing_payment_terms = VALUES(annexure_billing_payment_terms),
         annexure_taxation = VALUES(annexure_taxation),
         annexure_payment_milestone = VALUES(annexure_payment_milestone),
         annexure_confidentiality = VALUES(annexure_confidentiality),
         annexure_codes_standards = VALUES(annexure_codes_standards),
         annexure_dispute_resolution = VALUES(annexure_dispute_resolution),
         valid_until = VALUES(valid_until),
         status = VALUES(status),
         project_id = VALUES(project_id),
         gst_type = VALUES(gst_type),
         created_by = VALUES(created_by),
         updated_at = NOW()`
						: INSERT_SQL,
					[
						quotationNumber,
						qDate,
						client_name,
						body.client_email || null,
						body.client_phone || null,
						body.client_address || null,
						body.kind_attn || null,
						body.enquiry_number || null,
						formatDateOrNull(body.enquiry_date),
						sanitizedFirstItemDescription,
						sanitizedScopeItems,
						sanitizedScopeItems,
						parseFloatOrZero(body.gross_amount),
						parseFloatOrZero(body.gst_percentage),
						parseFloatOrZero(body.gst_amount),
						parseFloatOrZero(body.net_amount),
						parseFloatOrZero(body.gross_amount),
						parseFloatOrZero(body.gst_percentage),
						parseFloatOrZero(body.gst_amount),
						parseFloatOrZero(body.net_amount),
						body.amount_in_words || null,
						body.gst_number || null,
						body.pan_number || null,
						body.tan_number || null,
						sanitizedTerms,
						annexure.annexure_scope_of_work,
						annexure.annexure_input_document,
						annexure.annexure_deliverables,
						annexure.annexure_software,
						annexure.annexure_duration,
						annexure.annexure_site_visit,
						annexure.annexure_quotation_validity,
						annexure.annexure_mode_of_delivery,
						annexure.annexure_revision,
						annexure.annexure_exclusions,
						annexure.annexure_billing_payment_terms,
						annexure.annexure_taxation,
						annexure.annexure_payment_milestone,
						annexure.annexure_confidentiality,
						annexure.annexure_codes_standards,
						annexure.annexure_dispute_resolution,
						validUntil,
						body.status || 'draft',
						body.project_id || null,
						body.gst_type || 'cgst_sgst',
						authResult.user?.id || null,
					]
				);

				insertedId = result.insertId || null;
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

		// On the upsert path, insertId is 0; fetch the actual id
		if (!insertedId) {
			const [rows] = await connection.execute(
				'SELECT id FROM quotations WHERE quotation_number = ?',
				[quotationNumber]
			);
			insertedId = rows[0]?.id;
		}

		return NextResponse.json({
			success: true,
			message: 'Quotation created successfully',
			id: insertedId,
		});
	} catch (error) {
		console.error('Error creating standalone quotation:', error);
		if (error.code === 'ER_DUP_ENTRY') {
			return NextResponse.json(
				{
					success: false,
					error: 'A quotation with this number already exists',
				},
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ success: false, error: error.message || 'Failed to create quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
