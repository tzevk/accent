/**
 * Database Schema Initialization
 *
 * This module handles all table creation and schema migrations.
 * It should be run ONCE at application startup, not on every API request.
 *
 * Usage:
 * - Import and call ensureSchema() in your app initialization
 * - Or run via: node scripts/init-schema.js
 */

import { dbConnect } from '@/utils/database';

let schemaInitialized = false;
let initPromise = null;

/**
 * Ensures all required tables exist with correct schema.
 * Safe to call multiple times - will only run once per process.
 */
export async function ensureSchema() {
	// Return cached promise if already initializing/initialized
	if (initPromise) return initPromise;
	if (schemaInitialized) return true;

	initPromise = doSchemaInit();
	return initPromise;
}

async function doSchemaInit() {
	const startTime = Date.now();
	console.log('🔧 Initializing database schema...');

	const db = await dbConnect();

	try {
		// Run all schema creation in parallel where safe
		await Promise.all([
			initCompaniesTable(db),
			initUsersTable(db),
			initBankMasterTable(db),
			initCategoryMasterTable(db),
			initDescriptionMasterTable(db),
		]);

		// Tables with foreign keys - run after base tables
		await Promise.all([
			initLeadsTable(db),
			initProjectsTable(db),
			initProposalsTable(db),
		]);

		// Tables depending on the above
		await Promise.all([
			initFollowUpsTable(db),
			initWorkLogsTable(db),
			initUserActivityAssignmentsTable(db),
			initOutgoingPurchaseOrdersTable(db),
			initPaymentEntriesTable(db),
			initOutgoingQuotationsTable(db),
		]);

		// Independent financial tables
		await Promise.all([
			initCashVouchersTable(db),
			initPettyCashExpensesTable(db),
			initPurchaseOrdersTable(db),
			initInvoicesTable(db),
		]);

		schemaInitialized = true;
		const elapsed = Date.now() - startTime;
		console.log(`✅ Database schema initialized in ${elapsed}ms`);

		return true;
	} catch (error) {
		console.error('❌ Schema initialization failed:', error);
		throw error;
	} finally {
		db.release();
	}
}

async function initCompaniesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS companies (
      id INT PRIMARY KEY AUTO_INCREMENT,
      company_id VARCHAR(50) UNIQUE,
      company_name VARCHAR(255) NOT NULL,
      industry VARCHAR(100),
      company_size VARCHAR(50),
      website VARCHAR(255),
      phone VARCHAR(20),
      email VARCHAR(255),
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100),
      postal_code VARCHAR(20),
      description TEXT,
      founded_year INT,
      revenue VARCHAR(100),
      notes TEXT,
      location VARCHAR(255),
      contact_person VARCHAR(100),
      designation VARCHAR(100),
      mobile_number VARCHAR(20),
      sector VARCHAR(100),
      gstin VARCHAR(15),
      pan_number VARCHAR(10),
      company_profile TEXT,
      state_code VARCHAR(10),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

	// Alter statements to safely migrate existing databases
	const alterStatements = [
		'ALTER TABLE companies ADD COLUMN gstin VARCHAR(15)',
		'ALTER TABLE companies ADD COLUMN pan_number VARCHAR(10)',
		'ALTER TABLE companies ADD COLUMN company_profile TEXT',
		'ALTER TABLE companies ADD COLUMN state_code VARCHAR(10)',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			// Ignore duplicate column errors (errno 1060 / ER_DUP_FIELDNAME)
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Companies table schema update warning:', e.message || e);
			}
		}
	}
}

