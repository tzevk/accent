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

// Helper to ensure database table and all columns exist
async function ensureTableAndColumns(connection) {
	// Create table if not exists
	await connection.execute(`
    CREATE TABLE IF NOT EXISTS quotations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quotation_number VARCHAR(50) UNIQUE NOT NULL,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      client_address TEXT,
      subject VARCHAR(500),
      items JSON,
      subtotal DECIMAL(15, 2) DEFAULT 0,
      tax_rate DECIMAL(5, 2) DEFAULT 18,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      discount DECIMAL(15, 2) DEFAULT 0,
      total DECIMAL(15, 2) DEFAULT 0,
      notes TEXT,
      terms TEXT,
      valid_until DATE,
      status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_created_at (created_at)
    )
  `);

	// Alter fields that might not exist in old migrations
	const columnsToAdd = [
		'client_email VARCHAR(255)',
		'client_phone VARCHAR(50)',
		'client_address TEXT',
		'kind_attn VARCHAR(255)',
		'enquiry_number VARCHAR(100)',
		'enquiry_date DATE',
		'quotation_date DATE',
		'subject VARCHAR(500)',
		'items JSON',
		'scope_items JSON',
		'subtotal DECIMAL(15, 2) DEFAULT 0',
		'tax_rate DECIMAL(5, 2) DEFAULT 18',
		'tax_amount DECIMAL(15, 2) DEFAULT 0',
		'discount DECIMAL(15, 2) DEFAULT 0',
		'total DECIMAL(15, 2) DEFAULT 0',
		'notes TEXT',
		'terms TEXT',
		'amount_in_words TEXT',
		'gst_number VARCHAR(50)',
		'pan_number VARCHAR(50)',
		'tan_number VARCHAR(50)',
		'terms_and_conditions TEXT',
		'gross_amount DECIMAL(15, 2) DEFAULT 0',
		'gst_percentage DECIMAL(5, 2) DEFAULT 18',
		'gst_amount DECIMAL(15, 2) DEFAULT 0',
		'net_amount DECIMAL(15, 2) DEFAULT 0',
		'created_by INT',
		// Annexure columns
		'annexure_scope_of_work TEXT',
		'annexure_input_document TEXT',
		'annexure_deliverables TEXT',
		'annexure_software VARCHAR(255)',
		'annexure_duration VARCHAR(255)',
		'annexure_site_visit VARCHAR(255)',
		'annexure_quotation_validity VARCHAR(255)',
		'annexure_mode_of_delivery VARCHAR(255)',
		'annexure_revision VARCHAR(255)',
		'annexure_exclusions TEXT',
		'annexure_billing_payment_terms TEXT',
		'annexure_confidentiality TEXT',
		'annexure_codes_standards TEXT',
		'annexure_dispute_resolution TEXT',
	];

	for (const col of columnsToAdd) {
		try {
			await connection.execute(`ALTER TABLE quotations ADD COLUMN ${col}`);
		} catch (e) {
			// Column already exists
		}
	}

	// Ensure proposal_id and project_id allow NULL values
	try {
		await connection.execute(
			`ALTER TABLE quotations MODIFY COLUMN proposal_id INT NULL`
		);
	} catch (e) {
		// Column might not exist or modify failed, ignore
	}

	try {
		await connection.execute(
			`ALTER TABLE quotations MODIFY COLUMN project_id INT NULL`
		);
	} catch (e) {
		// Column might not exist or modify failed, ignore
	}
}

// POST - Create standalone quotation
export async function POST(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.CREATE
	);
	if (authResult.authorized === false) return authResult.response;

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
		await ensureTableAndColumns(connection);

		const qDate = formatDateOrNull(body.quotation_date);
		const validUntil = qDate
			? new Date(new Date(qDate).getTime() + 30 * 24 * 60 * 60 * 1000)
					.toISOString()
					.split('T')[0]
			: null;

		const [result] = await connection.execute(
			`INSERT INTO quotations 
       (quotation_number, quotation_date, client_name, client_email, client_phone, client_address, kind_attn, enquiry_number, enquiry_date, subject, items, scope_items, gross_amount, gst_percentage, gst_amount, net_amount, subtotal, tax_rate, tax_amount, total, amount_in_words, gst_number, pan_number, tan_number, terms_and_conditions, annexure_scope_of_work, annexure_input_document, annexure_deliverables, annexure_software, annexure_duration, annexure_site_visit, annexure_quotation_validity, annexure_mode_of_delivery, annexure_revision, annexure_exclusions, annexure_billing_payment_terms, annexure_confidentiality, annexure_codes_standards, annexure_dispute_resolution, valid_until, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				body.annexure_confidentiality || null,
				body.annexure_codes_standards || null,
				body.annexure_dispute_resolution || null,
				validUntil,
				body.status || 'draft',
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
