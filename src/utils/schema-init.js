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

async function ensureSoftDeleteColumns(db) {
	const columns = [
		{ table: 'quotations', def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0' },
		{
			table: 'project_quotations',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'proposal_followups',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'project_followups',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'project_invoices',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'companies',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'users',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'employees',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'vendors',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'support_tickets',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'expenses',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'other_expenses',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'payment_payables',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'payment_receivables',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'purchase_invoices',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'material_requisitions',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'follow_ups',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'software_categories',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'softwares',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
		{
			table: 'software_versions',
			def: 'isDelete TINYINT(1) NOT NULL DEFAULT 0',
		},
	];

	for (const { table, def } of columns) {
		try {
			await db.execute(`ALTER TABLE ${table} ADD COLUMN ${def}`);
		} catch (e) {
			if (e.errno === 1060 || e.message?.includes('Duplicate column name')) {
				/* already exists — ok */
			} else {
				console.warn(
					`ensureSoftDeleteColumns: could not add ${def} to ${table}:`,
					e.message || e
				);
			}
		}
		try {
			await db.execute(
				`ALTER TABLE ${table} ADD INDEX idx_isDelete (isDelete)`
			);
		} catch (e) {
			/* index may already exist */
		}
	}

	try {
		await db.execute(
			'ALTER TABLE quotations DROP INDEX unique_active_quotation'
		);
	} catch (e) {
		/* may not exist as that name */
	}
	try {
		await db.execute(
			'ALTER TABLE quotations DROP INDEX unique_active_quotation'
		);
	} catch (e) {
		/* may not exist as that name */
	}
	try {
		await db.execute(
			'ALTER TABLE quotations ADD UNIQUE KEY (quotation_number)'
		);
	} catch (e) {
		if (!e.message?.includes('Duplicate key name')) {
			console.warn(
				'ensureSoftDeleteColumns: unique key warning:',
				e.message || e
			);
		}
	}
}

async function doSchemaInit() {
	const startTime = Date.now();
	console.log('🔧 Initializing database schema...');

	const db = await dbConnect();

	try {
		// Pre-init critical columns that routes now depend on.
		// Must run BEFORE the parallel Promise.all blocks to avoid
		// race conditions where routes query isDelete before the ALTER completes.
		await ensureSoftDeleteColumns(db);

		// Run all schema creation in parallel where safe
		await Promise.all([
			initCompaniesTable(db),
			initEmployeesTable(db),
			initUsersTable(db),
			initVendorsTable(db),
			initSupportTicketsTable(db),
			initTicketCommentsTable(db),
			initExpensesTable(db),
			initOtherExpensesTable(db),
			initPaymentPayablesTable(db),
			initPaymentReceivablesTable(db),
			initPurchaseInvoicesTable(db),
			initMaterialRequisitionsTable(db),
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
			initSoftwareCategoriesTable(db),
			initSoftwaresTable(db),
			initSoftwareVersionsTable(db),
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
			initQuotationsTable(db),
			initProjectQuotationsTable(db),
			initInvoicesTable(db),
		]);

		// Proposal/project sub-tables
		await Promise.all([
			initProposalFollowupsTable(db),
			initProjectFollowupsTable(db),
			initProjectInvoicesTable(db),
			initProjectPurchaseOrdersTable(db),
			initProjectMomDocumentsTable(db),
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
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	// Alter statements to safely migrate existing databases
	const alterStatements = [
		'ALTER TABLE companies ADD COLUMN gstin VARCHAR(15)',
		'ALTER TABLE companies ADD COLUMN pan_number VARCHAR(10)',
		'ALTER TABLE companies ADD COLUMN company_profile TEXT',
		'ALTER TABLE companies ADD COLUMN state_code VARCHAR(10)',
		'ALTER TABLE companies ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
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

	try {
		await db.execute('ALTER TABLE companies ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Companies index migration warning:', e.message || e);
		}
	}
}

async function initEmployeesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS employees (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id VARCHAR(20) UNIQUE NOT NULL,
      first_name VARCHAR(50) NOT NULL,
      last_name VARCHAR(50) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      phone VARCHAR(20),
      mobile VARCHAR(30),
      personal_email VARCHAR(255),
      department VARCHAR(50),
      position VARCHAR(100),
      designation VARCHAR(100),
      hire_date DATE,
      joining_date DATE,
      exit_date DATE,
      exit_reason TEXT,
      status ENUM('active', 'inactive', 'terminated') DEFAULT 'active',
      manager_id INT,
      username VARCHAR(50) UNIQUE,
      middle_name VARCHAR(50),
      gender ENUM('Male', 'Female', 'Other'),
      employee_type ENUM('Payroll', 'Contract', 'Deputation', 'Permanent', 'Intern'),
      grade VARCHAR(50),
      workplace VARCHAR(100),
      level VARCHAR(50),
      reporting_to VARCHAR(100),
      pf_no VARCHAR(50),
      dob DATE,
      marital_status ENUM('Single', 'Married', 'Other'),
      employment_status VARCHAR(50),
      role VARCHAR(100),
      present_address TEXT,
      address TEXT,
      city VARCHAR(100),
      pin VARCHAR(20),
      state VARCHAR(100),
      country VARCHAR(100),
      profile_photo_url VARCHAR(255),
      bonus_eligible TINYINT(1) DEFAULT 0,
      stat_pf TINYINT(1) DEFAULT 0,
      stat_mlwf TINYINT(1) DEFAULT 0,
      stat_pt TINYINT(1) DEFAULT 0,
      stat_esic TINYINT(1) DEFAULT 0,
      stat_tds TINYINT(1) DEFAULT 0,
      qualification VARCHAR(100),
      institute VARCHAR(150),
      passing_year VARCHAR(4),
      work_experience TEXT,
      bank_account_no VARCHAR(50),
      bank_ifsc VARCHAR(20),
      bank_name VARCHAR(100),
      bank_branch VARCHAR(100),
      account_holder_name VARCHAR(150),
      pan VARCHAR(20),
      aadhar VARCHAR(20),
      gratuity_no VARCHAR(50),
      uan VARCHAR(50),
      esi_no VARCHAR(50),
      attendance_id VARCHAR(50),
      biometric_code VARCHAR(50),
      device_code VARCHAR(50),
      emergency_contact_name VARCHAR(100),
      emergency_contact_phone VARCHAR(20),
      deputation_company_id INT,
      company_name VARCHAR(255) DEFAULT 'Accent Techno Solutions Pvt Ltd',
      notes TEXT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE employees ADD COLUMN username VARCHAR(50) UNIQUE',
		'ALTER TABLE employees ADD COLUMN middle_name VARCHAR(50)',
		"ALTER TABLE employees ADD COLUMN gender ENUM('Male','Female','Other')",
		"ALTER TABLE employees ADD COLUMN employee_type ENUM('Payroll','Contract','Deputation','Permanent','Intern')",
		'ALTER TABLE employees ADD COLUMN grade VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN workplace VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN level VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN reporting_to VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN pf_no VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN dob DATE',
		"ALTER TABLE employees ADD COLUMN marital_status ENUM('Single','Married','Other')",
		'ALTER TABLE employees ADD COLUMN employment_status VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN role VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN joining_date DATE',
		'ALTER TABLE employees ADD COLUMN present_address TEXT',
		'ALTER TABLE employees ADD COLUMN city VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN pin VARCHAR(20)',
		'ALTER TABLE employees ADD COLUMN state VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN country VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN mobile VARCHAR(30)',
		'ALTER TABLE employees ADD COLUMN personal_email VARCHAR(255)',
		'ALTER TABLE employees ADD COLUMN profile_photo_url VARCHAR(255)',
		'ALTER TABLE employees ADD COLUMN bonus_eligible TINYINT(1) DEFAULT 0',
		'ALTER TABLE employees ADD COLUMN stat_pf TINYINT(1) DEFAULT 0',
		'ALTER TABLE employees ADD COLUMN stat_mlwf TINYINT(1) DEFAULT 0',
		'ALTER TABLE employees ADD COLUMN stat_pt TINYINT(1) DEFAULT 0',
		'ALTER TABLE employees ADD COLUMN stat_esic TINYINT(1) DEFAULT 0',
		'ALTER TABLE employees ADD COLUMN stat_tds TINYINT(1) DEFAULT 0',
		'ALTER TABLE employees ADD COLUMN qualification VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN institute VARCHAR(150)',
		'ALTER TABLE employees ADD COLUMN passing_year VARCHAR(4)',
		'ALTER TABLE employees ADD COLUMN work_experience TEXT',
		'ALTER TABLE employees ADD COLUMN bank_account_no VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN bank_ifsc VARCHAR(20)',
		'ALTER TABLE employees ADD COLUMN bank_name VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN bank_branch VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN account_holder_name VARCHAR(150)',
		'ALTER TABLE employees ADD COLUMN pan VARCHAR(20)',
		'ALTER TABLE employees ADD COLUMN aadhar VARCHAR(20)',
		'ALTER TABLE employees ADD COLUMN gratuity_no VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN uan VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN esi_no VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN attendance_id VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN biometric_code VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN device_code VARCHAR(50)',
		'ALTER TABLE employees ADD COLUMN exit_date DATE',
		'ALTER TABLE employees ADD COLUMN exit_reason TEXT',
		'ALTER TABLE employees ADD COLUMN deputation_company_id INT',
		"ALTER TABLE employees ADD COLUMN company_name VARCHAR(255) DEFAULT 'Accent Techno Solutions Pvt Ltd'",
		'ALTER TABLE employees ADD COLUMN designation VARCHAR(100)',
		'ALTER TABLE employees ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Employees table schema update warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute(
			"ALTER TABLE employees MODIFY COLUMN employee_type ENUM('Payroll','Contract','Deputation','Permanent','Intern')"
		);
	} catch {
		/* ignore */
	}

	try {
		await db.execute('ALTER TABLE employees ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Employees index migration warning:', e.message || e);
		}
	}
}

async function initVendorsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_id VARCHAR(50) UNIQUE,
      vendor_name VARCHAR(255) NOT NULL,
      vendor_type VARCHAR(100),
      industry_category VARCHAR(100),
      status VARCHAR(50) DEFAULT 'Active',
      contact_person VARCHAR(255),
      contact_designation VARCHAR(100),
      phone VARCHAR(50),
      email VARCHAR(255),
      address_street VARCHAR(500),
      address_city VARCHAR(100),
      address_state VARCHAR(100),
      address_country VARCHAR(100),
      address_pin VARCHAR(20),
      website VARCHAR(255),
      gst_vat_tax_id VARCHAR(100),
      pan_legal_reg_no VARCHAR(100),
      msme_ssi_registration VARCHAR(100),
      iso_certifications TEXT,
      other_compliance_docs TEXT,
      bank_name VARCHAR(255),
      bank_account_no VARCHAR(100),
      ifsc_swift_code VARCHAR(50),
      currency_preference VARCHAR(10) DEFAULT 'INR',
      payment_terms TEXT,
      credit_limit DECIMAL(15, 2),
      previous_projects TEXT,
      avg_quality_rating DECIMAL(2, 1),
      avg_delivery_rating DECIMAL(2, 1),
      avg_reliability_rating DECIMAL(2, 1),
      blacklist_notes TEXT,
      remarks TEXT,
      contract_attachments TEXT,
      certificate_attachments TEXT,
      profile_attachments TEXT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE vendors ADD COLUMN vendor_id VARCHAR(50) UNIQUE',
		'ALTER TABLE vendors ADD COLUMN contact_designation VARCHAR(100)',
		'ALTER TABLE vendors ADD COLUMN address_street VARCHAR(500)',
		'ALTER TABLE vendors ADD COLUMN address_city VARCHAR(100)',
		'ALTER TABLE vendors ADD COLUMN address_state VARCHAR(100)',
		'ALTER TABLE vendors ADD COLUMN address_country VARCHAR(100)',
		'ALTER TABLE vendors ADD COLUMN address_pin VARCHAR(20)',
		'ALTER TABLE vendors ADD COLUMN iso_certifications TEXT',
		'ALTER TABLE vendors ADD COLUMN other_compliance_docs TEXT',
		'ALTER TABLE vendors ADD COLUMN bank_name VARCHAR(255)',
		'ALTER TABLE vendors ADD COLUMN bank_account_no VARCHAR(100)',
		'ALTER TABLE vendors ADD COLUMN ifsc_swift_code VARCHAR(50)',
		'ALTER TABLE vendors ADD COLUMN currency_preference VARCHAR(10)',
		'ALTER TABLE vendors ADD COLUMN payment_terms TEXT',
		'ALTER TABLE vendors MODIFY COLUMN payment_terms TEXT',
		'ALTER TABLE vendors ADD COLUMN credit_limit DECIMAL(15, 2)',
		'ALTER TABLE vendors ADD COLUMN previous_projects TEXT',
		'ALTER TABLE vendors ADD COLUMN avg_quality_rating DECIMAL(2, 1)',
		'ALTER TABLE vendors ADD COLUMN avg_delivery_rating DECIMAL(2, 1)',
		'ALTER TABLE vendors ADD COLUMN avg_reliability_rating DECIMAL(2, 1)',
		'ALTER TABLE vendors ADD COLUMN blacklist_notes TEXT',
		'ALTER TABLE vendors ADD COLUMN contract_attachments TEXT',
		'ALTER TABLE vendors ADD COLUMN certificate_attachments TEXT',
		'ALTER TABLE vendors ADD COLUMN profile_attachments TEXT',
		'ALTER TABLE vendors ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Vendors table schema update warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute('ALTER TABLE vendors ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Vendors index migration warning:', e.message || e);
		}
	}
}

