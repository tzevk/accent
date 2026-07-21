import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

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
				JSON.stringify(body.scope_items || []),
				JSON.stringify(body.scope_items || []),
				body.scope_items?.[0]?.description || null,
				parseFloatOrZero(body.gross_amount),
				parseFloatOrZero(body.gst_percentage),
				parseFloatOrZero(body.gst_amount),
				parseFloatOrZero(body.net_amount),
				parseFloatOrZero(body.net_amount),
				body.amount_in_words || null,
				body.gst_number || null,
				body.pan_number || null,
				body.tan_number || null,
				body.terms_and_conditions || null,
				body.annexure_scope_of_work || null,
				body.annexure_input_document || null,
				body.annexure_deliverables || null,
				body.annexure_software || null,
				body.annexure_duration || null,
				body.annexure_site_visit || null,
				body.annexure_quotation_validity || null,
				body.annexure_mode_of_delivery || null,
				body.annexure_revision || null,
				body.annexure_exclusions || null,
				body.annexure_billing_payment_terms || null,
				body.annexure_taxation || null,
				body.annexure_payment_milestone || null,
				body.annexure_confidentiality || null,
				body.annexure_codes_standards || null,
				body.annexure_dispute_resolution || null,
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
		return NextResponse.json(
			{ success: false, error: error.message || 'Failed to update quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
