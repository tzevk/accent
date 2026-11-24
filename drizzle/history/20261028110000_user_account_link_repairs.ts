import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

const REPAIR_TABLE = 'user_account_link_repairs';

export async function up(db: MigrationDb): Promise<void> {
	await executeMigrationSql(
		db,
		`
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
	`
	);
}
