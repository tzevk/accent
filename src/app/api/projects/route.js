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
        status ENUM('planning', 'in-progress', 'on-hold', 'completed', 'cancelled') DEFAULT 'planning',
        priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
        progress INT DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      )
    `);
    
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
      budget,
      status,
      priority,
      progress,
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
    
    // Insert the new project
    const [result] = await db.execute(
      `INSERT INTO projects (
        project_id, name, description, company_id, client_name, project_manager,
        start_date, end_date, budget, status, priority, progress, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId, name, description, company_id || null, client_name, project_manager || null,
        start_date || null, end_date || null, budget || null, status || 'planning', 
        priority || 'medium', progress || 0, notes || null
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

    // Update project
    await db.execute(
      `UPDATE projects SET 
        name = ?, description = ?, company_id = ?, client_name = ?, project_manager = ?,
        start_date = ?, end_date = ?, budget = ?, status = ?, priority = ?, progress = ?, notes = ?
      WHERE id = ?`,
      [
        name, description, company_id || null, client_name, project_manager || null,
        start_date || null, end_date || null, budget || null, status || 'planning',
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
