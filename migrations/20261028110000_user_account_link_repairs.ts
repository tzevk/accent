import type { Knex } from 'knex';

const REPAIR_TABLE = 'user_account_link_repairs';

async function hasTable(knex: Knex): Promise<boolean> {
	const [rows] = await knex.raw(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
		[REPAIR_TABLE]
	);
	return rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
	await knex.raw(`
		CREATE TABLE IF NOT EXISTS \`${REPAIR_TABLE}\` (
			id INT NOT NULL AUTO_INCREMENT,
			user_id INT NOT NULL,
			actor_user_id INT NOT NULL,
			previous_employee_id INT NULL,
			employee_id INT NULL,
			reason TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_user_account_link_repairs_user_created (user_id, created_at),
			KEY idx_user_account_link_repairs_actor_created (actor_user_id, created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);
}

export async function down(knex: Knex): Promise<void> {
	if (!(await hasTable(knex))) return;
	const [rows] = await knex.raw(
		`SELECT COUNT(*) AS repair_count FROM \`${REPAIR_TABLE}\``
	);
	if (Number(rows[0]?.repair_count ?? 0) > 0) {
		throw new Error(
			'Cannot roll back user-account repairs while audit records exist; preserve the immutable repair ledger.'
		);
	}
	await knex.raw(`DROP TABLE \`${REPAIR_TABLE}\``);
}
