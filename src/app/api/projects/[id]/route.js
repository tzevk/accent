import { dbConnect } from '@/utils/database';

// GET specific project
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    
    const db = await dbConnect();
    
    const [rows] = await db.execute(`
      SELECT p.*, pr.proposal_id as linked_proposal_id, pr.title as proposal_title
      FROM projects p 
      LEFT JOIN proposals pr ON p.proposal_id = pr.id
      WHERE p.id = ?
    `, [projectId]);
    
    await db.end();
    
    if (rows.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch project' 
    }, { status: 500 });
  }
}

// PUT - Update project
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const data = await request.json();
    
    const {
      name,
      project_id,
      client_name,
      client_contact_details,
      project_location_country,
      project_location_city,
      project_location_site,
      industry,
      contract_type,
      company_id,
      project_manager,
      type,
      start_date,
      end_date,
      target_date,
      project_duration_planned,
      project_duration_actual,
      budget,
      progress,
      status,
      priority,
      assigned_to,
      description,
      notes,
      proposal_id,
      // Commercial Details
      project_value,
      currency,
      payment_terms,
      invoicing_status,
      cost_to_company,
      profitability_estimate,
      subcontractors_vendors,
      // Procurement & Material
      procurement_status,
      material_delivery_schedule,
      vendor_management,
      // Construction / Site
      mobilization_date,
      site_readiness,
      construction_progress,
      // Risk & Issues
      major_risks,
      mitigation_plans,
      change_orders,
      claims_disputes,
      // Project Closeout
      final_documentation_status,
      lessons_learned,
      client_feedback,
      actual_profit_loss
    } = data;

    const db = await dbConnect();
    
    // First ensure all new columns exist
    try {
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_id VARCHAR(100)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_contact_details TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_location_country VARCHAR(100)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_location_city VARCHAR(100)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_location_site VARCHAR(255)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS industry VARCHAR(100)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_type VARCHAR(100)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_duration_planned DECIMAL(10,2)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_duration_actual DECIMAL(10,2)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT');
      
      // Commercial Details
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_value DECIMAL(15,2)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT "USD"');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS invoicing_status VARCHAR(50)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS cost_to_company DECIMAL(15,2)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS profitability_estimate DECIMAL(5,2)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS subcontractors_vendors TEXT');
      
      // Procurement & Material
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS procurement_status VARCHAR(50)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS material_delivery_schedule TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS vendor_management TEXT');
      
      // Construction / Site
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS mobilization_date DATE');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_readiness VARCHAR(50)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS construction_progress TEXT');
      
      // Risk & Issues
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS major_risks TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS mitigation_plans TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS change_orders TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS claims_disputes TEXT');
      
      // Project Closeout
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS final_documentation_status VARCHAR(50)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS lessons_learned TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_feedback TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS actual_profit_loss DECIMAL(15,2)');
    } catch (err) {
      console.warn('Some ALTER TABLE statements failed, columns might already exist:', err.message);
    }
    
    // Update all provided fields using COALESCE
    const [result] = await db.execute(`
      UPDATE projects SET 
        name = COALESCE(?, name),
        project_id = COALESCE(?, project_id),
        client_name = COALESCE(?, client_name),
        client_contact_details = COALESCE(?, client_contact_details),
        project_location_country = COALESCE(?, project_location_country),
        project_location_city = COALESCE(?, project_location_city),
        project_location_site = COALESCE(?, project_location_site),
        industry = COALESCE(?, industry),
        contract_type = COALESCE(?, contract_type),
        company_id = COALESCE(?, company_id),
        project_manager = COALESCE(?, project_manager),
        type = COALESCE(?, type),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        target_date = COALESCE(?, target_date),
        project_duration_planned = COALESCE(?, project_duration_planned),
        project_duration_actual = COALESCE(?, project_duration_actual),
        budget = COALESCE(?, budget),
        progress = COALESCE(?, progress),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        assigned_to = COALESCE(?, assigned_to),
        description = COALESCE(?, description),
        notes = COALESCE(?, notes),
        proposal_id = COALESCE(?, proposal_id),
        project_value = COALESCE(?, project_value),
        currency = COALESCE(?, currency),
        payment_terms = COALESCE(?, payment_terms),
        invoicing_status = COALESCE(?, invoicing_status),
        cost_to_company = COALESCE(?, cost_to_company),
        profitability_estimate = COALESCE(?, profitability_estimate),
        subcontractors_vendors = COALESCE(?, subcontractors_vendors),
        procurement_status = COALESCE(?, procurement_status),
        material_delivery_schedule = COALESCE(?, material_delivery_schedule),
        vendor_management = COALESCE(?, vendor_management),
        mobilization_date = COALESCE(?, mobilization_date),
        site_readiness = COALESCE(?, site_readiness),
        construction_progress = COALESCE(?, construction_progress),
        major_risks = COALESCE(?, major_risks),
        mitigation_plans = COALESCE(?, mitigation_plans),
        change_orders = COALESCE(?, change_orders),
        claims_disputes = COALESCE(?, claims_disputes),
        final_documentation_status = COALESCE(?, final_documentation_status),
        lessons_learned = COALESCE(?, lessons_learned),
        client_feedback = COALESCE(?, client_feedback),
        actual_profit_loss = COALESCE(?, actual_profit_loss),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      name === undefined ? null : name,
      project_id === undefined ? null : project_id,
      client_name === undefined ? null : client_name,
      client_contact_details === undefined ? null : client_contact_details,
      project_location_country === undefined ? null : project_location_country,
      project_location_city === undefined ? null : project_location_city,
      project_location_site === undefined ? null : project_location_site,
      industry === undefined ? null : industry,
      contract_type === undefined ? null : contract_type,
      company_id === undefined ? null : company_id,
      project_manager === undefined ? null : project_manager,
      type === undefined ? null : type,
      start_date === undefined ? null : start_date,
      end_date === undefined ? null : end_date,
      target_date === undefined ? null : target_date,
      project_duration_planned === undefined ? null : project_duration_planned,
      project_duration_actual === undefined ? null : project_duration_actual,
      budget === undefined ? null : budget,
      progress === undefined ? null : progress,
      status === undefined ? null : status,
      priority === undefined ? null : priority,
      assigned_to === undefined ? null : assigned_to,
      description === undefined ? null : description,
      notes === undefined ? null : notes,
      proposal_id === undefined ? null : proposal_id,
      project_value === undefined ? null : project_value,
      currency === undefined ? null : currency,
      payment_terms === undefined ? null : payment_terms,
      invoicing_status === undefined ? null : invoicing_status,
      cost_to_company === undefined ? null : cost_to_company,
      profitability_estimate === undefined ? null : profitability_estimate,
      subcontractors_vendors === undefined ? null : subcontractors_vendors,
      procurement_status === undefined ? null : procurement_status,
      material_delivery_schedule === undefined ? null : material_delivery_schedule,
      vendor_management === undefined ? null : vendor_management,
      mobilization_date === undefined ? null : mobilization_date,
      site_readiness === undefined ? null : site_readiness,
      construction_progress === undefined ? null : construction_progress,
      major_risks === undefined ? null : major_risks,
      mitigation_plans === undefined ? null : mitigation_plans,
      change_orders === undefined ? null : change_orders,
      claims_disputes === undefined ? null : claims_disputes,
      final_documentation_status === undefined ? null : final_documentation_status,
      lessons_learned === undefined ? null : lessons_learned,
      client_feedback === undefined ? null : client_feedback,
      actual_profit_loss === undefined ? null : actual_profit_loss,
      projectId
    ]);

    // Ensure columns exist to store assigned disciplines/activities/assignments and per-discipline descriptions
    try {
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_disciplines TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_activities TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS discipline_descriptions TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assignments JSON');
    } catch (err) {
      // Non-fatal - some MySQL versions may not support IF NOT EXISTS on ALTER COLUMN
      console.warn('Could not ensure project assignment columns exist:', err.message || err);
    }

    // Persist disciplines/activities/descriptions/assignments if provided in payload
    try {
      const assignedDisciplines = data.disciplines ? JSON.stringify(data.disciplines) : null;
      const assignedActivities = data.activities ? JSON.stringify(data.activities) : null;
      const disciplineDescriptions = data.discipline_descriptions ? JSON.stringify(data.discipline_descriptions) : null;
      const assignments = data.assignments ? JSON.stringify(data.assignments) : null;

      if (assignedDisciplines !== null || assignedActivities !== null || disciplineDescriptions !== null || assignments !== null) {
        await db.execute(
          `UPDATE projects SET 
             assigned_disciplines = COALESCE(?, assigned_disciplines),
             assigned_activities = COALESCE(?, assigned_activities),
             discipline_descriptions = COALESCE(?, discipline_descriptions),
             assignments = COALESCE(?, assignments)
           WHERE id = ?`,
          [assignedDisciplines, assignedActivities, disciplineDescriptions, assignments, projectId]
        );
      }
    } catch (err) {
      console.error('Failed to persist project discipline/activity/assignment data:', err);
    }

    await db.end();

    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }

    return Response.json({ 
      success: true, 
      message: 'Project updated successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to update project' 
    }, { status: 500 });
  }
}

// DELETE project
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    
    const db = await dbConnect();
    
    const [result] = await db.execute(
      'DELETE FROM projects WHERE id = ?',
      [projectId]
    );
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Project deleted successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to delete project' 
    }, { status: 500 });
  }
}