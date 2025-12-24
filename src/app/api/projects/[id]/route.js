import { dbConnect } from '@/utils/database';

// GET specific project
export async function GET(request, { params }) {
  const { id } = await params;
  // Defensive: sometimes client may pass the literal string 'undefined' (e.g. bad useParams handling).
  // Treat that as a missing id and return a 400 early to avoid spurious schema lookups.
  if (!id || id === 'undefined') {
    return Response.json({ success: false, error: 'Invalid project id parameter' }, { status: 400 });
  }

  const projectIdInt = parseInt(id, 10);
  let db = null;

  try {
    db = await dbConnect();

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

    if (project.input_documents_list && typeof project.input_documents_list === 'string') {
      try {
        project.input_documents_list = JSON.parse(project.input_documents_list);
      } catch {
        project.input_documents_list = [];
      }
    }

    // Parse all the table list fields
    if (project.documents_received_list && typeof project.documents_received_list === 'string') {
      try {
        project.documents_received_list = JSON.parse(project.documents_received_list);
      } catch {
        project.documents_received_list = [];
      }
    }

    if (project.documents_issued_list && typeof project.documents_issued_list === 'string') {
      try {
        project.documents_issued_list = JSON.parse(project.documents_issued_list);
      } catch {
        project.documents_issued_list = [];
      }
    }

    if (project.project_handover_list && typeof project.project_handover_list === 'string') {
      try {
        project.project_handover_list = JSON.parse(project.project_handover_list);
      } catch {
        project.project_handover_list = [];
      }
    }

    if (project.project_manhours_list && typeof project.project_manhours_list === 'string') {
      try {
        project.project_manhours_list = JSON.parse(project.project_manhours_list);
      } catch {
        project.project_manhours_list = [];
      }
    }

    if (project.project_query_log_list && typeof project.project_query_log_list === 'string') {
      try {
        project.project_query_log_list = JSON.parse(project.project_query_log_list);
      } catch {
        project.project_query_log_list = [];
      }
    }

    if (project.project_assumption_list && typeof project.project_assumption_list === 'string') {
      try {
        project.project_assumption_list = JSON.parse(project.project_assumption_list);
      } catch {
        project.project_assumption_list = [];
      }
    }

    if (project.project_lessons_learnt_list && typeof project.project_lessons_learnt_list === 'string') {
      try {
        project.project_lessons_learnt_list = JSON.parse(project.project_lessons_learnt_list);
      } catch {
        project.project_lessons_learnt_list = [];
      }
    }

    if (project.project_schedule_list && typeof project.project_schedule_list === 'string') {
      try {
        project.project_schedule_list = JSON.parse(project.project_schedule_list);
      } catch {
        project.project_schedule_list = [];
      }
    }

    if (project.kickoff_meetings_list && typeof project.kickoff_meetings_list === 'string') {
      try {
        project.kickoff_meetings_list = JSON.parse(project.kickoff_meetings_list);
      } catch {
        project.kickoff_meetings_list = [];
      }
    }

    if (project.internal_meetings_list && typeof project.internal_meetings_list === 'string') {
      try {
        project.internal_meetings_list = JSON.parse(project.internal_meetings_list);
      } catch {
        project.internal_meetings_list = [];
      }
    }

    if (project.software_items && typeof project.software_items === 'string') {
      try {
        project.software_items = JSON.parse(project.software_items);
      } catch {
        project.software_items = [];
      }
    }

    // Parse project_activities_list and merge with user_activity_assignments
    if (project.project_activities_list && typeof project.project_activities_list === 'string') {
      try {
        project.project_activities_list = JSON.parse(project.project_activities_list);
      } catch {
        project.project_activities_list = [];
      }
    }

    // Load assignments from user_activity_assignments and merge into activities
    if (project.project_activities_list && Array.isArray(project.project_activities_list)) {
      try {
        const projectKey = project[pkCol] || project.project_id;
        if (projectKey) {
          const [assignments] = await db.execute(
            'SELECT * FROM user_activity_assignments WHERE project_id = ?',
            [projectKey]
          );

          if (assignments && assignments.length > 0) {
            // Create a map of activity name to assignment
            const assignmentMap = new Map();
            for (const assignment of assignments) {
              assignmentMap.set(assignment.activity_name, assignment);
            }

            // Merge assignments into activities
            project.project_activities_list = project.project_activities_list.map(activity => {
              const assignment = assignmentMap.get(activity.name);
              if (assignment) {
                return {
                  ...activity,
                  assigned_user: assignment.user_id ? String(assignment.user_id) : activity.assigned_user || '',
                  due_date: assignment.due_date || activity.due_date || '',
                  priority: assignment.priority || activity.priority || 'MEDIUM'
                };
              }
              return activity;
            });
          }
        }
      } catch (assignErr) {
        console.warn('Could not merge activity assignments:', assignErr.message || assignErr);
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
  } finally {
    if (db) {
      try {
        await db.end();
      } catch (e) {
        console.warn('Error releasing DB connection in GET /api/projects/[id]:', e?.message || e);
      }
    }
  }
}

// PUT - Update project
export async function PUT(request, context) {
  let db = null;
  let retries = 0;
  const maxRetries = 2;
  
  // Parse request data once outside the loop
  const { id } = await context.params;
  const data = await request.json();
  
  // Write debug info to file
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const debugInfo = {
    timestamp: new Date().toISOString(),
    projectId: id,
    dataKeys: Object.keys(data),
    documents_issued_list_type: typeof data.documents_issued_list,
    documents_issued_list_value: data.documents_issued_list,
    documents_issued_list_length: data.documents_issued_list?.length,
    project_handover_list_type: typeof data.project_handover_list,
    project_handover_list_value: data.project_handover_list,
    project_handover_list_length: data.project_handover_list?.length,
    input_documents_list_type: typeof data.input_documents_list,
    input_documents_list_value: data.input_documents_list,
    input_documents_list_length: data.input_documents_list?.length
  };
  fs.writeFileSync('/tmp/project-update-debug.json', JSON.stringify(debugInfo, null, 2));
  
  console.log('[PUT] ===== REQUEST DATA RECEIVED =====');
  console.log('[PUT] Project ID:', id);
  console.log('[PUT] Data keys:', Object.keys(data));
  console.log('[PUT] documents_issued_list type:', typeof data.documents_issued_list);
  console.log('[PUT] documents_issued_list value:', data.documents_issued_list);
  console.log('[PUT] documents_issued_list length:', data.documents_issued_list?.length);
  console.log('[PUT] =====================================');
  
  while (retries <= maxRetries) {
    try {
      console.log('PUT /api/projects/[id] - Start update for project:', id, 'Attempt:', retries + 1);
      console.log('PUT /api/projects/[id] - Data fields:', { 
        company_id: data.company_id, 
        client_name: data.client_name, 
        name: data.name,
        hasTeamMembers: !!data.team_members,
        hasProjectActivities: !!data.project_activities_list
      });
      
      console.log('PUT /api/projects/[id] - Attempting database connection...');
      
      // Get fresh connection for retry attempts
      if (db) {
        try {
          await db.end();
        } catch (e) {
          console.warn('Error releasing old connection:', e.message);
        }
        db = null;
      }
      
      db = await dbConnect();
      console.log('PUT /api/projects/[id] - Database connected successfully');

    // Inspect schema to determine the primary key column
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
      // Fallback to common primary key names
      pkCol = 'project_id';
    }

    // If no primary key found, default to 'project_id'
    if (!pkCol) {
      pkCol = 'project_id';
    }

    // Resolve the project using the primary key
    let projectId = null;
    if (/^\d+$/.test(id)) {
      projectId = parseInt(id, 10);
    } else {
      try {
        const [lookup] = await db.execute(`SELECT ${pkCol} FROM projects WHERE project_id = ?`, [id]);
        if (lookup && lookup.length > 0) {
          projectId = lookup[0][pkCol];
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
      additional_scope,
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
      next_internal_meeting,
      project_team
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
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id INT');

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
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS additional_scope TEXT');
      
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
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_team TEXT');
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
      // NOTE: project_id is the primary key and should NOT be updated here.
      // Updating it would violate foreign key constraints (e.g., user_activity_assignments).
      // The project_id is used to identify the record via the WHERE clause, not to be changed.
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
      ['additional_scope', additional_scope === undefined ? null : additional_scope],
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
      ['next_internal_meeting', normalizeDate(next_internal_meeting)],
      ['project_team', project_team === undefined ? null : project_team]
    ];

    const setParts = [];
    const queryParams = [];
    for (const [col, val] of fieldValues) {
      if (existingCols.has(col)) {
        setParts.push(`${col} = COALESCE(?, ${col})`);
        queryParams.push(val);
      }
    }

    // Always update updated_at
    setParts.push('updated_at = CURRENT_TIMESTAMP');

    const sql = `UPDATE projects SET ${setParts.join(', ')} WHERE ${pkCol} = ?`;
    queryParams.push(projectId);

    console.log('PUT /api/projects/[id] - Executing UPDATE with', setParts.length, 'fields');
    const [result] = await db.execute(sql, queryParams);
    console.log('PUT /api/projects/[id] - UPDATE executed, affected rows:', result.affectedRows);

    // Ensure columns exist to store assigned disciplines/activities/assignments and per-discipline descriptions
    try {
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_disciplines TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_activities TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS discipline_descriptions TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assignments JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_members JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS software_items JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_activities_list JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS planning_activities_list JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS documents_list JSON');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS input_documents_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS kickoff_meetings_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS internal_meetings_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS documents_received_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS documents_issued_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_handover_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_manhours_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_query_log_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_assumption_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_lessons_learnt_list TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_schedule_list TEXT');
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
      const softwareItems = data.software_items || null;
      const projectActivitiesList = data.project_activities_list || null;
      const planningActivitiesList = data.planning_activities_list || null;
      const documentsList = data.documents_list || null;
      const inputDocumentsList = data.input_documents_list || null;
      const kickoffMeetingsList = data.kickoff_meetings_list || null;
      const internalMeetingsList = data.internal_meetings_list || null;
      const documentsReceivedList = data.documents_received_list || null;
      const documentsIssuedList = data.documents_issued_list || null;
      const projectHandoverList = data.project_handover_list || null;
      const projectManhoursList = data.project_manhours_list || null;
      const projectQueryLogList = data.project_query_log_list || null;
      const projectAssumptionList = data.project_assumption_list || null;
      const projectLessonsLearntList = data.project_lessons_learnt_list || null;
      const projectScheduleList = data.project_schedule_list || null;

      console.log('[PUT] List fields received:', {
        documentsReceivedList: documentsReceivedList ? `${documentsReceivedList.substring(0, 50)}...` : 'null',
        documentsIssuedList: documentsIssuedList ? `${documentsIssuedList.substring(0, 50)}...` : 'null',
        projectHandoverList: projectHandoverList ? `${projectHandoverList.substring(0, 50)}...` : 'null',
        projectManhoursList: projectManhoursList ? `${projectManhoursList.substring(0, 50)}...` : 'null'
      });

      if (assignedDisciplines !== null || assignedActivities !== null || disciplineDescriptions !== null || 
          assignments !== null || teamMembers !== null || softwareItems !== null ||
          projectActivitiesList !== null || planningActivitiesList !== null || documentsList !== null ||
          inputDocumentsList !== null || kickoffMeetingsList !== null || internalMeetingsList !== null ||
          documentsReceivedList !== null || documentsIssuedList !== null || projectHandoverList !== null ||
          projectManhoursList !== null || projectQueryLogList !== null || projectAssumptionList !== null ||
          projectLessonsLearntList !== null || projectScheduleList !== null) {
        console.log('[PUT] Updating list fields in database...');
        console.log('[PUT] About to UPDATE with values:', {
          projectHandoverList: projectHandoverList?.substring(0, 100),
          projectManhoursList: projectManhoursList?.substring(0, 100),
          documentsIssuedList: documentsIssuedList?.substring(0, 100)
        });
        const updateResult = await db.execute(
          `UPDATE projects SET 
             assigned_disciplines = COALESCE(?, assigned_disciplines),
             assigned_activities = COALESCE(?, assigned_activities),
             discipline_descriptions = COALESCE(?, discipline_descriptions),
             assignments = COALESCE(?, assignments),
             team_members = COALESCE(?, team_members),
             software_items = COALESCE(?, software_items),
             project_activities_list = COALESCE(?, project_activities_list),
             planning_activities_list = COALESCE(?, planning_activities_list),
             documents_list = COALESCE(?, documents_list),
             input_documents_list = COALESCE(?, input_documents_list),
             kickoff_meetings_list = COALESCE(?, kickoff_meetings_list),
             internal_meetings_list = COALESCE(?, internal_meetings_list),
             documents_received_list = COALESCE(?, documents_received_list),
             documents_issued_list = COALESCE(?, documents_issued_list),
             project_handover_list = COALESCE(?, project_handover_list),
             project_manhours_list = COALESCE(?, project_manhours_list),
             project_query_log_list = COALESCE(?, project_query_log_list),
             project_assumption_list = COALESCE(?, project_assumption_list),
             project_lessons_learnt_list = COALESCE(?, project_lessons_learnt_list),
             project_schedule_list = COALESCE(?, project_schedule_list)
           WHERE ${pkCol} = ?`,
          [assignedDisciplines, assignedActivities, disciplineDescriptions, assignments, 
           teamMembers, softwareItems, projectActivitiesList, planningActivitiesList, documentsList, inputDocumentsList,
           kickoffMeetingsList, internalMeetingsList, documentsReceivedList, documentsIssuedList, projectHandoverList, projectManhoursList,
           projectQueryLogList, projectAssumptionList, projectLessonsLearntList, projectScheduleList, projectId]
        );
        console.log('[PUT] List fields update result:', updateResult[0].affectedRows, 'rows affected');
      } else {
        console.log('[PUT] No list fields to update (all null)');
      }
    } catch (err) {
      console.error('Failed to persist project discipline/activity/assignment/team data:', err);
    }

    // Sync activity assignments to user_activity_assignments table
    if (data.project_activities_list) {
      try {
        const activities = typeof data.project_activities_list === 'string' 
          ? JSON.parse(data.project_activities_list) 
          : data.project_activities_list;

        if (Array.isArray(activities)) {
          // First, delete existing assignments for this project
          await db.execute(
            'DELETE FROM user_activity_assignments WHERE project_id = ?',
            [projectId]
          );

          // Insert new assignments for activities that have assigned_user
          for (const activity of activities) {
            if (activity.assigned_user && activity.assigned_user !== '') {
              const userId = parseInt(activity.assigned_user);
              if (!isNaN(userId)) {
                // Use activity_name (frontend field) with fallback to name
                const activityName = activity.activity_name || activity.name || '';
                const subActivityName = activity.sub_activity_name || '';
                const fullActivityName = subActivityName ? `${activityName} - ${subActivityName}` : activityName;
                
                // Map priority to table's enum values
                const priorityMap = {
                  'LOW': 'Low',
                  'MEDIUM': 'Medium', 
                  'HIGH': 'High',
                  'URGENT': 'Critical'
                };
                const priority = priorityMap[activity.priority] || 'Medium';
                
                // Map status to table's enum values
                const statusMap = {
                  'NOT_STARTED': 'Not Started',
                  'IN_PROGRESS': 'In Progress',
                  'ON_HOLD': 'On Hold',
                  'COMPLETED': 'Completed',
                  'CANCELLED': 'Cancelled'
                };
                const status = statusMap[activity.status_completed] || 'Not Started';
                
                // Generate UUID for id
                const activityId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                await db.execute(
                  `INSERT INTO user_activity_assignments 
                   (id, user_id, project_id, activity_name, discipline_name, due_date, priority, estimated_hours, status, notes, assigned_date, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
                  [
                    activityId,
                    userId,
                    projectId,
                    fullActivityName,
                    activity.function_name || activity.discipline || '',
                    activity.due_date || null,
                    priority,
                    parseFloat(activity.planned_hours) || 0,
                    status,
                    activity.deliverables || activity.remarks || ''
                  ]
                );
              }
            }
          }
        }
      } catch (syncErr) {
        console.error('Failed to sync activity assignments:', syncErr);
        // Non-fatal - continue with success response
      }
    }

    await db.end();
    console.log('PUT /api/projects/[id] - Database connection closed');

    if (result.affectedRows === 0) {
      console.warn('PUT /api/projects/[id] - No rows affected, project not found');
      return Response.json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }

    console.log('PUT /api/projects/[id] - SUCCESS - Project updated');
    return Response.json({ 
      success: true, 
      message: 'Project updated successfully' 
    });
    
  } catch (error) {
    console.error('PUT /api/projects/[id] - CAUGHT ERROR on attempt', retries + 1);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error details:', {
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    
    // Check if it's a retryable error (connection issues)
    const isRetryable = error.code === 'ETIMEDOUT' || 
                       error.code === 'ECONNRESET' || 
                       error.code === 'PROTOCOL_CONNECTION_LOST' ||
                       error.message?.includes('connection is in closed state');
    
    // Ensure DB connection is closed before retry
    if (db) {
      try {
        await db.end();
        console.log('PUT /api/projects/[id] - Database connection closed after error');
      } catch (closeErr) {
        console.error('PUT /api/projects/[id] - Failed to close DB connection:', closeErr.message);
      }
      db = null;
    }
    
    // Retry for connection errors
    if (isRetryable && retries < maxRetries) {
      console.log('PUT /api/projects/[id] - Retrying due to connection error...');
      retries++;
      await new Promise(resolve => setTimeout(resolve, 500 * retries)); // Exponential backoff
      continue; // Retry the while loop
    }
    
    // Non-retryable error or max retries reached
    return Response.json({ 
      success: false, 
      error: 'Failed to update project',
      details: error.message || 'Unknown error',
      sqlMessage: error.sqlMessage || null
    }, { status: 500 });
  }
  } // End of while loop
  
  // Should never reach here, but just in case
  return Response.json({ 
    success: false, 
    error: 'Failed to update project after retries'
  }, { status: 500 });
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