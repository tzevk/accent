import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';

const TABLE = 'outgoing_quotations';

const DDL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    quotation_number VARCHAR(50) NOT NULL,
    quotation_date DATE,
    vendor_name VARCHAR(255) NOT NULL,
    vendor_email VARCHAR(255),
    vendor_phone VARCHAR(50),
    vendor_address TEXT,
    subject VARCHAR(500),
    items JSON,
    subtotal DECIMAL(15, 2) DEFAULT 0,
    tax_rate DECIMAL(5, 2) DEFAULT 18,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    discount DECIMAL(15, 2) DEFAULT 0,
    total DECIMAL(15, 2) DEFAULT 0,
    valid_until DATE,
    notes TEXT,
    terms TEXT,
    status ENUM('draft', 'sent', 'approved', 'rejected', 'expired') DEFAULT 'draft',
    project_id INT NULL,
    created_by INT,
    isDelete TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_vendor (vendor_name),
    INDEX idx_isDelete (isDelete)
  )
`;

async function ensureTable(db) {
	await db.execute(DDL);

	const alterStatements = [
		'ALTER TABLE outgoing_quotations ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
		'ALTER TABLE outgoing_quotations ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn(
					'Outgoing quotations schema update warning:',
					e.message || e
				);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE outgoing_quotations DROP INDEX quotation_number',
		'ALTER TABLE outgoing_quotations ADD UNIQUE KEY unique_active_quotation (quotation_number, isDelete)',
	];

	for (const stmt of indexMigrations) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (
				!e.message?.includes('check that it exists') &&
				!e.message?.includes('Duplicate key name')
			) {
				console.warn(
					'Outgoing quotations index migration warning:',
					e.message || e
				);
			}
		}
	}
}

async function nextNumber(db) {
	const [rows] = await db.execute(
		`SELECT quotation_number FROM ${TABLE} WHERE quotation_number LIKE 'OQ-%' AND isDelete = 0 ORDER BY id DESC LIMIT 1`
	);
	let next = 1;
	if (rows.length > 0) {
		const last = rows[0].quotation_number;
		const match = /OQ-(\d+)/.exec(last || '');
		if (match) next = parseInt(match[1], 10) + 1;
	}
	return `OQ-${String(next).padStart(5, '0')}`;
}

export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
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
		await ensureTable(db);

		const where = ['isDelete = 0'];
		const params = [];
		if (status && status !== 'all') {
			where.push('status = ?');
			params.push(status);
		}
		if (search) {
			where.push(
				'(quotation_number LIKE ? OR vendor_name LIKE ? OR subject LIKE ?)'
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
				SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
				SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
				SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
				COALESCE(SUM(total), 0) as totalValue
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
		console.error('Error fetching outgoing quotations:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function POST(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
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
		await ensureTable(db);

		const quotationNumber = body.quotation_number || (await nextNumber(db));

		const [result] = await db.execute(
			`INSERT INTO ${TABLE}
				(quotation_number, quotation_date, vendor_name, vendor_email, vendor_phone, vendor_address,
				 subject, items, subtotal, tax_rate, tax_amount, discount, total, valid_until, notes, terms,
				 status, project_id, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				quotationNumber,
				body.quotation_date || null,
				body.vendor_name,
				body.vendor_email || null,
				body.vendor_phone || null,
				body.vendor_address || null,
				body.subject || null,
				body.items ? JSON.stringify(body.items) : null,
				body.subtotal ?? 0,
				body.tax_rate ?? 18,
				body.tax_amount ?? 0,
				body.discount ?? 0,
				body.total ?? 0,
				body.valid_until || null,
				body.notes || null,
				body.terms || null,
				body.status || 'draft',
				body.project_id || null,
				user?.id || null,
			]
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'outgoing_quotation',
			resourceId: result.insertId,
			description: `Created outgoing quotation ${quotationNumber} for ${body.vendor_name}`,
			request,
		});

		return NextResponse.json({
			success: true,
			data: { id: result.insertId, quotation_number: quotationNumber },
		});
	} catch (error) {
		console.error('Error creating outgoing quotation:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}
