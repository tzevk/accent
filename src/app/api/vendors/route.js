import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.VENDORS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;
	let db;
	try {
		db = await dbConnect();

		// Fetch all vendors
		const [vendors] = await db.query(
			'SELECT * FROM vendors WHERE isDelete = 0 ORDER BY created_at DESC'
		);

		return Response.json({
			success: true,
			data: vendors,
		});
	} catch (error) {
		console.error('Error fetching vendors:', error);
		return Response.json(
			{
				success: false,
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch (e) {
				console.error('Error releasing connection:', e);
			}
		}
	}
}

export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.VENDORS,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		db = await dbConnect();
		const data = await request.json();
		const {
			vendor_id,
			vendor_name,
			vendor_type,
			industry_category,
			status,
			contact_person,
			contact_designation,
			phone,
			email,
			address_street,
			address_city,
			address_state,
			address_country,
			address_pin,
			website,
			gst_vat_tax_id,
			pan_legal_reg_no,
			msme_ssi_registration,
			iso_certifications,
			other_compliance_docs,
			bank_name,
			bank_account_no,
			ifsc_swift_code,
			currency_preference,
			payment_terms,
			credit_limit,
			previous_projects,
			avg_quality_rating,
			avg_delivery_rating,
			avg_reliability_rating,
			blacklist_notes,
			remarks,
			contract_attachments,
			certificate_attachments,
			profile_attachments,
		} = data;

		// Validate required fields
		if (!vendor_name) {
			return Response.json(
				{
					success: false,
					error: 'Vendor name is required',
				},
				{ status: 400 }
			);
		}

		// Auto-generate vendor_id if not provided
		let finalVendorId = vendor_id;
		if (!finalVendorId || finalVendorId.trim() === '') {
			const now = new Date();
			const month = String(now.getMonth() + 1).padStart(2, '0');
			const year = now.getFullYear();

			// Get the highest vendor_id for this month/year
			const monthYearPattern = `%-${month}-${year}`;
			const [existingVendors] = await db.query(
				'SELECT vendor_id FROM vendors WHERE vendor_id LIKE ? AND isDelete = 0 ORDER BY vendor_id DESC LIMIT 1',
				[monthYearPattern]
			);

			let serialNumber = 1;
			if (existingVendors.length > 0 && existingVendors[0].vendor_id) {
				const parts = existingVendors[0].vendor_id.split('-');
				if (parts.length === 3) {
					serialNumber = parseInt(parts[0]) + 1;
				}
			}

			finalVendorId = `${String(serialNumber).padStart(3, '0')}-${month}-${year}`;
		}

		const insertQuery = `
      INSERT INTO vendors (
        vendor_id, vendor_name, vendor_type, industry_category, status,
        contact_person, contact_designation, phone, email,
        address_street, address_city, address_state, address_country, address_pin, website,
        gst_vat_tax_id, pan_legal_reg_no, msme_ssi_registration, iso_certifications, other_compliance_docs,
        bank_name, bank_account_no, ifsc_swift_code, currency_preference, payment_terms, credit_limit,
        previous_projects, avg_quality_rating, avg_delivery_rating, avg_reliability_rating, 
        blacklist_notes, remarks,
        contract_attachments, certificate_attachments, profile_attachments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

		const [result] = await db.execute(insertQuery, [
			finalVendorId,
			vendor_name,
			vendor_type,
			industry_category,
			status || 'Active',
			contact_person,
			contact_designation,
			phone,
			email,
			address_street,
			address_city,
			address_state,
			address_country,
			address_pin,
			website,
			gst_vat_tax_id,
			pan_legal_reg_no,
			msme_ssi_registration,
			iso_certifications,
			other_compliance_docs,
			bank_name,
			bank_account_no,
			ifsc_swift_code,
			currency_preference || 'INR',
			payment_terms,
			credit_limit && credit_limit !== '' ? credit_limit : null,
			previous_projects,
			avg_quality_rating && avg_quality_rating !== ''
				? avg_quality_rating
				: null,
			avg_delivery_rating && avg_delivery_rating !== ''
				? avg_delivery_rating
				: null,
			avg_reliability_rating && avg_reliability_rating !== ''
				? avg_reliability_rating
				: null,
			blacklist_notes,
			remarks,
			contract_attachments,
			certificate_attachments,
			profile_attachments,
		]);

		return Response.json({
			success: true,
			data: { id: result.insertId, vendor_id: finalVendorId },
			message: 'Vendor created successfully',
		});
	} catch (error) {
		console.error('Error creating vendor:', error);
		return Response.json(
			{
				success: false,
				error: error.message,
				details: error.toString(),
			},
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch (e) {
				console.error('Error releasing connection:', e);
			}
		}
	}
}
