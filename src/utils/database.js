import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { existsSync } from 'fs'

// Load environment variables from .env.local or .env
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' })
} else if (existsSync('.env')) {
  dotenv.config({ path: '.env' })
}

export async function dbConnect() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  })
  
  return connection
}
