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

async function main() {
  const conn = await dbConnect()
  try {
    const database = process.env.DB_NAME || 'accent'
    const [rows] = await conn.query(
      `SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_NAME = 'projects' AND REFERENCED_TABLE_SCHEMA = ?`,
      [database]
    )
    if (!rows || rows.length === 0) {
      console.log('No foreign key constraints reference `projects`.')
    } else {
      console.log('Foreign key constraints referencing `projects`:')
      for (const r of rows) {
        console.log(`- ${r.TABLE_SCHEMA}.${r.TABLE_NAME} constraint ${r.CONSTRAINT_NAME}: column ${r.COLUMN_NAME} -> projects.${r.REFERENCED_COLUMN_NAME}`)
      }
    }
    await conn.end()
  } catch (err) {
    console.error('Error querying information_schema:', err)
    try { await conn.end() } catch(e){}
    process.exit(2)
  }
}

main()
