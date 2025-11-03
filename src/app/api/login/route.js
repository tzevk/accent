import { dbConnect } from '@/utils/database'
import { NextResponse } from 'next/server'
import { generateToken, setTokenCookie } from '@/utils/jwt-auth'


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
      const user = rows[0]
      
      // Create JWT payload
      const payload = {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role || 'user',
        roleId: user.role_id
      }
      
      // Generate JWT token
      const token = generateToken(payload)
      
      // Create response with user data
      const res = NextResponse.json({ 
        success: true, 
        message: 'Login successful',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          roleId: user.role_id
        }
      })
      
      // Set JWT token in httpOnly cookie
      setTokenCookie(res, token)
      
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



