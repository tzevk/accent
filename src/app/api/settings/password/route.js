import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

const MIN_PASSWORD_LENGTH = 6;

export async function POST(request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  const currentPassword = payload?.currentPassword?.trim();
  const newPassword = payload?.newPassword?.trim();

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ success: false, error: 'Both current and new passwords are required' }, { status: 400 });
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters long` }, { status: 400 });
  }

  let db;
  try {
    db = await dbConnect();
    const [rows] = await db.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [user.id]);
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User record not found' }, { status: 404 });
    }

    const existingPassword = rows[0].password_hash;
    if (existingPassword !== currentPassword) {
      return NextResponse.json({ success: false, error: 'Current password is incorrect' }, { status: 400 });
    }

    await db.execute(
      'UPDATE users SET password_hash = ?, last_password_change = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPassword, user.id]
    );
  } catch (error) {
    console.error('Password update failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update password' }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch {}
    }
  }

  return NextResponse.json({ success: true, message: 'Password updated successfully' });
}
