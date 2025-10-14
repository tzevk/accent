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


    const db = await dbConnect()


    // Check by username OR email, using the same password_hash field for now
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE (username = ? OR email = ?) AND password_hash = ?',
      [identifier, identifier, password]
    )


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



