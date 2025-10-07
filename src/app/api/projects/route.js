import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

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
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_date DATE');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255)');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT \'ONGOING\'');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS proposal_id INT');
      await db.execute('ALTER TABLE projects ADD COLUMN IF NOT EXISTS assignments JSON');
      await db.execute('ALTER TABLE projects ADD FOREIGN KEY IF NOT EXISTS (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL');

      // Update enum fields to use VARCHAR instead for more flexibility
      await db.execute('ALTER TABLE projects MODIFY COLUMN status VARCHAR(50) DEFAULT \'NEW\'');
      await db.execute('ALTER TABLE projects MODIFY COLUMN priority VARCHAR(50) DEFAULT \'MEDIUM\'');
      await db.execute('ALTER TABLE projects MODIFY COLUMN type VARCHAR(50) DEFAULT \'ONGOING\'');
    } catch (err) {
      console.warn('Some ALTER TABLE statements failed, table might already be updated:', err);
    }
    
    const [rows] = await db.execute(`
      SELECT 
        p.*,
        c.company_name
      FROM projects p
      LEFT JOIN companies c ON p.company_id = c.id
      ORDER BY p.created_at DESC
    `);
    
    await db.end();
    
    return NextResponse.json({ 
      success: true, 
      data: rows 
    });
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
      notes
    } = data;

    if (!name || !company_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Project name and company are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
    // Fetch company name from company_id
    const [companyRows] = await db.execute(
      'SELECT company_name FROM companies WHERE id = ?',
      [company_id]
    );
    
    if (companyRows.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Selected company not found' 
      }, { status: 400 });
    }
    
    const client_name = companyRows[0].company_name;
    
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
    
    // Insert the new project (include activities/disciplines JSON)
    const [result] = await db.execute(
      `INSERT INTO projects (
        project_id, name, description, company_id, client_name, project_manager,
        start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes,
        activities, disciplines, discipline_descriptions, assignments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId, name, description, company_id || null, client_name, project_manager || null,
        start_date || null, end_date || null, target_date || null, budget || null, assigned_to || null,
        status || 'NEW', type || 'ONGOING', priority || 'MEDIUM', progress || 0, proposal_id || null, notes || null,
        JSON.stringify(data.activities || []), JSON.stringify(data.disciplines || []), JSON.stringify(data.discipline_descriptions || {}), JSON.stringify(data.assignments || [])
      ]
    );
    
    // Get the created project
    const [newProject] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [result.insertId]
    );
    
    await db.end();
    
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
      proposal_id
    } = data;

    if (!id || !name || !company_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'ID, project name and company are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
    // Fetch company name from company_id
    const [companyRows] = await db.execute(
      'SELECT company_name FROM companies WHERE id = ?',
      [company_id]
    );
    
    if (companyRows.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Selected company not found' 
      }, { status: 400 });
    }
    
    const client_name = companyRows[0].company_name;
    
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

    // Update project (including manhours and cost_breakup)
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
        assignments = ?
      WHERE id = ?`,
      [
        name,
        description,
        company_id || null,
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
        id
      ]
    );
    
    // Get the updated project
    const [updatedProject] = await db.execute(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );
    
    await db.end();
    
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

    // Delete project
    await db.execute(
      'DELETE FROM projects WHERE id = ?',
      [id]
    );
    
    await db.end();
    
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