async function initUsersTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_super_admin BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initLeadsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS leads (
      id INT PRIMARY KEY AUTO_INCREMENT,
      lead_id VARCHAR(50),
      company_id INT NULL,
      company_name VARCHAR(255),
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      inquiry_email VARCHAR(255),
      cc_emails TEXT,
      phone VARCHAR(50),
      designation VARCHAR(255),
      city VARCHAR(255),
      project_description TEXT,
      enquiry_type VARCHAR(100),
      enquiry_status VARCHAR(100),
      enquiry_date DATE,
      lead_source VARCHAR(100),
      priority VARCHAR(50),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initProjectsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INT PRIMARY KEY AUTO_INCREMENT,
      project_id VARCHAR(50) UNIQUE,
      name VARCHAR(255) NOT NULL,
      project_title VARCHAR(255),
      project_code VARCHAR(100),
      description TEXT,
      company_id INT,
      client_name VARCHAR(255),
      project_manager VARCHAR(255),
      start_date DATE,
      end_date DATE,
      target_date DATE,
      budget DECIMAL(15,2),
      status VARCHAR(50) DEFAULT 'NEW',
      priority VARCHAR(50) DEFAULT 'MEDIUM',
      progress INT DEFAULT 0,
      type VARCHAR(50) DEFAULT 'ONGOING',
      proposal_id INT,
      assigned_to VARCHAR(255),
      assignments JSON,
      project_schedule TEXT,
      input_document LONGTEXT,
      list_of_deliverables TEXT,
      kickoff_meeting TEXT,
      in_house_meeting TEXT,
      project_assumption_list LONGTEXT,
      project_lessons_learnt_list LONGTEXT,
      software_items LONGTEXT,
      project_team TEXT,
      project_activities_list LONGTEXT,
      planning_activities_list LONGTEXT,
      documents_list LONGTEXT,
      input_documents_list LONGTEXT,
      kickoff_meetings_list LONGTEXT,
      internal_meetings_list LONGTEXT,
      documents_received_list LONGTEXT,
      documents_issued_list LONGTEXT,
      project_handover_list LONGTEXT,
      project_manhours_list LONGTEXT,
      project_query_log_list LONGTEXT,
      project_schedule_list LONGTEXT,
      revision TEXT,
      site_visit TEXT,
      quotation_validity TEXT,
      duration TEXT,
      mode_of_delivery TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initProposalsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS proposals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      proposal_id VARCHAR(50) UNIQUE,
      title VARCHAR(255),
      description TEXT,
      company_id INT,
      lead_id INT,
      status VARCHAR(50) DEFAULT 'draft',
      amount DECIMAL(15,2),
      quotation_number VARCHAR(100),
      quotation_date DATE,
      enquiry_number VARCHAR(100),
      enquiry_date DATE,
      quotation_validity VARCHAR(255),
      billing_payment_terms TEXT,
      other_terms TEXT,
      general_terms TEXT,
      software VARCHAR(255),
      duration VARCHAR(100),
      budget DECIMAL(15,2),
      planned_start_date DATE,
      planned_end_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initFollowUpsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INT PRIMARY KEY AUTO_INCREMENT,
      lead_id INT,
      follow_up_date DATE,
      follow_up_type VARCHAR(100),
      notes TEXT,
      status VARCHAR(50),
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);
}

async function initWorkLogsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      project_id VARCHAR(50),
      log_date DATE,
      hours_worked DECIMAL(5,2),
      description TEXT,
      activity_type VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_date (project_id, log_date),
      INDEX idx_user_date (user_id, log_date)
    )
  `);
}

async function initUserActivityAssignmentsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS user_activity_assignments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      project_id VARCHAR(50),
      activity_name VARCHAR(255),
      description TEXT,
      status VARCHAR(50) DEFAULT 'Not Started',
      priority VARCHAR(50) DEFAULT 'Medium',
      due_date DATE,
      estimated_hours DECIMAL(10,2),
      actual_hours DECIMAL(10,2),
      assigned_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_status (user_id, status),
      INDEX idx_project (project_id),
      INDEX idx_due_date (due_date)
    )
  `);
}

