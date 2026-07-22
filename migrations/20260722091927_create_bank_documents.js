export async function up(knex) {
	await knex.raw(`
    CREATE TABLE bank_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      bank_id VARCHAR(36) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
      document_name VARCHAR(255) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      uploaded_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bank_id) REFERENCES bank_master(BankID) ON DELETE CASCADE
    )
  `);
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS bank_documents');
}
