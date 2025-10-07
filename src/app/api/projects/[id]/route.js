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
      type,
      start_date,
      end_date,
      target_date,
      progress,
      status,
      assigned_to
    } = data;

    const db = await dbConnect();
    
    // Update only provided fields using COALESCE
    const [result] = await db.execute(`
      UPDATE projects SET 
        name = COALESCE(?, name),
        type = COALESCE(?, type),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        target_date = COALESCE(?, target_date),
        progress = COALESCE(?, progress),
        status = COALESCE(?, status),
        assigned_to = COALESCE(?, assigned_to)
      WHERE id = ?
    `, [
      name === undefined ? null : name,
      type === undefined ? null : type,
      start_date === undefined ? null : start_date,
      end_date === undefined ? null : end_date,
      target_date === undefined ? null : target_date,
      progress === undefined ? null : progress,
      status === undefined ? null : status,
      assigned_to === undefined ? null : assigned_to,
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