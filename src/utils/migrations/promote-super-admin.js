import dotenv from 'dotenv';
import { dbConnect } from '../database.js';
import { RESOURCES, PERMISSIONS, generatePermissionKey } from '../rbac.js';

// Load env (use .env.local if present like Next.js dev)
dotenv.config({ path: '.env.local' });

function buildAllPermissions() {
	const perms = [];
	for (const resource of Object.values(RESOURCES)) {
		for (const perm of Object.values(PERMISSIONS)) {
			perms.push(generatePermissionKey(resource, perm));
		}
	}
	return perms;
}

async function ensureSchema(conn) {
	// Users table (minimal superset of fields we use)
	await conn.query(`
		CREATE TABLE IF NOT EXISTS users (
			id INT PRIMARY KEY AUTO_INCREMENT,
			username VARCHAR(50) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			email VARCHAR(100),
			employee_id INT DEFAULT NULL,
			role_id INT DEFAULT NULL,
			permissions JSON DEFAULT NULL,
			department VARCHAR(100) DEFAULT NULL,
			full_name VARCHAR(100) DEFAULT NULL,
			status ENUM('active','inactive') DEFAULT 'active',
			is_active BOOLEAN DEFAULT TRUE,
			is_super_admin BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			INDEX idx_username (username),
			INDEX idx_role_id (role_id)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
	`);

	// roles_master table
	await conn.query(`
		CREATE TABLE IF NOT EXISTS roles_master (
			id INT PRIMARY KEY AUTO_INCREMENT,
			role_code VARCHAR(50) UNIQUE NOT NULL,
			role_name VARCHAR(255) NOT NULL,
			role_hierarchy INT DEFAULT 0,
			department VARCHAR(100),
			permissions JSON,
			description TEXT,
			status ENUM('active','inactive') DEFAULT 'active',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
	`);
}

async function run() {
	const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@crmaccent.com';
	const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
	const adminUsername = (adminEmail.split('@')[0] || 'admin').toLowerCase();

	let conn;
	try {
		conn = await dbConnect();
		await ensureSchema(conn);

		// Ensure Administrator role exists with full permissions and hierarchy >= 90
		const fullPerms = buildAllPermissions();
		const [roleRows] = await conn.query(
			`SELECT id, role_hierarchy FROM roles_master WHERE role_code = 'ADMIN' OR role_name = 'Administrator' LIMIT 1`
		);

		let roleId;
		if (!roleRows || roleRows.length === 0) {
			const [ins] = await conn.query(
				`INSERT INTO roles_master (role_code, role_name, role_hierarchy, permissions, status, description)
				 VALUES ('ADMIN','Administrator', 90, ?, 'active', 'System Administrator with full access')`,
				[JSON.stringify(fullPerms)]
			);
			roleId = ins.insertId;
			console.log(`✅ Created Administrator role (id=${roleId})`);
		} else {
			roleId = roleRows[0].id;
			await conn.query(
				`UPDATE roles_master SET role_hierarchy = GREATEST(role_hierarchy, 90), permissions = ? WHERE id = ?`,
				[JSON.stringify(fullPerms), roleId]
			);
			console.log(`✔️ Ensured Administrator role (id=${roleId}) has full permissions`);
		}

		// Create or promote the admin user
		const [userRows] = await conn.query(
			`SELECT id, username, email FROM users WHERE email = ? OR username = ? LIMIT 1`,
			[adminEmail, adminUsername]
		);

		if (!userRows || userRows.length === 0) {
			const [insUser] = await conn.query(
				`INSERT INTO users (username, password_hash, email, role_id, permissions, status, is_active, is_super_admin, full_name)
				 VALUES (?, ?, ?, ?, ?, 'active', TRUE, TRUE, 'System Administrator')`,
				[adminUsername, adminPassword, adminEmail, roleId, JSON.stringify(fullPerms)]
			);
			console.log(`🎉 Created super admin user (id=${insUser.insertId}, email=${adminEmail})`);
		} else {
			const u = userRows[0];
			await conn.query(
				`UPDATE users SET password_hash = ?, role_id = ?, permissions = ?, status = 'active', is_active = TRUE, is_super_admin = TRUE WHERE id = ?`,
				[adminPassword, roleId, JSON.stringify(fullPerms), u.id]
			);
			console.log(`🔑 Promoted existing user (id=${u.id}, email=${u.email || adminEmail}) to super admin`);
		}

		console.log('✅ Super admin is ready. You can log in with:');
		console.log(`   Email: ${adminEmail}`);
		console.log(`   Password: ${adminPassword}`);
	} catch (err) {
		console.error('❌ Failed to create/promote super admin:', err);
		process.exit(1);
	} finally {
		if (conn) await conn.end();
	}
}

run();

