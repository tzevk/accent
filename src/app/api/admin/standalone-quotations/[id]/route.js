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
      project_id INT NULL,
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
		'project_id INT NULL',
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
		'annexure_taxation TEXT',
		'annexure_payment_milestone TEXT',
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

	try {
		await connection.execute(
			`ALTER TABLE quotations ADD INDEX idx_project_id (project_id)`
		);
	} catch (e) {
		// Index might already exist, ignore
	}
}

// GET - Fetch standalone quotation
export async function GET(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let connection;
	try {
		const { id } = await params;
		connection = await dbConnect();
		await ensureTableAndColumns(connection);

		const [rows] = await connection.execute(
			'SELECT * FROM quotations WHERE id = ?',
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
	if (authResult.authorized === false) return authResult.response;

	let connection;
	try {
		const { id } = await params;
		const body = await request.json();

		connection = await dbConnect();
		await ensureTableAndColumns(connection);

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
      WHERE id = ?`,
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
