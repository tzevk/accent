import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { randomUUID } from 'crypto';

/**
 * GET /api/users/[id]/activities
 * Fetch all activities assigned to a specific user
 * 
 * Query params:
 * - status: Filter by status (Not Started, In Progress, On Hold, Completed, Cancelled)
 * - project_id: Filter by project
 * - priority: Filter by priority (Low, Medium, High, Critical)
 * - overdue: true/false - Show only overdue activities
 */
export async function GET(request, { params }) {
  try {
    const auth = await ensurePermission(request, RESOURCES.ACTIVITIES, PERMISSIONS.READ);
    if (!auth.authorized) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const requestedUserId = parseInt(id);
    const currentUser = auth.user;

    // Users can only view their own activities unless they have elevated permissions
    const canViewOthers = currentUser.is_super_admin || 
                          hasPermission(currentUser, RESOURCES.USERS, PERMISSIONS.READ);

    if (requestedUserId !== currentUser.id && !canViewOthers) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden: You can only view your own activities' 
      }, { status: 403 });
    }

    const db = await dbConnect();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const projectId = searchParams.get('project_id');
    const priority = searchParams.get('priority');
    const overdue = searchParams.get('overdue');

    let query = `
      SELECT 
        uaa.*,
        p.project_title as project_name,
        p.client_name,
        p.status as project_status,
        p.project_code,
        u.username as assigned_by_name,
        u.full_name as assigned_by_full_name
      FROM user_activity_assignments uaa
      LEFT JOIN projects p ON uaa.project_id = p.project_id
      LEFT JOIN users u ON uaa.assigned_by = u.id
      WHERE uaa.user_id = ?
    `;

    const queryParams = [requestedUserId];

    if (status) {
      query += ' AND uaa.status = ?';
      queryParams.push(status);
    }

    if (projectId) {
      query += ' AND uaa.project_id = ?';
      queryParams.push(parseInt(projectId));
    }

    if (priority) {
      query += ' AND uaa.priority = ?';
      queryParams.push(priority);
    }

    if (overdue === 'true') {
      query += ' AND uaa.due_date < CURDATE() AND uaa.status NOT IN (?, ?)';
      queryParams.push('Completed', 'Cancelled');
    }

    query += ' ORDER BY uaa.due_date ASC, uaa.priority DESC, uaa.created_at DESC';

    const [activities] = await db.execute(query, queryParams);
    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: activities,
      count: activities.length 
    });

  } catch (error) {
    console.error('GET user activities error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch user activities' 
    }, { status: 500 });
  }
}

/**
 * POST /api/users/[id]/activities
 * Create a new activity assignment for a user
 * (Typically called from project assignment interface)
 */
