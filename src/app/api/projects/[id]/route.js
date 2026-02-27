import { dbConnect } from '@/utils/database';
import { RESOURCES, PERMISSIONS, getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { getTableColumns, getPrimaryKeyColumn, invalidateCache } from '@/utils/schema-cache';

// Helper to check if user is in project team
function isUserInProjectTeam(projectTeam, userId, userEmail) {
  if (!projectTeam) return false;
  try {
    const team = typeof projectTeam === 'string' ? JSON.parse(projectTeam) : projectTeam;
    if (!Array.isArray(team)) return false;
    return team.some(member => 
      String(member.user_id) === String(userId) || 
      String(member.id) === String(userId) ||
      member.email === userEmail
    );
  } catch {
    return false;
  }
}

// GET specific project
export async function GET(request, { params }) {
  // Get current user first
  const user = await getCurrentUser(request);
  if (!user) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  
  // Only Rajesh Panchal and super admins can see all projects; everyone else must be in project team
  const isProjectAdmin = user.full_name?.toLowerCase() === 'rajesh panchal';
  const canSeeAllProjects = user.is_super_admin || isProjectAdmin;
  
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

    // Use cached schema inspection instead of INFORMATION_SCHEMA per request
    let pkCol = null;
    try {
      pkCol = await getPrimaryKeyColumn(db, 'projects');
    } catch (schemaErr) {
      console.warn('Could not inspect primary key for projects table:', schemaErr.message || schemaErr);
    }

    // Also check for presence of human-readable id columns
    let hasProjectIdCol = false;
    let hasProjectCodeCol = false;
    try {
      const cols = await getTableColumns(db, 'projects');
      hasProjectIdCol = cols.has('project_id');
      hasProjectCodeCol = cols.has('project_code');
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
    
    // Check if user is in project team (unless super admin)
    if (!canSeeAllProjects) {
      const isTeamMember = isUserInProjectTeam(project.project_team, user.id, user.email);
      if (!isTeamMember) {
        console.log(`[Projects API] User ${user.email} denied access to project ${id} - not a team member`);
        return Response.json({
          success: false,
          error: 'You do not have permission to access this project'
        }, { status: 403 });
      }
      console.log(`[Projects API] User ${user.email} granted access to project ${id} as team member`);
    }

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
        await db.release();
      } catch (e) {
        console.warn('Error releasing DB connection in GET /api/projects/[id]:', e?.message || e);
      }
    }
  }
}

