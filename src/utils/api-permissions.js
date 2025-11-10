import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { hasPermission, RESOURCES, PERMISSIONS, getDefaultPermissionsForLevel, mergePermissions } from '@/utils/rbac';

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

// Load current user from cookie and DB (includes role permissions)
export async function getCurrentUser(request) {
  try {
    const userId = request?.cookies?.get?.('user_id')?.value;
    if (!userId) return null;

    const db = await dbConnect();
    const [rows] = await db.execute(
      `SELECT 
          u.id,
          u.username,
          u.full_name,
          u.email,
          u.department,
          u.employee_id AS linked_employee_id,
          u.role_id,
          u.permissions AS user_permissions,
          u.is_super_admin,
          u.is_active,
          u.status,
          u.last_login,
          u.last_password_change,
          r.permissions AS role_permissions,
          r.role_hierarchy,
          r.role_name,
          r.role_code,
          e.id AS employee_record_id,
          e.first_name,
          e.last_name,
          e.phone,
          e.mobile,
          e.personal_email,
          e.department AS employee_department,
          e.position,
          e.present_address,
          e.city,
          e.state,
          e.country,
          e.profile_photo_url,
          e.emergency_contact_name,
          e.emergency_contact_phone
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       LEFT JOIN employees e ON u.employee_id = e.id
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

    const mergedPermissions = mergePermissions(rolePermissions, userPermissions);
    const employee = row.employee_record_id
      ? {
          id: row.employee_record_id,
          first_name: row.first_name,
          last_name: row.last_name,
          phone: row.phone,
          mobile: row.mobile,
          personal_email: row.personal_email,
          department: row.employee_department,
          position: row.position,
          present_address: row.present_address,
          city: row.city,
          state: row.state,
          country: row.country,
          profile_photo_url: row.profile_photo_url,
          emergency_contact_name: row.emergency_contact_name,
          emergency_contact_phone: row.emergency_contact_phone
        }
      : null;

    const authenticated = !!request?.cookies?.get?.('auth')?.value;
    return {
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      email: row.email,
      department: row.department || employee?.department || null,
      employee_id: row.linked_employee_id,
      role_id: row.role_id,
      role: row.role_id
        ? {
            id: row.role_id,
            name: row.role_name,
            code: row.role_code,
            hierarchy: row.role_hierarchy
          }
        : null,
      is_super_admin: !!row.is_super_admin,
      // Consider the session: if authenticated, treat as active even if flag wasn't updated yet
      is_active: row.is_active === null ? true : (!!row.is_active || authenticated),
      status: row.status,
      last_login: row.last_login,
      last_password_change: row.last_password_change,
      permissions: userPermissions,
      role_permissions: rolePermissions,
      merged_permissions: mergedPermissions,
      employee
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