async function initSupportTicketsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_number VARCHAR(20) UNIQUE NOT NULL,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category ENUM('payroll', 'leave', 'policy', 'access_cards', 'seating', 'maintenance', 'general_request', 'confidential') DEFAULT 'general_request',
      priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
      status ENUM('new', 'under_review', 'in_progress', 'waiting_for_employee', 'resolved', 'closed') DEFAULT 'new',
      screenshots JSON,
      browser_info TEXT,
      page_url VARCHAR(500),
      steps_to_reproduce TEXT,
      expected_behavior TEXT,
      actual_behavior TEXT,
      assigned_to INT,
      resolution_notes TEXT,
      resolved_at DATETIME,
      resolved_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_priority (priority),
      INDEX idx_category (category),
      INDEX idx_created_at (created_at),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE support_tickets ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
	];
	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Support tickets schema update warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute(
			'ALTER TABLE support_tickets ADD INDEX idx_isDelete (isDelete)'
		);
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Support tickets index migration warning:', e.message || e);
		}
	}
}

async function initTicketCommentsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      user_id INT NOT NULL,
      comment TEXT NOT NULL,
      is_internal BOOLEAN DEFAULT FALSE,
      attachments JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_id (ticket_id)
    )
  `);
}

async function initExpensesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_number VARCHAR(50) UNIQUE NOT NULL,
      expense_date DATE,
      category VARCHAR(100) NOT NULL,
      sub_category VARCHAR(100),
      description VARCHAR(500),
      vendor_name VARCHAR(255),
      amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      total_amount DECIMAL(15, 2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'INR',
      payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') DEFAULT 'bank',
      payment_reference VARCHAR(255),
      paid_to VARCHAR(255),
      paid_by INT NULL,
      receipt_url VARCHAR(500),
      is_billable TINYINT(1) DEFAULT 0,
      is_reimbursable TINYINT(1) DEFAULT 0,
      project_id INT NULL,
      department VARCHAR(100),
      notes TEXT,
      status ENUM('draft', 'submitted', 'approved', 'rejected', 'reimbursed') DEFAULT 'submitted',
      approved_by INT NULL,
      approved_at DATETIME,
      created_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category),
      INDEX idx_status (status),
      INDEX idx_expense_date (expense_date),
      INDEX idx_vendor (vendor_name),
      INDEX idx_project_id (project_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE expenses ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
	];
	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Expenses table schema update warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute('ALTER TABLE expenses ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Expenses index migration warning:', e.message || e);
		}
	}
}

async function initOtherExpensesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS other_expenses (
      id CHAR(36) NOT NULL PRIMARY KEY,
      voucher_number VARCHAR(50) UNIQUE NOT NULL,
      voucher_date DATE NOT NULL,
      expense_category VARCHAR(100) NOT NULL,
      payee_type ENUM('vendor', 'employee') NOT NULL,
      vendor_id INT NULL,
      vendor_name VARCHAR(255) NULL,
      employee_id INT NULL,
      employee_name VARCHAR(255) NULL,
      bill_no VARCHAR(100) NULL,
      bill_date DATE NULL,
      bill_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
      gst_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
      net_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
      description TEXT NULL,
      status ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
      created_by INT NULL,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_voucher_date (voucher_date),
      INDEX idx_category (expense_category),
      INDEX idx_payee_type (payee_type),
      INDEX idx_status (status),
      INDEX idx_isDelete (isDelete)
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE other_expenses ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Other expenses schema update warning:', e.message || e);
		}
	}

	try {
		await db.execute(
			'ALTER TABLE other_expenses ADD INDEX idx_isDelete (isDelete)'
		);
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Other expenses index migration warning:', e.message || e);
		}
	}
}

async function initPaymentPayablesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_payables (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reference_number VARCHAR(50) UNIQUE NOT NULL,
      vendor_invoice_number VARCHAR(100),
      purchase_invoice_id INT NULL,
      vendor_name VARCHAR(255) NOT NULL,
      vendor_email VARCHAR(255),
      vendor_phone VARCHAR(50),
      invoice_date DATE,
      due_date DATE,
      invoice_amount DECIMAL(15, 2) DEFAULT 0,
      paid_amount DECIMAL(15, 2) DEFAULT 0,
      balance_due DECIMAL(15, 2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'INR',
      project_id INT NULL,
      po_number VARCHAR(100),
      payment_terms VARCHAR(100),
      last_follow_up_date DATE,
      next_follow_up_date DATE,
      notes TEXT,
      status ENUM('pending', 'partial', 'paid', 'overdue', 'cancelled') DEFAULT 'pending',
      paid_date DATE,
      payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') NULL,
      transaction_reference VARCHAR(255),
      bank_name VARCHAR(255),
      tds_amount DECIMAL(15, 2) DEFAULT 0,
      approved_by INT NULL,
      approved_at DATETIME,
      assigned_to INT NULL,
      created_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_vendor (vendor_name),
      INDEX idx_due_date (due_date),
      INDEX idx_purchase_invoice_id (purchase_invoice_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE payment_payables ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Payment payables schema update warning:', e.message || e);
		}
	}

	try {
		await db.execute(
			'ALTER TABLE payment_payables ADD INDEX idx_isDelete (isDelete)'
		);
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Payment payables index migration warning:', e.message || e);
		}
	}
}

async function initPaymentReceivablesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_receivables (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reference_number VARCHAR(50) UNIQUE NOT NULL,
      invoice_number VARCHAR(100),
      invoice_id INT NULL,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      invoice_date DATE,
      due_date DATE,
      invoice_amount DECIMAL(15, 2) DEFAULT 0,
      paid_amount DECIMAL(15, 2) DEFAULT 0,
      balance_due DECIMAL(15, 2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'INR',
      project_id INT NULL,
      po_number VARCHAR(100),
      payment_terms VARCHAR(100),
      last_follow_up_date DATE,
      next_follow_up_date DATE,
      notes TEXT,
      status ENUM('pending', 'partial', 'received', 'overdue', 'written_off') DEFAULT 'pending',
      received_date DATE,
      payment_mode ENUM('cash', 'bank', 'cheque', 'card', 'upi', 'other') NULL,
      transaction_reference VARCHAR(255),
      assigned_to INT NULL,
      created_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_client (client_name),
      INDEX idx_due_date (due_date),
      INDEX idx_invoice_id (invoice_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE payment_receivables ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn(
				'Payment receivables schema update warning:',
				e.message || e
			);
		}
	}

	try {
		await db.execute(
			'ALTER TABLE payment_receivables ADD INDEX idx_isDelete (isDelete)'
		);
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn(
				'Payment receivables index migration warning:',
				e.message || e
			);
		}
	}
}

async function initPurchaseInvoicesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_number VARCHAR(50) UNIQUE NOT NULL,
      invoice_date DATE,
      due_date DATE,
      vendor_name VARCHAR(255) NOT NULL,
      vendor_email VARCHAR(255),
      vendor_phone VARCHAR(50),
      vendor_address TEXT,
      vendor_gstin VARCHAR(20),
      vendor_pan VARCHAR(20),
      po_number VARCHAR(100),
      po_date DATE,
      po_id INT NULL,
      description VARCHAR(500),
      items JSON,
      subtotal DECIMAL(15, 2) DEFAULT 0,
      tax_rate DECIMAL(5, 2) DEFAULT 18,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      cgst_amount DECIMAL(15, 2) DEFAULT 0,
      sgst_amount DECIMAL(15, 2) DEFAULT 0,
      igst_amount DECIMAL(15, 2) DEFAULT 0,
      discount DECIMAL(15, 2) DEFAULT 0,
      total DECIMAL(15, 2) DEFAULT 0,
      amount_paid DECIMAL(15, 2) DEFAULT 0,
      balance_due DECIMAL(15, 2) DEFAULT 0,
      payment_status ENUM('unpaid', 'partial', 'paid', 'overdue') DEFAULT 'unpaid',
      notes TEXT,
      terms TEXT,
      attachment_url VARCHAR(500),
      status ENUM('draft', 'pending', 'approved', 'paid', 'overdue', 'cancelled') DEFAULT 'draft',
      project_id INT NULL,
      created_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_vendor (vendor_name),
      INDEX idx_payment_status (payment_status),
      INDEX idx_isDelete (isDelete)
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE purchase_invoices ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Purchase invoices schema update warning:', e.message || e);
		}
	}
}

async function initMaterialRequisitionsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS material_requisitions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      requisition_number VARCHAR(50) NOT NULL UNIQUE,
      requisition_date DATE NOT NULL,
      requested_by VARCHAR(100),
      department VARCHAR(100),
      line_items JSON,
      status ENUM('pending', 'approved', 'fulfilled', 'rejected') DEFAULT 'pending',
      prepared_by VARCHAR(100),
      checked_by VARCHAR(100),
      approved_by VARCHAR(100),
      received_by VARCHAR(100),
      receipt_date DATE,
      notes TEXT,
      created_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE material_requisitions ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn(
				'Material requisitions schema update warning:',
				e.message || e
			);
		}
	}
}

async function initUsersTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(100),
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      employee_id INT DEFAULT NULL,
      vendor_id INT DEFAULT NULL,
      account_type ENUM('employee', 'vendor') DEFAULT 'employee',
      role_id INT DEFAULT NULL,
      permissions JSON DEFAULT NULL,
      field_permissions JSON DEFAULT NULL,
      department VARCHAR(100) DEFAULT NULL,
      full_name VARCHAR(100) DEFAULT NULL,
      status ENUM('active', 'inactive') DEFAULT 'active',
      is_active BOOLEAN DEFAULT TRUE,
      is_super_admin BOOLEAN DEFAULT FALSE,
      isDelete TINYINT(1) DEFAULT 0,
      last_login TIMESTAMP NULL,
      last_password_change TIMESTAMP NULL,
      created_by INT DEFAULT NULL,
      updated_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_employee_id (employee_id),
      INDEX idx_vendor_id (vendor_id),
      INDEX idx_role_id (role_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE users ADD COLUMN username VARCHAR(50) UNIQUE NOT NULL',
		'ALTER TABLE users ADD COLUMN employee_id INT DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN vendor_id INT DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN account_type ENUM("employee", "vendor") DEFAULT "employee"',
		'ALTER TABLE users ADD COLUMN role_id INT DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN permissions JSON DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN field_permissions JSON DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN department VARCHAR(100) DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN full_name VARCHAR(100) DEFAULT NULL',
		"ALTER TABLE users ADD COLUMN status ENUM('active', 'inactive') DEFAULT 'active'",
		'ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN DEFAULT FALSE',
		'ALTER TABLE users ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
		'ALTER TABLE users ADD COLUMN last_login TIMESTAMP NULL',
		'ALTER TABLE users ADD COLUMN last_password_change TIMESTAMP NULL',
		'ALTER TABLE users ADD COLUMN created_by INT DEFAULT NULL',
		'ALTER TABLE users ADD COLUMN updated_by INT DEFAULT NULL',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Users table schema update warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute('ALTER TABLE users ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Users index migration warning:', e.message || e);
		}
	}

	try {
		await db.execute('ALTER TABLE users ADD INDEX idx_email (email)');
	} catch (e) {} // best-effort; may already exist

	try {
		await db.execute(
			'ALTER TABLE users ADD INDEX idx_login (username, email, password_hash)'
		);
	} catch (e) {} // best-effort composite index for login query
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
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

	const alterStatements = [
		'ALTER TABLE leads ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Leads table schema update warning:', e.message || e);
			}
		}
	}
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
      client_contact_details TEXT,
      project_location_country VARCHAR(100),
      project_location_city VARCHAR(100),
      project_location_site VARCHAR(255),
      industry VARCHAR(100),
      contract_type VARCHAR(100),
      project_manager VARCHAR(255),
      start_date DATE,
      end_date DATE,
      target_date DATE,
      project_duration_planned VARCHAR(100),
      project_duration_actual VARCHAR(100),
      budget DECIMAL(15,2),
      project_value DECIMAL(15,2),
      currency VARCHAR(10),
      payment_terms TEXT,
      invoicing_status VARCHAR(50),
      cost_to_company DECIMAL(15,2),
      profitability_estimate DECIMAL(5,2),
      subcontractors_vendors TEXT,
      procurement_status VARCHAR(100),
      material_delivery_schedule TEXT,
      vendor_management TEXT,
      mobilization_date DATE,
      site_readiness TEXT,
      construction_progress TEXT,
      major_risks TEXT,
      mitigation_plans TEXT,
      change_orders TEXT,
      claims_disputes TEXT,
      final_documentation_status VARCHAR(100),
      lessons_learned TEXT,
      client_feedback TEXT,
      actual_profit_loss DECIMAL(15,2),
      status VARCHAR(50) DEFAULT 'NEW',
      priority VARCHAR(50) DEFAULT 'MEDIUM',
      progress INT DEFAULT 0,
      type VARCHAR(50) DEFAULT 'ONGOING',
      proposal_id INT,
      assigned_to VARCHAR(255),
      additional_scope TEXT,
      assignments JSON,
      project_schedule TEXT,
      input_document LONGTEXT,
      list_of_deliverables TEXT,
      kickoff_meeting TEXT,
      in_house_meeting TEXT,
      project_start_milestone DATE,
      project_review_milestone DATE,
      project_end_milestone DATE,
      kickoff_meeting_date DATE,
      kickoff_followup_date DATE,
      internal_meeting_date DATE,
      next_internal_meeting DATE,
      project_assumption_list LONGTEXT,
      project_lessons_learnt_list LONGTEXT,
      software_items LONGTEXT,
      project_team TEXT,
      estimated_manhours DECIMAL(10,2),
      unit_qty DECIMAL(10,2),
      scope_of_work TEXT,
      deliverables TEXT,
      software_included VARCHAR(255),
      duration TEXT,
      mode_of_delivery TEXT,
      site_visit TEXT,
      quotation_validity TEXT,
      exclusion TEXT,
      billing_and_payment_terms TEXT,
      other_terms_and_conditions TEXT,
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
      notes TEXT,
      converted_by VARCHAR(255),
      converted_at DATETIME,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE projects ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
		'ALTER TABLE projects ADD COLUMN project_code VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN project_title VARCHAR(255)',
		'ALTER TABLE projects ADD COLUMN client_name VARCHAR(255)',
		'ALTER TABLE projects ADD COLUMN client_contact_details TEXT',
		'ALTER TABLE projects ADD COLUMN project_location_country VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN project_location_city VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN project_location_site VARCHAR(255)',
		'ALTER TABLE projects ADD COLUMN industry VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN contract_type VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN project_manager VARCHAR(255)',
		'ALTER TABLE projects ADD COLUMN project_duration_planned VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN project_duration_actual VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN project_value DECIMAL(15,2)',
		'ALTER TABLE projects ADD COLUMN currency VARCHAR(10)',
		'ALTER TABLE projects ADD COLUMN payment_terms TEXT',
		'ALTER TABLE projects ADD COLUMN invoicing_status VARCHAR(50)',
		'ALTER TABLE projects ADD COLUMN cost_to_company DECIMAL(15,2)',
		'ALTER TABLE projects ADD COLUMN profitability_estimate DECIMAL(5,2)',
		'ALTER TABLE projects ADD COLUMN subcontractors_vendors TEXT',
		'ALTER TABLE projects ADD COLUMN procurement_status VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN material_delivery_schedule TEXT',
		'ALTER TABLE projects ADD COLUMN vendor_management TEXT',
		'ALTER TABLE projects ADD COLUMN mobilization_date DATE',
		'ALTER TABLE projects ADD COLUMN site_readiness TEXT',
		'ALTER TABLE projects ADD COLUMN construction_progress TEXT',
		'ALTER TABLE projects ADD COLUMN major_risks TEXT',
		'ALTER TABLE projects ADD COLUMN mitigation_plans TEXT',
		'ALTER TABLE projects ADD COLUMN change_orders TEXT',
		'ALTER TABLE projects ADD COLUMN claims_disputes TEXT',
		'ALTER TABLE projects ADD COLUMN final_documentation_status VARCHAR(100)',
		'ALTER TABLE projects ADD COLUMN lessons_learned TEXT',
		'ALTER TABLE projects ADD COLUMN client_feedback TEXT',
		'ALTER TABLE projects ADD COLUMN actual_profit_loss DECIMAL(15,2)',
		'ALTER TABLE projects ADD COLUMN additional_scope TEXT',
		'ALTER TABLE projects ADD COLUMN project_start_milestone DATE',
		'ALTER TABLE projects ADD COLUMN project_review_milestone DATE',
		'ALTER TABLE projects ADD COLUMN project_end_milestone DATE',
		'ALTER TABLE projects ADD COLUMN kickoff_meeting_date DATE',
		'ALTER TABLE projects ADD COLUMN kickoff_followup_date DATE',
		'ALTER TABLE projects ADD COLUMN internal_meeting_date DATE',
		'ALTER TABLE projects ADD COLUMN next_internal_meeting DATE',
		'ALTER TABLE projects ADD COLUMN estimated_manhours DECIMAL(10,2)',
		'ALTER TABLE projects ADD COLUMN unit_qty DECIMAL(10,2)',
		'ALTER TABLE projects ADD COLUMN scope_of_work TEXT',
		'ALTER TABLE projects ADD COLUMN deliverables TEXT',
		'ALTER TABLE projects ADD COLUMN software_included VARCHAR(255)',
		'ALTER TABLE projects ADD COLUMN duration TEXT',
		'ALTER TABLE projects ADD COLUMN mode_of_delivery TEXT',
		'ALTER TABLE projects ADD COLUMN site_visit TEXT',
		'ALTER TABLE projects ADD COLUMN quotation_validity TEXT',
		'ALTER TABLE projects ADD COLUMN exclusion TEXT',
		'ALTER TABLE projects ADD COLUMN billing_and_payment_terms TEXT',
		'ALTER TABLE projects ADD COLUMN other_terms_and_conditions TEXT',
		'ALTER TABLE projects ADD COLUMN documents_received_list LONGTEXT',
		'ALTER TABLE projects ADD COLUMN documents_issued_list LONGTEXT',
		'ALTER TABLE projects ADD COLUMN project_handover_list LONGTEXT',
		'ALTER TABLE projects ADD COLUMN project_manhours_list LONGTEXT',
		'ALTER TABLE projects ADD COLUMN project_query_log_list LONGTEXT',
		'ALTER TABLE projects ADD COLUMN project_schedule_list LONGTEXT',
		'ALTER TABLE projects ADD COLUMN converted_by VARCHAR(255)',
		'ALTER TABLE projects ADD COLUMN converted_at DATETIME',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Projects table schema update warning:', e.message || e);
			}
		}
	}

	const textUpgrades = [
		'scope_of_work',
		'deliverables',
		'exclusion',
		'billing_and_payment_terms',
		'other_terms_and_conditions',
		'site_visit',
		'quotation_validity',
		'duration',
		'mode_of_delivery',
		'revision',
	];
	for (const col of textUpgrades) {
		try {
			await db.execute(`ALTER TABLE projects MODIFY COLUMN \`${col}\` TEXT`);
		} catch {
			/* ignore */
		}
	}

	try {
		await db.execute('ALTER TABLE projects ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Projects index migration warning:', e.message || e);
		}
	}
}

