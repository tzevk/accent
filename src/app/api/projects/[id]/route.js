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