import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasColumn } from '@/utils/schema-cache';

/**
 * PUT /api/projects/[id]/status
 * Body: { status: string }
 * Access: super admins or users with projects:update permission.
 */
export async function PUT(request, { params }) {
  let db;
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const canUpdate =
      user.is_super_admin === true ||
      user.is_super_admin === 1 ||
      hasPermission(user, RESOURCES.PROJECTS, PERMISSIONS.UPDATE);
    if (!canUpdate) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id || id === 'undefined') {
      return NextResponse.json({ success: false, error: 'Invalid project id' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const status = typeof body?.status === 'string' ? body.status.trim() : '';
    if (!status) {
      return NextResponse.json({ success: false, error: 'status is required' }, { status: 400 });
    }

    db = await dbConnect();

    const hasProjectStatus = await hasColumn(db, 'projects', 'project_status');
    const hasStatus = await hasColumn(db, 'projects', 'status');

    if (!hasStatus && !hasProjectStatus) {
      return NextResponse.json({ success: false, error: 'Project status column not found' }, { status: 500 });
    }

    const setParts = [];
    const setParams = [];
    if (hasStatus) {
      setParts.push('status = ?');
      setParams.push(status);
    }
    if (hasProjectStatus) {
      setParts.push('project_status = ?');
      setParams.push(status);
    }

    // Try update by project_id first (common in this codebase). If it doesn't match, fallback to primary id.
    let affectedRows = 0;
    {
      const [r] = await db.execute(
        `UPDATE projects SET ${setParts.join(', ')} WHERE project_id = ?`,
        [...setParams, id]
      );
      affectedRows = r?.affectedRows || 0;
    }

    if (affectedRows === 0 && /^\d+$/.test(String(id))) {
      const [r2] = await db.execute(
        `UPDATE projects SET ${setParts.join(', ')} WHERE id = ?`,
        [...setParams, parseInt(String(id), 10)]
      );
      affectedRows = r2?.affectedRows || 0;
    }

    if (affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, affected_rows: affectedRows });
  } catch (error) {
    console.error('Project status update error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update project status', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) {
      try {
        db.release();
      } catch {}
    }
  }
}
