#!/usr/bin/env node
/*
  One-time bootstrap script to ensure the administrator account exists.
  - Makes sure the users table has is_super_admin
  - Creates or updates admin user with email admin@crmaccent.com
  - Default password: admin123 (please change immediately)
*/

import { dbConnect } from './src/utils/database.js';

async function ensureAdmin() {
  let db;
  try {
    db = await dbConnect();

    // Ensure schema matches expectations (column may already exist)
    try {
      await db.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE');
    } catch {}

    // Find existing admin by email or username
    const email = 'admin@crmaccent.com';
    const username = 'admin';
    const defaultPassword = 'admin123';

    const [rows] = await db.execute(
      'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
      [email, username]
    );

    if (rows && rows.length > 0) {
      const id = rows[0].id;
      await db.execute(
        "UPDATE users SET is_super_admin = TRUE, status = 'active' WHERE id = ?",
        [id]
      );
      console.log(`✔ Administrator set: user id ${id}`);
    } else {
      const [result] = await db.execute(
        `INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin)
         VALUES (?, ?, ?, ?, 'active', TRUE, TRUE)`,
        [username, defaultPassword, email, 'Administrator']
      );
      console.log(`✔ Administrator created: user id ${result.insertId}`);
    }

    console.log('\nIMPORTANT: For security, change the admin password after first login.');
  } catch (err) {
    console.error('Failed to ensure admin:', err?.message || err);
    process.exitCode = 1;
  } finally {
    if (db) await db.end();
  }
}

ensureAdmin();