async function initProposalsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS proposals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      proposal_id VARCHAR(50) UNIQUE,
      title VARCHAR(255),
      proposal_title VARCHAR(255),
      description TEXT,
      company_id INT,
      client_name VARCHAR(255),
      lead_id INT,
      status VARCHAR(50) DEFAULT 'draft',
      priority VARCHAR(50) DEFAULT 'MEDIUM',
      progress INT DEFAULT 0,
      amount DECIMAL(15,2),
      proposal_value DECIMAL(15,2),
      currency VARCHAR(10) DEFAULT 'INR',
      contract_type VARCHAR(100),
      industry VARCHAR(100),
      payment_terms TEXT,
      project_type VARCHAR(50),
      lumpsum_cost DECIMAL(15,2) DEFAULT 0,
      total_lines INT DEFAULT 0,
      per_line_charges DECIMAL(15,2) DEFAULT 0,
      total_line_cost DECIMAL(15,2) DEFAULT 0,
      total_manhours DECIMAL(10,2) DEFAULT 0,
      manhour_charges DECIMAL(15,2) DEFAULT 0,
      total_manhour_cost DECIMAL(15,2) DEFAULT 0,
      quotation_number VARCHAR(100),
      quotation_date DATE,
      enquiry_number VARCHAR(100),
      enquiry_no VARCHAR(100),
      enquiry_date DATE,
      date_of_enquiry DATE,
      date_of_quotation DATE,
      quotation_validity VARCHAR(255),
      billing_payment_terms TEXT,
      other_terms TEXT,
      general_terms TEXT,
      additional_fields TEXT,
      input_document TEXT,
      list_of_deliverables TEXT,
      documents_list JSON,
      software VARCHAR(255),
      software_items JSON,
      duration VARCHAR(100),
      site_visit TEXT,
      mode_of_delivery VARCHAR(255),
      revision VARCHAR(255),
      exclusions TEXT,
      project_schedule TEXT,
      kickoff_meeting TEXT,
      in_house_meeting TEXT,
      kickoff_meeting_date DATE,
      internal_meeting_date DATE,
      next_internal_meeting DATE,
      disciplines JSON,
      activities JSON,
      discipline_descriptions JSON,
      planning_activities_list JSON,
      commercial_items JSON,
      planned_hours_total DECIMAL(10,2),
      actual_hours_total DECIMAL(10,2),
      planned_hours_by_discipline JSON,
      actual_hours_by_discipline JSON,
      planned_hours_per_activity JSON,
      actual_hours_per_activity JSON,
      hours_variance_total DECIMAL(10,2),
      hours_variance_percentage DECIMAL(5,2),
      productivity_index DECIMAL(5,2),
      client_contact_details TEXT,
      project_location_country VARCHAR(100),
      project_location_city VARCHAR(100),
      project_location_site VARCHAR(255),
      budget DECIMAL(15,2),
      cost_to_company DECIMAL(15,2),
      profitability_estimate DECIMAL(5,2),
      major_risks TEXT,
      mitigation_plans TEXT,
      planned_start_date DATE,
      planned_end_date DATE,
      project_duration_planned VARCHAR(100),
      target_date DATE,
      project_id INT,
      client_address TEXT,
      kind_attn VARCHAR(255),
      attention_person VARCHAR(255),
      attention_designation VARCHAR(255),
      quotation_no VARCHAR(100),
      scope_items JSON,
      amount_in_words TEXT,
      total_amount DECIMAL(15,2),
      gross_amount DECIMAL(15,2) DEFAULT 0,
      gst_percentage DECIMAL(5,2) DEFAULT 18,
      gst_amount DECIMAL(15,2) DEFAULT 0,
      net_amount DECIMAL(15,2) DEFAULT 0,
      gst_type VARCHAR(20) DEFAULT 'cgst_sgst',
      gst_number VARCHAR(50),
      pan_number VARCHAR(50),
      tan_number VARCHAR(50),
      terms_and_conditions TEXT,
      payment_mode VARCHAR(50),
      receiver_signature VARCHAR(255),
      company_signature VARCHAR(255),
      signatory_name VARCHAR(255),
      signatory_designation VARCHAR(255),
      discussion TEXT,
      annexure_scope_of_work TEXT,
      annexure_input_document TEXT,
      annexure_deliverables TEXT,
      annexure_software VARCHAR(255),
      annexure_duration VARCHAR(255),
      annexure_site_visit VARCHAR(255),
      annexure_quotation_validity VARCHAR(255),
      annexure_mode_of_delivery VARCHAR(255),
      annexure_revision VARCHAR(255),
      annexure_exclusions TEXT,
      annexure_billing_payment_terms TEXT,
      annexure_taxation TEXT,
      annexure_payment_milestone TEXT,
      annexure_confidentiality TEXT,
      annexure_codes_standards TEXT,
      annexure_dispute_resolution TEXT,
      converted_by VARCHAR(255),
      converted_at DATETIME,
      notes TEXT,
      contact_name VARCHAR(255),
      contact_email VARCHAR(255),
      phone VARCHAR(50),
      client VARCHAR(255),
      project_description TEXT,
      city VARCHAR(100),
      value DECIMAL(15,2),
      due_date DATE,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE proposals ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN proposal_title VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN client_name VARCHAR(255)',
		"ALTER TABLE proposals ADD COLUMN priority VARCHAR(50) DEFAULT 'MEDIUM'",
		'ALTER TABLE proposals ADD COLUMN progress INT DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN proposal_value DECIMAL(15,2)',
		"ALTER TABLE proposals ADD COLUMN currency VARCHAR(10) DEFAULT 'INR'",
		'ALTER TABLE proposals ADD COLUMN contract_type VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN industry VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN payment_terms TEXT',
		'ALTER TABLE proposals ADD COLUMN project_type VARCHAR(50)',
		'ALTER TABLE proposals ADD COLUMN lumpsum_cost DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN total_lines INT DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN per_line_charges DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN total_line_cost DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN total_manhours DECIMAL(10,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN manhour_charges DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN total_manhour_cost DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN quotation_number VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN quotation_date DATE',
		'ALTER TABLE proposals ADD COLUMN enquiry_number VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN enquiry_no VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN enquiry_date DATE',
		'ALTER TABLE proposals ADD COLUMN date_of_enquiry DATE',
		'ALTER TABLE proposals ADD COLUMN date_of_quotation DATE',
		'ALTER TABLE proposals ADD COLUMN quotation_validity VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN billing_payment_terms TEXT',
		'ALTER TABLE proposals ADD COLUMN other_terms TEXT',
		'ALTER TABLE proposals ADD COLUMN general_terms TEXT',
		'ALTER TABLE proposals ADD COLUMN additional_fields TEXT',
		'ALTER TABLE proposals ADD COLUMN input_document TEXT',
		'ALTER TABLE proposals ADD COLUMN list_of_deliverables TEXT',
		'ALTER TABLE proposals ADD COLUMN documents_list JSON',
		'ALTER TABLE proposals ADD COLUMN software VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN software_items JSON',
		'ALTER TABLE proposals ADD COLUMN duration VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN site_visit TEXT',
		'ALTER TABLE proposals ADD COLUMN mode_of_delivery VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN revision VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN exclusions TEXT',
		'ALTER TABLE proposals ADD COLUMN project_schedule TEXT',
		'ALTER TABLE proposals ADD COLUMN kickoff_meeting TEXT',
		'ALTER TABLE proposals ADD COLUMN in_house_meeting TEXT',
		'ALTER TABLE proposals ADD COLUMN kickoff_meeting_date DATE',
		'ALTER TABLE proposals ADD COLUMN internal_meeting_date DATE',
		'ALTER TABLE proposals ADD COLUMN next_internal_meeting DATE',
		'ALTER TABLE proposals ADD COLUMN disciplines JSON',
		'ALTER TABLE proposals ADD COLUMN activities JSON',
		'ALTER TABLE proposals ADD COLUMN discipline_descriptions JSON',
		'ALTER TABLE proposals ADD COLUMN planning_activities_list JSON',
		'ALTER TABLE proposals ADD COLUMN commercial_items JSON',
		'ALTER TABLE proposals ADD COLUMN planned_hours_total DECIMAL(10,2)',
		'ALTER TABLE proposals ADD COLUMN actual_hours_total DECIMAL(10,2)',
		'ALTER TABLE proposals ADD COLUMN planned_hours_by_discipline JSON',
		'ALTER TABLE proposals ADD COLUMN actual_hours_by_discipline JSON',
		'ALTER TABLE proposals ADD COLUMN planned_hours_per_activity JSON',
		'ALTER TABLE proposals ADD COLUMN actual_hours_per_activity JSON',
		'ALTER TABLE proposals ADD COLUMN hours_variance_total DECIMAL(10,2)',
		'ALTER TABLE proposals ADD COLUMN hours_variance_percentage DECIMAL(5,2)',
		'ALTER TABLE proposals ADD COLUMN productivity_index DECIMAL(5,2)',
		'ALTER TABLE proposals ADD COLUMN client_contact_details TEXT',
		'ALTER TABLE proposals ADD COLUMN project_location_country VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN project_location_city VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN project_location_site VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN budget DECIMAL(15,2)',
		'ALTER TABLE proposals ADD COLUMN cost_to_company DECIMAL(15,2)',
		'ALTER TABLE proposals ADD COLUMN profitability_estimate DECIMAL(5,2)',
		'ALTER TABLE proposals ADD COLUMN major_risks TEXT',
		'ALTER TABLE proposals ADD COLUMN mitigation_plans TEXT',
		'ALTER TABLE proposals ADD COLUMN planned_start_date DATE',
		'ALTER TABLE proposals ADD COLUMN planned_end_date DATE',
		'ALTER TABLE proposals ADD COLUMN project_duration_planned VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN target_date DATE',
		'ALTER TABLE proposals ADD COLUMN project_id INT',
		'ALTER TABLE proposals ADD COLUMN client_address TEXT',
		'ALTER TABLE proposals ADD COLUMN kind_attn VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN attention_person VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN attention_designation VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN quotation_no VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN scope_items JSON',
		'ALTER TABLE proposals ADD COLUMN amount_in_words TEXT',
		'ALTER TABLE proposals ADD COLUMN total_amount DECIMAL(15,2)',
		'ALTER TABLE proposals ADD COLUMN gross_amount DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN gst_percentage DECIMAL(5,2) DEFAULT 18',
		'ALTER TABLE proposals ADD COLUMN gst_amount DECIMAL(15,2) DEFAULT 0',
		'ALTER TABLE proposals ADD COLUMN net_amount DECIMAL(15,2) DEFAULT 0',
		"ALTER TABLE proposals ADD COLUMN gst_type VARCHAR(20) DEFAULT 'cgst_sgst'",
		'ALTER TABLE proposals ADD COLUMN gst_number VARCHAR(50)',
		'ALTER TABLE proposals ADD COLUMN pan_number VARCHAR(50)',
		'ALTER TABLE proposals ADD COLUMN tan_number VARCHAR(50)',
		'ALTER TABLE proposals ADD COLUMN terms_and_conditions TEXT',
		'ALTER TABLE proposals ADD COLUMN payment_mode VARCHAR(50)',
		'ALTER TABLE proposals ADD COLUMN receiver_signature VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN company_signature VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN signatory_name VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN signatory_designation VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN discussion TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_scope_of_work TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_input_document TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_deliverables TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_software VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN annexure_duration VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN annexure_site_visit VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN annexure_quotation_validity VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN annexure_mode_of_delivery VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN annexure_revision VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN annexure_exclusions TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_billing_payment_terms TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_taxation TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_payment_milestone TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_confidentiality TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_codes_standards TEXT',
		'ALTER TABLE proposals ADD COLUMN annexure_dispute_resolution TEXT',
		'ALTER TABLE proposals ADD COLUMN converted_by VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN converted_at DATETIME',
		'ALTER TABLE proposals ADD COLUMN notes TEXT',
		'ALTER TABLE proposals ADD COLUMN contact_name VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN contact_email VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN phone VARCHAR(50)',
		'ALTER TABLE proposals ADD COLUMN client VARCHAR(255)',
		'ALTER TABLE proposals ADD COLUMN project_description TEXT',
		'ALTER TABLE proposals ADD COLUMN city VARCHAR(100)',
		'ALTER TABLE proposals ADD COLUMN value DECIMAL(15,2)',
		'ALTER TABLE proposals ADD COLUMN due_date DATE',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Proposals table schema update warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute(
			"ALTER TABLE proposals MODIFY COLUMN status VARCHAR(50) DEFAULT 'draft'"
		);
	} catch (e) {
		console.warn('Proposals status column modify warning:', e.message || e);
	}

	try {
		await db.execute('ALTER TABLE proposals ADD INDEX idx_isDelete (isDelete)');
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Proposals index migration warning:', e.message || e);
		}
	}
}

