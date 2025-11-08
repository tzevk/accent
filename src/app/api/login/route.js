import { dbConnect } from '@/utils/database'
import { NextResponse } from 'next/server'


export async function POST(req) {
  try {
    const body = await req.json()
    const identifier = body?.username || body?.email // allow either name
    const password = body?.password


    if (!identifier || !password) {
      return NextResponse.json(
        { success: false, message: 'Username/Email and password required' },
        { status: 400 }
      )
    }


    // Try DB connection with graceful error mapping
    let db
    try {
      db = await dbConnect()
    } catch (err) {
      console.error('Login DB connect failed:', err)
      const isNet = ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'DB_CONNECTION_FAILED'].includes(err?.code)
      return NextResponse.json(
        { success: false, message: isNet ? 'Database temporarily unavailable. Please try again shortly.' : 'Server error' },
        { status: isNet ? 503 : 500 }
      )
    }


    // Check by username OR email, using the same password_hash field for now
    let rows
    try {
      ;[rows] = await db.execute(
        'SELECT * FROM users WHERE (username = ? OR email = ?) AND password_hash = ?',
        [identifier, identifier, password]
      )
      if (rows.length > 0) {
        const userId = rows[0].id
        try {
          await db.execute('UPDATE users SET last_login = NOW(), is_active = TRUE, status = "active" WHERE id = ?', [userId])
        } catch (err) {
          console.warn('Failed to update last_login for user', userId, err?.code || err?.message || err)
        }
      }
    } catch (err) {
      console.error('Login query failed:', err)
      await db.end()
      return NextResponse.json(
        { success: false, message: 'Server error' },
        { status: 500 }
      )
    }


    await db.end()


    if (rows.length > 0) {
      // Minimal auth: set an httpOnly cookie to mark authenticated session
      // Note: For production, sign this value (HMAC/JWT). This is a simple presence check.
      const res = NextResponse.json({ success: true, message: 'Login successful' })
      const isProd = process.env.NODE_ENV === 'production'
      res.cookies.set('auth', '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 8 // 8 hours
      })
      // Also set user_id for server-side RBAC resolution
  const userId = rows[0].id
      res.cookies.set('user_id', String(userId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 8
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



