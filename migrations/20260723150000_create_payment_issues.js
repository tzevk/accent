export async function up(knex) {
	await knex.raw(`
    CREATE TABLE IF NOT EXISTS payment_issues (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payee_name VARCHAR(255) NOT NULL,
      payee_type ENUM('company', 'vendor') DEFAULT 'company',
      invoice_number VARCHAR(100) DEFAULT NULL,
      invoice_date DATE DEFAULT NULL,
      invoice_amount DECIMAL(15,2) DEFAULT 0.00,
      amount DECIMAL(15,2) DEFAULT 0.00,
      deduction DECIMAL(15,2) DEFAULT 0.00,
      net_amount DECIMAL(15,2) DEFAULT 0.00,
      issue_date DATE DEFAULT NULL,
      transaction_reference VARCHAR(255) DEFAULT NULL,
      bank_name VARCHAR(255) DEFAULT NULL,
      status ENUM('full', 'part') DEFAULT 'full',
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_payee (payee_name),
      INDEX idx_invoice (invoice_number),
      INDEX idx_status (status),
      INDEX idx_isDelete (isDelete)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export async function down(knex) {
	await knex.raw('DROP TABLE IF EXISTS payment_issues');
}
