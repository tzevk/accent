import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();

    // Ensure audit columns exist on both proposals and projects (best-effort)
    try {
      await pool.execute(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS converted_by VARCHAR(255) DEFAULT NULL`);
      await pool.execute(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP NULL`);
      await pool.execute(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS converted_by VARCHAR(255) DEFAULT NULL`);
      await pool.execute(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP NULL`);
    } catch (e) {
      console.warn('Schema alter warnings during convert:', e?.message || e);
    }
    
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

// Convert proposal to project
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ success: false, error: 'Proposal id required' }, { status: 400 });

    const body = await request.json();
    // Load DB
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();

    // Fetch proposal
    const [rows] = await pool.execute('SELECT * FROM proposals WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      await pool.end?.();
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }
    const proposal = rows[0];

    // Prepare project data from proposal (map common fields)
    const projectData = {
      name: proposal.proposal_title || proposal.title || `Project from ${proposal.proposal_title || proposal.title || id}`,
      description: proposal.description || proposal.project_description || null,
      company_id: proposal.company_id || null,
      // intentionally do not set project_manager here; user will assign it on the Project page
      start_date: body.start_date || proposal.planned_start_date || null,
      end_date: body.end_date || proposal.planned_end_date || null,
      target_date: body.target_date || proposal.target_date || null,
      budget: body.budget || proposal.budget || proposal.proposal_value || null,
      status: body.status || 'NEW',
      priority: body.priority || proposal.priority || 'MEDIUM',
      progress: body.progress || 0,
      proposal_id: proposal.id,
      notes: body.notes || proposal.notes || null,
      project_schedule: proposal.project_schedule || null,
      input_document: proposal.input_document || null,
      list_of_deliverables: proposal.list_of_deliverables || null,
      kickoff_meeting: proposal.kickoff_meeting || null,
      in_house_meeting: proposal.in_house_meeting || null,
      // copy collaborative fields
      activities: proposal.activities || body.activities || [],
      disciplines: proposal.disciplines || body.disciplines || [],
      discipline_descriptions: proposal.discipline_descriptions || body.discipline_descriptions || {},
      planning_activities_list: proposal.planning_activities_list || body.planning_activities_list || [],
      documents_list: proposal.documents_list || body.documents_list || []
    };

    // Insert project using existing projects POST logic shape
    const insertSql = `INSERT INTO projects (
      project_id, name, description, company_id, client_name,
      start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes,
      activities, disciplines, discipline_descriptions, assignments,
      project_schedule, input_document, list_of_deliverables, kickoff_meeting, in_house_meeting
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;


    // Compose project_id using serial-month-year logic (reuse projects.POST behavior)
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentPattern = `-${month}-${year}`;

    // Find highest serial number for current month/year
    const [existingProjects] = await pool.execute(
      'SELECT project_id FROM projects WHERE project_id LIKE ? ORDER BY project_id DESC',
      [`%${currentPattern}`]
    );
    let maxSerial = 0;
    existingProjects.forEach(p => {
      if (p.project_id && p.project_id.endsWith(currentPattern)) {
        const serialPart = p.project_id.split('-')[0];
        const serial = parseInt(serialPart, 10);
        if (!isNaN(serial) && serial > maxSerial) maxSerial = serial;
      }
    });
    const nextSerial = String(maxSerial + 1).padStart(3, '0');
    const project_id = `${nextSerial}-${month}-${year}`;

    const client_name = proposal.client_name || proposal.client || null;

    const [result] = await pool.execute(insertSql, [
      project_id,
      projectData.name,
      projectData.description,
      projectData.company_id,
      client_name,
      projectData.start_date,
      projectData.end_date,
      projectData.target_date,
      projectData.budget,
      null, // assigned_to
      projectData.status,
      'ONGOING', // type
      projectData.priority,
      projectData.progress,
      projectData.proposal_id,
      projectData.notes,
      JSON.stringify(projectData.activities || []),
      JSON.stringify(projectData.disciplines || []),
      JSON.stringify(projectData.discipline_descriptions || {}),
      JSON.stringify([]),
      projectData.project_schedule,
      projectData.input_document,
      projectData.list_of_deliverables,
      projectData.kickoff_meeting,
      projectData.in_house_meeting
    ]);

    // Update proposal status to CONVERTED, link the created project id and set audit fields
    const convertedBy = body.converted_by || 'manual';
    const convertedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    // Ensure proposals.status can accept new values (best-effort migration from ENUM to VARCHAR)
    try {
      await pool.execute("ALTER TABLE proposals MODIFY COLUMN status VARCHAR(50) DEFAULT 'draft'");
    } catch (e) {
      // ignore if ALTER fails (older DBs might not allow modification)
      console.warn('Failed to alter proposals.status column:', e?.message || e);
    }

    await pool.execute('UPDATE proposals SET status = ?, project_id = ?, converted_by = ?, converted_at = ? WHERE id = ?', ['CONVERTED', result.insertId, convertedBy, convertedAt, id]);

    // Also set audit fields on the created project row (best-effort)
    try {
      await pool.execute('UPDATE projects SET converted_by = ?, converted_at = ? WHERE id = ?', [convertedBy, convertedAt, result.insertId]);
    } catch (e) {
      console.warn('Failed to set audit fields on project:', e?.message || e);
    }

    // Fetch created project
    const [created] = await pool.execute('SELECT * FROM projects WHERE id = ?', [result.insertId]);

    await pool.end?.();

  return NextResponse.json({ success: true, data: { project: created[0], proposal: { ...proposal, status: 'CONVERTED', project_id: created[0].project_id } } }, { status: 201 });
  } catch (err) {
    console.error('Convert proposal to project error:', err);
    return NextResponse.json({ success: false, error: 'Failed to convert proposal', details: err.message }, { status: 500 });
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