export async function POST(request, { params }) {
  try {
    const auth = await ensurePermission(request, RESOURCES.ACTIVITIES, PERMISSIONS.ASSIGN);
    if (!auth.authorized) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const userId = parseInt(id);
    const currentUser = auth.user;
    const data = await request.json();

    const {
      employee_id,
      project_id,
      activity_id,
      activity_name,
      discipline_id,
      discipline_name,
      due_date,
      priority = 'Medium',
      estimated_hours,
      notes
    } = data;

    if (!activity_name) {
      return NextResponse.json({ 
        success: false, 
        error: 'Activity name is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    // Verify user exists
    const [userCheck] = await db.execute(
      'SELECT id FROM users WHERE id = ? AND is_active = 1',
      [userId]
    );

    if (userCheck.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'User not found or inactive' 
      }, { status: 404 });
    }

    // If project_id is provided, verify it exists
    if (project_id) {
      const [projectCheck] = await db.execute(
        'SELECT project_id FROM projects WHERE project_id = ?',
        [project_id]
      );

      if (projectCheck.length === 0) {
        await db.end();
        return NextResponse.json({ 
          success: false, 
          error: 'Project not found' 
        }, { status: 404 });
      }
    }

    const assignmentId = randomUUID();

    await db.execute(`
      INSERT INTO user_activity_assignments (
        id, user_id, employee_id, project_id, activity_id, activity_name,
        discipline_id, discipline_name, assigned_by, due_date, priority,
        estimated_hours, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      assignmentId,
      userId,
      employee_id || null,
      project_id || null,
      activity_id || null,
      activity_name,
      discipline_id || null,
      discipline_name || null,
      currentUser.id,
      due_date || null,
      priority,
      estimated_hours || null,
      notes || null
    ]);

    // Log the assignment in activity_updates
    const updateId = randomUUID();
    await db.execute(`
      INSERT INTO activity_updates (
        id, activity_assignment_id, updated_by, update_type, new_value, comment
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      updateId,
      assignmentId,
      currentUser.id,
      'assigned',
      JSON.stringify({ activity_name, due_date, priority }),
      'Activity assigned'
    ]);

    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Activity assigned successfully',
      data: { id: assignmentId }
    }, { status: 201 });

  } catch (error) {
    console.error('POST user activity error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to assign activity' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/users/[id]/activities
 * Update an activity assignment (progress, status, hours, etc.)
 */
export async function PUT(request, { params }) {
  try {
    const auth = await ensurePermission(request, RESOURCES.ACTIVITIES, PERMISSIONS.UPDATE);
    if (!auth.authorized) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const userId = parseInt(id);
    const currentUser = auth.user;
    const data = await request.json();

    const {
      activity_id,
      status,
      progress_percentage,
      actual_hours,
      notes,
      completion_date
    } = data;

    if (!activity_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Activity ID is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    // Get current activity state
    const [current] = await db.execute(
      'SELECT * FROM user_activity_assignments WHERE id = ? AND user_id = ?',
      [activity_id, userId]
    );

    if (current.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Activity not found or does not belong to this user' 
      }, { status: 404 });
    }

    const currentActivity = current[0];
    const updates = [];
    const values = [];
    const changes = [];

    if (status && status !== currentActivity.status) {
      updates.push('status = ?');
      values.push(status);
      changes.push({ field: 'status', old: currentActivity.status, new: status });
      
      // If status is Completed, set completion_date
      if (status === 'Completed' && !completion_date) {
        updates.push('completion_date = NOW()');
        updates.push('progress_percentage = 100');
      }
    }

    if (progress_percentage !== undefined && progress_percentage !== currentActivity.progress_percentage) {
      updates.push('progress_percentage = ?');
      values.push(progress_percentage);
      changes.push({ field: 'progress_percentage', old: currentActivity.progress_percentage, new: progress_percentage });
    }

    if (actual_hours !== undefined && actual_hours !== currentActivity.actual_hours) {
      updates.push('actual_hours = ?');
      values.push(actual_hours);
      changes.push({ field: 'actual_hours', old: currentActivity.actual_hours, new: actual_hours });
    }

    if (notes && notes !== currentActivity.notes) {
      updates.push('notes = ?');
      values.push(notes);
    }

    if (completion_date) {
      updates.push('completion_date = ?');
      values.push(completion_date);
    }

    if (updates.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: true, 
        message: 'No changes to update' 
      });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(activity_id, userId);

    await db.execute(
      `UPDATE user_activity_assignments SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    // Log each change in activity_updates
    for (const change of changes) {
      const updateId = randomUUID();
      let updateType = 'progress_update';
      if (change.field === 'status') updateType = 'status_change';
      if (change.field === 'actual_hours') updateType = 'hours_update';

      await db.execute(`
        INSERT INTO activity_updates (
          id, activity_assignment_id, updated_by, update_type, old_value, new_value
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        updateId,
        activity_id,
        currentUser.id,
        updateType,
        String(change.old),
        String(change.new)
      ]);
    }

    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Activity updated successfully' 
    });

  } catch (error) {
    console.error('PUT user activity error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update activity' 
    }, { status: 500 });
  }
}

/**
 * DELETE /api/users/[id]/activities?activity_id=xxx
 * Remove an activity assignment
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await ensurePermission(request, RESOURCES.ACTIVITIES, PERMISSIONS.DELETE);
    if (!auth.authorized) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const userId = parseInt(id);
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get('activity_id');

    if (!activityId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Activity ID is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    // Verify activity belongs to user
    const [activity] = await db.execute(
      'SELECT id FROM user_activity_assignments WHERE id = ? AND user_id = ?',
      [activityId, userId]
    );

    if (activity.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Activity not found or does not belong to this user' 
      }, { status: 404 });
    }

    await db.execute(
      'DELETE FROM user_activity_assignments WHERE id = ? AND user_id = ?',
      [activityId, userId]
    );

    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Activity deleted successfully' 
    });

  } catch (error) {
    console.error('DELETE user activity error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to delete activity' 
    }, { status: 500 });
  }
}
