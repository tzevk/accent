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
    // Build the UPDATE dynamically so we only try to set columns that actually exist
    const dbName = process.env.DB_NAME || 'accent';
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'proposals'`,
      [dbName]
    );
    const existing = new Set(cols.map(c => c.COLUMN_NAME));

    // Helper to push if column exists
    const setParts = [];
    const values = [];
    const pushIf = (colName, val) => {
      if (existing.has(colName)) {
        setParts.push(`${colName} = ?`);
        values.push(val);
      }
    };

    // Map request body keys to possible DB column names and push accordingly
    // title/proposal_title
    pushIf('title', body.title ?? null);
    pushIf('proposal_title', body.proposal_title ?? body.title ?? null);
    pushIf('client', body.client ?? null);
    pushIf('contact_name', body.contact_name ?? null);
    pushIf('contact_email', body.contact_email ?? null);
    pushIf('phone', body.phone ?? null);
    pushIf('project_description', body.project_description ?? body.description ?? null);
    pushIf('value', body.value ?? body.proposal_value ?? null);
    pushIf('status', body.status ?? null);
    pushIf('due_date', body.due_date ?? body.target_date ?? null);
    pushIf('notes', body.notes ?? null);
    pushIf('lead_id', body.lead_id ?? null);

    // Quotation / related fields
    pushIf('client_name', body.client_name ?? body.client ?? null);
    pushIf('client_address', body.client_address ?? null);
    pushIf('attention_person', body.attention_person ?? null);
    pushIf('attention_designation', body.attention_designation ?? null);
    pushIf('quotation_no', body.quotation_no ?? null);
    pushIf('date_of_quotation', body.date_of_quotation ?? null);
    pushIf('enquiry_no', body.enquiry_no ?? null);
    pushIf('date_of_enquiry', body.date_of_enquiry ?? null);

    if (existing.has('scope_items')) {
      pushIf('scope_items', body.scope_items ? JSON.stringify(body.scope_items) : null);
    }
    pushIf('amount_in_words', body.amount_in_words ?? null);
    pushIf('total_amount', body.total_amount ?? null);
    pushIf('gst_number', body.gst_number ?? null);
    pushIf('pan_number', body.pan_number ?? null);
    pushIf('tan_number', body.tan_number ?? null);
    pushIf('terms_and_conditions', body.terms_and_conditions ?? body.general_terms ?? null);
    pushIf('payment_mode', body.payment_mode ?? null);
    pushIf('receiver_signature', body.receiver_signature ?? null);
    pushIf('company_signature', body.company_signature ?? null);
    pushIf('signatory_name', body.signatory_name ?? null);
    pushIf('signatory_designation', body.signatory_designation ?? null);

    // Frontend fields (new)
    pushIf('input_document', body.input_document ?? null);
    pushIf('list_of_deliverables', body.list_of_deliverables ?? null);
    pushIf('project_schedule', body.project_schedule ?? null);
    pushIf('software', body.software ?? null);
    pushIf('duration', body.duration ?? null);
    pushIf('site_visit', body.site_visit ?? null);
    pushIf('quotation_validity', body.quotation_validity ?? null);
    pushIf('mode_of_delivery', body.mode_of_delivery ?? null);
    pushIf('revision', body.revision ?? null);
    pushIf('exclusions', body.exclusions ?? null);
    pushIf('billing_payment_terms', body.billing_payment_terms ?? null);
    // existing schema used annexure_confidentiality etc. keep other_terms mapping
    pushIf('other_terms', body.other_terms ?? body.annexure_confidentiality ?? null);
    pushIf('additional_fields', body.additional_fields ?? null);
    pushIf('general_terms', body.general_terms ?? null);
    pushIf('payment_terms', body.payment_terms ?? body.payment_terms ?? null);

    // If there are no columns to update, return 400
    if (setParts.length === 0) {
      return NextResponse.json({ success: false, error: 'No updatable columns found for proposals table' }, { status: 400 });
    }

    // Append updated_at if present
    if (existing.has('updated_at')) {
      setParts.push('updated_at = NOW()');
    }

    const sql = `UPDATE proposals SET ${setParts.join(', ')} WHERE id = ?`;
    values.push(id);

    const [result] = await pool.execute(sql, values);

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