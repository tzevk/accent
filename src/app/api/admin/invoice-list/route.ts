import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * GET /api/admin/invoice-list
 * Returns a lightweight list of invoices for searchable-select dropdowns.
 */
export async function GET(request: Request) {
	let db;
	try {
		// RBAC check
		const auth = await ensurePermission(
			request,
			RESOURCES.INVOICES,
			PERMISSIONS.READ
		);
		if (auth instanceof Response) return auth;

		const { searchParams } = new URL(request.url);
		const search = (searchParams.get('search') || '').trim().toLowerCase();

		db = await dbConnect();

		let sql =
			'SELECT id, invoice_number, client_name, invoice_date, gross_amount, net_amount, tax_amount FROM invoices WHERE isDelete = 0';
		const params: string[] = [];

		if (search) {
			sql += ' AND (LOWER(invoice_number) LIKE ? OR LOWER(client_name) LIKE ?)';
			const like = `%${search}%`;
			params.push(like, like);
		}

		sql += ' ORDER BY created_at DESC LIMIT 200';

		const [rows] = await db.execute(sql, params);

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching invoice list:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch invoice list' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