// PUT - Update project
export async function PUT(request, context) {
  // Get current user first
  const user = await getCurrentUser(request);
  if (!user) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  
  // Check if user has full projects:update permission (only Rajesh Panchal and super admins)
  const isProjectAdmin = user.full_name?.toLowerCase() === 'rajesh panchal';
  const hasFullAccess = user.is_super_admin || isProjectAdmin || hasPermission(user, RESOURCES.PROJECTS, PERMISSIONS.UPDATE);
  
  let db = null;
  let retries = 0;
  const maxRetries = 2;
  
  // Parse request data once outside the loop
  const { id } = await context.params;
  const data = await request.json();
  
  while (retries <= maxRetries) {
    try {
      // Get fresh connection for retry attempts
      if (db) {
        try {
          await db.release();
        } catch (e) {
          console.warn('Error releasing old connection:', e.message);
        }
        db = null;
      }
      
      db = await dbConnect();

    // Detect primary key column using cached schema
    let pkCol = 'project_id'; // default fallback
    try {
      const cachedPk = await getPrimaryKeyColumn(db, 'projects');
      if (cachedPk) pkCol = cachedPk;
    } catch (schemaErr) {
      // Fallback to default primary key
    }

    // Resolve the project: URL param is the numeric primary key
    let projectId = null;
    if (/^\d+$/.test(id)) {
      projectId = parseInt(id, 10);
    } else {
      // If non-numeric ID provided, it might be a project_code lookup
      try {
        const [lookup] = await db.execute(`SELECT ${pkCol} FROM projects WHERE project_code = ?`, [id]);
        if (lookup && lookup.length > 0) {
          projectId = lookup[0][pkCol];
        }
      } catch (lookupErr) {
        console.warn('Project lookup by project_code failed:', lookupErr.message || lookupErr);
      }
    }

    if (projectId === null) {
      // ensure DB connection closed before returning
      try { await db.release(); } catch {}
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    
    // If user doesn't have full access, check if they're in the project team
    if (!hasFullAccess) {
      try {
        const [projectRows] = await db.execute(
          `SELECT project_team FROM projects WHERE ${pkCol} = ?`,
          [projectId]
        );
        if (projectRows && projectRows.length > 0) {
          const isTeamMember = isUserInProjectTeam(projectRows[0].project_team, user.id, user.email);
          if (!isTeamMember) {
            console.log(`[Projects API PUT] User ${user.email} denied update access to project ${id} - not a team member`);
            try { await db.release(); } catch {}
            return Response.json({
              success: false,
              error: 'You do not have permission to update this project'
            }, { status: 403 });
          }
          console.log(`[Projects API PUT] User ${user.email} granted update access to project ${id} as team member`);
        }
      } catch (teamCheckErr) {
        console.warn('Error checking team membership for PUT:', teamCheckErr.message);
      }
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
      project_team,
      // Manhours fields
      estimated_manhours,
      unit_qty,
      scope_of_work,
      deliverables,
      software_included,
      duration,
      mode_of_delivery,
      revision,
      site_visit,
      quotation_validity,
      exclusion,
      billing_and_payment_terms,
      other_terms_and_conditions
    } = data;

    
    
    // Helper function to normalize decimal/numeric fields (convert empty strings to null)
    const normalizeDecimal = (value) => {
      if (value === undefined || value === null || value === '') return null;
      return value;
    };
    
    // Helper function to normalize date fields (convert empty strings to null, objects to strings)
    const normalizeDate = (value) => {
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
      // If it's a Date object, convert to YYYY-MM-DD string
      if (value instanceof Date) {
        return value.toISOString().split('T')[0];
      }
      // If it's an object (but not Date), try to extract a date string
      if (typeof value === 'object' && value !== null) {
        console.warn('normalizeDate received object:', value);
        return null;
      }
      return value;
    };
    
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

    // Build UPDATE query - use cached column list
    let existingCols = await getTableColumns(db, 'projects');

    // Auto-create missing LONGTEXT columns for list fields that the edit page sends
    const requiredListCols = [
      'project_activities_list', 'planning_activities_list', 'documents_list',
      'input_documents_list', 'kickoff_meetings_list', 'internal_meetings_list',
      'documents_received_list', 'documents_issued_list', 'project_handover_list',
      'project_manhours_list', 'project_query_log_list', 'project_schedule_list'
    ];
    const missingCols = requiredListCols.filter(c => !existingCols.has(c));
    if (missingCols.length > 0) {
      try {
        const alterParts = missingCols.map(c => `ADD COLUMN IF NOT EXISTS \`${c}\` LONGTEXT`).join(', ');
        await db.execute(`ALTER TABLE projects ${alterParts}`);
        // Invalidate cache so getTableColumns re-fetches
        invalidateCache('projects');
        existingCols = await getTableColumns(db, 'projects');
      } catch (alterErr) {
        console.warn('Failed to auto-create list columns:', alterErr.message);
      }
    }

    // Auto-fix TEXT columns that may have been created as VARCHAR(255)
    const textCols = ['revision', 'scope_of_work', 'deliverables', 'exclusion', 'billing_and_payment_terms', 'other_terms_and_conditions', 'site_visit', 'quotation_validity', 'duration', 'mode_of_delivery'];
    for (const col of textCols) {
      if (!existingCols.has(col)) {
        try {
          await db.execute(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS \`${col}\` TEXT`);
          invalidateCache('projects');
          existingCols = await getTableColumns(db, 'projects');
        } catch (e) { /* ignore */ }
      } else {
        // Column exists - ensure it's TEXT not VARCHAR
        try {
          const [colInfo] = await db.execute(
            `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'projects' AND COLUMN_NAME = ? AND TABLE_SCHEMA = DATABASE()`,
            [col]
          );
          if (colInfo.length > 0 && colInfo[0].DATA_TYPE === 'varchar') {
            await db.execute(`ALTER TABLE projects MODIFY COLUMN \`${col}\` TEXT`);
            invalidateCache('projects');
            existingCols = await getTableColumns(db, 'projects');
          }
        } catch (e) { console.warn(`Failed to upgrade ${col} to TEXT:`, e.message); }
      }
    }

    const fieldValues = [
      ['name', name],
      // project_code stores the human-readable "Project Number" that can be edited
      ['project_code', project_id],
      ['client_name', clientNameParam],
      ['client_contact_details', client_contact_details],
      ['project_location_country', project_location_country],
      ['project_location_city', project_location_city],
      ['project_location_site', project_location_site],
      ['industry', industry],
      ['contract_type', contract_type],
      ['company_id', companyParamValue],
      ['project_manager', project_manager],
      ['type', type],
      ['start_date', normalizeDate(start_date)],
      ['end_date', normalizeDate(end_date)],
      ['target_date', normalizeDate(target_date)],
      ['project_duration_planned', normalizeDecimal(project_duration_planned)],
      ['project_duration_actual', normalizeDecimal(project_duration_actual)],
      ['budget', normalizeDecimal(budget)],
      ['progress', progress],
      ['status', status],
      ['priority', priority],
      ['assigned_to', assigned_to],
      ['description', description],
      ['additional_scope', additional_scope],
      ['notes', notes],
      ['proposal_id', (proposal_id === undefined || proposal_id === null || proposal_id === '' ) ? null : proposal_id],
      ['project_value', normalizeDecimal(project_value)],
      ['currency', currency],
      ['payment_terms', payment_terms],
      ['invoicing_status', invoicing_status],
      ['cost_to_company', normalizeDecimal(cost_to_company)],
      ['profitability_estimate', normalizeDecimal(profitability_estimate)],
      ['subcontractors_vendors', subcontractors_vendors],
      ['procurement_status', procurement_status],
      ['material_delivery_schedule', material_delivery_schedule],
      ['vendor_management', vendor_management],
      ['mobilization_date', normalizeDate(mobilization_date)],
      ['site_readiness', site_readiness],
      ['construction_progress', construction_progress],
      ['major_risks', major_risks],
      ['mitigation_plans', mitigation_plans],
      ['change_orders', change_orders],
      ['claims_disputes', claims_disputes],
      ['final_documentation_status', final_documentation_status],
      ['lessons_learned', lessons_learned],
      ['client_feedback', client_feedback],
      ['actual_profit_loss', normalizeDecimal(actual_profit_loss)],
      ['project_schedule', project_schedule],
      ['input_document', input_document],
      ['list_of_deliverables', list_of_deliverables],
      ['kickoff_meeting', kickoff_meeting],
      ['in_house_meeting', in_house_meeting],
      ['project_start_milestone', project_start_milestone],
      ['project_review_milestone', project_review_milestone],
      ['project_end_milestone', project_end_milestone],
      ['kickoff_meeting_date', normalizeDate(kickoff_meeting_date)],
      ['kickoff_followup_date', normalizeDate(kickoff_followup_date)],
      ['internal_meeting_date', normalizeDate(internal_meeting_date)],
      ['next_internal_meeting', normalizeDate(next_internal_meeting)],
      ['project_team', project_team === undefined ? null : (typeof project_team === 'object' && project_team !== null ? JSON.stringify(project_team) : project_team)],
      ['estimated_manhours', normalizeDecimal(estimated_manhours)],
      ['unit_qty', normalizeDecimal(unit_qty)],
      ['scope_of_work', scope_of_work === undefined ? null : scope_of_work],
      ['deliverables', deliverables === undefined ? null : deliverables],
      ['software_included', software_included === undefined ? null : software_included],
      ['duration', duration === undefined ? null : duration],
      ['mode_of_delivery', mode_of_delivery === undefined ? null : mode_of_delivery],
      ['revision', revision === undefined ? null : revision],
      ['site_visit', site_visit === undefined ? null : site_visit],
      ['quotation_validity', quotation_validity === undefined ? null : quotation_validity],
      ['exclusion', exclusion === undefined ? null : exclusion],
      ['billing_and_payment_terms', billing_and_payment_terms === undefined ? null : billing_and_payment_terms],
      ['other_terms_and_conditions', other_terms_and_conditions]
    ];

    // Add list fields to main UPDATE (avoid second query race condition)
    const assignedDisciplines = data.disciplines ? JSON.stringify(data.disciplines) : undefined;
    const assignedActivities = data.activities ? JSON.stringify(data.activities) : undefined;
    const disciplineDescriptions = data.discipline_descriptions ? JSON.stringify(data.discipline_descriptions) : undefined;
    const assignments = data.assignments ? JSON.stringify(data.assignments) : undefined;
    const teamMembers = data.team_members ? (typeof data.team_members === 'string' ? data.team_members : JSON.stringify(data.team_members)) : undefined;
    const softwareItems = data.software_items ? (typeof data.software_items === 'string' ? data.software_items : JSON.stringify(data.software_items)) : undefined;
    const projectActivitiesList = data.project_activities_list ? (typeof data.project_activities_list === 'string' ? data.project_activities_list : JSON.stringify(data.project_activities_list)) : undefined;
    const planningActivitiesList = data.planning_activities_list ? (typeof data.planning_activities_list === 'string' ? data.planning_activities_list : JSON.stringify(data.planning_activities_list)) : undefined;
    const documentsList = data.documents_list ? (typeof data.documents_list === 'string' ? data.documents_list : JSON.stringify(data.documents_list)) : undefined;
    const inputDocumentsList = data.input_documents_list || undefined;
    const kickoffMeetingsList = data.kickoff_meetings_list || undefined;
    const internalMeetingsList = data.internal_meetings_list || undefined;
    const documentsReceivedList = data.documents_received_list || undefined;
    const documentsIssuedList = data.documents_issued_list || undefined;
    const projectHandoverList = data.project_handover_list || undefined;
    const projectManhoursList = data.project_manhours_list || undefined;
    const projectQueryLogList = data.project_query_log_list || undefined;
    const projectAssumptionList = data.project_assumption_list || undefined;
    const projectLessonsLearntList = data.project_lessons_learnt_list || undefined;
    const projectScheduleList = data.project_schedule_list || undefined;

    const listFields = [
      ['assigned_disciplines', assignedDisciplines === undefined ? null : assignedDisciplines],
      ['assigned_activities', assignedActivities === undefined ? null : assignedActivities],
      ['discipline_descriptions', disciplineDescriptions === undefined ? null : disciplineDescriptions],
      ['assignments', assignments === undefined ? null : assignments],
      ['team_members', teamMembers === undefined ? null : teamMembers],
      ['software_items', softwareItems === undefined ? null : softwareItems],
      ['project_activities_list', projectActivitiesList === undefined ? null : projectActivitiesList],
      ['planning_activities_list', planningActivitiesList === undefined ? null : planningActivitiesList],
      ['documents_list', documentsList === undefined ? null : documentsList],
      ['input_documents_list', inputDocumentsList === undefined ? null : inputDocumentsList],
      ['kickoff_meetings_list', kickoffMeetingsList === undefined ? null : kickoffMeetingsList],
      ['internal_meetings_list', internalMeetingsList === undefined ? null : internalMeetingsList],
      ['documents_received_list', documentsReceivedList === undefined ? null : documentsReceivedList],
      ['documents_issued_list', documentsIssuedList === undefined ? null : documentsIssuedList],
      ['project_handover_list', projectHandoverList === undefined ? null : projectHandoverList],
      ['project_manhours_list', projectManhoursList === undefined ? null : projectManhoursList],
      ['project_query_log_list', projectQueryLogList === undefined ? null : projectQueryLogList],
      ['project_assumption_list', projectAssumptionList === undefined ? null : projectAssumptionList],
      ['project_lessons_learnt_list', projectLessonsLearntList === undefined ? null : projectLessonsLearntList],
      ['project_schedule_list', projectScheduleList === undefined ? null : projectScheduleList]
    ];

    // Merge list fields into main field values
    fieldValues.push(...listFields);

    const setParts = [];
    const queryParams = [];
    const paramFieldMap = []; // Track which field each param corresponds to
    
    // Only update fields that: 1) exist in schema, 2) were explicitly provided (not undefined)
    for (const [col, val] of fieldValues) {
      // Skip if column doesn't exist in database
      if (!existingCols.has(col)) {
        continue;
      }
      // Skip undefined values (field not in request) but allow null (intentional clear)
      if (val !== undefined) {
        setParts.push(`${col} = ?`);
        queryParams.push(val);
        paramFieldMap.push({ col, type: val === null ? 'null' : typeof val, isObject: typeof val === 'object' && val !== null });
      }
    }

    // Always update updated_at
    setParts.push('updated_at = CURRENT_TIMESTAMP');

    const sql = `UPDATE projects SET ${setParts.join(', ')} WHERE ${pkCol} = ?`;
    queryParams.push(projectId);

    // Validate all parameters are not undefined
    const invalidParams = queryParams.map((p, i) => ({ index: i, field: paramFieldMap[i]?.col, value: p, isUndefined: p === undefined })).filter(p => p.isUndefined);
    if (invalidParams.length > 0) {
      throw new Error('Invalid parameters: undefined values found at indices ' + invalidParams.map(p => p.index).join(', '));
    }

    let result;
    try {
      [result] = await db.execute(sql, queryParams);
    } catch (execError) {
      console.error('PUT /api/projects/[id] - Execute error:', execError.message);
      throw execError;
    }

    // Sync activity assignments to user_activity_assignments table
    if (data.project_activities_list) {
      try {
        const activities = typeof data.project_activities_list === 'string' 
          ? JSON.parse(data.project_activities_list) 
          : data.project_activities_list;

        if (Array.isArray(activities)) {
          // Auto-create missing columns in user_activity_assignments
          try {
            const uaaCols = await getTableColumns(db, 'user_activity_assignments');
            const requiredUaaCols = [
              ['description', 'TEXT'],
              ['discipline_name', 'VARCHAR(255)'],
              ['notes', 'TEXT'],
              ['assigned_date', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
              ['qty_assigned', 'DECIMAL(10,2) DEFAULT 0'],
              ['qty_completed', 'DECIMAL(10,2) DEFAULT 0'],
              ['start_date', 'DATE'],
              ['daily_entries', 'LONGTEXT'],
              ['activity_id', 'VARCHAR(100)']
            ];
            const missingUaaCols = requiredUaaCols.filter(([col]) => !uaaCols.has(col));
            if (missingUaaCols.length > 0) {
              // Add each missing column individually to avoid syntax issues across MySQL versions
              for (const [col, def] of missingUaaCols) {
                try {
                  await db.execute(`ALTER TABLE user_activity_assignments ADD COLUMN \`${col}\` ${def}`);
                } catch (addErr) {
                  // Column may already exist (race condition or cache stale) — ignore duplicate column errors
                  if (!addErr.message?.includes('Duplicate column')) {
                    console.warn(`Failed to add column ${col}:`, addErr.message);
                  }
                }
              }
              invalidateCache('user_activity_assignments');
            }
          } catch (colErr) {
            console.warn('Failed to ensure user_activity_assignments columns:', colErr.message);
          }

          // Build a map of incoming assignments: key = `${userId}-${activityId}` 
          const incomingMap = new Map();
          const allUserIds = new Set();
          
          for (const activity of activities) {
            const actId = String(activity.id || '');
            
            // Multi-user format
            if (Array.isArray(activity.assigned_users)) {
              for (const u of activity.assigned_users) {
                const uid = parseInt(typeof u === 'object' ? u.user_id : u);
                if (!isNaN(uid) && uid > 0) {
                  allUserIds.add(uid);
                  const userData = typeof u === 'object' ? u : {};
                  const activityName = activity.activity_name || activity.name || '';
                  const subActivityName = activity.sub_activity_name || '';
                  const fullActivityName = subActivityName ? `${activityName} - ${subActivityName}` : activityName;
                  
                  const priorityMap = { 'LOW': 'Low', 'MEDIUM': 'Medium', 'HIGH': 'High', 'URGENT': 'Critical' };
                  const statusMap = { 'NOT_STARTED': 'Not Started', 'IN_PROGRESS': 'In Progress', 'ON_HOLD': 'On Hold', 'COMPLETED': 'Completed', 'CANCELLED': 'Cancelled' };
                  const priority = priorityMap[activity.priority] || activity.priority || 'Medium';
                  const status = statusMap[userData.status || activity.status_completed] || userData.status || 'Not Started';

                  incomingMap.set(`${uid}-${actId}`, {
                    user_id: uid,
                    project_id: projectId,
                    activity_id: actId,
                    activity_name: fullActivityName,
                    discipline_name: activity.function_name || activity.discipline || '',
                    description: userData.description || '',
                    due_date: userData.due_date || activity.due_date || null,
                    start_date: userData.start_date || null,
                    priority,
                    estimated_hours: parseFloat(userData.planned_hours || activity.planned_hours) || 0,
                    actual_hours: parseFloat(userData.actual_hours) || 0,
                    qty_assigned: parseFloat(userData.qty_assigned) || 0,
                    qty_completed: parseFloat(userData.qty_completed) || 0,
                    status,
                    notes: userData.remarks || activity.deliverables || activity.remarks || '',
                    daily_entries: userData.daily_entries ? JSON.stringify(userData.daily_entries) : null
                  });
                }
              }
            }

            // Old single-user format
            if (activity.assigned_user && activity.assigned_user !== '') {
              const uid = parseInt(activity.assigned_user);
              if (!isNaN(uid) && uid > 0 && !incomingMap.has(`${uid}-${actId}`)) {
                allUserIds.add(uid);
                const activityName = activity.activity_name || activity.name || '';
                const priorityMap = { 'LOW': 'Low', 'MEDIUM': 'Medium', 'HIGH': 'High', 'URGENT': 'Critical' };
                const priority = priorityMap[activity.priority] || 'Medium';
                
                incomingMap.set(`${uid}-${actId}`, {
                  user_id: uid,
                  project_id: projectId,
                  activity_id: actId,
                  activity_name: activityName,
                  discipline_name: activity.function_name || activity.discipline || '',
                  description: '',
                  due_date: activity.due_date || null,
                  start_date: null,
                  priority,
                  estimated_hours: parseFloat(activity.planned_hours) || 0,
                  actual_hours: 0,
                  qty_assigned: 0,
                  qty_completed: 0,
                  status: 'Not Started',
                  notes: activity.deliverables || activity.remarks || '',
                  daily_entries: null
                });
              }
            }
          }

          // Batch verify which user IDs exist
          const validUserIds = new Set();
          if (allUserIds.size > 0) {
            const placeholders = [...allUserIds].map(() => '?').join(',');
            const [existingUsers] = await db.execute(
              `SELECT id FROM users WHERE id IN (${placeholders})`,
              [...allUserIds]
            );
            for (const row of existingUsers) validUserIds.add(row.id);
          }

          // Delete old rows for this project, then insert fresh (preserving daily_entries from JSON blob)
          await db.execute(
            'DELETE FROM user_activity_assignments WHERE project_id = ?',
            [projectId]
          );

          // Insert all valid assignments
          const batchRows = [];
          for (const [, row] of incomingMap) {
            if (!validUserIds.has(row.user_id)) continue;
            batchRows.push([
              row.user_id,
              row.project_id,
              row.activity_id,
              row.activity_name,
              row.discipline_name,
              row.description,
              row.due_date,
              row.start_date,
              row.priority,
              row.estimated_hours,
              row.actual_hours,
              row.qty_assigned,
              row.qty_completed,
              row.status,
              row.notes,
              row.daily_entries
            ]);
          }

          const BATCH_SIZE = 500;
          for (let i = 0; i < batchRows.length; i += BATCH_SIZE) {
            const batch = batchRows.slice(i, i + BATCH_SIZE);
            const valuePlaceholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())').join(',');
            const flatValues = batch.flat();
            await db.execute(
              `INSERT INTO user_activity_assignments 
               (user_id, project_id, activity_id, activity_name, discipline_name, description, due_date, start_date, priority, estimated_hours, actual_hours, qty_assigned, qty_completed, status, notes, daily_entries, assigned_date, created_at, updated_at)
               VALUES ${valuePlaceholders}`,
              flatValues
            );
          }
        }
      } catch (syncErr) {
        console.error('Failed to sync activity assignments:', syncErr);
        // Non-fatal - continue with success response
      }
    }

    await db.release();

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
    // Check if it's a retryable error (connection issues)
    const isRetryable = error.code === 'ETIMEDOUT' || 
                       error.code === 'ECONNRESET' || 
                       error.code === 'PROTOCOL_CONNECTION_LOST' ||
                       error.message?.includes('connection is in closed state');
    
    // Ensure DB connection is closed before retry
    if (db) {
      try {
        await db.release();
      } catch (closeErr) {
        // Ignore close errors
      }
      db = null;
    }
    
    // Retry for connection errors
    if (isRetryable && retries < maxRetries) {
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
    // Get current user first
    const user = await getCurrentUser(request);
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user has full projects:delete permission (only Rajesh Panchal and super admins)
    const isProjectAdmin = user.full_name?.toLowerCase() === 'rajesh panchal';
    const hasFullAccess = user.is_super_admin || isProjectAdmin || hasPermission(user, RESOURCES.PROJECTS, PERMISSIONS.DELETE);
    
    const { id } = await params;
    const projectId = parseInt(id);
    
    const db = await dbConnect();
    
    // If user doesn't have full access, check if they're in the project team
    if (!hasFullAccess) {
      const [projectRows] = await db.execute(
        'SELECT project_team FROM projects WHERE id = ?',
        [projectId]
      );
      if (projectRows && projectRows.length > 0) {
        const isTeamMember = isUserInProjectTeam(projectRows[0].project_team, user.id, user.email);
        if (!isTeamMember) {
          console.log(`[Projects API DELETE] User ${user.email} denied delete access to project ${id} - not a team member`);
          await db.release();
          return Response.json({
            success: false,
            error: 'You do not have permission to delete this project'
          }, { status: 403 });
        }
        console.log(`[Projects API DELETE] User ${user.email} granted delete access to project ${id} as team member`);
      } else {
        await db.release();
        return Response.json({ success: false, error: 'Project not found' }, { status: 404 });
      }
    }
    
    const [result] = await db.execute(
      'DELETE FROM projects WHERE id = ?',
      [projectId]
    );
    
    await db.release();
    
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