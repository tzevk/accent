import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// GET - Fetch quotations (from both quotations and project_quotations tables)
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const status = searchParams.get('status');
		const source = searchParams.get('source'); // 'all', 'quotations', 'projects'
		const offset = (page - 1) * limit;

		connection = await dbConnect();

		// Build combined query using UNION to get from both tables
		let allQuotations = [];

		// Query from quotations table
		if (!source || source === 'all' || source === 'quotations') {
			let query1 = `
        SELECT 
          id,
          quotation_number,
          client_name,
          NULL as client_email,
          subject,
          total,
          COALESCE(quotation_date, created_at) as created_at,
          valid_until,
          status,
          'quotations' as source,
          project_id,
          NULL as project_name
        FROM quotations WHERE 1=1 AND (isDelete = 0 OR isDelete IS NULL)
      `;
			const params1 = [];

			if (status && status !== 'all') {
				query1 += ' AND status = ?';
				params1.push(status);
			}

			const [quotations] = await connection.execute(query1, params1);
			allQuotations = [...allQuotations, ...quotations];
		}

		// Query from project_quotations table
		const projectQuotations = [];
		if (!source || source === 'all' || source === 'projects') {
			let query2 = `
        SELECT 
          pq.id,
          pq.quotation_number,
          COALESCE(pq.client_name, pq.enquiry_number) as client_name,
          NULL as client_email,
          pq.scope_of_work as subject,
          pq.net_amount as total,
          COALESCE(pq.quotation_date, pq.created_at) as created_at,
          DATE_ADD(pq.quotation_date, INTERVAL 30 DAY) as valid_until,
          COALESCE(pq.status, 'draft') as status,
          'project' as source,
          pq.project_id,
          NULL as project_name
        FROM project_quotations pq
        WHERE pq.quotation_number IS NOT NULL AND pq.quotation_number != '' AND (pq.isDelete = 0 OR pq.isDelete IS NULL)
      `;
			const params2 = [];

			if (status && status !== 'all') {
				query2 += ' AND pq.status = ?';
				params2.push(status);
			}

			const [pqRows] = await connection.execute(query2, params2);
			projectQuotations.push(...pqRows);
			allQuotations = [...allQuotations, ...projectQuotations];
		}

		// Batch-fetch project names for all quotations that have a project_id (1 query instead of N+M)
		const projectIds = new Set();
		for (const q of allQuotations) {
			if (q.project_id) projectIds.add(q.project_id);
		}

		if (projectIds.size > 0) {
			try {
				const placeholders = Array(projectIds.size).fill('?').join(',');
				const [projects] = await connection.execute(
					`SELECT project_id, name, client_name FROM projects WHERE project_id IN (${placeholders})`,
					[...projectIds]
				);
				const projectMap = new Map();
				for (const p of projects) {
					projectMap.set(p.project_id, p);
				}

				// Apply project data
				for (const q of allQuotations) {
					const p = projectMap.get(q.project_id);
					if (!p) continue;
					q.project_name = p.name;
					// For project-sourced quotations, also fill client_name/subject from project
					if (q.source === 'project') {
						if (!q.client_name || q.client_name === q.subject) {
							q.client_name = p.client_name || q.client_name;
						}
						if (!q.subject) {
							q.subject = p.name;
						}
					}
				}
			} catch (e) {
				// Projects table might not exist or have different structure, ignore
			}
		}

		// Sort by created_at descending
		allQuotations.sort(
			(a, b) => new Date(b.created_at) - new Date(a.created_at)
		);

		// Get total count
		const total = allQuotations.length;

		// Paginate — limit=0 returns all
		const paginatedQuotations =
			limit === 0 ? allQuotations : allQuotations.slice(offset, offset + limit);

		// Calculate stats from combined data
		const stats = {
			total: allQuotations.length,
			draft: allQuotations.filter((q) => q.status === 'draft' || !q.status)
				.length,
			sent: allQuotations.filter((q) => q.status === 'sent').length,
			approved: allQuotations.filter((q) => q.status === 'approved').length,
			rejected: allQuotations.filter((q) => q.status === 'rejected').length,
		};

		return NextResponse.json({
			success: true,
			data: paginatedQuotations,
			stats,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error('Error fetching quotations:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch quotations' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// POST - Create new quotation
export async function POST(request) {
	// RBAC check
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
		const {
			quotation_number,
			client_name,
			client_email,
			client_phone,
			client_address,
			subject,
			items,
			subtotal,
			tax_rate,
			tax_amount,
			discount,
			total,
			notes,
			terms,
			valid_until,
			status,
			project_id,
			gst_type,
		} = body;

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

		const [result] = await connection.execute(
			`INSERT INTO quotations 
       (quotation_number, client_name, client_email, client_phone, client_address, subject, items, subtotal, tax_rate, tax_amount, discount, total, notes, terms, valid_until, status, project_id, gst_type, created_by, isDelete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         isDelete = 0,
         client_name = VALUES(client_name),
         client_email = VALUES(client_email),
         client_phone = VALUES(client_phone),
         client_address = VALUES(client_address),
         subject = VALUES(subject),
         items = VALUES(items),
         subtotal = VALUES(subtotal),
         tax_rate = VALUES(tax_rate),
         tax_amount = VALUES(tax_amount),
         discount = VALUES(discount),
         total = VALUES(total),
         notes = VALUES(notes),
         terms = VALUES(terms),
         valid_until = VALUES(valid_until),
         status = VALUES(status),
         project_id = VALUES(project_id),
         gst_type = VALUES(gst_type),
         created_by = VALUES(created_by),
         updated_at = NOW()`,
			[
				quotation_number,
				client_name,
				client_email || null,
				client_phone || null,
				client_address || null,
				subject || null,
				JSON.stringify(items || []),
				subtotal || 0,
				tax_rate || 18,
				tax_amount || 0,
				discount || 0,
				total || 0,
				notes || null,
				terms || null,
				valid_until || null,
				status || 'draft',
				project_id || null,
				gst_type || 'cgst_sgst',
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
		console.error('Error creating quotation:', error);
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
			{ success: false, error: 'Failed to create quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// PUT - Update quotation
export async function PUT(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const body = await request.json();
		const {
			id,
			quotation_number,
			client_name,
			client_email,
			client_phone,
			client_address,
			subject,
			items,
			subtotal,
			tax_rate,
			tax_amount,
			discount,
			total,
			notes,
			terms,
			valid_until,
			status,
			project_id,
			gst_type,
		} = body;

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Quotation ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const [result] = await connection.execute(
			`UPDATE quotations SET
       quotation_number = ?,
       client_name = ?,
       client_email = ?,
       client_phone = ?,
       client_address = ?,
       subject = ?,
       items = ?,
       subtotal = ?,
       tax_rate = ?,
       tax_amount = ?,
       discount = ?,
       total = ?,
       notes = ?,
       terms = ?,
       valid_until = ?,
       status = ?,
       project_id = ?,
       gst_type = ?
        WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			[
				quotation_number,
				client_name,
				client_email || null,
				client_phone || null,
				client_address || null,
				subject || null,
				JSON.stringify(items || []),
				subtotal || 0,
				tax_rate || 18,
				tax_amount || 0,
				discount || 0,
				total || 0,
				notes || null,
				terms || null,
				valid_until || null,
				status || 'draft',
				project_id || null,
				gst_type || 'cgst_sgst',
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
		console.error('Error updating quotation:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}

// DELETE - Delete quotation
export async function DELETE(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');
		const source = searchParams.get('source') || 'quotations';

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Quotation ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		let result;
		if (source === 'project') {
			[result] = await connection.execute(
				'UPDATE project_quotations SET isDelete = 1 WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)',
				[id]
			);
		} else if (source === 'proposal') {
			[result] = await connection.execute(
				`UPDATE proposals SET 
					quotation_number = NULL, 
					quotation_date = NULL, 
					client_name = NULL, 
					client_address = NULL, 
					kind_attn = NULL, 
					enquiry_number = NULL, 
					enquiry_date = NULL, 
					scope_items = NULL, 
					gross_amount = 0, 
					gst_amount = 0, 
					net_amount = 0,
					terms_and_conditions = NULL
				WHERE id = ?`,
				[id]
			);
		} else {
			[result] = await connection.execute(
				'UPDATE quotations SET isDelete = 1 WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)',
				[id]
			);
		}

		if (result.affectedRows === 0) {
			return NextResponse.json(
				{ success: false, error: 'Quotation not found' },
				{ status: 404 }
			);
		}

		return NextResponse.json({
			success: true,
			message: 'Quotation deleted successfully',
		});
	} catch (error) {
		console.error('Error deleting quotation:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete quotation' },
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
