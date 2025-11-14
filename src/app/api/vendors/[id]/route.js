import { dbConnect } from '@/utils/database';

export async function GET(request, { params }) {
  let db;
  try {
    const { id } = await params;
    db = await dbConnect();
    const [vendors] = await db.query('SELECT * FROM vendors WHERE id = ?', [id]);

    if (vendors.length === 0) {
      return Response.json({
        success: false,
        error: 'Vendor not found'
      }, { status: 404 });
    }

    return Response.json({
      success: true,
      data: vendors[0]
    });

  } catch (error) {
    console.error('Error fetching vendor:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch (e) { console.error('Error releasing connection:', e); }
    }
  }
}

export async function PUT(request, { params }) {
  let db;
  try {
    const { id } = await params;
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
      profile_attachments
    } = data;

    // Validate required fields
    if (!vendor_name) {
      return Response.json({
        success: false,
        error: 'Vendor name is required'
      }, { status: 400 });
    }

    const updateQuery = `
      UPDATE vendors SET
        vendor_id = ?,
        vendor_name = ?,
        vendor_type = ?,
        industry_category = ?,
        status = ?,
        contact_person = ?,
        contact_designation = ?,
        phone = ?,
        email = ?,
        address_street = ?,
        address_city = ?,
        address_state = ?,
        address_country = ?,
        address_pin = ?,
        website = ?,
        gst_vat_tax_id = ?,
        pan_legal_reg_no = ?,
        msme_ssi_registration = ?,
        iso_certifications = ?,
        other_compliance_docs = ?,
        bank_name = ?,
        bank_account_no = ?,
        ifsc_swift_code = ?,
        currency_preference = ?,
        payment_terms = ?,
        credit_limit = ?,
        previous_projects = ?,
        avg_quality_rating = ?,
        avg_delivery_rating = ?,
        avg_reliability_rating = ?,
        blacklist_notes = ?,
        remarks = ?,
        contract_attachments = ?,
        certificate_attachments = ?,
        profile_attachments = ?
      WHERE id = ?
    `;

    await db.execute(updateQuery, [
      vendor_id, vendor_name, vendor_type, industry_category, status,
      contact_person, contact_designation, phone, email,
      address_street, address_city, address_state, address_country, address_pin, website,
      gst_vat_tax_id, pan_legal_reg_no, msme_ssi_registration, iso_certifications, other_compliance_docs,
      bank_name, bank_account_no, ifsc_swift_code, currency_preference, payment_terms, credit_limit,
      previous_projects, avg_quality_rating, avg_delivery_rating, avg_reliability_rating,
      blacklist_notes, remarks,
      contract_attachments, certificate_attachments, profile_attachments,
      id
    ]);

    return Response.json({
      success: true,
      message: 'Vendor updated successfully'
    });

  } catch (error) {
    console.error('Error updating vendor:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch (e) { console.error('Error releasing connection:', e); }
    }
  }
}

export async function DELETE(request, { params }) {
  let db;
  try {
    const { id } = await params;
    db = await dbConnect();

    await db.execute('DELETE FROM vendors WHERE id = ?', [id]);

    return Response.json({
      success: true,
      message: 'Vendor deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting vendor:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch (e) { console.error('Error releasing connection:', e); }
    }
  }
}
