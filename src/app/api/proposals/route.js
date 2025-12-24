import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// Helper to ensure all required columns exist in proposals table
async function ensureProposalColumns(pool) {
  const alterStatements = [
    // Quotation related fields
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quotation_number VARCHAR(100)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quotation_date DATE',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_number VARCHAR(100)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_date DATE',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quotation_validity VARCHAR(255)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS billing_payment_terms TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS other_terms TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS general_terms TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS additional_fields TEXT',
    
    // Input documents & deliverables
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS input_document TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS list_of_deliverables TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS documents_list JSON',
    
    // Software & schedule fields
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS software VARCHAR(255)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS software_items JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS duration VARCHAR(100)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS site_visit TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS mode_of_delivery VARCHAR(255)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS revision VARCHAR(255)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS exclusions TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_schedule TEXT',
    
    // Meetings
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS kickoff_meeting TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS in_house_meeting TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS kickoff_meeting_date DATE',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS internal_meeting_date DATE',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS next_internal_meeting DATE',
    
    // Disciplines & activities
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS disciplines JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS activities JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS discipline_descriptions JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planning_activities_list JSON',
    
    // Commercial items
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS commercial_items JSON',
    
    // Hours tracking
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_hours_total DECIMAL(10,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS actual_hours_total DECIMAL(10,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_hours_by_discipline JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS actual_hours_by_discipline JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_hours_per_activity JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS actual_hours_per_activity JSON',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS hours_variance_total DECIMAL(10,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS hours_variance_percentage DECIMAL(5,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS productivity_index DECIMAL(5,2)',
    
    // Client & location
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS client_contact_details TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_location_country VARCHAR(100)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_location_city VARCHAR(100)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_location_site VARCHAR(255)',
    
    // Financial
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS budget DECIMAL(15,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS cost_to_company DECIMAL(15,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS profitability_estimate DECIMAL(5,2)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS major_risks TEXT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS mitigation_plans TEXT',
    
    // Schedule
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_start_date DATE',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_end_date DATE',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_duration_planned VARCHAR(100)',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS target_date DATE',
    
    // Status & progress
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_id INT',
    'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_no VARCHAR(100)',
  ];
  
  for (const stmt of alterStatements) {
    try {
      await pool.execute(stmt);
    } catch (e) {
      // Ignore errors - column might already exist or syntax not supported
      console.warn('Column alter skipped:', e?.message || e);
    }
  }
}

export async function GET() {
  try {
    const pool = await dbConnect();
    
    // Ensure all columns exist before fetching
    await ensureProposalColumns(pool);
    
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
    
    // Extract fields matching new database schema
    const {
      // From lead conversion (basic fields)
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
      
      // New comprehensive fields
      proposal_title,
      description,
  company_id,
  client_name,
      industry,
      contract_type,
      proposal_value,
      currency,
      payment_terms,
      
      // Schedule fields
      planned_start_date,
      planned_end_date,
      project_duration_planned,
      target_date,
      project_schedule,
      
      // Scope fields
      input_document,
      list_of_deliverables,
      disciplines,
      activities,
      discipline_descriptions,
      planning_activities_list,
      documents_list,
      
      // Meetings fields
      kickoff_meeting,
      in_house_meeting,
      kickoff_meeting_date,
      internal_meeting_date,
      next_internal_meeting,
      
  // (frontend scope fields already declared above)
      
  // Financial & Risk fields
    software,
    duration,
    site_visit,
    quotation_validity,
    mode_of_delivery,
    revision,
    exclusions,
    billing_payment_terms,
    other_terms,
    additional_fields,
    general_terms,
    budget,
    project_location_country,
    cost_to_company,
      profitability_estimate,
      major_risks,
      mitigation_plans,
      
      // Hours tracking fields
      planned_hours_total,
      actual_hours_total,
      planned_hours_by_discipline,
      actual_hours_by_discipline,
      planned_hours_per_activity,
      actual_hours_per_activity,
      hours_variance_total,
      hours_variance_percentage,
      productivity_index,
      
      // Client & Location fields
      client_contact_details,
        // project_schedule,
      project_location_city,
      project_location_site,
      
      // Status fields
      progress,
      project_id
    } = data;

    // Get database connection
    const pool = await dbConnect();

    // Generate proposal ID in format: ATSPL/Q/{MONTH_NUMBER}/{RUNNING_YEAR}/076{SEQ}
    // Find the highest sequence number used this month/year to avoid duplicates
    // Example: ATSPL/Q/12/2025/076001
    try {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      
      // Find the maximum sequence number from existing proposal_ids for this month/year
      // Pattern: ATSPL/Q/MM/YYYY/076XXX where XXX is the sequence
      const pattern = `ATSPL/Q/${month}/${year}/076%`;
      const [maxRows] = await pool.execute(
        `SELECT proposal_id FROM proposals WHERE proposal_id LIKE ? ORDER BY proposal_id DESC LIMIT 1`,
        [pattern]
      );
      
      let seq = 1;
      if (maxRows && maxRows.length > 0 && maxRows[0].proposal_id) {
        // Extract the sequence number from the last part (e.g., "076004" -> 4)
        const lastId = maxRows[0].proposal_id;
        const match = lastId.match(/076(\d+)$/);
        if (match) {
          seq = parseInt(match[1], 10) + 1;
        }
      }
      
      const seqStr = String(seq).padStart(3, '0');
      var proposal_id = `ATSPL/Q/${month}/${year}/076${seqStr}`;
    } catch (e) {
      // If finding max fails, fall back to timestamp-based unique id
      console.error('Failed to compute sequential proposal id, falling back to timestamp-based id', e);
      const now2 = new Date();
      const month2 = String(now2.getMonth() + 1).padStart(2, '0');
      const year2 = now2.getFullYear();
      const timestamp = Date.now().toString().slice(-6);
      var proposal_id = `ATSPL/Q/${month2}/${year2}/076${timestamp}`;
    }
    
    // Build columns and values explicitly to avoid column/value count mismatches
    const columns = [
  'proposal_id', 'proposal_title', 'description', 'company_id', 'client_name',
  'industry', 'contract_type', 'proposal_value', 'currency',
      'payment_terms', 'planned_start_date', 'planned_end_date', 'project_duration_planned',
      'target_date', 'project_schedule', 'input_document', 'list_of_deliverables',
      'disciplines', 'activities', 'discipline_descriptions', 'planning_activities_list',
      'documents_list', 'kickoff_meeting', 'in_house_meeting', 'kickoff_meeting_date',
      'internal_meeting_date', 'next_internal_meeting', 'software', 'duration',
      'site_visit', 'quotation_validity', 'mode_of_delivery', 'revision', 'exclusions',
      'billing_payment_terms', 'other_terms', 'additional_fields', 'general_terms',
      'budget', 'cost_to_company', 'profitability_estimate', 'major_risks', 'mitigation_plans',
      'planned_hours_total', 'actual_hours_total', 'planned_hours_by_discipline', 'actual_hours_by_discipline',
      'planned_hours_per_activity', 'actual_hours_per_activity', 'hours_variance_total', 'hours_variance_percentage',
      'productivity_index', 'client_contact_details', 'project_location_country',
      'project_location_city', 'project_location_site', 'status', 'priority', 'progress',
     'notes', 'lead_id', 'enquiry_no', 'project_id'
    ];

    const values = [
      proposal_id,
      proposal_title || title || null,
      description || project_description || null,
      company_id || null,
      client_name || client || null,
      industry || null,
      contract_type || null,
      proposal_value || value || null,
      currency || 'INR',
      payment_terms || null,
      planned_start_date || null,
      planned_end_date || null,
      project_duration_planned || null,
      target_date || due_date || null,
      project_schedule || null,
      input_document || null,
      list_of_deliverables || null,
      disciplines ? JSON.stringify(disciplines) : null,
      activities ? JSON.stringify(activities) : null,
      discipline_descriptions ? JSON.stringify(discipline_descriptions) : null,
      planning_activities_list ? JSON.stringify(planning_activities_list) : null,
      documents_list ? JSON.stringify(documents_list) : null,
      kickoff_meeting || null,
      in_house_meeting || null,
      kickoff_meeting_date || null,
      internal_meeting_date || null,
      next_internal_meeting || null,
      software || null,
      duration || null,
      site_visit || null,
      quotation_validity || null,
      mode_of_delivery || null,
      revision || null,
      exclusions || null,
      billing_payment_terms || `Payment shall be released by the client within 7 days from the date of the invoice.
Payment shall be by way of RTGS transfer to ATSPL bank account.
The late payment charges will be 2% per month on the total bill amount if bills are not settled within the credit period of 30 days.
In case of project delays beyond two-month, software cost of ₹10,000/- per month will be charged.
Upon completion of the above scope of work, if a project is cancelled or held by the client for any reason then Accent Techno Solutions Private Limited is entitled to 100% invoice against the completed work.`,
      other_terms || `Input, output & any excerpts in between is intellectual properties of client. ATS shall not voluntarily disclose any of such documents to third parties & will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information.
ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across.
ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.`,
      additional_fields || null,
      general_terms || `General Terms and conditions
• Any additional work will be charged extra
• GST 18% extra as applicable on total project cost.
• The proposal is based on client's enquiry and provided input data
• Work will start within 15 days after receipt of confirmed LOI/PO.
• Mode of Payments: - Through Wire transfer to ‘Accent Techno Solutions Pvt Ltd.’ payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244`,
      budget || null,
      cost_to_company || null,
      profitability_estimate || null,
      major_risks || null,
      mitigation_plans || null,
      planned_hours_total || null,
      actual_hours_total || null,
      planned_hours_by_discipline ? JSON.stringify(planned_hours_by_discipline) : null,
      actual_hours_by_discipline ? JSON.stringify(actual_hours_by_discipline) : null,
      planned_hours_per_activity ? JSON.stringify(planned_hours_per_activity) : null,
      actual_hours_per_activity ? JSON.stringify(actual_hours_per_activity) : null,
      hours_variance_total || null,
      hours_variance_percentage || null,
      productivity_index || null,
      client_contact_details || null,
      project_location_country || null,
      project_location_city || city || null,
      project_location_site || null,
      (status === 'pending' ? 'DRAFT' : (status || 'DRAFT').toUpperCase()),
      (priority || 'MEDIUM').toUpperCase(),
      progress || 0,
      notes || null,
     lead_id || null,
     lead_id || null, // enquiry_no will mirror lead_id on create
      project_id || null
    ];

    // Sanity check: ensure columns length matches values length
    if (columns.length !== values.length) {
      console.error('Proposals INSERT mismatch: columns.length=', columns.length, 'values.length=', values.length);
      console.error('Columns:', columns);
      console.error('Values length and sample:', values.length, values.slice(0, 10));
      throw new Error(`Column/value count mismatch: ${columns.length} columns, ${values.length} values`);
    }

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO proposals (${columns.join(', ')}) VALUES (${placeholders})`;

    const [result] = await pool.execute(sql, values);
    
    const newProposal = {
      id: result.insertId,
      proposal_id,
      proposal_title: proposal_title || title,
      client_name: client_name || client,
      contact_name,
      contact_email,
      phone,
      description: description || project_description,
      city,
      priority: priority || 'MEDIUM',
      proposal_value: proposal_value || value,
      status: status || 'DRAFT',
      target_date: target_date || due_date,
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
      { success: false, error: 'Failed to create proposal', details: error.message },
      { status: 500 }
    );
  }
}