async function initProposalFollowupsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS proposal_followups (
      id INT PRIMARY KEY AUTO_INCREMENT,
      proposal_id INT NOT NULL,
      follow_up_date DATE NOT NULL,
      follow_up_type VARCHAR(50) DEFAULT 'Call',
      description TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'Scheduled',
      outcome TEXT,
      next_action VARCHAR(255),
      next_follow_up_date DATE,
      contacted_person VARCHAR(255),
      notes TEXT,
      created_by VARCHAR(255),
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_proposal_id (proposal_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE proposal_followups ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Proposal followups schema update warning:', e.message || e);
		}
	}
}

async function initProjectFollowupsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_followups (
      id INT PRIMARY KEY AUTO_INCREMENT,
      project_id INT NOT NULL,
      follow_up_date DATE NOT NULL,
      follow_up_type VARCHAR(50) DEFAULT 'Internal Review',
      description TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'Scheduled',
      priority VARCHAR(20) DEFAULT 'Medium',
      milestone VARCHAR(255),
      responsible_person VARCHAR(255),
      action_items TEXT,
      outcome TEXT,
      next_action VARCHAR(255),
      next_follow_up_date DATE,
      blockers TEXT,
      notes TEXT,
      logged_by VARCHAR(255),
      created_by VARCHAR(255),
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      INDEX idx_follow_up_date (follow_up_date),
      INDEX idx_status (status),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE project_followups ADD COLUMN logged_by VARCHAR(255)',
		'ALTER TABLE project_followups ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];
	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn(
					'Project followups schema update warning:',
					e.message || e
				);
			}
		}
	}
}

