/**
 * Canonical order identity and direction (ticket #310).
 *
 * One order store with an explicit direction and a durable `order_uid` replaces
 * the four pre-canonical stores consumers used to join by document number:
 *   purchase_orders, outgoing_purchase_orders, project_purchase_orders, and
 *   project_invoices rows carrying `tab_type = 'purchase_order'`.
 *
 * Nothing here classifies a legacy row: table names, counterparty text, and
 * client-invoice links are not direction evidence, so every existing row is
 * queued in `order_legacy_mappings` for a document-backed review decision.
 * The same document number in two stores is recorded as a collision candidate,
 * never merged.
 *
 * `invoices.order_uid` is the canonical reference for a client invoice's
 * order (replacing the free-text `po_number` cross-store match), and
 * `entity_documents` learns the `order` entity so an order keeps its source
 * documents.
 *
 * Idempotent: every step checks information_schema first.
 */

const LEGACY_STORES = [
	'purchase_orders',
	'outgoing_purchase_orders',
	'project_purchase_orders',
	'project_invoices',
];

export async function up(knex) {
	const hasTable = async (table) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema = DATABASE() AND table_name = ?
			 LIMIT 1`,
			[table]
		);
		return rows.length > 0;
	};

	const hasColumn = async (table, column) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
			 LIMIT 1`,
			[table, column]
		);
		return rows.length > 0;
	};

	const hasIndex = async (table, index) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.statistics
			 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
			 LIMIT 1`,
			[table, index]
		);
		return rows.length > 0;
	};

	if (!(await hasTable('orders'))) {
		await knex.raw(`
