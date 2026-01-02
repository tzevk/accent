import dotenv from 'dotenv';
import { createConnection } from 'mysql2/promise';

dotenv.config({ path: '.env.local' });

async function listUsersPermissions() {
  const db = await createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('\n=== All Users and Their Permissions ===\n');

  const [users] = await db.execute(
    'SELECT id, username, email, is_super_admin, permissions, role_id FROM users ORDER BY id'
  );

  for (const u of users) {
    let permCount = 0;
    let perms = u.permissions;
    if (typeof perms === 'string') {
      try {
        perms = JSON.parse(perms);
        permCount = perms.length;
      } catch {}
    } else if (Array.isArray(perms)) {
      permCount = perms.length;
    }
    
    console.log(`ID: ${u.id} | ${u.email || u.username}`);
    console.log(`   Super Admin: ${u.is_super_admin ? 'YES' : 'NO'} | Role ID: ${u.role_id || 'None'} | Permissions: ${permCount > 0 ? permCount + ' items' : 'NONE'}`);
    if (permCount > 0 && permCount <= 20) {
      console.log(`   Perms: ${JSON.stringify(perms)}`);
    }
    console.log('');
  }

  await db.end();
}

listUsersPermissions().catch(console.error);
