import { dbConnect } from './src/utils/database.js'
import dotenv from 'dotenv'
import { existsSync } from 'fs'

// Load environment variables from .env.local
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' })
  console.log('📁 Loaded environment variables from .env.local')
} else if (existsSync('.env')) {
  dotenv.config({ path: '.env' })
  console.log('📁 Loaded environment variables from .env')
}

async function checkTableStructure() {
  try {
    const db = await dbConnect()
    console.log('✅ Database connected successfully')
    
    // Check users table structure
    console.log('\n📋 Users table structure:')
    const [tableInfo] = await db.execute('DESCRIBE users')
    console.log('Columns found:')
    tableInfo.forEach(column => {
      console.log(`  - ${column.Field} (${column.Type}) ${column.Null === 'YES' ? 'NULL' : 'NOT NULL'}${column.Key ? ` [${column.Key}]` : ''}`)
    })
    
    // Show all data in the table (limit 5 rows)
    console.log('\n👥 Sample data from users table:')
    const [users] = await db.execute('SELECT * FROM users LIMIT 5')
    if (users.length === 0) {
      console.log('  No users found')
    } else {
      console.log('Found columns in data:', Object.keys(users[0]))
      users.forEach((user, index) => {
        console.log(`  User ${index + 1}:`, user)
      })
    }
    
    await db.end()
    console.log('\n✅ Database connection closed')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

checkTableStructure()
