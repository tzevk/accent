#!/usr/bin/env node
import dotenv from 'dotenv'
dotenv.config({ path: process.env.DOTENV_PATH || '.env.local' })

const dbUtilsPath = new URL('../src/utils/database.js', import.meta.url).href
let dbConnect
try {
  const mod = await import(dbUtilsPath)
  dbConnect = mod.dbConnect
} catch (err) {
  console.error('Failed to import db helper:', err)
  process.exit(1)
}

const args = process.argv.slice(2)
const force = args.includes('--yes') || args.includes('--force')

async function main() {
  const conn = await dbConnect()
  try {
    const database = process.env.DB_NAME || 'accent'
    const [rows] = await conn.query(
      `SELECT TABLE_NAME, CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_NAME = 'projects' AND REFERENCED_TABLE_SCHEMA = ?`,
      [database]
    )

    if (!rows || rows.length === 0) {
      console.log('No foreign keys reference `projects`. Proceeding to drop the table.')
    } else {
      console.log('Found foreign keys referencing `projects`:')
      for (const r of rows) {
        console.log(`- ${r.TABLE_NAME} constraint ${r.CONSTRAINT_NAME}`)
      }
      if (!force) {
        console.log('\nRun this script again with --yes to drop those constraints and then drop `projects`.')
        await conn.end()
        process.exit(0)
      }
      // drop each foreign key constraint
      for (const r of rows) {
        console.log(`Dropping constraint ${r.CONSTRAINT_NAME} on table ${r.TABLE_NAME}...`)
        try {
          await conn.query(`ALTER TABLE \`${r.TABLE_NAME}\` DROP FOREIGN KEY \`${r.CONSTRAINT_NAME}\``)
        } catch (err) {
          console.error(`Failed to drop constraint ${r.CONSTRAINT_NAME} on ${r.TABLE_NAME}:`, err.message)
          throw err
        }
      }
    }

    // Now drop projects
    console.log('Dropping `projects` table...')
    await conn.query('DROP TABLE IF EXISTS `projects`')
    console.log('`projects` table dropped.')
    await conn.end()
  } catch (err) {
    console.error('Operation failed:', err)
    try { await conn.end() } catch(e){}
    process.exit(2)
  }
}

main()