async function initProjectInvoicesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      invoice_number VARCHAR(100),
      invoice_date DATE,
      company_name VARCHAR(255),
      city VARCHAR(100),
      invoice_amount DECIMAL(15, 2),
      project_number VARCHAR(100),
      expenses_head VARCHAR(255),
      payment DECIMAL(15, 2),
      purchase_description TEXT,
      payment_overdue_days INT DEFAULT 0,
      remarks TEXT,
      tab_type VARCHAR(50) DEFAULT 'invoice',
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      INDEX idx_invoice_number (invoice_number),
      INDEX idx_isDelete (isDelete)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

	const alterStatements = [
		'ALTER TABLE project_invoices ADD COLUMN company_name VARCHAR(255)',
		'ALTER TABLE project_invoices ADD COLUMN city VARCHAR(100)',
		'ALTER TABLE project_invoices ADD COLUMN project_number VARCHAR(100)',
		'ALTER TABLE project_invoices ADD COLUMN expenses_head VARCHAR(255)',
		'ALTER TABLE project_invoices ADD COLUMN payment DECIMAL(15,2)',
		'ALTER TABLE project_invoices ADD COLUMN purchase_description TEXT',
		'ALTER TABLE project_invoices ADD COLUMN payment_overdue_days INT DEFAULT 0',
		"ALTER TABLE project_invoices ADD COLUMN tab_type VARCHAR(50) DEFAULT 'invoice'",
		'ALTER TABLE project_invoices ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];
	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Project invoices schema update warning:', e.message || e);
			}
		}
	}
}

async function initProjectPurchaseOrdersTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      po_number VARCHAR(100),
      po_date DATE,
      client_name VARCHAR(255),
      vendor_name VARCHAR(255),
      delivery_date DATE,
      scope_of_work TEXT,
      gross_amount DECIMAL(15, 2) DEFAULT 0,
      gst_percentage DECIMAL(5, 2) DEFAULT 18,
      gst_amount DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      payment_terms TEXT,
      remarks TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      UNIQUE KEY unique_project (project_id)
    )
  `);

	try {
		await db.execute(
			'ALTER TABLE project_purchase_orders MODIFY COLUMN payment_terms TEXT'
		);
	} catch {
		/* ignore */
	}
}

async function initProjectMomDocumentsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_mom_documents (
      id VARCHAR(36) PRIMARY KEY,
      original_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(120) NOT NULL,
      file_size BIGINT NOT NULL,
      file_data LONGBLOB NOT NULL,
      uploaded_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_uploaded_by (uploaded_by),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function initFollowUpsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INT PRIMARY KEY AUTO_INCREMENT,
      lead_id INT,
      follow_up_date DATE,
      follow_up_type VARCHAR(100),
      description TEXT,
      notes TEXT,
      status VARCHAR(50),
      next_action VARCHAR(255),
      next_follow_up_date DATE,
      created_by INT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE follow_ups ADD COLUMN description TEXT',
		'ALTER TABLE follow_ups ADD COLUMN next_action VARCHAR(255)',
		'ALTER TABLE follow_ups ADD COLUMN next_follow_up_date DATE',
		'ALTER TABLE follow_ups ADD COLUMN isDelete TINYINT(1) DEFAULT 0',
	];
	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Follow-ups schema update warning:', e.message || e);
			}
		}
	}
}

async function initSoftwareCategoriesTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS software_categories (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
	try {
		await db.execute(
			'ALTER TABLE software_categories ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn(
				'Software categories schema update warning:',
				e.message || e
			);
		}
	}
}

async function initSoftwaresTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS softwares (
      id VARCHAR(36) PRIMARY KEY,
      category_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255),
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
	try {
		await db.execute(
			'ALTER TABLE softwares ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Softwares schema update warning:', e.message || e);
		}
	}
}

async function initSoftwareVersionsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS software_versions (
      id VARCHAR(36) PRIMARY KEY,
      software_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      release_date DATE,
      notes TEXT,
      isDelete TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
	try {
		await db.execute(
			'ALTER TABLE software_versions ADD COLUMN isDelete TINYINT(1) DEFAULT 0'
		);
	} catch (e) {
		if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
			console.warn('Software versions schema update warning:', e.message || e);
		}
	}
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
		"ALTER TABLE outgoing_purchase_orders ADD COLUMN status ENUM('draft', 'pending', 'approved', 'completed', 'cancelled') DEFAULT 'pending'",
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
      payment_type ENUM('full', 'partial') DEFAULT NULL,
      tds_amount DECIMAL(15, 2) DEFAULT 0,
      gst_amount DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      created_by INT,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE payment_entries ADD COLUMN city VARCHAR(255)',
		'ALTER TABLE payment_entries ADD COLUMN receipt_no VARCHAR(100)',
		'ALTER TABLE payment_entries ADD COLUMN receipt_date DATE',
		'ALTER TABLE payment_entries ADD COLUMN payment_date DATE',
		'ALTER TABLE payment_entries ADD COLUMN bank_name VARCHAR(255)',
		'ALTER TABLE payment_entries ADD COLUMN remark TEXT',
		'ALTER TABLE payment_entries ADD COLUMN invoice_no VARCHAR(100)',
		'ALTER TABLE payment_entries ADD COLUMN invoice_date DATE',
		'ALTER TABLE payment_entries ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
		'ALTER TABLE payment_entries ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
		'ALTER TABLE payment_entries ADD COLUMN created_by INT',
		"ALTER TABLE payment_entries ADD COLUMN payment_type ENUM('full', 'partial') DEFAULT NULL",
		'ALTER TABLE payment_entries ADD COLUMN tds_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE payment_entries ADD COLUMN gst_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE payment_entries ADD COLUMN net_amount DECIMAL(15, 2) DEFAULT 0',
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
		'ALTER TABLE outgoing_quotations DROP INDEX unique_active_quotation',
		'ALTER TABLE outgoing_quotations ADD UNIQUE KEY (quotation_number)',
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
		'ALTER TABLE cash_vouchers DROP INDEX unique_active_voucher',
		'ALTER TABLE cash_vouchers ADD UNIQUE KEY (voucher_number)',
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
      po_number VARCHAR(50) NOT NULL,
      vendor_name VARCHAR(255) NOT NULL,
      vendor_email VARCHAR(255),
      vendor_phone VARCHAR(50),
      vendor_address TEXT,
      vendor_gstin VARCHAR(255),
      description VARCHAR(500),
      items JSON,
      subtotal DECIMAL(15, 2) DEFAULT 0,
      tax_rate DECIMAL(5, 2) DEFAULT 18,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      discount DECIMAL(15, 2) DEFAULT 0,
      total DECIMAL(15, 2) DEFAULT 0,
      notes TEXT,
      terms TEXT,
      delivery_date DATE,
      status ENUM('draft', 'pending', 'approved', 'completed', 'cancelled') DEFAULT 'draft',
      company_id INT,
      project_id INT,
      po_date DATE,
      po_amount DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      remarks TEXT,
      quotation_no VARCHAR(255),
      quotation_date VARCHAR(255),
      kind_attn VARCHAR(255),
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_isDelete (isDelete),
      INDEX idx_created_at (created_at),
      INDEX idx_project_id (project_id)
    )
  `);

	const alterStatements = [
		'ALTER TABLE purchase_orders ADD COLUMN vendor_gstin VARCHAR(255)',
		'ALTER TABLE purchase_orders ADD COLUMN quotation_no VARCHAR(255)',
		'ALTER TABLE purchase_orders ADD COLUMN quotation_date VARCHAR(255)',
		'ALTER TABLE purchase_orders ADD COLUMN kind_attn VARCHAR(255)',
		'ALTER TABLE purchase_orders ADD COLUMN company_id INT',
		'ALTER TABLE purchase_orders ADD COLUMN project_id INT',
		'ALTER TABLE purchase_orders ADD COLUMN po_date DATE',
		'ALTER TABLE purchase_orders ADD COLUMN po_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE purchase_orders ADD COLUMN net_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE purchase_orders ADD COLUMN remarks TEXT',
		'ALTER TABLE purchase_orders ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Purchase orders schema update warning:', e.message || e);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE purchase_orders ADD INDEX idx_project_id (project_id)',
		'ALTER TABLE purchase_orders DROP INDEX po_number',
		'ALTER TABLE purchase_orders ADD UNIQUE KEY unique_active_po (po_number, isDelete)',
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
					'Purchase orders index migration warning:',
					e.message || e
				);
			}
		}
	}

	try {
		await db.execute('ALTER TABLE purchase_orders DROP COLUMN client_name');
	} catch (e) {
		/* column may not exist */
	}
}

