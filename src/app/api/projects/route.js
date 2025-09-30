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
      name,
      description,
      company_id,
      client_name,
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

    if (!name || !client_name) {
      return NextResponse.json({ 
        success: false, 
        error: 'Project name and client name are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    
    // Generate project ID
    const [lastProject] = await db.execute(
      'SELECT project_id FROM projects ORDER BY id DESC LIMIT 1'
    );
    
    let projectId;
    if (lastProject.length > 0 && lastProject[0].project_id) {
      const lastId = parseInt(lastProject[0].project_id.replace('PRJ', ''));
      projectId = `PRJ${String(lastId + 1).padStart(5, '0')}`;
    } else {
      projectId = 'PRJ00001';
    }
    
    // Insert the new project (include manhours and cost_breakup)
    const [result] = await db.execute(
      `INSERT INTO projects (
        project_id, name, description, company_id, client_name, project_manager,
        start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId, name, description, company_id || null, client_name, project_manager || null,
        start_date || null, end_date || null, target_date || null, budget || null, assigned_to || null,
        status || 'NEW', type || 'ONGOING', priority || 'MEDIUM', progress || 0, proposal_id || null, notes || null
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
      client_name,
      project_manager,
      start_date,
      end_date,
      budget,
      manhours,
      cost_breakup,
      status,
      priority,
      progress,
      notes
    } = data;

    if (!id || !name || !client_name) {
      return NextResponse.json({ 
        success: false, 
        error: 'ID, project name and client name are required' 
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

    // Update project (including manhours and cost_breakup)
    await db.execute(
      `UPDATE projects SET 
        name = ?, description = ?, company_id = ?, client_name = ?, project_manager = ?,
        start_date = ?, end_date = ?, budget = ?, manhours = ?, cost_breakup = ?, status = ?, priority = ?, progress = ?, notes = ?
      WHERE id = ?`,
      [
        name, description, company_id || null, client_name, project_manager || null,
        start_date || null, end_date || null, budget || null,
        manhours || null,
        cost_breakup ? JSON.stringify(cost_breakup) : null,
        status || 'planning',
        priority || 'medium', progress || 0, notes || null, id
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
