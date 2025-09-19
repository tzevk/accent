import { dbConnect } from './src/utils/database.js'
import dotenv from 'dotenv'
import { existsSync } from 'fs'

// Load environment variables from .env.local
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' })
  console.log('📁 Loaded environment variables from .env.local')
}

async function testLogin() {
  try {
    const db = await dbConnect()
    console.log('✅ Database connected successfully')
    
    // Test with the actual user from the database
    const username = 'admin@crmaccent.com'
    const password = 'admin123'
    
    console.log(`\n🔐 Testing login with username: ${username}`)
    
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE username = ? AND password_hash = ?',
      [username, password]
    )
    
    if (rows.length > 0) {
      console.log('✅ Login test successful - user found')
      console.log('User data:', {
        id: rows[0].id,
        username: rows[0].username,
        email: rows[0].email,
        full_name: rows[0].full_name,
        role: rows[0].role,
        status: rows[0].status
      })
    } else {
      console.log('❌ Login test failed - no user found with those credentials')
    }
    
    await db.end()
    console.log('\n✅ Database connection closed')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

testLogin()
