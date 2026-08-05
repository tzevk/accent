export async function up(knex) {
	await knex.raw(`
    CREATE TABLE deliverable_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      deleted_by INT NULL DEFAULT NULL,
      active_category_name VARCHAR(255)
        GENERATED ALWAYS AS (IF(isDelete = 0, category_name, NULL)) STORED,
      UNIQUE KEY uq_active_category_name (active_category_name),
      KEY idx_isDelete (isDelete)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS deliverable_categories');
}
