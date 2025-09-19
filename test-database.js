import { dbConnect } from './src/utils/database.js'

async function testDatabase() {
  console.log('Testing database connection...')
  
  try {
    const db = await dbConnect()
    console.log('✅ Database connected successfully')
    
    // Check if users table exists
    console.log('\n📋 Checking users table structure...')
    try {
      const [tableInfo] = await db.execute('DESCRIBE users')
      console.log('Users table columns:')
      tableInfo.forEach(column => {
        console.log(`  - ${column.Field} (${column.Type}) ${column.Null === 'YES' ? 'NULL' : 'NOT NULL'}`)
      })
    } catch (error) {
      console.log('❌ Users table does not exist or cannot be accessed')
      console.log('Error:', error.message)
      
      // Try to create the users table
      console.log('\n🔧 Creating users table...')
      await db.execute(`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)
      console.log('✅ Users table created successfully')
      
      // Insert a test user
      console.log('\n👤 Adding test user...')
      await db.execute(
        'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
        ['testuser', 'testpass123', 'test@example.com']
      )
      console.log('✅ Test user added: username=testuser, password=testpass123')
    }
    
    // Show all users
    console.log('\n👥 Current users in database:')
    const [users] = await db.execute('SELECT id, username, email, created_at FROM users')
    if (users.length === 0) {
      console.log('  No users found')
    } else {
      users.forEach(user => {
        console.log(`  - ID: ${user.id}, Username: ${user.username}, Email: ${user.email}`)
      })
    }
    
    // Test login query
    console.log('\n🔐 Testing login query...')
    const [loginTest] = await db.execute(
      'SELECT * FROM users WHERE username = ? AND password = ?',
      ['testuser', 'testpass123']
    )
    
    if (loginTest.length > 0) {
      console.log('✅ Login test successful - user found')
      console.log('User data:', loginTest[0])
    } else {
      console.log('❌ Login test failed - no user found with those credentials')
    }
    
    await db.end()
    console.log('\n✅ Database connection closed')
    
  } catch (error) {
    console.error('❌ Database test failed:', error)
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Tips:')
      console.log('  - Make sure MySQL/MariaDB is running')
      console.log('  - Check your database credentials in .env file')
      console.log('  - Verify the database exists')
    }
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n💡 Tips:')
      console.log('  - Check your database username and password in .env file')
      console.log('  - Make sure the database user has proper permissions')
    }
    
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.log('\n💡 Tips:')
      console.log('  - The database specified in .env does not exist')
      console.log('  - Create the database first or check the DB_NAME in .env')
    }
  }
}

// Load environment variables from .env.local
import dotenv from 'dotenv'
import { existsSync } from 'fs'

if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' })
  console.log('📁 Loaded environment variables from .env.local')
} else if (existsSync('.env')) {
  dotenv.config({ path: '.env' })
  console.log('📁 Loaded environment variables from .env')
} else {
  console.log('❌ No .env.local or .env file found')
  console.log('💡 Create a .env.local file with the following variables:')
  console.log(`
DB_HOST=localhost
DB_PORT=3306
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password
  `)
  process.exit(1)
}

testDatabase()
