import { dbConnect } from '@/utils/database';

// GET follow-ups for a specific project
export async function GET(request, { params }) {
  let db;
  try {
    const { id } = await params;
    
    if (!id) {
      return Response.json({ success: false, error: 'Project ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Ensure table exists with project-specific fields
    await db.execute(`
      CREATE TABLE IF NOT EXISTS project_followups (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type VARCHAR(50) DEFAULT 'Internal Review',
        description TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Scheduled',
        priority VARCHAR(20) DEFAULT 'Medium',
        milestone VARCHAR(255),
        responsible_person VARCHAR(255),
        action_items TEXT,
        outcome TEXT,
        next_action VARCHAR(255),
        next_follow_up_date DATE,
        blockers TEXT,
        notes TEXT,
        logged_by VARCHAR(255),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        INDEX idx_follow_up_date (follow_up_date),
        INDEX idx_status (status)
      )
    `);
    
    // Add logged_by column if it doesn't exist
    await db.execute(`
      ALTER TABLE project_followups 
      ADD COLUMN IF NOT EXISTS logged_by VARCHAR(255) AFTER notes
    `).catch(() => {});

    // Get follow-ups for this project
    const [rows] = await db.execute(
      `SELECT * FROM project_followups 
       WHERE project_id = ? 
       ORDER BY follow_up_date DESC, created_at DESC`,
      [id]
    );

    return Response.json({ success: true, data: rows });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to fetch follow-ups' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// POST - Create new follow-up for a project
export async function POST(request, { params }) {
  let db;
  try {
    const { id } = await params;
    const data = await request.json();
    
    if (!id) {
      return Response.json({ success: false, error: 'Project ID is required' }, { status: 400 });
    }

    const {
      follow_up_date,
      follow_up_type,
      description,
      status,
      priority,
      milestone,
      responsible_person,
      action_items,
      outcome,
      next_action,
      next_follow_up_date,
      blockers,
      notes,
      logged_by,
      created_by
    } = data;

    if (!follow_up_date || !description) {
      return Response.json({ success: false, error: 'Follow-up date and description are required' }, { status: 400 });
    }

    db = await dbConnect();

    const [result] = await db.execute(
      `INSERT INTO project_followups 
        (project_id, follow_up_date, follow_up_type, description, status, priority, milestone, 
         responsible_person, action_items, outcome, next_action, next_follow_up_date, blockers, notes, logged_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        follow_up_date,
        follow_up_type || 'Internal Review',
        description,
        status || 'Scheduled',
        priority || 'Medium',
        milestone || null,
        responsible_person || null,
        action_items || null,
        outcome || null,
        next_action || null,
        next_follow_up_date || null,
        blockers || null,
        notes || null,
        logged_by || null,
        created_by || null
      ]
    );

    return Response.json({ 
      success: true, 
      message: 'Follow-up created successfully',
      id: result.insertId 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to create follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// PUT - Update existing follow-up
export async function PUT(request, { params }) {
  let db;
  try {
    const { id: projectId } = await params;
    const data = await request.json();
    
    if (!projectId) {
      return Response.json({ success: false, error: 'Project ID is required' }, { status: 400 });
    }

    const { id: followupId, ...updateFields } = data;

    if (!followupId) {
      return Response.json({ success: false, error: 'Follow-up ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Build dynamic update query
    const allowedFields = [
      'follow_up_date', 'follow_up_type', 'description', 'status', 'priority',
      'milestone', 'responsible_person', 'action_items', 'outcome', 
      'next_action', 'next_follow_up_date', 'blockers', 'notes', 'logged_by'
    ];
    
    const updates = [];
    const values = [];
    
    for (const field of allowedFields) {
      if (updateFields[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(updateFields[field] || null);
      }
    }

    if (updates.length === 0) {
      return Response.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    values.push(followupId, projectId);

    await db.execute(
      `UPDATE project_followups SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`,
      values
    );

    return Response.json({ success: true, message: 'Follow-up updated successfully' });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to update follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}

// DELETE - Delete a follow-up
export async function DELETE(request, { params }) {
  let db;
  try {
    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const followupId = searchParams.get('followup_id');
    
    if (!projectId) {
      return Response.json({ success: false, error: 'Project ID is required' }, { status: 400 });
    }

    if (!followupId) {
      return Response.json({ success: false, error: 'Follow-up ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    await db.execute(
      'DELETE FROM project_followups WHERE id = ? AND project_id = ?',
      [followupId, projectId]
    );

    return Response.json({ success: true, message: 'Follow-up deleted successfully' });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ success: false, error: 'Failed to delete follow-up' }, { status: 500 });
  } finally {
    if (db) await db.end();
  }
}
