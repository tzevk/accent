import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

export async function up(db: MigrationDb): Promise<void> {
	await executeMigrationSql(
		db,
		`
    CREATE TABLE user_presence (
      user_id INT NOT NULL PRIMARY KEY,
      last_seen TIMESTAMP NULL DEFAULT NULL,
      is_idle TINYINT(1) NOT NULL DEFAULT 0,
      current_page VARCHAR(255) DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_presence_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `
	);
}
