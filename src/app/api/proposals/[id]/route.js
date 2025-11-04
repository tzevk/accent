import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();
    
    const [rows] = await pool.execute(
      'SELECT * FROM proposals WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      proposal: rows[0]
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch proposal' },
      { status: 500 }
    );
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();
    
    const {
      title, client, contact_name, contact_email, phone, project_description,
      value, status, due_date, notes, lead_id,
      // Quotation fields
      client_name, client_address, attention_person, attention_designation,
      quotation_no, date_of_quotation, enquiry_no, date_of_enquiry,
      scope_items, amount_in_words, total_amount, gst_number, pan_number,
      tan_number, terms_and_conditions, payment_mode, receiver_signature,
      company_signature, signatory_name, signatory_designation,
      // Annexure fields
      annexure_scope_of_work, annexure_input_documents, annexure_deliverables,
      annexure_software, annexure_duration, annexure_site_visit,
      annexure_quotation_validity, annexure_mode_of_delivery, annexure_revision,
      annexure_exclusions, annexure_billing_payment_terms, annexure_confidentiality,
      annexure_codes_and_standards, annexure_dispute_resolution
    } = body;

    const [result] = await pool.execute(
      `UPDATE proposals SET 
        title = ?, client = ?, contact_name = ?, contact_email = ?, 
        phone = ?, project_description = ?, value = ?, status = ?, 
        due_date = ?, notes = ?, lead_id = ?,
        client_name = ?, client_address = ?, attention_person = ?, attention_designation = ?,
        quotation_no = ?, date_of_quotation = ?, enquiry_no = ?, date_of_enquiry = ?,
        scope_items = ?, amount_in_words = ?, total_amount = ?, gst_number = ?, pan_number = ?,
        tan_number = ?, terms_and_conditions = ?, payment_mode = ?, receiver_signature = ?,
        company_signature = ?, signatory_name = ?, signatory_designation = ?,
        annexure_scope_of_work = ?, annexure_input_documents = ?, annexure_deliverables = ?,
        annexure_software = ?, annexure_duration = ?, annexure_site_visit = ?,
        annexure_quotation_validity = ?, annexure_mode_of_delivery = ?, annexure_revision = ?,
        annexure_exclusions = ?, annexure_billing_payment_terms = ?, annexure_confidentiality = ?,
        annexure_codes_and_standards = ?, annexure_dispute_resolution = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        title || null, client || null, contact_name || null, contact_email || null, phone || null, 
        project_description || null, value || null, status || null, due_date || null, notes || null, lead_id || null,
        client_name || null, client_address || null, attention_person || null, attention_designation || null,
        quotation_no || null, date_of_quotation || null, enquiry_no || null, date_of_enquiry || null,
        scope_items ? JSON.stringify(scope_items) : null, amount_in_words || null, total_amount || null, gst_number || null, pan_number || null,
        tan_number || null, terms_and_conditions || null, payment_mode || null, receiver_signature || null,
        company_signature || null, signatory_name || null, signatory_designation || null,
        annexure_scope_of_work || null, annexure_input_documents || null, annexure_deliverables || null,
        annexure_software || null, annexure_duration || null, annexure_site_visit || null,
        annexure_quotation_validity || null, annexure_mode_of_delivery || null, annexure_revision || null,
        annexure_exclusions || null, annexure_billing_payment_terms || null, annexure_confidentiality || null,
        annexure_codes_and_standards || null, annexure_dispute_resolution || null, id
      ]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Proposal updated successfully'
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update proposal' },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();
    
    const [result] = await pool.execute(
      'DELETE FROM proposals WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Proposal deleted successfully'
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete proposal' },
      { status: 500 }
    );
  }
}