async function initQuotationsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS quotations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quotation_number VARCHAR(50) NOT NULL,
      quotation_date DATE,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      client_address TEXT,
      kind_attn VARCHAR(255),
      enquiry_number VARCHAR(100),
      enquiry_date DATE,
      subject VARCHAR(500),
      items JSON,
      scope_items JSON,
      gross_amount DECIMAL(15, 2) DEFAULT 0,
      gst_percentage DECIMAL(5, 2) DEFAULT 18,
      gst_amount DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      subtotal DECIMAL(15, 2) DEFAULT 0,
      tax_rate DECIMAL(5, 2) DEFAULT 18,
      tax_amount DECIMAL(15, 2) DEFAULT 0,
      discount DECIMAL(15, 2) DEFAULT 0,
      total DECIMAL(15, 2) DEFAULT 0,
      amount_in_words TEXT,
      gst_number VARCHAR(50),
      pan_number VARCHAR(50),
      tan_number VARCHAR(50),
      gst_type VARCHAR(20) DEFAULT 'cgst_sgst',
      terms_and_conditions TEXT,
      notes TEXT,
      terms TEXT,
      valid_until DATE,
      status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
      project_id INT NULL,
      proposal_id INT NULL,
      created_by INT,
      deleted_at TIMESTAMP NULL,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      INDEX idx_project_id (project_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE quotations ADD COLUMN quotation_date DATE',
		'ALTER TABLE quotations ADD COLUMN client_email VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN client_phone VARCHAR(50)',
		'ALTER TABLE quotations ADD COLUMN client_address TEXT',
		'ALTER TABLE quotations ADD COLUMN kind_attn VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN enquiry_number VARCHAR(100)',
		'ALTER TABLE quotations ADD COLUMN enquiry_date DATE',
		'ALTER TABLE quotations ADD COLUMN subject VARCHAR(500)',
		'ALTER TABLE quotations ADD COLUMN items JSON',
		'ALTER TABLE quotations ADD COLUMN scope_items JSON',
		'ALTER TABLE quotations ADD COLUMN subtotal DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN tax_rate DECIMAL(5, 2) DEFAULT 18',
		'ALTER TABLE quotations ADD COLUMN tax_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN discount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN total DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN gross_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN gst_percentage DECIMAL(5, 2) DEFAULT 18',
		'ALTER TABLE quotations ADD COLUMN gst_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN net_amount DECIMAL(15, 2) DEFAULT 0',
		'ALTER TABLE quotations ADD COLUMN amount_in_words TEXT',
		'ALTER TABLE quotations ADD COLUMN gst_number VARCHAR(50)',
		'ALTER TABLE quotations ADD COLUMN pan_number VARCHAR(50)',
		'ALTER TABLE quotations ADD COLUMN tan_number VARCHAR(50)',
		'ALTER TABLE quotations ADD COLUMN gst_type VARCHAR(20) DEFAULT "cgst_sgst"',
		'ALTER TABLE quotations ADD COLUMN terms_and_conditions TEXT',
		'ALTER TABLE quotations ADD COLUMN notes TEXT',
		'ALTER TABLE quotations ADD COLUMN terms TEXT',
		'ALTER TABLE quotations ADD COLUMN valid_until DATE',
		"ALTER TABLE quotations ADD COLUMN status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft'",
		'ALTER TABLE quotations ADD COLUMN project_id INT NULL',
		'ALTER TABLE quotations ADD COLUMN proposal_id INT NULL',
		'ALTER TABLE quotations ADD COLUMN created_by INT',
		'ALTER TABLE quotations ADD COLUMN deleted_at TIMESTAMP NULL',
		'ALTER TABLE quotations ADD COLUMN annexure_scope_of_work TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_input_document TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_deliverables TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_software VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN annexure_duration VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN annexure_site_visit VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN annexure_quotation_validity VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN annexure_mode_of_delivery VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN annexure_revision VARCHAR(255)',
		'ALTER TABLE quotations ADD COLUMN annexure_exclusions TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_billing_payment_terms TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_taxation TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_payment_milestone TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_confidentiality TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_codes_standards TEXT',
		'ALTER TABLE quotations ADD COLUMN annexure_dispute_resolution TEXT',
		'ALTER TABLE quotations ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn('Quotations schema update warning:', e.message || e);
			}
		}
	}

	const indexMigrations = [
		'ALTER TABLE quotations DROP INDEX unique_active_quotation',
		'ALTER TABLE quotations ADD UNIQUE KEY (quotation_number)',
	];

	for (const stmt of indexMigrations) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (
				!e.message?.includes('check that it exists') &&
				!e.message?.includes('Duplicate key name')
			) {
				console.warn('Quotations index migration warning:', e.message || e);
			}
		}
	}

	try {
		await db.execute(
			'ALTER TABLE quotations MODIFY COLUMN project_id INT NULL'
		);
	} catch {
		/* column or modify may not be applicable */
	}

	try {
		await db.execute(
			'ALTER TABLE quotations MODIFY COLUMN proposal_id INT NULL'
		);
	} catch {
		/* column or modify may not be applicable */
	}

	try {
		await db.execute(
			'ALTER TABLE quotations ADD INDEX idx_project_id (project_id)'
		);
	} catch (e) {
		if (
			!e.message?.includes('Duplicate key name') &&
			!e.message?.includes('already exists')
		) {
			console.warn('Quotations index migration warning:', e.message || e);
		}
	}
}

