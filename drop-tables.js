import { dbConnect } from './src/utils/database.js'
import dotenv from 'dotenv'
import { existsSync } from 'fs'

// Load environment variables from .env.local
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' })
  console.log('📁 Loaded environment variables from .env.local')
}

async function dropTables() {
  try {
    const db = await dbConnect()
    console.log('✅ Database connected successfully')
    
    // Get all tables in the database
    console.log('\n📋 Getting all tables in the database...')
    const [tables] = await db.execute('SHOW TABLES')
    
    if (tables.length === 0) {
      console.log('ℹ️  No tables found in the database')
      await db.end()
      return
    }
    
    console.log('Found tables:')
    tables.forEach(table => {
      const tableName = Object.values(table)[0]
      console.log(`  - ${tableName}`)
    })
    
    // Filter out the users table
    const tablesToDrop = tables.filter(table => {
      const tableName = Object.values(table)[0].toLowerCase()
      return tableName !== 'users'
    })
    
    if (tablesToDrop.length === 0) {
      console.log('\n✅ Only users table exists - nothing to drop')
      await db.end()
      return
    }
    
    console.log(`\n🗑️  Will drop ${tablesToDrop.length} tables (keeping 'users' table):`)
    tablesToDrop.forEach(table => {
      const tableName = Object.values(table)[0]
      console.log(`  - ${tableName}`)
    })
    
    // Disable foreign key checks to avoid dependency issues
    console.log('\n🔧 Disabling foreign key checks...')
    await db.execute('SET FOREIGN_KEY_CHECKS = 0')
    
    // Drop each table
    console.log('\n🗑️  Dropping tables...')
    for (const table of tablesToDrop) {
      const tableName = Object.values(table)[0]
      try {
        await db.execute(`DROP TABLE IF EXISTS \`${tableName}\``)
        console.log(`  ✅ Dropped table: ${tableName}`)
      } catch (error) {
        console.log(`  ❌ Failed to drop table ${tableName}: ${error.message}`)
      }
    }
    
    // Re-enable foreign key checks
    console.log('\n🔧 Re-enabling foreign key checks...')
    await db.execute('SET FOREIGN_KEY_CHECKS = 1')
    
    // Verify remaining tables
    console.log('\n📋 Remaining tables after cleanup:')
    const [remainingTables] = await db.execute('SHOW TABLES')
    if (remainingTables.length === 0) {
      console.log('  ⚠️  No tables remaining')
    } else {
      remainingTables.forEach(table => {
        const tableName = Object.values(table)[0]
        console.log(`  - ${tableName}`)
      })
    }
    
    await db.end()
    console.log('\n✅ Database cleanup completed successfully')
    
  } catch (error) {
    console.error('❌ Error during database cleanup:', error.message)
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Tips:')
      console.log('  - Make sure MySQL/MariaDB is running')
      console.log('  - Check your database credentials in .env.local')
    }
  }
}

// Warning message
console.log('⚠️  WARNING: This will permanently delete all tables except "users"')
console.log('⚠️  Make sure you have a backup if needed')
console.log('\n🚀 Starting database cleanup...')

dropTables()
