export async function up(knex) {
	await knex.raw(`
    CREATE TABLE sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	await knex.raw('CREATE INDEX idx_sessions_user ON sessions (user_id)');
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS sessions');
}
