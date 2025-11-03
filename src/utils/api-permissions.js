import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { hasPermission, RESOURCES, PERMISSIONS, getDefaultPermissionsForLevel } from '@/utils/rbac';
import jwt from 'jsonwebtoken';

// Safely parse JSON fields stored in MySQL JSON columns
function safeParse(json, fallback = []) {
  try {
    if (!json) return fallback;
    if (typeof json === 'object') return json;
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// Load current user from JWT token and DB (includes role permissions)
export async function getCurrentUser(request) {
  try {
    const token = request?.cookies?.get?.('auth_token')?.value;
    if (!token) return null;

    // Verify and decode JWT token
    const secret = process.env.JWT_SECRET || 'your-default-secret-key';
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (error) {
      console.error('JWT verification failed in getCurrentUser:', error);
      return null;
    }

    const userId = decoded.userId;
    if (!userId) return null;

    const db = await dbConnect();
    const [rows] = await db.execute(
      `SELECT u.id, u.username, u.email, u.role_id, u.permissions as user_permissions, u.is_super_admin,
              r.permissions as role_permissions, r.role_hierarchy
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );
    await db.end();

    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    const userPermissions = safeParse(row.user_permissions, []);
    let rolePermissions = safeParse(row.role_permissions, []);
    // If role has no explicit permissions but has a hierarchy level, derive sensible defaults
    if ((!rolePermissions || rolePermissions.length === 0) && typeof row.role_hierarchy === 'number') {
      try {
        rolePermissions = getDefaultPermissionsForLevel(row.role_hierarchy) || [];
      } catch {}
    }

    return {
      id: row.id,
      username: row.username,
      email: row.email,
      role_id: row.role_id,
      is_super_admin: !!row.is_super_admin,
      permissions: userPermissions,
      role_permissions: rolePermissions,
    };
  } catch {
    return null;
  }
}

// Assert a specific permission for a resource; returns {authorized, user} or a NextResponse
export async function ensurePermission(request, resource, permission) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Super admin bypass or exact permission match
  if (user.is_super_admin || hasPermission(user, resource, permission)) {
    return { authorized: true, user };
  }

  return NextResponse.json({ success: false, error: 'Forbidden: missing permission' }, { status: 403 });
}

export { RESOURCES, PERMISSIONS };
