import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { logActivity } from '@/utils/activity-logger';

// GET all projects
export async function GET() {
  try {
    const db = await dbConnect();
    
    // Create projects table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id VARCHAR(50) UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        company_id INT,
        client_name VARCHAR(255),
        project_manager VARCHAR(255),
        start_date DATE,
        end_date DATE,
        budget DECIMAL(15,2),
        status VARCHAR(50) DEFAULT 'NEW',
        priority VARCHAR(50) DEFAULT 'MEDIUM',
        progress INT DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      )
    `);

    // Add new columns if they don't exist
    try {
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_date DATE');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT \'ONGOING\'');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS proposal_id INT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assignments JSON');
      
      // Add new project fields requested by user
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_schedule TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS input_document TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS list_of_deliverables TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS kickoff_meeting TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS in_house_meeting TEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_assumption_list LONGTEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_lessons_learnt_list LONGTEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS software_items LONGTEXT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_team TEXT');
      
      await db.execute('ALTER TABLE projects ADD FOREIGN KEY IF NOT EXISTS (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL');

      // Update enum fields to use VARCHAR instead for more flexibility
      // Only run MODIFY if the column exists to avoid errors on older/newer schemas
      try {
        const [enumCols] = await db.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME IN ('status','priority','type')`
        );
        const existingEnums = new Set((enumCols || []).map(c => c.COLUMN_NAME));
        if (existingEnums.has('status')) {
          await db.execute("ALTER TABLE projects MODIFY COLUMN status VARCHAR(50) DEFAULT 'NEW'");
        }
        if (existingEnums.has('priority')) {
          await db.execute("ALTER TABLE projects MODIFY COLUMN priority VARCHAR(50) DEFAULT 'MEDIUM'");
        }
        if (existingEnums.has('type')) {
          await db.execute("ALTER TABLE projects MODIFY COLUMN type VARCHAR(50) DEFAULT 'ONGOING'");
        }
      } catch (modifyErr) {
        console.warn('Skipping MODIFY COLUMN for enum fields due to schema inspection error:', modifyErr?.message || modifyErr);
      }
    } catch (err) {
      console.warn('Some ALTER TABLE statements failed, table might already be updated:', err);
    }
    
    // Attempt to join companies only if company_id column truly exists; fallback safely if missing
    let rows;
    let hasCompanyId = false;
    try {
      const [cols] = await db.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
      );
      hasCompanyId = Array.isArray(cols) && cols.some(c => c.COLUMN_NAME === 'company_id');
    } catch (inspectErr) {
      console.warn('Could not inspect projects table for company_id column:', inspectErr?.message || inspectErr);
      hasCompanyId = false;
    }

    if (hasCompanyId) {
      try {
        const [r] = await db.execute(`
          SELECT p.*, c.company_name
          FROM projects p
          LEFT JOIN companies c ON p.company_id = c.id
          ORDER BY p.created_at DESC
        `);
        rows = r;
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
    
    await db.end();
    
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Projects GET error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch projects',
      details: error.message 
    }, { status: 500 });
  }
}

// POST - Create new project
export async function POST(request) {
  try {
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

    if (!name || (!company_id && !proposal_id && !data.client_name)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Project name and company (company_id, client_name, or linked proposal) are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
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
        await db.end();
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
        await db.end();
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
    
    await db.end();
    
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
  }
}

// PUT - Update project
export async function PUT(request) {
  try {
    const data = await request.json();
    const {
      id,
      name,
      description,
      company_id,
      project_manager,
      start_date,
      end_date,
      target_date,
      budget,
      status,
      priority,
      progress,
      notes,
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

    if (!id || !name) {
      return NextResponse.json({ 
        success: false, 
        error: 'ID and project name are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

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

    // Ensure we have either a company id OR a client name
    if (!effectiveCompanyId && !effectiveClientName) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Company is required (provide company_id, client_name, or link a proposal with a company)' 
      }, { status: 400 });
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
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Project not found' 
      }, { status: 404 });
    }

    // Update project (including manhours and cost_breakup and new fields)
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
        budget = ?,
        status = ?,
        priority = ?,
        progress = ?,
        notes = ?,
        assigned_to = ?,
        type = ?,
        proposal_id = ?,
        activities = ?,
        disciplines = ?,
        discipline_descriptions = ?,
        assignments = ?,
        project_schedule = ?,
        input_document = ?,
        list_of_deliverables = ?,
        kickoff_meeting = ?,
        in_house_meeting = ?
        ,project_assumption_list = ?,
        project_lessons_learnt_list = ?
      WHERE id = ?`,
      [
        name,
        description,
  effectiveCompanyId || null,
        client_name,
        project_manager || null,
        start_date || null,
        end_date || null,
        target_date || null,
        budget || null,
        status || 'planning',
        priority || 'medium',
        progress || 0,
        notes || null,
        assigned_to || null,
        type || 'ONGOING',
        proposal_id || null,
        JSON.stringify(data.activities || []),
        JSON.stringify(data.disciplines || []),
        JSON.stringify(data.discipline_descriptions || {}),
        JSON.stringify(data.assignments || []),
        project_schedule || null,
        input_document || null,
        list_of_deliverables || null,
        kickoff_meeting || null,
        in_house_meeting || null,
        data.project_assumption_list ? (typeof data.project_assumption_list === 'string' ? data.project_assumption_list : JSON.stringify(data.project_assumption_list)) : null,
        data.project_lessons_learnt_list ? (typeof data.project_lessons_learnt_list === 'string' ? data.project_lessons_learnt_list : JSON.stringify(data.project_lessons_learnt_list)) : null,
        id
      ]
    );
    
    // Get the updated project
    const [updatedProject] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );
    
    await db.end();
    
    // Log the activity
    logActivity({
      actionType: 'update',
      resourceType: 'project',
      resourceId: id.toString(),
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
  }
}

// DELETE - Delete project
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Project ID is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    // Inspect projects columns to determine a suitable key column to use for lookup/delete
    let keyCol = null;
    try {
      const [pkRows] = await db.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'PRIMARY'`
      );
      const [cols] = await db.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
      );
      const existing = new Set((cols || []).map(c => c.COLUMN_NAME));

      if (existing.has('id')) keyCol = 'id';
      else if (existing.has('project_id')) keyCol = 'project_id';
      else if (existing.has('project_code')) keyCol = 'project_code';
      else if (pkRows && pkRows.length > 0 && pkRows[0].COLUMN_NAME) keyCol = pkRows[0].COLUMN_NAME;
      else keyCol = null;
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
      await db.end();
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Delete project using the resolved key
    await db.execute(`DELETE FROM projects WHERE ${keyCol} = ?`, [id]);

    await db.end();
    
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
  }
}
