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

    // Generate proposal ID for new schema
    const proposal_id = `P${Date.now()}`;
    
    // Get database connection
    const pool = await dbConnect();
    
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
      'notes', 'lead_id', 'project_id'
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