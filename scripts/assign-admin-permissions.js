/**
 * Script to assign ALL permissions to admin@accent.com
 * Run with: node scripts/assign-admin-permissions.js
 */

require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

const RESOURCES = {
  LEADS: 'leads',
  PROJECTS: 'projects', 
  EMPLOYEES: 'employees',
  USERS: 'users',
  COMPANIES: 'companies',
  VENDORS: 'vendors',
  PROPOSALS: 'proposals',
  DASHBOARD: 'dashboard',
  REPORTS: 'reports',
  WORK_LOGS: 'work_logs',
  MESSAGES: 'messages',
  PROFILE: 'profile',
  ACTIVITIES: 'activities',
  SOFTWARE: 'software',
  DOCUMENTS: 'documents',
  ROLES: 'roles',
  SETTINGS: 'settings',
  ADMIN_MONITORING: 'admin_monitoring',
  ADMIN_ACTIVITY_LOGS: 'admin_activity_logs',
  ADMIN_AUDIT_LOGS: 'admin_audit_logs',
  ADMIN_PRODUCTIVITY: 'admin_productivity'
};

const PERMISSIONS = {
  READ: 'read',
  CREATE: 'create', 
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  IMPORT: 'import',
  APPROVE: 'approve',
  ASSIGN: 'assign'
};

async function assignAllPermissions() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'accentcrm'
  });

  try {
    // Generate all permission keys
    const allPermissions = [];
    Object.values(RESOURCES).forEach(resource => {
      Object.values(PERMISSIONS).forEach(permission => {
        allPermissions.push(`${resource}:${permission}`);
      });
    });

    console.log(`Generated ${allPermissions.length} permission keys`);

    // Find admin@accent.com user
    const [users] = await connection.execute(
      'SELECT id, email, username, permissions, is_super_admin FROM users WHERE email = ?',
      ['admin@accent.com']
    );

    if (users.length === 0) {
      console.error('User admin@accent.com not found!');
      return;
    }

    const user = users[0];
    console.log(`Found user: ${user.email} (ID: ${user.id})`);
    console.log(`Current is_super_admin: ${user.is_super_admin}`);

    // Update user with all permissions and set as super admin
    await connection.execute(
      'UPDATE users SET permissions = ?, is_super_admin = 1 WHERE id = ?',
      [JSON.stringify(allPermissions), user.id]
    );

    console.log('\n✅ Successfully assigned ALL permissions to admin@accent.com');
    console.log(`   Total permissions: ${allPermissions.length}`);
    console.log('   Also set is_super_admin = 1');

    // Verify the update
    const [updated] = await connection.execute(
      'SELECT permissions, is_super_admin FROM users WHERE id = ?',
      [user.id]
    );

    if (updated.length > 0) {
      const perms = JSON.parse(updated[0].permissions || '[]');
      console.log(`\n   Verified: ${perms.length} permissions stored`);
      console.log(`   is_super_admin: ${updated[0].is_super_admin}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

assignAllPermissions();
