/**
 * Leave Application System
 *
 * - leave_types        : master list (code maps to payroll / employee_attendance
 *                        status codes PL | CL | SL | EL | UL | LWP so approvals
 *                        feed salary math correctly)
 * - leave_applications : employee requests + admin review workflow
 * - employee_leaves    : per-year balance ledger. Column names intentionally
 *                        match the existing reader in
 *                        src/app/api/users/[id]/attendance/route.js which
 *                        already probes this table (employee_id, year,
 *                        total_leaves, used_leaves).
 *
 * Also grants leaves:* permission keys to existing roles_master entries.
 */

const SEED_TYPES = [
	// name, code, is_paid, annual quota, consumes balance
	['Privilege Leave', 'PL', 1, 21, 1],
	['Casual Leave', 'CL', 1, 12, 1],
	['Sick Leave', 'SL', 1, 7, 1],
	['Earned Leave', 'EL', 1, 15, 1],
	['Loss of Pay', 'LWP', 0, 0, 0],
	['Unpaid Leave', 'UL', 0, 0, 0],
];

// role_code -> permission actions granted on the leaves resource
const ROLE_GRANTS = {
	super_admin: ['read', 'create', 'update', 'delete', 'approve'],
	project_manager: ['read', 'create', 'approve'],
	employee: ['read', 'create'],
};

function grantKeysFor(roleCode) {
	const actions =
		ROLE_GRANTS[roleCode] ||
		// Unknown roles fall back to the same baseline as "employee"
		ROLE_GRANTS.employee;
	return actions.map((action) => `leaves:${action}`);
}

function parsePermissions(raw) {
	// mysql2/knex may deliver this LONGTEXT column already JSON-parsed.
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter((k) => typeof k === 'string');
	if (typeof raw === 'object') {
		return Object.values(raw).filter((k) => typeof k === 'string');
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((k) => typeof k === 'string')
			: [];
	} catch (_) {
		return [];
	}
}

async function grantLeavesPermissions(knex) {
	const roles = await knex
		.select('id', 'role_code', 'permissions')
		.from('roles_master');

	for (const role of roles) {
		const current = parsePermissions(role.permissions);
		const merged = new Set([...current, ...grantKeysFor(role.role_code)]);
		const next = Array.from(merged);

		if (next.length !== current.length) {
			await knex('roles_master')
				.where({ id: role.id })
				.update({ permissions: JSON.stringify(next) });
		}
	}
}

async function revokeLeavesPermissions(knex) {
	const roles = await knex
		.select('id', 'role_code', 'permissions')
		.from('roles_master');

	for (const role of roles) {
		let current = [];
		try {
			current = JSON.parse(role.permissions || '[]');
			if (!Array.isArray(current)) current = [];
		} catch (_) {
			current = [];
		}

		const revoked = current.filter(
			(key) => typeof key !== 'string' || !key.startsWith('leaves:')
		);

		if (revoked.length !== current.length) {
			await knex('roles_master')
				.where({ id: role.id })
				.update({ permissions: JSON.stringify(revoked) });
		}
	}
}

export async function up(knex) {
	await knex.raw(`
    CREATE TABLE IF NOT EXISTS leave_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      code VARCHAR(10) NOT NULL COMMENT 'Matches payroll/attendance status codes PL CL SL EL UL LWP',
      description VARCHAR(255) DEFAULT NULL,
      is_paid TINYINT(1) NOT NULL DEFAULT 1,
      default_annual_quota DECIMAL(5,1) NOT NULL DEFAULT 0.0,
      requires_balance TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 for LOP-type leaves that draw no quota',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      deleted_by INT NULL DEFAULT NULL,
      active_code VARCHAR(10)
        GENERATED ALWAYS AS (IF(isDelete = 0, code, NULL)) STORED,
      UNIQUE KEY uq_active_leave_type_code (active_code),
      KEY idx_isDelete (isDelete)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

	await knex.raw(`
    CREATE TABLE IF NOT EXISTS leave_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT 'Applicant (users.id)',
      leave_type_id INT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      half_day TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Only allowed when start_date = end_date',
      duration_days DECIMAL(5,1) NOT NULL DEFAULT 1.0,
      reason TEXT DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        COMMENT 'pending | approved | rejected (VARCHAR not ENUM per house convention)',
      reviewed_by INT NULL DEFAULT NULL,
      reviewed_at DATETIME NULL DEFAULT NULL,
      review_notes TEXT DEFAULT NULL COMMENT 'Admin comments on approval/rejection',
      written_attendance LONGTEXT DEFAULT NULL
        COMMENT 'Audit trail for approval side-effects: {attendance:[{date,prev_status}],balances:[{leave_type_id,year,days}]}'
        CHECK (written_attendance IS NULL OR json_valid(written_attendance)),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      KEY idx_leave_user (user_id),
      KEY idx_leave_status (status),
      KEY idx_leave_dates (start_date, end_date),
      KEY idx_isDelete (isDelete),
      CONSTRAINT fk_leave_app_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_leave_app_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_leave_app_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

	await knex.raw(`
    CREATE TABLE IF NOT EXISTS employee_leaves (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL COMMENT 'employees.id — matches the legacy reader contract',
      leave_type_id INT NOT NULL,
      year SMALLINT NOT NULL,
      total_leaves DECIMAL(5,1) NOT NULL DEFAULT 0.0,
      used_leaves DECIMAL(5,1) NOT NULL DEFAULT 0.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_emp_type_year (employee_id, leave_type_id, year),
      CONSTRAINT fk_emp_leaves_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
      CONSTRAINT fk_emp_leaves_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

	// Seed standard leave types (idempotent on code)
	for (const [name, code, isPaid, quota, requiresBalance] of SEED_TYPES) {
		await knex.raw(
			`INSERT INTO leave_types (name, code, is_paid, default_annual_quota, requires_balance)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE code = ?)`,
			[name, code, isPaid, quota, requiresBalance, code]
		);
	}

	await grantLeavesPermissions(knex);
}

export async function down(knex) {
	await revokeLeavesPermissions(knex);
	await knex.raw('DROP TABLE IF EXISTS employee_leaves');
	await knex.raw('DROP TABLE IF EXISTS leave_applications');
	await knex.raw('DROP TABLE IF EXISTS leave_types');
}
