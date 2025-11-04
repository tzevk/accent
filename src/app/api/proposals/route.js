import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const pool = await dbConnect();
    
    const [rows] = await pool.execute(
      'SELECT * FROM proposals ORDER BY created_at DESC'
    );
    
    return NextResponse.json({
      success: true,
      proposals: rows
    });
  } catch (error) {
    console.error('Error fetching proposals:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch proposals' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const data = await request.json();

    
    const {
      title,
      client,
      contact_name,
      contact_email,
      phone,
      project_description,
      city,
      priority,
      value,
      status,
      due_date,
      notes,
      lead_id,
      // Quotation fields
      client_name,
      client_address,
      attention_person,
      attention_designation,
      quotation_no,
      date_of_quotation,
      enquiry_no,
      date_of_enquiry,
      scope_items,
      amount_in_words,
      total_amount,
      gst_number,
      pan_number,
      tan_number,
      terms_and_conditions,
      payment_mode,
      receiver_signature,
      company_signature,
      signatory_name,
      signatory_designation,
      // Annexure fields
      annexure_scope_of_work,
      annexure_input_documents,
      annexure_deliverables,
      annexure_software,
      annexure_duration,
      annexure_site_visit,
      annexure_quotation_validity,
      annexure_mode_of_delivery,
      annexure_revision,
      annexure_exclusions,
      annexure_billing_payment_terms,
      annexure_confidentiality,
      annexure_codes_and_standards,
      annexure_dispute_resolution
    } = data;

    // Generate proposal number
    const proposal_number = `P${String(Date.now()).slice(-6)}`;
    
    // Get database connection
    const pool = await dbConnect();
    
    // Create proposal in database
    const [result] = await pool.execute(
      `INSERT INTO proposals (
        proposal_number, title, client, contact_name, contact_email, 
        phone, project_description, city, priority, value, status, 
        due_date, notes, lead_id,
        client_name, client_address, attention_person, attention_designation,
        quotation_no, date_of_quotation, enquiry_no, date_of_enquiry,
        scope_items, amount_in_words, total_amount, gst_number, pan_number,
        tan_number, terms_and_conditions, payment_mode, receiver_signature,
        company_signature, signatory_name, signatory_designation,
        annexure_scope_of_work, annexure_input_documents, annexure_deliverables,
        annexure_software, annexure_duration, annexure_site_visit,
        annexure_quotation_validity, annexure_mode_of_delivery, annexure_revision,
        annexure_exclusions, annexure_billing_payment_terms, annexure_confidentiality,
        annexure_codes_and_standards, annexure_dispute_resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        proposal_number, title || null, client || null, contact_name || null, contact_email || null,
        phone || null, project_description || null, city || null, priority || 'Medium', value || null, status || 'draft',
        due_date || null, notes || null, lead_id || null,
        client_name || null, client_address || null, attention_person || null, attention_designation || null,
        quotation_no || null, date_of_quotation || null, enquiry_no || null, date_of_enquiry || null,
        scope_items ? JSON.stringify(scope_items) : null, amount_in_words || null, total_amount || null, gst_number || null, pan_number || null,
        tan_number || null, terms_and_conditions || null, payment_mode || null, receiver_signature || null,
        company_signature || null, signatory_name || null, signatory_designation || null,
        annexure_scope_of_work || null, annexure_input_documents || null, annexure_deliverables || null,
        annexure_software || null, annexure_duration || null, annexure_site_visit || null,
        annexure_quotation_validity || null, annexure_mode_of_delivery || null, annexure_revision || null,
        annexure_exclusions || null, annexure_billing_payment_terms || null, annexure_confidentiality || null,
        annexure_codes_and_standards || null, annexure_dispute_resolution || null
      ]
    );
    
    const newProposal = {
      id: result.insertId,
      proposal_number,
      title,
      client,
      contact_name,
      contact_email,
      phone,
      project_description,
      city,
      priority,
      value,
      status: status || 'draft',
      due_date,
      notes,
      lead_id,
      created_at: new Date().toISOString()
    };
    
    return NextResponse.json({
      success: true,
      data: newProposal,
      proposal: newProposal,
      message: 'Proposal created successfully'
    });
  } catch (error) {
    console.error('Error creating proposal:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create proposal: ' + error.message },
      { status: 500 }
    );
  }
}