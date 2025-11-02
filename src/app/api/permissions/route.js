import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { RESOURCES, PERMISSIONS, validatePermissions, groupPermissionsByResource } from '@/utils/rbac';
import { getCurrentUser } from '@/utils/api-permissions';

// Safe JSON parse helper to avoid runtime crashes on bad DB contents
function safeParse(json, fallback = []) {
  try {
    if (!json) return fallback;
    if (typeof json === 'object') return json; // already parsed
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// GET - Get permissions for a specific user or role
export async function GET(request) {
  try {
    // Only admins can view user/role permission details; meta is open to all
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const needsRBAC = type && type !== 'meta';
    if (needsRBAC) {
      const user = await getCurrentUser(request);
      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      
      if (!user.is_super_admin) {
        return NextResponse.json({ 
          success: false, 
          error: 'Forbidden: Only administrators can view permissions' 
        }, { status: 403 });
      }
    }
    const userId = searchParams.get('user_id');
    const roleId = searchParams.get('role_id');
    // 'user' or 'role' or 'all' or 'meta'

    const db = await dbConnect();

    let response = {
      success: true,
      data: {
        resources: RESOURCES,
        permissions: PERMISSIONS,
        user_permissions: null,
        role_permissions: null,
        effective_permissions: null
      }
    };

    // Get user-specific permissions
    if (userId && (type === 'user' || type === 'all')) {
      const [userRows] = await db.execute(
        `SELECT u.permissions as user_permissions, u.role_id,
                r.permissions as role_permissions, r.role_name,
                u.is_super_admin
         FROM users u
         LEFT JOIN roles_master r ON u.role_id = r.id
         WHERE u.id = ? AND (u.status = 'active' OR u.status IS NULL)`,
        [userId]
      );

      if (userRows.length > 0) {
        const user = userRows[0];
  const userPermissions = safeParse(user.user_permissions, []);
  const rolePermissions = safeParse(user.role_permissions, []);
        
        response.data.user_permissions = {
          direct: userPermissions,
          grouped: groupPermissionsByResource(userPermissions)
        };
        
        response.data.role_permissions = {
          direct: rolePermissions,
          grouped: groupPermissionsByResource(rolePermissions),
          role_name: user.role_name
        };

        // Calculate effective permissions (role + user overrides)
        const effectivePermissions = [...new Set([...rolePermissions, ...userPermissions])];
        response.data.effective_permissions = {
          direct: effectivePermissions,
          grouped: groupPermissionsByResource(effectivePermissions)
        };

        response.data.is_super_admin = user.is_super_admin;
      }
    }

    // Get role-specific permissions
    if (roleId && (type === 'role' || type === 'all')) {
      const [roleRows] = await db.execute(
        'SELECT permissions, role_name FROM roles_master WHERE id = ? AND status = "active"',
        [roleId]
      );

      if (roleRows.length > 0) {
        const role = roleRows[0];
  const rolePermissions = safeParse(role.permissions, []);
        
        response.data.role_permissions = {
          direct: rolePermissions,
          grouped: groupPermissionsByResource(rolePermissions),
          role_name: role.role_name
        };
      }
    }

    await db.end();
    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch permissions' 
    }, { status: 500 });
  }
}

