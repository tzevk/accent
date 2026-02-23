import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';
import { ensurePermission, RESOURCES, PERMISSIONS, getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { hasColumn, getTableColumns, getPrimaryKeyColumn } from '@/utils/schema-cache';

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

// GET all projects
export async function GET(request) {
  let db;
  try {
    // Get current user first
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Only super admins can see all projects; everyone else sees only their team's projects
    const canSeeAllProjects = user.is_super_admin;
    
    db = await dbConnect();
    
    // Use cached schema check instead of DDL on every request
    const hasCompanyId = await hasColumn(db, 'projects', 'company_id');
    let rows;

    if (hasCompanyId) {
      try {
        const [r] = await db.execute(`
          SELECT p.*, 
                 c.company_name AS linked_company_name,
                 prop.client_name AS proposal_client_name,
                 prop_c.company_name AS proposal_company_name
          FROM projects p
          LEFT JOIN companies c ON p.company_id = c.id
          LEFT JOIN proposals prop ON p.proposal_id = prop.id
          LEFT JOIN companies prop_c ON prop.company_id = prop_c.id
          ORDER BY p.created_at DESC
        `);
        // Merge client_name: prefer p.client_name, then linked_company_name, then proposal info
        rows = r.map(row => ({
          ...row,
          client_name: row.client_name || row.linked_company_name || row.proposal_client_name || row.proposal_company_name || null
        }));
      } catch (joinErr) {
        // If the join still fails due to schema drift, log and fallback
        if (String(joinErr?.message || '').includes('Unknown column') && String(joinErr?.message || '').includes('company_id')) {
          console.warn('company_id column missing during join, falling back to projects only select');
          const [r] = await db.execute(`SELECT p.* FROM projects p ORDER BY p.created_at DESC`);
          rows = r;
        } else {
          throw joinErr;
        }
      }
    } else {
      const [r] = await db.execute(`SELECT p.* FROM projects p ORDER BY p.created_at DESC`);
      rows = r;
    }

    // Filter to only projects where user is in the team (unless super admin)
    let filteredRows = rows;
    if (!canSeeAllProjects) {
      console.log('[Projects API] Filtering projects by team membership for user:', user.email);
      filteredRows = rows.filter(project => 
        isUserInProjectTeam(project.project_team, user.id, user.email)
      );
      console.log(`[Projects API] User ${user.email} can see ${filteredRows.length} out of ${rows.length} projects`);
    } else {
      console.log('[Projects API] Super admin - showing all', rows.length, 'projects');
    }
    
    return NextResponse.json({ success: true, data: filteredRows });
  } catch (error) {
    console.error('Projects GET error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch projects',
      details: error.message 
    }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// POST - Create new project
export async function POST(request) {
  let db;
  try {
    // RBAC: create projects
    const auth = await ensurePermission(request, RESOURCES.PROJECTS, PERMISSIONS.CREATE);
    if (auth instanceof Response) return auth;
    
    const data = await request.json();
    const {
      project_id,
      name,
      description,
      company_id,
      project_manager,
      start_date,
      end_date,
      target_date,
      budget,
      assigned_to,
      status,
      type,
      priority,
      progress,
      proposal_id,
      notes,
      // New fields
      project_schedule,
      input_document,
      list_of_deliverables,
      kickoff_meeting,
      in_house_meeting,
      project_team
    } = data;

    if (!name) {
      return NextResponse.json({ 
        success: false, 
        error: 'Project name is required' 
      }, { status: 400 });
    }

    db = await dbConnect();
    
  // If a proposal_id is provided, prefer company information from that proposal
  let effectiveCompanyId = company_id || null;
  // use data.client_name (may be present in payload) rather than an undefined variable
  let effectiveClientName = data.client_name || null;
  
  // Debug logging
  console.log('POST /api/projects - received data:', { 
    company_id, 
    client_name: data.client_name, 
    proposal_id,
    effectiveCompanyId,
    effectiveClientName 
  });

    if (proposal_id) {
      try {
        const [proposalRows] = await db.execute(
          'SELECT company_id, client_name FROM proposals WHERE id = ? OR proposal_id = ?',
          [proposal_id, proposal_id]
        );
        if (proposalRows && proposalRows.length > 0) {
          // Use company_id/client_name from proposal if present
          if (proposalRows[0].company_id) effectiveCompanyId = proposalRows[0].company_id;
          if (proposalRows[0].client_name) effectiveClientName = proposalRows[0].client_name;
        }
      } catch (e) {
        console.warn('Failed to lookup proposal for company override:', e?.message || e);
      }
    }

    // Fetch company name from effectiveCompanyId if available, otherwise use effectiveClientName
    let client_name = effectiveClientName;
    if (effectiveCompanyId) {
      try {
        const [companyRows] = await db.execute(
          'SELECT company_name FROM companies WHERE id = ?',
          [effectiveCompanyId]
        );
        if (companyRows.length > 0) {
          client_name = client_name || companyRows[0].company_name;
        }
      } catch (e) {
        console.warn('Failed to fetch company name:', e?.message || e);
      }
    }
    
    let projectId;
    
    // If project_id is provided manually, validate and use it
    if (project_id && project_id.trim()) {
      const trimmedId = project_id.trim();
      
      // Validate format: should be serial-month-year (e.g., 001-10-2024)
      const projectIdPattern = /^\d{3}-\d{2}-\d{4}$/;
      if (!projectIdPattern.test(trimmedId)) {

        return NextResponse.json({ 
          success: false, 
          error: 'Invalid project number format. Use format: 001-10-2024 (serial-month-year)' 
        }, { status: 400 });
      }
      
      // Check if project_id already exists
      const [existing] = await db.execute(
        'SELECT id FROM projects WHERE project_id = ?',
        [trimmedId]
      );
      
      if (existing.length > 0) {

        return NextResponse.json({ 
          success: false, 
          error: `Project number ${trimmedId} already exists` 
        }, { status: 400 });
      }
      
      projectId = trimmedId;
    } else {
      // Auto-generate project ID in format: serial-month-year (e.g., 001-10-2024)
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const currentPattern = `-${month}-${year}`;
      
      // Find highest serial number for current month/year
      const [projects] = await db.execute(
        'SELECT project_id FROM projects WHERE project_id LIKE ? ORDER BY project_id DESC',
        [`%${currentPattern}`]
      );
      
      let maxSerial = 0;
      projects.forEach(p => {
        if (p.project_id && p.project_id.endsWith(currentPattern)) {
          const serialPart = p.project_id.split('-')[0];
          const serial = parseInt(serialPart, 10);
          if (!isNaN(serial) && serial > maxSerial) {
            maxSerial = serial;
          }
        }
      });
      
      const nextSerial = String(maxSerial + 1).padStart(3, '0');
      projectId = `${nextSerial}-${month}-${year}`;
    }
    
    // Insert the new project (include activities/disciplines JSON and new fields)
    const [result] = await db.execute(
      `INSERT INTO projects (
        project_id, name, description, company_id, client_name, project_manager,
        start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes,
        activities, disciplines, discipline_descriptions, assignments,
        project_schedule, input_document, list_of_deliverables, kickoff_meeting, in_house_meeting,
        project_assumption_list, project_lessons_learnt_list, project_team
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
  projectId, name, description, effectiveCompanyId || null, client_name, project_manager || null,
        start_date || null, end_date || null, target_date || null, budget || null, assigned_to || null,
        status || 'NEW', type || 'ONGOING', priority || 'MEDIUM', progress || 0, proposal_id || null, notes || null,
        JSON.stringify(data.activities || []), JSON.stringify(data.disciplines || []), JSON.stringify(data.discipline_descriptions || {}), JSON.stringify(data.assignments || []),
        project_schedule || null, input_document || null, list_of_deliverables || null, kickoff_meeting || null, in_house_meeting || null,
        data.project_assumption_list ? (typeof data.project_assumption_list === 'string' ? data.project_assumption_list : JSON.stringify(data.project_assumption_list)) : null,
        data.project_lessons_learnt_list ? (typeof data.project_lessons_learnt_list === 'string' ? data.project_lessons_learnt_list : JSON.stringify(data.project_lessons_learnt_list)) : null,
        project_team || null
      ]
    );
    
    // Get the created project
    const [newProject] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [result.insertId]
    );

    // Log the activity
    logActivity({
      actionType: 'create',
      resourceType: 'project',
      resourceId: result.insertId.toString(),
      description: `Created project: ${name}`,
      details: {
        project_id: projectId,
        project_name: name,
        client_name: client_name,
        status: status || 'NEW'
      }
    }, request).catch(err => console.error('Failed to log activity:', err));
    
    return NextResponse.json({ 
      success: true, 
      data: newProject[0],
      message: 'Project created successfully' 
    }, { status: 201 });
  } catch (error) {
    console.error('Projects POST error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to create project',
      details: error.message 
    }, { status: 500 });
  } finally {
    if (db) try { db.release(); } catch {}
  }
}

// PUT - Update project
export async function PUT(request) {
  let db;
  try {
    const data = await request.json();
    const {
      id,
      project_id,
      name,
      description,
      company_id,
      project_manager,
      start_date,
      end_date,
      target_date,
      status,
      assigned_to,
      type,
      proposal_id,
      // New fields
      project_schedule,
      input_document,
      list_of_deliverables,
      kickoff_meeting,
      in_house_meeting
    } = data;

    // Support both id and project_id for backward compatibility
    const projectId = project_id || id;

    if (!projectId || !name) {
      return NextResponse.json({ 
        success: false, 
        error: 'ID and project name are required' 
      }, { status: 400 });
    }

    db = await dbConnect();

    // If a proposal_id is provided, prefer company information from that proposal
    let effectiveCompanyId = company_id || null;
    let effectiveClientName = null;

    if (proposal_id) {
      try {
        const [proposalRows] = await db.execute(
          'SELECT company_id, client_name FROM proposals WHERE id = ? OR proposal_id = ?',
          [proposal_id, proposal_id]
        );
        if (proposalRows && proposalRows.length > 0) {
          if (proposalRows[0].company_id) effectiveCompanyId = proposalRows[0].company_id;
          if (proposalRows[0].client_name) effectiveClientName = proposalRows[0].client_name;
        }
      } catch (e) {
        console.warn('Failed to lookup proposal for company override:', e?.message || e);
      }
    }

    // Fetch company name from effectiveCompanyId if we have it
    let client_name = effectiveClientName;
    if (effectiveCompanyId) {
      const [companyRows] = await db.execute(
        'SELECT company_name FROM companies WHERE id = ?',
        [effectiveCompanyId]
      );

      if (companyRows.length > 0) {
        client_name = client_name || companyRows[0].company_name;
      }
    }

    // Check if project exists
    const [existing] = await db.execute(
      'SELECT project_id FROM projects WHERE project_id = ?',
      [projectId]
    );

    if (existing.length === 0) {

      return NextResponse.json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }

    // Update project - only use columns that exist in the table
    await db.execute(
      `UPDATE projects SET 
        name = ?,
        description = ?,
        company_id = ?,
        client_name = ?,
        project_manager = ?,
        start_date = ?,
        end_date = ?,
        target_date = ?,
        status = ?,
        assigned_to = ?,
        type = ?,
        proposal_id = ?,
        assigned_disciplines = ?,
        assigned_activities = ?,
        discipline_descriptions = ?,
        assignments = ?,
        project_schedule = ?,
        input_document = ?,
        list_of_deliverables = ?,
        kickoff_meeting = ?,
        in_house_meeting = ?,
        project_assumption_list = ?,
        project_lessons_learnt_list = ?
      WHERE project_id = ?`,
      [
        name,
        description || null,
        effectiveCompanyId || null,
        client_name || null,
        project_manager || null,
        start_date || null,
        end_date || null,
        target_date || null,
        status || 'planning',
        assigned_to || null,
        type || 'ONGOING',
        proposal_id || null,
        JSON.stringify(data.disciplines || data.assigned_disciplines || []),
        JSON.stringify(data.activities || data.assigned_activities || []),
        JSON.stringify(data.discipline_descriptions || {}),
        JSON.stringify(data.assignments || []),
        project_schedule || null,
        input_document || null,
        list_of_deliverables || null,
        kickoff_meeting || null,
        in_house_meeting || null,
        data.project_assumption_list ? (typeof data.project_assumption_list === 'string' ? data.project_assumption_list : JSON.stringify(data.project_assumption_list)) : null,
        data.project_lessons_learnt_list ? (typeof data.project_lessons_learnt_list === 'string' ? data.project_lessons_learnt_list : JSON.stringify(data.project_lessons_learnt_list)) : null,
        projectId
      ]
    );
    
    // Get the updated project
    const [updatedProject] = await db.execute(
      'SELECT * FROM projects WHERE project_id = ?',
      [projectId]
    );

    // Log the activity
    logActivity({
      actionType: 'update',
      resourceType: 'project',
      resourceId: projectId.toString(),
      description: `Updated project: ${name}`,
      details: {
        project_id: updatedProject[0]?.project_id,
        project_name: name,
        status: status,
        updated_fields: Object.keys(data)
      }
    }, request).catch(err => console.error('Failed to log activity:', err));
    
    return NextResponse.json({ 
      success: true, 
      data: updatedProject[0],
      message: 'Project updated successfully' 
    });
  } catch (error) {
    console.error('Projects PUT error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update project',
      details: error.message 
    }, { status: 500 });
  } finally {
    if (db) try { db.release(); } catch {}
  }
}

// DELETE - Delete project
export async function DELETE(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Project ID is required' 
      }, { status: 400 });
    }

    db = await dbConnect();

    // Inspect projects columns using cached schema
    let keyCol = null;
    try {
      const existing = await getTableColumns(db, 'projects');

      if (existing.has('id')) keyCol = 'id';
      else if (existing.has('project_id')) keyCol = 'project_id';
      else if (existing.has('project_code')) keyCol = 'project_code';
      else {
        const pk = await getPrimaryKeyColumn(db, 'projects');
        keyCol = pk || null;
      }
    } catch (inspErr) {
      console.warn('Could not inspect projects table schema for DELETE, falling back to id:', inspErr?.message || inspErr);
      keyCol = 'id';
    }

    if (!keyCol) {
      try { await db.end(); } catch {}
      return NextResponse.json({ success: false, error: 'Could not determine projects primary key for deletion' }, { status: 500 });
    }

    // Check if project exists using resolved key column
    const query = `SELECT ${keyCol}, name, project_id FROM projects WHERE ${keyCol} = ?`;
    const [existing] = await db.execute(query, [id]);

    if (!existing || existing.length === 0) {

      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Delete project using the resolved key
    await db.execute(`DELETE FROM projects WHERE ${keyCol} = ?`, [id]);

    // Log the activity
    logActivity({
      actionType: 'delete',
      resourceType: 'project',
      resourceId: id,
      description: `Deleted project: ${existing[0].name}`,
      details: {
        project_id: existing[0].project_id,
        project_name: existing[0].name
      }
    }, request).catch(err => console.error('Failed to log activity:', err));
    
    return NextResponse.json({ 
      success: true, 
      message: 'Project deleted successfully' 
    });
  } catch (error) {
    console.error('Projects DELETE error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to delete project',
      details: error.message 
    }, { status: 500 });
  } finally {
    if (db) try { db.release(); } catch {}
  }
}
