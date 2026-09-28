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

/** mysql2 duplicate-key error (unique index violation). */
function isDuplicateKeyError(error) {
	return error?.errno === 1062 || error?.code === 'ER_DUP_ENTRY';
}

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

// GET - Fetch standalone quotation
export async function GET(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { id } = await params;
		connection = await dbConnect();

		const [rows] = await connection.execute(
			'SELECT * FROM quotations WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)',
			[id]
		);

		if (rows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Quotation not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({ success: true, data: rows[0] });
	} catch (error) {
		console.error('Error fetching standalone quotation:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// PUT - Update standalone quotation
export async function PUT(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { id } = await params;
		const body = await request.json();

		connection = await dbConnect();

		const qDate = formatDateOrNull(body.quotation_date);
		const validUntil = qDate
			? new Date(new Date(qDate).getTime() + 30 * 24 * 60 * 60 * 1000)
					.toISOString()
					.split('T')[0]
			: null;

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

		const [result] = await connection.execute(
			`UPDATE quotations SET
        quotation_number = ?,
        quotation_date = ?,
        client_name = ?,
        client_address = ?,
        kind_attn = ?,
        enquiry_number = ?,
        enquiry_date = ?,
        items = ?,
        scope_items = ?,
        subject = ?,
        gross_amount = ?,
        gst_percentage = ?,
        gst_amount = ?,
        net_amount = ?,
        total = ?,
        amount_in_words = ?,
        gst_number = ?,
        pan_number = ?,
        tan_number = ?,
        terms_and_conditions = ?,
        annexure_scope_of_work = ?,
        annexure_input_document = ?,
        annexure_deliverables = ?,
        annexure_software = ?,
        annexure_duration = ?,
        annexure_site_visit = ?,
        annexure_quotation_validity = ?,
        annexure_mode_of_delivery = ?,
        annexure_revision = ?,
        annexure_exclusions = ?,
        annexure_billing_payment_terms = ?,
        annexure_taxation = ?,
        annexure_payment_milestone = ?,
        annexure_confidentiality = ?,
        annexure_codes_standards = ?,
        annexure_dispute_resolution = ?,
        valid_until = ?,
        project_id = ?,
        updated_at = NOW()
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			[
				body.quotation_number,
				qDate,
				body.client_name || null,
				body.client_address || null,
				body.kind_attn || null,
				body.enquiry_number || null,
				formatDateOrNull(body.enquiry_date),
				sanitizedScopeItems,
				sanitizedScopeItems,
				sanitizedFirstItemDescription,
				parseFloatOrZero(body.gross_amount),
				parseFloatOrZero(body.gst_percentage),
				parseFloatOrZero(body.gst_amount),
				parseFloatOrZero(body.net_amount),
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
				body.project_id || null,
				id,
			]
		);

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Quotation not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Quotation updated successfully',
		});
	} catch (error) {
		console.error('Error updating standalone quotation:', error);
		// Active-number unique index (migration
		// 20260928120000_add_unique_active_document_numbers): a collision on an
		// edited number is a constraint error, not a silent duplicate.
		if (isDuplicateKeyError(error)) {
			return NextResponse.json(
				{
					success: false,
					error: 'A quotation with this number already exists',
				},
				{ status: 409 }
			);
		}
		return NextResponse.json(
			{ success: false, error: error.message || 'Failed to update quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
