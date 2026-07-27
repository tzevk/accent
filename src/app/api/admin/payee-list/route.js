import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/payee-list
 * Returns a unified list of companies and vendors for searchable-select dropdowns.
 */
export async function GET(request) {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const search = (searchParams.get('search') || '').trim().toLowerCase();

		db = await dbConnect();
		let companySql = `SELECT company_name AS name, CONCAT(company_name, ' [Company]') AS display_name, 'company' AS type, id, city, state FROM companies WHERE isDelete = 0`;
		const companyParams = [];
		if (search) {
			companySql += ` AND LOWER(company_name) LIKE ?`;
			companyParams.push(`%${search}%`);
		}
		companySql += ` ORDER BY company_name ASC LIMIT 200`;
		const [companies] = await db.execute(companySql, companyParams);
		let vendorSql = `SELECT vendor_name AS name, CONCAT(vendor_name, ' [Vendor]') AS display_name, 'vendor' AS type, id, address_city AS city, address_state AS state FROM vendors WHERE isDelete = 0`;
		const vendorParams = [];
		if (search) {
			vendorSql += ` AND LOWER(vendor_name) LIKE ?`;
			vendorParams.push(`%${search}%`);
		}
		vendorSql += ` ORDER BY vendor_name ASC LIMIT 200`;
		const [vendors] = await db.execute(vendorSql, vendorParams);

		// Combine: companies first, then vendors
		const combined = [
			...companies.map((c) => ({ ...c, id: `company-${c.id}` })),
			...vendors.map((v) => ({ ...v, id: `vendor-${v.id}` })),
		];

		return NextResponse.json({ success: true, data: combined });
	} catch (error) {
		console.error('Error fetching payee list:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch payee list' },
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
