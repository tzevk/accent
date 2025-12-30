import { dbConnect } from '@/utils/database'
import { NextResponse } from 'next/server'
import { logActivity } from '@/utils/activity-logger'


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
      return NextResponse.json(
        { success: false, message: 'Server error' },
        { status: 500 }
      )
    } finally {
      if (db) {
        try { await db.end() } catch {}
      }
    }

    if (rows.length > 0) {
      // Minimal auth: set an httpOnly cookie to mark authenticated session
      // Note: For production, sign this value (HMAC/JWT). This is a simple presence check.
      const user = rows[0];
      const res = NextResponse.json({ 
        success: true, 
        message: 'Login successful',
        is_super_admin: user.is_super_admin === 1 || user.is_super_admin === true
      })
      const isProd = process.env.NODE_ENV === 'production'
      
      // Set cookies with immediate effect
      res.cookies.set('auth', '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 8, // 8 hours
        priority: 'high'
      })
      
      // Also set user_id for server-side RBAC resolution
      const userId = rows[0].id
      res.cookies.set('user_id', String(userId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 8,
        priority: 'high'
      })
      
      // Set is_super_admin cookie for middleware routing
      const isSuperAdmin = user.is_super_admin === 1 || user.is_super_admin === true;
      res.cookies.set('is_super_admin', isSuperAdmin ? '1' : '0', {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 8,
        priority: 'high'
      })
      
      return res
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



