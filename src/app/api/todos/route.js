import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

// Ensure todos table exists
async function ensureTodosTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS todos (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT DEFAULT NULL,
      priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
      status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
      due_date DATE DEFAULT NULL,
      completed_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_due_date (due_date)
    )
  `);
}

/**
 * GET /api/todos
 * Fetch todos for the current user
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    db = await dbConnect();
    await ensureTodosTable(db);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const showCompleted = searchParams.get('show_completed') === 'true';

    let whereClause = 'user_id = ?';
    const params = [currentUser.id];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    } else if (!showCompleted) {
      whereClause += ' AND status != "completed"';
    }

    const [todos] = await db.execute(
      `SELECT * FROM todos WHERE ${whereClause} ORDER BY 
        CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        CASE status WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 WHEN 'completed' THEN 3 END,
        due_date ASC,
        created_at DESC`,
      params
    );

    await db.end();

    return NextResponse.json({
      success: true,
      data: todos
    });
  } catch (error) {
    console.error('Error fetching todos:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to fetch todos' }, { status: 500 });
  }
}

/**
 * POST /api/todos
 * Create a new todo
 */
export async function POST(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const { title, description, priority, due_date } = data;

    if (!title || !title.trim()) {
      return NextResponse.json({ 
        success: false, 
        error: 'Title is required' 
      }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTodosTable(db);

    const [result] = await db.execute(
      `INSERT INTO todos (user_id, title, description, priority, due_date)
       VALUES (?, ?, ?, ?, ?)`,
      [
        currentUser.id,
        title.trim(),
        description?.trim() || null,
        priority || 'medium',
        due_date || null
      ]
    );

    const [newTodo] = await db.execute(
      'SELECT * FROM todos WHERE id = ?',
      [result.insertId]
    );

    await db.end();

    return NextResponse.json({
      success: true,
      data: newTodo[0],
      message: 'Todo created'
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating todo:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to create todo' }, { status: 500 });
  }
}

/**
 * PUT /api/todos
 * Update a todo
 */
export async function PUT(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const { id, title, description, priority, status, due_date } = data;

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Todo ID is required' 
      }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTodosTable(db);

    // Verify ownership
    const [existing] = await db.execute(
      'SELECT * FROM todos WHERE id = ? AND user_id = ?',
      [id, currentUser.id]
    );

    if (existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Todo not found' }, { status: 404 });
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description?.trim() || null);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      params.push(priority);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
      if (status === 'completed') {
        updates.push('completed_at = NOW()');
      } else {
        updates.push('completed_at = NULL');
      }
    }
    if (due_date !== undefined) {
      updates.push('due_date = ?');
      params.push(due_date || null);
    }

    if (updates.length > 0) {
      params.push(id, currentUser.id);
      await db.execute(
        `UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        params
      );
    }

    const [updatedTodo] = await db.execute(
      'SELECT * FROM todos WHERE id = ?',
      [id]
    );

    await db.end();

    return NextResponse.json({
      success: true,
      data: updatedTodo[0],
      message: 'Todo updated'
    });
  } catch (error) {
    console.error('Error updating todo:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to update todo' }, { status: 500 });
  }
}

/**
 * DELETE /api/todos
 * Delete a todo
 */
export async function DELETE(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Todo ID is required' 
      }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTodosTable(db);

    const [result] = await db.execute(
      'DELETE FROM todos WHERE id = ? AND user_id = ?',
      [id, currentUser.id]
    );

    await db.end();

    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Todo not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Todo deleted'
    });
  } catch (error) {
    console.error('Error deleting todo:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to delete todo' }, { status: 500 });
  }
}
