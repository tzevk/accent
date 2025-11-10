import { dbConnect } from '@/utils/database';

// GET specific project
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    // Defensive: sometimes client may pass the literal string 'undefined' (e.g. bad useParams handling).
    // Treat that as a missing id and return a 400 early to avoid spurious schema lookups.
    if (!id || id === 'undefined') {
      return Response.json({ success: false, error: 'Invalid project id parameter' }, { status: 400 });
    }
    const projectIdInt = parseInt(id, 10);

    const db = await dbConnect();

    // Inspect schema to avoid referencing missing columns (some envs have different project schemas)
    let pkCol = null;
    try {
      const [pkRows] = await db.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'PRIMARY'`
      );
      if (pkRows && pkRows.length > 0 && pkRows[0].COLUMN_NAME) {
        pkCol = pkRows[0].COLUMN_NAME;
      }
    } catch (schemaErr) {
      console.warn('Could not inspect primary key for projects table:', schemaErr.message || schemaErr);
    }

    // Also check for presence of human-readable id columns
    let hasProjectIdCol = false;
    let hasProjectCodeCol = false;
    try {
      const [cols] = await db.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME IN ('project_id','project_code')`
      );
      if (cols && cols.length > 0) {
        for (const c of cols) {
          if (c.COLUMN_NAME === 'project_id') hasProjectIdCol = true;
          if (c.COLUMN_NAME === 'project_code') hasProjectCodeCol = true;
        }
      }
    } catch (colErr) {
      console.warn('Could not inspect projects columns:', colErr.message || colErr);
    }

    // Build a dynamic OR-based lookup using columns that actually exist in the table.
    // This reduces the chance of missing a match when callers pass project_id or project_code.
    let candidates = [];
    let rows = [];
    try {
      candidates = [];
      if (pkCol) candidates.push(pkCol);
      if (hasProjectIdCol && !candidates.includes('project_id')) candidates.push('project_id');
      if (hasProjectCodeCol && !candidates.includes('project_code')) candidates.push('project_code');

      if (candidates.length > 0) {
        const whereParts = candidates.map((c) => `p.${c} = ?`).join(' OR ');
        const params = candidates.map(() => id);
        try {
          const [r] = await db.execute(`SELECT p.* FROM projects p WHERE ${whereParts} LIMIT 1`, params);
          rows = r || [];
        } catch (orErr) {
          console.warn('OR-based lookup failed, will try fallbacks individually:', orErr?.message || orErr);
          rows = [];
        }
      }

      // Fallback: if not found and id parses numeric, try numeric match against pkCol specifically
      if ((!rows || rows.length === 0) && !Number.isNaN(projectIdInt) && pkCol) {
        try {
          const [rNum] = await db.execute(`SELECT p.* FROM projects p WHERE p.${pkCol} = ? LIMIT 1`, [projectIdInt]);
          rows = rNum || [];
        } catch (numErr) {
          console.warn('Numeric PK lookup failed as last resort:', numErr.message || numErr);
          rows = [];
        }
      }
    } catch (lookupErr) {
      console.warn('Project lookup attempts failed:', lookupErr?.message || lookupErr);
      rows = [];
    }

    if (!rows || rows.length === 0) {
      console.warn('Project lookup did not find a match', { id, pkCol, candidates });
      await db.end();
      return Response.json({ 
        success: false, 
        error: 'Project not found',
        details: { id, pkCol, candidates }
      }, { status: 404 });
    }

    const project = rows[0];

    // Fetch associated project activities after we have the project row.
    // Determine which key the activities table expects: prefer primary key value, fallback to project_id or project_code.
    let projectActivities = [];
    try {
      let activityKeyValue = null;
      if (pkCol && project[pkCol] !== undefined && project[pkCol] !== null) {
        activityKeyValue = project[pkCol];
      } else if (project.project_id !== undefined && project.project_id !== null) {
        activityKeyValue = project.project_id;
      } else if (project.project_code !== undefined && project.project_code !== null) {
        activityKeyValue = project.project_code;
      }

      if (activityKeyValue !== null) {
        const [activities] = await db.execute(
          `SELECT * FROM project_activities WHERE project_id = ? ORDER BY created_at DESC`,
          [activityKeyValue]
        );
        projectActivities = activities || [];
      } else {
        // No suitable key to lookup activities; skip silently
        projectActivities = [];
      }
    } catch (actError) {
      console.warn('Could not fetch project activities:', actError.message || actError);
      projectActivities = [];
    }

    await db.end();
    
    // Parse JSON fields if they exist
    if (project.planning_activities_list && typeof project.planning_activities_list === 'string') {
      try {
        project.planning_activities_list = JSON.parse(project.planning_activities_list);
      } catch {
        project.planning_activities_list = [];
      }
    }
    
    if (project.documents_list && typeof project.documents_list === 'string') {
      try {
        project.documents_list = JSON.parse(project.documents_list);
      } catch {
        project.documents_list = [];
      }
    }
    
    return Response.json({ 
      success: true, 
      data: {
        ...project,
        project_activities: projectActivities
      }
    });
  } catch (error) {
    console.error('Database error:', error);
    // Include error message/short stack in response for easier local debugging
    const details = error?.message || String(error);
    const stack = error?.stack ? error.stack.split('\n').slice(0,5).join('\n') : undefined;
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch project',
      details,
      stack
    }, { status: 500 });
  }
}