CREATE TABLE \`orders\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`order_uid\` varchar(64) NOT NULL,
  \`order_number\` varchar(100) NOT NULL,
  \`direction\` enum('client','supplier') NOT NULL,
  \`counterparty_name\` varchar(255) NOT NULL,
  \`company_id\` int(11) DEFAULT NULL,
  \`project_id\` int(11) DEFAULT NULL,
  \`currency\` varchar(3) NOT NULL DEFAULT 'INR',
  \`amount_basis\` enum('gross','net','unknown') NOT NULL DEFAULT 'unknown',
  \`gross_amount\` decimal(15,2) DEFAULT NULL,
  \`tax_amount\` decimal(15,2) DEFAULT NULL,
  \`net_amount\` decimal(15,2) DEFAULT NULL,
  \`client_invoiced_value\` decimal(15,2) DEFAULT NULL,
  \`order_date\` date DEFAULT NULL,
  \`status\` enum('draft','pending','approved','completed','cancelled') NOT NULL DEFAULT 'draft',
  \`firmness\` enum('firm','cancellable','unknown') NOT NULL DEFAULT 'unknown',
  \`firmness_evidence_reference\` varchar(255) DEFAULT NULL,
  \`source_document_reference\` varchar(255) DEFAULT NULL,
  \`evidence_reference\` varchar(255) DEFAULT NULL,
  \`remarks\` text DEFAULT NULL,
  \`origin_mapping_id\` int(11) DEFAULT NULL,
  \`created_from\` enum('entry','legacy_review') NOT NULL DEFAULT 'entry',
  \`financial_version\` int(11) NOT NULL DEFAULT 1,
  \`created_by\` int(11) DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  \`updated_at\` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  \`isDelete\` tinyint(1) NOT NULL DEFAULT 0,
  \`deleted_at\` datetime DEFAULT NULL,
  \`deleted_by\` int(11) DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`unique_order_uid\` (\`order_uid\`),
  KEY \`idx_order_number\` (\`order_number\`),
  KEY \`idx_order_direction_status\` (\`direction\`,\`status\`),
  KEY \`idx_order_project\` (\`project_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		`);
	}

	if (!(await hasTable('order_legacy_mappings'))) {
		await knex.raw(`
CREATE TABLE \`order_legacy_mappings\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`legacy_store\` enum(${LEGACY_STORES.map((s) => `'${s}'`).join(',')}) NOT NULL,
  \`legacy_id\` int(11) NOT NULL,
  \`document_number\` varchar(100) DEFAULT NULL,
  \`counterparty_name\` varchar(255) DEFAULT NULL,
  \`legacy_amount\` decimal(15,2) DEFAULT NULL,
  \`legacy_date\` date DEFAULT NULL,
  \`legacy_status\` varchar(50) DEFAULT NULL,
  \`project_id\` int(11) DEFAULT NULL,
  \`review_state\` enum('pending','resolved','duplicate','insufficient') NOT NULL DEFAULT 'pending',
  \`resolved_direction\` enum('client','supplier') DEFAULT NULL,
  \`canonical_order_uid\` varchar(64) DEFAULT NULL,
  \`duplicate_of_mapping_id\` int(11) DEFAULT NULL,
  \`version\` int(11) NOT NULL DEFAULT 1,
  \`reason\` text DEFAULT NULL,
  \`evidence_reference\` varchar(255) DEFAULT NULL,
  \`reviewed_by\` int(11) DEFAULT NULL,
  \`reviewed_at\` datetime DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  \`updated_at\` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`unique_legacy_copy\` (\`legacy_store\`,\`legacy_id\`),
  KEY \`idx_legacy_document\` (\`document_number\`),
  KEY \`idx_legacy_review_state\` (\`review_state\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		`);
	}

	if (!(await hasTable('order_review_decisions'))) {
		await knex.raw(`
CREATE TABLE \`order_review_decisions\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`mapping_id\` int(11) NOT NULL,
  \`decision\` enum('classify','link','duplicate','insufficient') NOT NULL,
  \`version\` int(11) NOT NULL,
  \`direction\` enum('client','supplier') DEFAULT NULL,
  \`canonical_order_uid\` varchar(64) DEFAULT NULL,
  \`duplicate_of_mapping_id\` int(11) DEFAULT NULL,
  \`reason\` text NOT NULL,
  \`evidence_reference\` varchar(255) DEFAULT NULL,
  \`actor_id\` int(11) DEFAULT NULL,
  \`actor_name\` varchar(255) DEFAULT NULL,
  \`payload\` json DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`unique_mapping_version\` (\`mapping_id\`,\`version\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		`);
	}

	if (!(await hasTable('order_events'))) {
		await knex.raw(`
CREATE TABLE \`order_events\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`order_uid\` varchar(64) NOT NULL,
  \`version\` int(11) DEFAULT NULL,
  \`event\` enum('created','updated','client_invoiced') NOT NULL,
  \`amount\` decimal(15,2) DEFAULT NULL,
  \`reference\` varchar(100) DEFAULT NULL,
  \`actor_id\` int(11) DEFAULT NULL,
  \`reason\` text DEFAULT NULL,
  \`payload\` json DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`unique_order_version\` (\`order_uid\`,\`version\`),
  KEY \`idx_order_events_uid\` (\`order_uid\`,\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
		`);
	}

	if (!(await hasColumn('invoices', 'order_uid'))) {
		await knex.raw(
			`ALTER TABLE \`invoices\` ADD COLUMN \`order_uid\` varchar(64) DEFAULT NULL`
		);
	}
	if (!(await hasIndex('invoices', 'idx_invoice_order_uid'))) {
		await knex.raw(
			`ALTER TABLE \`invoices\` ADD KEY \`idx_invoice_order_uid\` (\`order_uid\`)`
		);
	}

	// Documents may attach to a canonical order the same way they attach to a
	// project, a legacy purchase order, or an invoice.
	const [entityColumns] = await knex.raw(
		`SELECT COLUMN_TYPE FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'entity_documents'
		    AND column_name = 'entity_type'
		  LIMIT 1`
	);
	const entityType = entityColumns?.[0]?.COLUMN_TYPE ?? '';
	if (entityType && !entityType.includes("'order'")) {
		await knex.raw(
			`ALTER TABLE \`entity_documents\`
			 MODIFY COLUMN \`entity_type\` enum('project','purchase_order','invoice','order') NOT NULL`
		);
	}

	// Queue every active legacy copy once. The review state starts `pending`;
	// nothing in this migration assigns a direction, a canonical identity, or a
	// duplicate link.
	const backfills = [
		{
			store: 'purchase_orders',
			sql: `INSERT INTO order_legacy_mappings
           (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
         SELECT 'purchase_orders', po.id, po.po_number, po.vendor_name,
                COALESCE(po.po_amount, po.total, po.net_amount), po.po_date, po.status, po.project_id
           FROM purchase_orders po
          WHERE (po.isDelete = 0 OR po.isDelete IS NULL)
            AND NOT EXISTS (
              SELECT 1 FROM order_legacy_mappings m
               WHERE m.legacy_store = 'purchase_orders' AND m.legacy_id = po.id)`,
		},
		{
			store: 'outgoing_purchase_orders',
			sql: `INSERT INTO order_legacy_mappings
           (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
         SELECT 'outgoing_purchase_orders', po.id, po.po_number, po.company_name,
                po.po_amount, po.po_date, po.status, NULL
           FROM outgoing_purchase_orders po
          WHERE po.isDelete = 0
            AND NOT EXISTS (
              SELECT 1 FROM order_legacy_mappings m
               WHERE m.legacy_store = 'outgoing_purchase_orders' AND m.legacy_id = po.id)`,
		},
		{
			// Both names are display hints only; a row carrying both stays
			// explicitly ambiguous until a document-backed review decides.
			store: 'project_purchase_orders',
			sql: `INSERT INTO order_legacy_mappings
           (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
         SELECT 'project_purchase_orders', po.id, po.po_number,
                CONCAT_WS(' / ', po.client_name, po.vendor_name),
                po.net_amount, po.po_date, NULL, po.project_id
           FROM project_purchase_orders po
          WHERE NOT EXISTS (
              SELECT 1 FROM order_legacy_mappings m
               WHERE m.legacy_store = 'project_purchase_orders' AND m.legacy_id = po.id)`,
		},
		{
			store: 'project_invoices',
			sql: `INSERT INTO order_legacy_mappings
           (legacy_store, legacy_id, document_number, counterparty_name, legacy_amount, legacy_date, legacy_status, project_id)
         SELECT 'project_invoices', pi.id, pi.po_number, pi.client_name,
                COALESCE(pi.po_amount, pi.invoice_amount), pi.po_date, pi.status, pi.project_id
           FROM project_invoices pi
          WHERE pi.isDelete = 0 AND pi.tab_type = 'purchase_order'
            AND NOT EXISTS (
              SELECT 1 FROM order_legacy_mappings m
               WHERE m.legacy_store = 'project_invoices' AND m.legacy_id = pi.id)`,
		},
	];

	for (const { sql } of backfills) {
		await knex.raw(sql);
	}
}

