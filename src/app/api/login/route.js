import { dbConnect } from '@/utils/database'


export async function POST(req) {
  try {
    const body = await req.json()
    const identifier = body?.username || body?.email // allow either name
    const password = body?.password


    if (!identifier || !password) {
      return Response.json(
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
      return Response.json({ success: true, message: 'Login successful' })
    }


    return Response.json(
      { success: false, message: 'Invalid credentials' },
      { status: 401 }
    )
  } catch (error) {
    console.error('Login error:', error)
    return Response.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    )
  }
}