async function initBankMasterTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS bank_master (
      BankID VARCHAR(36) PRIMARY KEY,
      BankCode VARCHAR(10) UNIQUE,
      BankName VARCHAR(255) NOT NULL,
      IFSC_Prefix CHAR(4),
      SWIFT_Code VARCHAR(11),
      LEI_Code VARCHAR(20),
      HeadOfficeAddress TEXT,
      IsActive BOOLEAN DEFAULT TRUE,
      CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function initOutgoingPurchaseOrdersTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS outgoing_purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sr_no INT,
      company_name VARCHAR(255) NOT NULL,
      city VARCHAR(255),
      po_number VARCHAR(100) NOT NULL,
      po_date DATE,
      po_amount DECIMAL(15, 2) NOT NULL,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      project_number VARCHAR(100),
      description VARCHAR(500),
      remarks TEXT,
      status ENUM('draft', 'pending', 'approved', 'completed', 'cancelled') DEFAULT 'pending',
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE outgoing_purchase_orders ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
		'ALTER TABLE outgoing_purchase_orders ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
		'ALTER TABLE outgoing_purchase_orders ADD COLUMN tax_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE outgoing_purchase_orders ADD COLUMN net_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE outgoing_purchase_orders ADD COLUMN description VARCHAR(500)',
		"ALTER TABLE outgoing_purchase_orders MODIFY COLUMN status ENUM('draft', 'pending', 'approved', 'completed', 'cancelled') DEFAULT 'pending'",
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn(
					'Outgoing purchase orders schema update warning:',
					e.message || e
				);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE outgoing_purchase_orders DROP INDEX po_number',
		'ALTER TABLE outgoing_purchase_orders ADD UNIQUE KEY unique_active_po (po_number, isDelete)',
	];

	for (const stmt of indexMigrations) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (
				!e.message?.includes('check that it exists') &&
				!e.message?.includes('Duplicate key name')
			) {
				console.warn(
					'Outgoing purchase orders index migration warning:',
					e.message || e
				);
			}
		}
	}
}

async function initPaymentEntriesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_entries (
      id VARCHAR(255) PRIMARY KEY,
      company_name VARCHAR(255) NOT NULL,
      city VARCHAR(255),
      receipt_no VARCHAR(100),
      receipt_date DATE,
      amount DECIMAL(15, 2) DEFAULT 0,
      payment_date DATE,
      transaction_id VARCHAR(100),
      bank_name VARCHAR(255),
      remark TEXT,
      invoice_no VARCHAR(100),
      invoice_date DATE,
      created_by INT,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE payment_entries ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
		'ALTER TABLE payment_entries ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
		'ALTER TABLE payment_entries ADD COLUMN created_by INT',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Payment entries schema update warning:', e.message || e);
			}
		}
	}
}

async function initCategoryMasterTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS category_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initDescriptionMasterTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS description_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      description_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function initOutgoingQuotationsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS outgoing_quotations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quotation_number VARCHAR(50) NOT NULL,
      quotation_date DATE,
      vendor_name VARCHAR(255) NOT NULL,
      vendor_email VARCHAR(255),
      vendor_phone VARCHAR(50),
      vendor_address TEXT,
      subject VARCHAR(500),
      items JSON,
      subtotal DECIMAL(15, 2) DEFAULT 0,
      tax_rate DECIMAL(5, 2) DEFAULT 18,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      discount DECIMAL(15, 2) DEFAULT 0,
      total DECIMAL(15, 2) DEFAULT 0,
      valid_until DATE,
      notes TEXT,
      terms TEXT,
      status ENUM('draft', 'sent', 'approved', 'rejected', 'expired') DEFAULT 'draft',
      project_id INT NULL,
      created_by INT,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_vendor (vendor_name),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE outgoing_quotations ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
		'ALTER TABLE outgoing_quotations ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn(
					'Outgoing quotations schema update warning:',
					e.message || e
				);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE outgoing_quotations DROP INDEX quotation_number',
		'ALTER TABLE outgoing_quotations ADD UNIQUE KEY unique_active_quotation (quotation_number, isDelete)',
	];

	for (const stmt of indexMigrations) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (
				!e.message?.includes('check that it exists') &&
				!e.message?.includes('Duplicate key name')
			) {
				console.warn(
					'Outgoing quotations index migration warning:',
					e.message || e
				);
			}
		}
	}
}