// PUT - Update project
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const data = await request.json();
    const db = await dbConnect();

    // Resolve the numeric primary key for the project.
    // If the route param is a pure numeric string, use it directly.
    // Otherwise try to resolve the human-friendly `project_id` to the numeric id.
    let projectId = null;
    if (/^\d+$/.test(id)) {
      projectId = parseInt(id, 10);
    } else {
      try {
        const [lookup] = await db.execute('SELECT id FROM projects WHERE project_id = ?', [id]);
        if (lookup && lookup.length > 0) {
          projectId = lookup[0].id;
        }
      } catch (lookupErr) {
        console.warn('Project lookup by project_id failed:', lookupErr.message || lookupErr);
      }
    }

    if (projectId === null) {
      // ensure DB connection closed before returning
      try { await db.end(); } catch {}
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    
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
      actual_profit_loss,
      // Meeting and Document Fields
      project_schedule,
      input_document,
      list_of_deliverables,
      kickoff_meeting,
      in_house_meeting,
      // Enhanced Planning & Meeting Fields
      project_start_milestone,
      project_review_milestone,
      project_end_milestone,
      kickoff_meeting_date,
      kickoff_followup_date,
      internal_meeting_date,
      next_internal_meeting
    } = data;

    
    
    // Helper function to normalize decimal/numeric fields (convert empty strings to null)
    const normalizeDecimal = (value) => {
      if (value === undefined || value === null || value === '') return null;
      return value;
    };
    
    // Helper function to normalize date fields (convert empty strings to null)
    const normalizeDate = (value) => {
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
      return value;
    };
    
    // First ensure all new columns exist
    try {
      // Ensure core columns exist to avoid 'unknown column' errors on UPDATE
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS name VARCHAR(255)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)');

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
      
      // Meeting and Document Fields
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_schedule TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS input_document TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS list_of_deliverables TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS kickoff_meeting TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS in_house_meeting TEXT');
      
      // Enhanced Planning & Meeting Fields
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_start_milestone TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_review_milestone TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_end_milestone TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS kickoff_meeting_date DATE');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS kickoff_followup_date DATE');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS internal_meeting_date DATE');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_internal_meeting DATE');
    } catch (err) {
      console.warn('Some ALTER TABLE statements failed, columns might already exist:', err.message);
    }
    
    // Update all provided fields using COALESCE
    // If proposal_id provided in payload, prefer company info from the linked proposal
    let companyParamValue = (company_id === undefined || company_id === null || company_id === '' ) ? null : company_id;
    let clientNameParam = client_name === undefined ? null : client_name;
    if (proposal_id !== undefined && proposal_id !== null && proposal_id !== '') {
      try {
        const [proposalRows] = await db.execute(
          'SELECT company_id, client_name FROM proposals WHERE id = ? OR proposal_id = ?',
          [proposal_id, proposal_id]
        );
        if (proposalRows && proposalRows.length > 0) {
          if (proposalRows[0].company_id) companyParamValue = proposalRows[0].company_id;
          if (proposalRows[0].client_name) clientNameParam = proposalRows[0].client_name;
        }
      } catch (e) {
        console.warn('Failed to lookup proposal for company override in project update:', e?.message || e);
      }
    }

    // Build an UPDATE that only references columns that actually exist in the projects table.
    // This avoids "Unknown column" errors in environments with partial schemas.
    const [colRows] = await db.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
    );
    const existingCols = new Set((colRows || []).map(c => c.COLUMN_NAME));

    const fieldValues = [
      ['name', name === undefined ? null : name],
      ['project_id', project_id === undefined ? null : project_id],
      ['client_name', clientNameParam],
      ['client_contact_details', client_contact_details === undefined ? null : client_contact_details],
      ['project_location_country', project_location_country === undefined ? null : project_location_country],
      ['project_location_city', project_location_city === undefined ? null : project_location_city],
      ['project_location_site', project_location_site === undefined ? null : project_location_site],
      ['industry', industry === undefined ? null : industry],
      ['contract_type', contract_type === undefined ? null : contract_type],
      ['company_id', companyParamValue],
      ['project_manager', project_manager === undefined ? null : project_manager],
      ['type', type === undefined ? null : type],
      ['start_date', normalizeDate(start_date)],
      ['end_date', normalizeDate(end_date)],
      ['target_date', normalizeDate(target_date)],
      ['project_duration_planned', normalizeDecimal(project_duration_planned)],
      ['project_duration_actual', normalizeDecimal(project_duration_actual)],
      ['budget', normalizeDecimal(budget)],
      ['progress', progress === undefined ? null : progress],
      ['status', status === undefined ? null : status],
      ['priority', priority === undefined ? null : priority],
      ['assigned_to', assigned_to === undefined ? null : assigned_to],
      ['description', description === undefined ? null : description],
      ['notes', notes === undefined ? null : notes],
      ['proposal_id', (proposal_id === undefined || proposal_id === null || proposal_id === '' ) ? null : proposal_id],
      ['project_value', normalizeDecimal(project_value)],
      ['currency', currency === undefined ? null : currency],
      ['payment_terms', payment_terms === undefined ? null : payment_terms],
      ['invoicing_status', invoicing_status === undefined ? null : invoicing_status],
      ['cost_to_company', normalizeDecimal(cost_to_company)],
      ['profitability_estimate', normalizeDecimal(profitability_estimate)],
      ['subcontractors_vendors', subcontractors_vendors === undefined ? null : subcontractors_vendors],
      ['procurement_status', procurement_status === undefined ? null : procurement_status],
      ['material_delivery_schedule', material_delivery_schedule === undefined ? null : material_delivery_schedule],
      ['vendor_management', vendor_management === undefined ? null : vendor_management],
      ['mobilization_date', normalizeDate(mobilization_date)],
      ['site_readiness', site_readiness === undefined ? null : site_readiness],
      ['construction_progress', construction_progress === undefined ? null : construction_progress],
      ['major_risks', major_risks === undefined ? null : major_risks],
      ['mitigation_plans', mitigation_plans === undefined ? null : mitigation_plans],
      ['change_orders', change_orders === undefined ? null : change_orders],
      ['claims_disputes', claims_disputes === undefined ? null : claims_disputes],
      ['final_documentation_status', final_documentation_status === undefined ? null : final_documentation_status],
      ['lessons_learned', lessons_learned === undefined ? null : lessons_learned],
      ['client_feedback', client_feedback === undefined ? null : client_feedback],
      ['actual_profit_loss', normalizeDecimal(actual_profit_loss)],
      ['project_schedule', project_schedule === undefined ? null : project_schedule],
      ['input_document', input_document === undefined ? null : input_document],
      ['list_of_deliverables', list_of_deliverables === undefined ? null : list_of_deliverables],
      ['kickoff_meeting', kickoff_meeting === undefined ? null : kickoff_meeting],
      ['in_house_meeting', in_house_meeting === undefined ? null : in_house_meeting],
      ['project_start_milestone', project_start_milestone === undefined ? null : project_start_milestone],
      ['project_review_milestone', project_review_milestone === undefined ? null : project_review_milestone],
      ['project_end_milestone', project_end_milestone === undefined ? null : project_end_milestone],
      ['kickoff_meeting_date', normalizeDate(kickoff_meeting_date)],
      ['kickoff_followup_date', normalizeDate(kickoff_followup_date)],
      ['internal_meeting_date', normalizeDate(internal_meeting_date)],
      ['next_internal_meeting', normalizeDate(next_internal_meeting)]
    ];

    const setParts = [];
    const params = [];
    for (const [col, val] of fieldValues) {
      if (existingCols.has(col)) {
        setParts.push(`${col} = COALESCE(?, ${col})`);
        params.push(val);
      }
    }

    // Always update updated_at
    setParts.push('updated_at = CURRENT_TIMESTAMP');

    const sql = `UPDATE projects SET ${setParts.join(', ')} WHERE id = ?`;
    params.push(projectId);

    const [result] = await db.execute(sql, params);

    // Ensure columns exist to store assigned disciplines/activities/assignments and per-discipline descriptions
    try {
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_disciplines TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_activities TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS discipline_descriptions TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assignments JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_members JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_activities_list JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS planning_activities_list JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS documents_list JSON');
    } catch (err) {
      // Non-fatal - some MySQL versions may not support IF NOT EXISTS on ALTER COLUMN
      console.warn('Could not ensure project assignment columns exist:', err.message || err);
    }

    // Persist disciplines/activities/descriptions/assignments/team_members/project_activities_list/planning_activities/documents if provided in payload
    try {
      const assignedDisciplines = data.disciplines ? JSON.stringify(data.disciplines) : null;
      const assignedActivities = data.activities ? JSON.stringify(data.activities) : null;
      const disciplineDescriptions = data.discipline_descriptions ? JSON.stringify(data.discipline_descriptions) : null;
      const assignments = data.assignments ? JSON.stringify(data.assignments) : null;
      const teamMembers = data.team_members || null;
      const projectActivitiesList = data.project_activities_list || null;
      const planningActivitiesList = data.planning_activities_list || null;
      const documentsList = data.documents_list || null;

      if (assignedDisciplines !== null || assignedActivities !== null || disciplineDescriptions !== null || 
          assignments !== null || teamMembers !== null || projectActivitiesList !== null || 
          planningActivitiesList !== null || documentsList !== null) {
        await db.execute(
          `UPDATE projects SET 
             assigned_disciplines = COALESCE(?, assigned_disciplines),
             assigned_activities = COALESCE(?, assigned_activities),
             discipline_descriptions = COALESCE(?, discipline_descriptions),
             assignments = COALESCE(?, assignments),
             team_members = COALESCE(?, team_members),
             project_activities_list = COALESCE(?, project_activities_list),
             planning_activities_list = COALESCE(?, planning_activities_list),
             documents_list = COALESCE(?, documents_list)
           WHERE id = ?`,
          [assignedDisciplines, assignedActivities, disciplineDescriptions, assignments, 
           teamMembers, projectActivitiesList, planningActivitiesList, documentsList, projectId]
        );
      }
    } catch (err) {
      console.error('Failed to persist project discipline/activity/assignment/team data:', err);
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