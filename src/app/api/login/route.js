import { dbConnect } from '@/utils/database'

export async function POST(req) {
  try {
    const { username, password } = await req.json()
    
    if (!username || !password) {
      return Response.json(
        { success: false, message: 'Username and password required' },
        { status: 400 }
      )
    }

    const db = await dbConnect()
    
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE username = ? AND password_hash = ?',
      [username, password]
    )
    
    await db.end()

    if (rows.length > 0) {
      return Response.json({
        success: true,
        message: 'Login successful'
      })
    } else {
      return Response.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      )
    }

  } catch (error) {
    console.error('Login error:', error)
    return Response.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    )
  }
}