// POST - Update permissions for user or role
export async function POST(request) {
  try {
    // Only super admins can modify permissions
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!user.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden: Only administrators can manage permissions' 
      }, { status: 403 });
    }

    const data = await request.json();
    const { user_id, role_id, permissions, type, action } = data; // action: 'grant', 'revoke', 'replace'

    if (!permissions || !Array.isArray(permissions)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Permissions array is required' 
      }, { status: 400 });
    }

    // Validate permissions
    const validation = validatePermissions(permissions);
    if (validation.invalid.length > 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid permissions found',
        invalid_permissions: validation.invalid
      }, { status: 400 });
    }

    const db = await dbConnect();

    if (type === 'user' && user_id) {
      // Update user permissions
      const [existingUser] = await db.execute(
        'SELECT permissions FROM users WHERE id = ? LIMIT 1',
        [user_id]
      );

      if (existingUser.length === 0) {
        await db.end();
        return NextResponse.json({ 
          success: false, 
          error: 'User not found' 
        }, { status: 404 });
      }

  let currentPermissions = safeParse(existingUser[0].permissions, []);
      let newPermissions;

      switch (action) {
        case 'grant':
          newPermissions = [...new Set([...currentPermissions, ...permissions])];
          break;
        case 'revoke':
          newPermissions = currentPermissions.filter(p => !permissions.includes(p));
          break;
        case 'replace':
        default:
          newPermissions = permissions;
          break;
      }

      await db.execute(
        'UPDATE users SET permissions = ? WHERE id = ?',
        [JSON.stringify(newPermissions), user_id]
      );

      console.log('✅ User permissions saved to database:', {
        user_id,
        permissionCount: newPermissions.length,
        permissions: newPermissions
      });

      await db.end();
      return NextResponse.json({ 
        success: true, 
        message: 'User permissions updated successfully',
        data: { permissions: newPermissions }
      });

    } else if (type === 'role' && role_id) {
      // Update role permissions
      const [existingRole] = await db.execute(
        'SELECT permissions FROM roles_master WHERE id = ? AND status = "active"',
        [role_id]
      );

      if (existingRole.length === 0) {
        await db.end();
        return NextResponse.json({ 
          success: false, 
          error: 'Role not found' 
        }, { status: 404 });
      }

  let currentPermissions = safeParse(existingRole[0].permissions, []);
      let newPermissions;

      switch (action) {
        case 'grant':
          newPermissions = [...new Set([...currentPermissions, ...permissions])];
          break;
        case 'revoke':
          newPermissions = currentPermissions.filter(p => !permissions.includes(p));
          break;
        case 'replace':
        default:
          newPermissions = permissions;
          break;
      }

      await db.execute(
        'UPDATE roles_master SET permissions = ? WHERE id = ?',
        [JSON.stringify(newPermissions), role_id]
      );

      // Update all users with this role to refresh their effective permissions
      await db.execute(
        'UPDATE users SET permissions = permissions WHERE role_id = ?',
        [role_id]
      );

      await db.end();
      return NextResponse.json({ 
        success: true, 
        message: 'Role permissions updated successfully',
        data: { permissions: newPermissions }
      });

    } else {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Either user_id or role_id must be provided with appropriate type' 
      }, { status: 400 });
    }

  } catch (error) {
    console.error('Error updating permissions:', error);
    return NextResponse.json({ 
      success: false, 
      error: error?.message || 'Failed to update permissions' 
    }, { status: 500 });
  }
}

// PUT - Bulk permission operations
export async function PUT(request) {
  try {
    // Only super admins can perform bulk permission operations
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!user.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden: Only administrators can manage permissions' 
      }, { status: 403 });
    }

    const data = await request.json();
    const { operations } = data; // Array of permission operations

    if (!operations || !Array.isArray(operations)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Operations array is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    const results = [];

    // Begin transaction
    await db.execute('START TRANSACTION');

    try {
      for (const operation of operations) {
        const { type, target_id, permissions, action } = operation;

        if (type === 'user') {
          const [user] = await db.execute(
            'SELECT permissions FROM users WHERE id = ? LIMIT 1',
            [target_id]
          );

          if (user.length > 0) {
            let currentPermissions = user[0].permissions ? JSON.parse(user[0].permissions) : [];
            let newPermissions;

            switch (action) {
              case 'grant':
                newPermissions = [...new Set([...currentPermissions, ...permissions])];
                break;
              case 'revoke':
                newPermissions = currentPermissions.filter(p => !permissions.includes(p));
                break;
              case 'replace':
                newPermissions = permissions;
                break;
            }

            await db.execute(
              'UPDATE users SET permissions = ? WHERE id = ?',
              [JSON.stringify(newPermissions), target_id]
            );

            results.push({ 
              type, 
              target_id, 
              action, 
              success: true, 
              permissions: newPermissions 
            });
          }
        } else if (type === 'role') {
          const [role] = await db.execute(
            'SELECT permissions FROM roles_master WHERE id = ? AND status = "active"',
            [target_id]
          );

          if (role.length > 0) {
            let currentPermissions = role[0].permissions ? JSON.parse(role[0].permissions) : [];
            let newPermissions;

            switch (action) {
              case 'grant':
                newPermissions = [...new Set([...currentPermissions, ...permissions])];
                break;
              case 'revoke':
                newPermissions = currentPermissions.filter(p => !permissions.includes(p));
                break;
              case 'replace':
                newPermissions = permissions;
                break;
            }

            await db.execute(
              'UPDATE roles_master SET permissions = ? WHERE id = ?',
              [JSON.stringify(newPermissions), target_id]
            );

            results.push({ 
              type, 
              target_id, 
              action, 
              success: true, 
              permissions: newPermissions 
            });
          }
        }
      }

      await db.execute('COMMIT');
      await db.end();

      return NextResponse.json({ 
        success: true, 
        message: 'Bulk permission operations completed',
        data: { results }
      });

    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error in bulk permission operations:', error);
    return NextResponse.json({ 
      success: false, 
      error: error?.message || 'Failed to complete bulk permission operations' 
    }, { status: 500 });
  }
}