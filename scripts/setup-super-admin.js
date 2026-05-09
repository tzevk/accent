#!/usr/bin/env node

/**
 * Super Admin Setup Script
 * Creates a new super admin user with full system access
 */

import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const config = {
  username: 'crmadmin',
  email: 'crm@accent.com',
  fullName: 'Super Administrator',
  password: 'admin123'
};

async function createSuperAdmin() {
  let connection;
  
  try {
    console.log('🔐 Generating password hash...');
    const passwordHash = await bcrypt.hash(config.password, 10);
    console.log('✓ Password hash generated');
    
    console.log('\n📡 Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      dateStrings: true
    });
    console.log('✓ Connected to database');
    
    // Check if username already exists
    console.log('\n🔍 Checking if username already exists...');
    const [existingUsers] = await connection.execute(
      'SELECT id, username, email, is_super_admin FROM users WHERE username = ? OR email = ?',
      [config.username, config.email]
    );
    
    if (existingUsers.length > 0) {
      const existing = existingUsers[0];
      console.log('⚠️  User already exists!');
      console.log('   Username:', existing.username);
      console.log('   Email:', existing.email);
      console.log('   Is Super Admin:', existing.is_super_admin ? 'Yes' : 'No');
      
      if (!existing.is_super_admin) {
        console.log('\n🔄 Promoting existing user to super admin...');
        await connection.execute(
          'UPDATE users SET is_super_admin = 1 WHERE id = ?',
          [existing.id]
        );
        console.log('✓ User promoted to super admin!');
      } else {
        console.log('\n✓ User already has super admin access');
      }
    } else {
      // Create new super admin user
      console.log('\n➕ Creating new super admin user...');
      const [result] = await connection.execute(
        `INSERT INTO users (
          username,
          password_hash,
          email,
          full_name,
          is_super_admin,
          account_type,
          status,
          is_active,
          created_at
        ) VALUES (?, ?, ?, ?, 1, 'employee', 'active', 1, NOW())`,
        [config.username, passwordHash, config.email, config.fullName]
      );
      
      console.log('✓ Super admin user created successfully!');
      console.log('   User ID:', result.insertId);
    }
    
    // Verify and display all super admins
    console.log('\n📋 All Super Admin Users:');
    console.log('═══════════════════════════════════════════════════════════════');
    const [superAdmins] = await connection.execute(
      `SELECT 
        id,
        username,
        email,
        full_name,
        is_super_admin,
        status,
        created_at
      FROM users 
      WHERE is_super_admin = 1
      ORDER BY created_at DESC`
    );
    
    if (superAdmins.length === 0) {
      console.log('   No super admin users found');
    } else {
      superAdmins.forEach((admin, index) => {
        console.log(`\n   ${index + 1}. ${admin.username} (ID: ${admin.id})`);
        console.log(`      Email: ${admin.email}`);
        console.log(`      Name: ${admin.full_name || 'N/A'}`);
        console.log(`      Status: ${admin.status}`);
        console.log(`      Created: ${admin.created_at}`);
      });
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('\n✅ Setup Complete!');
    console.log('\n📝 Login Credentials:');
    console.log('   Username:', config.username);
    console.log('   Password:', config.password);
    console.log('   Email:', config.email);
    console.log('\n🔗 Next Steps:');
    console.log('   1. Login at /signin');
    console.log('   2. Verify access to /reports/project-activities');
    console.log('   3. Check /projects - should see ALL projects');
    console.log('   4. Access /admin/dashboard');
    console.log('\n⚡ Super admin has access to:');
    console.log('   - All projects (regardless of team membership)');
    console.log('   - Project activities report with edit capabilities');
    console.log('   - All reports and admin features');
    console.log('   - User management');
    console.log('   - All modules in the system');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'ER_DUP_ENTRY') {
      console.error('   User with this username or email already exists');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('   Could not connect to database. Check your .env.local configuration');
    } else {
      console.error('   Full error:', error);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n📡 Database connection closed');
    }
  }
}

// Run the script
console.log('═══════════════════════════════════════════════════════════════');
console.log('           Super Admin Setup Script');
console.log('═══════════════════════════════════════════════════════════════\n');

createSuperAdmin().then(() => {
  console.log('\n🎉 Done!\n');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});