async function initCashVouchersTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS cash_vouchers (
      id INT PRIMARY KEY AUTO_INCREMENT,
      voucher_number VARCHAR(50) UNIQUE,
      voucher_date DATE,
      voucher_type ENUM('payment', 'receipt') DEFAULT 'payment',
      paid_to VARCHAR(255),
      project_number VARCHAR(100),
      payment_mode ENUM('cash', 'cheque') DEFAULT 'cash',
      total_amount DECIMAL(15,2) DEFAULT 0,
      amount_in_words TEXT,
      line_items JSON,
      prepared_by VARCHAR(255),
      checked_by VARCHAR(255),
      approved_by_name VARCHAR(255),
      receiver_signature VARCHAR(255),
      description VARCHAR(500),
      status ENUM('pending', 'approved', 'rejected', 'paid') DEFAULT 'pending',
      approved_by INT,
      approved_at DATETIME,
      notes TEXT,
      created_by INT,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE cash_vouchers ADD COLUMN paid_to VARCHAR(255)',
		'ALTER TABLE cash_vouchers ADD COLUMN project_number VARCHAR(100)',
		'ALTER TABLE cash_vouchers ADD COLUMN total_amount DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE cash_vouchers ADD COLUMN amount_in_words TEXT',
		'ALTER TABLE cash_vouchers ADD COLUMN line_items JSON',
		'ALTER TABLE cash_vouchers ADD COLUMN prepared_by VARCHAR(255)',
		'ALTER TABLE cash_vouchers ADD COLUMN checked_by VARCHAR(255)',
		'ALTER TABLE cash_vouchers ADD COLUMN approved_by_name VARCHAR(255)',
		'ALTER TABLE cash_vouchers ADD COLUMN receiver_signature VARCHAR(255)',
		'ALTER TABLE cash_vouchers ADD COLUMN description VARCHAR(500)',
		'ALTER TABLE cash_vouchers ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Cash vouchers schema update warning:', e.message || e);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE cash_vouchers DROP INDEX voucher_number',
		'ALTER TABLE cash_vouchers ADD UNIQUE KEY unique_active_voucher (voucher_number, isDelete)',
	];

	for (const stmt of indexMigrations) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (
				!e.message?.includes('check that it exists') &&
				!e.message?.includes('Duplicate key name')
			) {
				console.warn('Cash vouchers index migration warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute(`
      UPDATE cash_vouchers
      SET description = COALESCE(
        JSON_UNQUOTE(JSON_EXTRACT(line_items, '$[0].description')),
        notes
      )
      WHERE description IS NULL
    `);
	} catch {
		/* ignore - JSON_EXTRACT may fail on empty line_items */
	}
}

async function initPettyCashExpensesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS petty_cash_expenses (
      id CHAR(36) NOT NULL PRIMARY KEY,
      transaction_number VARCHAR(50) UNIQUE NOT NULL,
      transaction_date DATE NOT NULL,
      transaction_type ENUM('receipt', 'payment') NOT NULL DEFAULT 'payment',
      expense_category VARCHAR(100) NULL,
      description VARCHAR(500) NULL,
      amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
      payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') DEFAULT 'cash',
      payment_reference VARCHAR(255) NULL,
      recipient_name VARCHAR(255) NULL,
      custodian_employee_id INT NULL,
      custodian_employee_name VARCHAR(255) NULL,
      bill_no VARCHAR(100) NULL,
      bill_date DATE NULL,
      status ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
      approved_by INT NULL,
      approved_by_name VARCHAR(255) NULL,
      approved_at DATETIME NULL,
      notes TEXT NULL,
      created_by INT NULL,
      source_voucher_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_transaction_date (transaction_date),
      INDEX idx_transaction_type (transaction_type),
      INDEX idx_category (expense_category),
      INDEX idx_status (status),
      INDEX idx_custodian (custodian_employee_id),
      INDEX idx_source_voucher (source_voucher_id)
    )
  `);

	const alterStatements = [
		'ALTER TABLE petty_cash_expenses ADD COLUMN credit_amount DECIMAL(15,2) NOT NULL DEFAULT 0',
		'ALTER TABLE petty_cash_expenses ADD COLUMN debit_amount DECIMAL(15,2) NOT NULL DEFAULT 0',
		'ALTER TABLE petty_cash_expenses ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
		'ALTER TABLE petty_cash_expenses ADD COLUMN source_voucher_id INT NULL',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
			if (stmt.includes('credit_amount') || stmt.includes('debit_amount')) {
				await db.execute(`
          UPDATE petty_cash_expenses SET
            credit_amount = IF(transaction_type = 'receipt', amount, 0),
            debit_amount  = IF(transaction_type = 'payment', amount, 0)
        `);
			}
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn(
					'Petty cash expenses schema update warning:',
					e.message || e
				);
			}
		}
	}

	try {
		await db.execute(`
      UPDATE petty_cash_expenses pce
      INNER JOIN cash_vouchers cv ON pce.transaction_number = cv.voucher_number
      SET pce.source_voucher_id = cv.id
      WHERE pce.source_voucher_id IS NULL
        AND pce.transaction_number IS NOT NULL
        AND pce.isDelete = 0
        AND pce.transaction_number LIKE 'CV-%'
    `);
	} catch {
		/* ignore - tables may not exist yet */
	}
}

