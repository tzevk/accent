import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES as API_RESOURCES, PERMISSIONS as API_PERMISSIONS } from '@/utils/api-permissions';

// POST - reset user password
export async function POST(request) {
  let db;
  try {
    // RBAC: update users permission required to reset password
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;

    const data = await request.json();
    const { user_id, new_password } = data;

    if (!user_id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    if (!new_password) {
      return NextResponse.json({ success: false, error: 'New password is required' }, { status: 400 });
    }

    if (new_password.length < 6) {
      return NextResponse.json({ success: false, error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    db = await dbConnect();

    // Verify user exists
    const [existing] = await db.execute('SELECT id, username FROM users WHERE id = ? LIMIT 1', [user_id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Update password (storing plain text as per existing pattern in this codebase)
    await db.execute(
      'UPDATE users SET password_hash = ?, last_password_change = CURRENT_TIMESTAMP WHERE id = ?',
      [new_password, user_id]
    );

    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: `Password reset successfully for user "${existing[0].username}"` 
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to reset password' }, { status: 500 });
  }
}
