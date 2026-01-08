import { dbConnect } from '@/utils/database'
import { NextResponse } from 'next/server'
import { logActivity } from '@/utils/activity-logger'
import { getDefaultPermissionsForLevel, mergePermissions } from '@/utils/rbac'

// Helper to safely parse JSON
function safeParse(json, fallback = []) {
  try {
    if (!json) return fallback;
    if (typeof json === 'object') return json;
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// Fetch user permissions from database
async function getUserPermissions(db, userId) {
  try {
    const [rows] = await db.execute(
      `SELECT 
        u.permissions AS user_permissions,
        u.is_super_admin,
        r.permissions AS role_permissions,
        r.role_hierarchy
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );
    
    if (!rows || rows.length === 0) return { permissions: [], isSuperAdmin: false };
    
    const row = rows[0];
    const userPermissions = safeParse(row.user_permissions, []);
    let rolePermissions = safeParse(row.role_permissions, []);
    
    // If role has no explicit permissions but has hierarchy level, derive defaults
    if ((!rolePermissions || rolePermissions.length === 0) && typeof row.role_hierarchy === 'number') {
      try {
        rolePermissions = getDefaultPermissionsForLevel(row.role_hierarchy) || [];
      } catch {}
    }
    
    const mergedPermissions = mergePermissions(rolePermissions, userPermissions);
    return {
      permissions: mergedPermissions,
      isSuperAdmin: !!row.is_super_admin
    };
  } catch (error) {
    console.error('Failed to fetch user permissions:', error);
    return { permissions: [], isSuperAdmin: false };
  }
}


export async function POST(req) {
  let db = null
  try {
    // Parse JSON body safely
    let body = null
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { success: false, message: 'Invalid request body' },
        { status: 400 }
      )
    }

    const identifier = body?.username || body?.email // allow either name
    const password = body?.password

    if (!identifier || !password) {
      return NextResponse.json(
        { success: false, message: 'Username/Email and password required' },
        { status: 400 }
      )
    }

    // Try DB connection with graceful error mapping
    try {
      db = await dbConnect()
    } catch (err) {
      console.error('Login DB connect failed:', err)
      const isNet = ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'DB_CONNECTION_FAILED', 'PROTOCOL_CONNECTION_LOST'].includes(err?.code)
      return NextResponse.json(
        { success: false, message: isNet ? 'Database temporarily unavailable. Please try again shortly.' : 'Server error' },
        { status: isNet ? 503 : 500 }
      )
    }

    // Check by username OR email, using the same password_hash field for now (plaintext)
    let rows = []
    try {
      const [qRows] = await db.execute(
        'SELECT * FROM users WHERE (username = ? OR email = ?) AND password_hash = ?',
        [identifier, identifier, password]
      )
      rows = qRows || []
      if (rows.length > 0) {
        const userId = rows[0].id
        try {
          await db.execute('UPDATE users SET last_login = NOW(), is_active = TRUE, status = "active" WHERE id = ?', [userId])
          
          // Log successful login
          logActivity({
            userId,
            actionType: 'login',
            description: `User ${rows[0].username} logged in successfully`,
            request: req,
            status: 'success'
          }).catch(console.error);
        } catch (err) {
          console.warn('Failed to update last_login for user', userId, err?.code || err?.message || err)
        }
      } else {
        // Log failed login attempt
        logActivity({
          userId: 0, // Unknown user
          actionType: 'login',
          description: `Failed login attempt for identifier: ${identifier}`,
          details: { identifier },
          request: req,
          status: 'failed'
        }).catch(console.error);
      }
    } catch (err) {
      console.error('Login query failed:', err)
      if (db) {
        try { await db.end() } catch {}
      }
      return NextResponse.json(
        { success: false, message: 'Server error' },
        { status: 500 }
      )
    }

    if (rows.length > 0) {
      const user = rows[0];
      const userId = user.id;
      const isSuperAdmin = user.is_super_admin === 1 || user.is_super_admin === true;
      
      // Fetch user permissions before closing DB connection
      const { permissions } = await getUserPermissions(db, userId);
      
      // Now close the DB connection
      if (db) {
        try { await db.end() } catch {}
      }
      
      const res = NextResponse.json({ 
        success: true, 
        message: 'Login successful',
        is_super_admin: isSuperAdmin
      })
      const isProd = process.env.NODE_ENV === 'production'
      
      // Set cookies as session cookies (cleared when browser closes)
      res.cookies.set('auth', '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        priority: 'high'
      })
      
      // Also set user_id for server-side RBAC resolution
      res.cookies.set('user_id', String(userId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        priority: 'high'
      })
      
      // Set is_super_admin cookie for middleware routing
      res.cookies.set('is_super_admin', isSuperAdmin ? '1' : '0', {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        priority: 'high'
      })
      
      // Store permissions in session cookie (Base64 encoded JSON)
      // This allows fast permission checks without DB queries
      const permissionsData = JSON.stringify({
        p: permissions,           // permissions array
        sa: isSuperAdmin,         // is_super_admin flag
        ts: Date.now()            // timestamp for cache invalidation
      });
      const encodedPermissions = Buffer.from(permissionsData).toString('base64');
      
      res.cookies.set('session_permissions', encodedPermissions, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        priority: 'high',
        // Permissions cookie expires in 24 hours - will be refreshed on next login
        maxAge: 60 * 60 * 24
      })
      
      return res
    }
    
    // Close DB connection for failed login
    if (db) {
      try { await db.end() } catch {}
    }

    return NextResponse.json(
      { success: false, message: 'Invalid credentials' },
      { status: 401 }
    )
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    )
  }
}