async function initPurchaseOrdersTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      po_number VARCHAR(100) NOT NULL,
      client_name VARCHAR(255) NOT NULL,
      original_value DECIMAL(15, 2) NOT NULL DEFAULT 0,
      remaining_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
      po_date DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_po (po_number(100), client_name(255))
    )
  `);
}

async function initInvoicesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_number VARCHAR(50) NOT NULL,
      invoice_date DATE,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      client_address TEXT,
      client_pan VARCHAR(20),
      client_gstin VARCHAR(20),
      client_state VARCHAR(100),
      client_state_code VARCHAR(10),
      kind_attn VARCHAR(255),
      po_number VARCHAR(100),
      po_date DATE,
      po_value DECIMAL(15, 2),
      original_po_value DECIMAL(15, 2),
      balance_po_value DECIMAL(15, 2),
      description VARCHAR(500),
      items JSON,
      line_items JSON,
      subtotal DECIMAL(15, 2) DEFAULT 0,
      gross_amount DECIMAL(15, 2) DEFAULT 0,
      tax_rate DECIMAL(5, 2) DEFAULT 18,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      gst_type VARCHAR(20) DEFAULT 'cgst_sgst',
      cgst_rate DECIMAL(5, 2) DEFAULT 9,
      sgst_rate DECIMAL(5, 2) DEFAULT 9,
      igst_rate DECIMAL(5, 2) DEFAULT 18,
      discount DECIMAL(15, 2) DEFAULT 0,
      total DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      amount_in_words VARCHAR(500),
      gst_number VARCHAR(20),
      pan_number VARCHAR(20),
      tan_number VARCHAR(20),
      service_category VARCHAR(500),
      bank_address VARCHAR(500),
      amount_paid DECIMAL(15, 2) DEFAULT 0,
      balance_due DECIMAL(15, 2) DEFAULT 0,
      notes TEXT,
      terms TEXT,
      due_date DATE,
      status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled') DEFAULT 'draft',
      po_id INT NULL,
      created_by INT,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      INDEX idx_due_date (due_date),
      INDEX idx_isDelete (isDelete),
      UNIQUE KEY unique_active_invoice (invoice_number, isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE invoices ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Invoices schema update warning:', e.message || e);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE invoices DROP INDEX invoice_number',
		'ALTER TABLE invoices ADD UNIQUE KEY unique_active_invoice (invoice_number, isDelete)',
	];

	for (const stmt of indexMigrations) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (
				!e.message?.includes('check that it exists') &&
				!e.message?.includes('Duplicate key name')
			) {
				console.warn('Invoices index migration warning:', e.message || e);
			}
		}
	}
}

/**
 * Check if schema is already initialized
 */
export function isSchemaInitialized() {
	return schemaInitialized;
}

// Export for direct CLI usage
export default ensureSchema;
