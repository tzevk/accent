import dotenv from 'dotenv';
import { dbConnect } from '../database.js';

// Load environment variables from .env.local (Next.js dev convention)
dotenv.config({ path: '.env.local' });

/**
 * Migration: Ensure Admin roles (role_hierarchy >= 80) include Users:Create
 * Policy rationale (industry standard):
 * - RBAC checks must remain exact (no hidden equivalence).
 * - Administrative roles should explicitly carry the capabilities they need.
 * - This migration seeds the minimum missing capability for onboarding (users:create).
 */
async function runMigration() {
  let connection;
  try {
    connection = await dbConnect();

    // Fetch active admin-level roles
    const [roles] = await connection.query(
      `SELECT id, role_name, role_hierarchy, permissions
       FROM roles_master
       WHERE status = 'active' AND role_hierarchy >= 80`
    );

    if (!roles || roles.length === 0) {
      console.log('ℹ️ No admin-level roles found (role_hierarchy >= 80). Nothing to seed.');
      return;
    }

    let updatedCount = 0;

    for (const role of roles) {
      let perms = [];
      try {
        perms = role.permissions ? JSON.parse(role.permissions) : [];
        if (!Array.isArray(perms)) perms = [];
      } catch {
        perms = [];
      }

      const usersCreate = 'users:create';
      if (!perms.includes(usersCreate)) {
        perms.push(usersCreate);
        await connection.query(
          'UPDATE roles_master SET permissions = ? WHERE id = ?',
          [JSON.stringify(perms), role.id]
        );
        updatedCount += 1;
        console.log(`✅ Added ${usersCreate} to role "${role.role_name}" (id=${role.id})`);
      } else {
        console.log(`✔️ Role "${role.role_name}" (id=${role.id}) already has ${usersCreate}`);
      }
    }

    if (updatedCount === 0) {
      console.log('ℹ️ All admin roles already include users:create.');
    } else {
      console.log(`🎉 Seed complete. Updated ${updatedCount} admin role(s).`);
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
