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
       (quotation_number, quotation_date, client_name, client_email, client_phone, client_address, kind_attn, enquiry_number, enquiry_date, subject, items, scope_items, gross_amount, gst_percentage, gst_amount, net_amount, subtotal, tax_rate, tax_amount, total, amount_in_words, gst_number, pan_number, tan_number, terms_and_conditions, annexure_scope_of_work, annexure_input_document, annexure_deliverables, annexure_software, annexure_duration, annexure_site_visit, annexure_quotation_validity, annexure_mode_of_delivery, annexure_revision, annexure_exclusions, annexure_billing_payment_terms, annexure_taxation, annexure_payment_milestone, annexure_confidentiality, annexure_codes_standards, annexure_dispute_resolution, valid_until, status, project_id, gst_type, created_by, isDelete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
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
         updated_at = NOW()`,
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

		// On duplicate key, insertId is 0; fetch the actual id
		let insertedId = result.insertId;
		if (!insertedId) {
			const [rows] = await connection.execute(
				'SELECT id FROM quotations WHERE quotation_number = ?',
				[quotation_number]
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