async function initProjectQuotationsTable(db) {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_quotations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      quotation_number VARCHAR(100),
      quotation_date DATE,
      enquiry_number VARCHAR(100),
      enquiry_date DATE,
      enquiry_quantity VARCHAR(255),
      scope_of_work TEXT,
      client_name VARCHAR(255),
      client_address TEXT,
      kind_attn VARCHAR(255),
      scope_items JSON,
      gross_amount DECIMAL(15, 2) DEFAULT 0,
      gst_percentage DECIMAL(5, 2) DEFAULT 18,
      gst_amount DECIMAL(15, 2) DEFAULT 0,
      net_amount DECIMAL(15, 2) DEFAULT 0,
      amount_in_words TEXT,
      gst_number VARCHAR(50),
      pan_number VARCHAR(50),
      tan_number VARCHAR(50),
      gst_type VARCHAR(20) DEFAULT 'cgst_sgst',
      terms_and_conditions TEXT,
      status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
      deleted_at TIMESTAMP NULL,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      INDEX idx_isDelete (isDelete)
    )
  `);

	const alterStatements = [
		'ALTER TABLE project_quotations ADD COLUMN enquiry_date DATE',
		'ALTER TABLE project_quotations ADD COLUMN client_name VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN client_address TEXT',
		'ALTER TABLE project_quotations ADD COLUMN kind_attn VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN scope_items JSON',
		'ALTER TABLE project_quotations ADD COLUMN amount_in_words TEXT',
		'ALTER TABLE project_quotations ADD COLUMN gst_number VARCHAR(50)',
		'ALTER TABLE project_quotations ADD COLUMN pan_number VARCHAR(50)',
		'ALTER TABLE project_quotations ADD COLUMN tan_number VARCHAR(50)',
		'ALTER TABLE project_quotations ADD COLUMN gst_type VARCHAR(20) DEFAULT "cgst_sgst"',
		'ALTER TABLE project_quotations ADD COLUMN terms_and_conditions TEXT',
		"ALTER TABLE project_quotations ADD COLUMN status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft'",
		'ALTER TABLE project_quotations ADD COLUMN deleted_at TIMESTAMP NULL',
		'ALTER TABLE project_quotations ADD COLUMN annexure_scope_of_work TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_input_document TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_deliverables TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_software VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN annexure_duration VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN annexure_site_visit VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN annexure_quotation_validity VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN annexure_mode_of_delivery VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN annexure_revision VARCHAR(255)',
		'ALTER TABLE project_quotations ADD COLUMN annexure_exclusions TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_billing_payment_terms TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_taxation TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_payment_milestone TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_confidentiality TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_codes_standards TEXT',
		'ALTER TABLE project_quotations ADD COLUMN annexure_dispute_resolution TEXT',
		'ALTER TABLE project_quotations ADD COLUMN isDelete TINYINT(1) NOT NULL DEFAULT 0',
	];

	for (const stmt of alterStatements) {
		try {
			await db.execute(stmt);
		} catch (e) {
			if (e.errno !== 1060 && !e.message?.includes('Duplicate column name')) {
				console.warn(
					'Project quotations schema update warning:',
					e.message || e
				);
			}
		}
	}
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
      status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled', 'fully_paid', 'partially_paid') DEFAULT 'draft',
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
		"ALTER TABLE invoices MODIFY COLUMN status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled', 'fully_paid', 'partially_paid') DEFAULT 'draft'",
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
