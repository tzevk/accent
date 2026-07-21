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
		const { quotation_number, client_name } = body;

		if (!quotation_number || !client_name) {
			return NextResponse.json(
				{
					success: false,
					error: 'Quotation number and client name are required',
				},
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const qDate = formatDateOrNull(body.quotation_date);
		const validUntil = qDate
			? new Date(new Date(qDate).getTime() + 30 * 24 * 60 * 60 * 1000)
					.toISOString()
					.split('T')[0]
			: null;

		const [result] = await connection.execute(
			`INSERT INTO quotations 
       (quotation_number, quotation_date, client_name, client_email, client_phone, client_address, kind_attn, enquiry_number, enquiry_date, subject, items, scope_items, gross_amount, gst_percentage, gst_amount, net_amount, subtotal, tax_rate, tax_amount, total, amount_in_words, gst_number, pan_number, tan_number, terms_and_conditions, annexure_scope_of_work, annexure_input_document, annexure_deliverables, annexure_software, annexure_duration, annexure_site_visit, annexure_quotation_validity, annexure_mode_of_delivery, annexure_revision, annexure_exclusions, annexure_billing_payment_terms, annexure_taxation, annexure_payment_milestone, annexure_confidentiality, annexure_codes_standards, annexure_dispute_resolution, valid_until, status, project_id, gst_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				quotation_number,
				qDate,
				client_name,
				body.client_email || null,
				body.client_phone || null,
				body.client_address || null,
				body.kind_attn || null,
				body.enquiry_number || null,
				formatDateOrNull(body.enquiry_date),
				body.scope_items?.[0]?.description || null,
				JSON.stringify(body.scope_items || []),
				JSON.stringify(body.scope_items || []),
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
				body.status || 'draft',
				body.project_id || null,
				body.gst_type || 'cgst_sgst',
				authResult.user?.id || null,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Quotation created successfully',
			id: result.insertId,
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