export async function down(knex) {
	const hasTable = async (table) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.tables
			 WHERE table_schema = DATABASE() AND table_name = ?
			 LIMIT 1`,
			[table]
		);
		return rows.length > 0;
	};

	const hasColumn = async (table, column) => {
		const [rows] = await knex.raw(
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
			 LIMIT 1`,
			[table, column]
		);
		return rows.length > 0;
	};

	const [entityColumns] = await knex.raw(
		`SELECT COLUMN_TYPE FROM information_schema.columns
		  WHERE table_schema = DATABASE() AND table_name = 'entity_documents'
		    AND column_name = 'entity_type'
		  LIMIT 1`
	);
	const entityType = entityColumns?.[0]?.COLUMN_TYPE ?? '';
	if (entityType.includes("'order'")) {
		// Narrow only when no document uses the value — a narrowing with rows
		// present would truncate under STRICT_TRANS_TABLES.
		const [used] = await knex.raw(
			`SELECT COUNT(*) AS n FROM entity_documents WHERE entity_type = 'order'`
		);
		if (Number(used?.[0]?.n ?? 0) === 0) {
			await knex.raw(
				`ALTER TABLE \`entity_documents\`
				 MODIFY COLUMN \`entity_type\` enum('project','purchase_order','invoice') NOT NULL`
			);
		}
	}

	if (await hasColumn('invoices', 'order_uid')) {
		const [used] = await knex.raw(
			`SELECT COUNT(*) AS n FROM invoices WHERE order_uid IS NOT NULL`
		);
		if (Number(used?.[0]?.n ?? 0) === 0) {
			await knex.raw(`ALTER TABLE \`invoices\` DROP COLUMN \`order_uid\``);
		}
	}

	for (const table of [
		'order_events',
		'order_review_decisions',
		'order_legacy_mappings',
		'orders',
	]) {
		if (await hasTable(table)) {
			await knex.raw(`DROP TABLE \`${table}\``);
		}
	}
}
