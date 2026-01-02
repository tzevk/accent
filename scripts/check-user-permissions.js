import dotenv from 'dotenv';
import { createConnection } from 'mysql2/promise';

dotenv.config({ path: '.env.local' });

async function checkPermissions() {
  const db = await createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  // Get the user by email
  const email = process.argv[2] || 'admin@accent.com';
  
  console.log('\n=== Checking permissions for:', email, '===\n');

  const [users] = await db.execute(
    'SELECT id, username, email, permissions, is_super_admin, role_id FROM users WHERE email = ?',
    [email]
  );

  if (users.length === 0) {
    console.log('User not found!');
    await db.end();
    return;
  }

  const user = users[0];
  console.log('User ID:', user.id);
  console.log('Username:', user.username);
  console.log('Is Super Admin:', user.is_super_admin ? 'YES' : 'NO');
  console.log('Role ID:', user.role_id);
  
  let perms = user.permissions;
  console.log('\nRaw permissions type:', typeof perms);
  console.log('Raw permissions value:', perms ? String(perms).substring(0, 300) : 'NULL');
  
  if (typeof perms === 'string') {
    try {
      perms = JSON.parse(perms);
      console.log('\nParsed as JSON array with', perms.length, 'permissions');
      console.log('First 10 permissions:', perms.slice(0, 10));
    } catch (e) {
      console.log('Failed to parse permissions JSON:', e.message);
    }
  } else if (perms === null) {
    console.log('Permissions are NULL');
  }

  // Check role permissions if role_id exists
  if (user.role_id) {
    const [roles] = await db.execute(
      'SELECT id, role_name, permissions FROM roles_master WHERE id = ?',
      [user.role_id]
    );
    if (roles.length > 0) {
      console.log('\nRole:', roles[0].role_name);
      let rolePerms = roles[0].permissions;
      if (typeof rolePerms === 'string') {
        try {
          rolePerms = JSON.parse(rolePerms);
          console.log('Role permissions count:', rolePerms.length);
        } catch {
          console.log('Could not parse role permissions');
        }
      }
    }
  }

  await db.end();
  console.log('\n=== Done ===\n');
}

checkPermissions().catch(console.error);
