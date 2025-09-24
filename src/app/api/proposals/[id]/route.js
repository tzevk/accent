import { dbConnect } from '@/utils/database';

// GET specific proposal
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const proposalId = parseInt(id);
    
    const db = await dbConnect();
    
    const [rows] = await db.execute(
      'SELECT * FROM proposals WHERE id = ?',
      [proposalId]
    );
    
    await db.end();
    
    if (rows.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'Proposal not found' 
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
      error: 'Failed to fetch proposal' 
    }, { status: 500 });
  }
}

// PUT - Update proposal
export async function PUT(request, context) {
  try {
    const { id } = await context.params;
    const proposalId = parseInt(id);
    const data = await request.json();
    
    const {
      title,
      value,
      due_date,
      notes,
      status
    } = data;

    const db = await dbConnect();
    
    // Ensure undefined => null for SQL parameters (mysql2 forbids undefined)
    // Normalize parameters: mysql2 rejects `undefined`; also convert empty date strings to null
    const normalizedDueDate = (due_date === undefined || (typeof due_date === 'string' && due_date.trim() === '')) ? null : due_date;

    const params = [
      title === undefined ? null : title,
      value === undefined ? null : value,
      normalizedDueDate,
      notes === undefined ? null : notes,
      status === undefined ? null : status,
      proposalId
    ];

    // Update the proposal
    const [result] = await db.execute(
      `UPDATE proposals SET 
        title = COALESCE(?, title),
        value = COALESCE(?, value),
        due_date = COALESCE(?, due_date),
        notes = COALESCE(?, notes),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      params
    );
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Proposal not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Proposal updated successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to update proposal' 
    }, { status: 500 });
  }
}

// DELETE proposal
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const proposalId = parseInt(id);
    
    const db = await dbConnect();
    
    const [result] = await db.execute(
      'DELETE FROM proposals WHERE id = ?',
      [proposalId]
    );
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Proposal not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Proposal deleted successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to delete proposal' 
    }, { status: 500 });
  }
}
