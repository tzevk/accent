import {
	executeMigrationSql,
	type MigrationDb,
} from '../../scripts/migration-sql.ts';

/**
 * Salary Profile timeline foundation (#435).
 *
 * Non-destructive schema for dated Salary Revisions:
 * - retained cancellation state and a MariaDB-compatible unique eligible
 *   start date (generated NULLs let cancelled/inactive rows keep their dates), so
 *   a later valid agreement can reuse a cancelled month;
 * - CTC-first agreements may leave the legacy gross amount columns unset;
 * - a per-Employee salary-timeline version used for optimistic writes;
 * - a durable Employee/agreement/month payroll-use ledger that survives slip
 *   deletion or run reopening;
 * - agreed-agreement provenance and Salary Type snapshots on new Payroll Slips;
 * - dedicated audit actions for correction, revision and cancellation.
 *
 * Rollout evidence: recorded Payroll Slips, deleted-slip Payroll Slip audit
 * rows, and frozen Payroll Run roster provenance are conservatively backfilled
 * into the use ledger. A legacy slip/audit row with no recorded agreement
 * identity produces an ambiguous use row (agreement NULL) with candidate ids in
 * evidence_context; it never invents an exact old agreement link. Ambiguous
 * evidence blocks the affected month until an authorized review resolves it.
 *
 * Idempotent: tables, columns and indexes are checked through
 * information_schema. Existing profile, slip, audit and roster rows are never
 * updated or deleted. The only data written is the new evidence ledger and
 * timeline version rows.
 */

type Row = Record<string, unknown>;

const AUDIT_ACTION_ENUM =
	"enum('create','update','delete','approve','reject','finalize','lock','reopen','correct','revise','cancel')";

interface Candidate {
	agreement_id: number;
	agreement_source: 'employee_salary_profile' | 'salary_structures';
	effective_from: string;
	effective_to: string | null;
}

interface EvidenceKey {
	employee_id: number;
	month: string;
	slip_ids: Set<number>;
	slip_identities: Set<string>;
	audit_ids: Set<number>;
	audit_actions: Set<string>;
	audit_identities: Set<string>;
	roster_run_ids: Set<number>;
	roster_versions: Set<number>;
	roster_identities: Set<string>;
	first_used_at: string | null;
}

function rowsOf(result: unknown): Row[] {
	if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
	return (result[0] as unknown[]).filter(
		(row): row is Row =>
			row !== null && typeof row === 'object' && !Array.isArray(row)
	);
}

async function hasTable(db: MigrationDb, table: string): Promise<boolean> {
	const rows = rowsOf(
		await executeMigrationSql(
			db,
			`SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = ?
        LIMIT 1`,
			[table]
		)
	);
	return rows.length > 0;
}

async function hasColumn(
	db: MigrationDb,
	table: string,
	column: string
): Promise<boolean> {
	const rows = rowsOf(
		await executeMigrationSql(
			db,
			`SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
        LIMIT 1`,
			[table, column]
		)
	);
	return rows.length > 0;
}

async function hasIndex(
	db: MigrationDb,
	table: string,
	index: string
): Promise<boolean> {
	const rows = rowsOf(
		await executeMigrationSql(
			db,
			`SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
        LIMIT 1`,
			[table, index]
		)
	);
	return rows.length > 0;
}

function text(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number > 0 ? number : null;
	}
	return null;
}

function localDateParts(value: unknown): {
	year: number;
	month: number;
	day: number;
} | null {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		return {
			year: value.getFullYear(),
			month: value.getMonth() + 1,
			day: value.getDate(),
		};
	}
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (match === null) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
		return null;
	}
	return { year, month, day };
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}

function dateOnly(value: unknown): string | null {
	const parts = localDateParts(value);
	if (parts === null) return null;
	return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

function monthStart(value: unknown): string | null {
	const day = dateOnly(value);
	if (day === null) return null;
	return `${day.slice(0, 7)}-01`;
}

function sqlDateTime(value: unknown): string | null {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		return `${value.getFullYear()}-${pad(value.getMonth() + 1, 2)}-${pad(
			value.getDate(),
			2
		)} ${pad(value.getHours(), 2)}:${pad(value.getMinutes(), 2)}:${pad(
			value.getSeconds(),
			2
		)}`;
	}
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed === '') return null;
	return trimmed.replace('T', ' ').slice(0, 19);
}

function earlier(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return left <= right ? left : right;
}

function jsonObject(value: unknown): Row | null {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return value as Row;
	}
	if (typeof value !== 'string' || value.trim() === '') return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed !== null &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed)
			? (parsed as Row)
			: null;
	} catch {
		return null;
	}
}

function identity(source: unknown, id: unknown): string | null {
	if (source !== 'employee_salary_profile' && source !== 'salary_structures') {
		return null;
	}
	const agreementId = positiveInteger(id);
	return agreementId === null ? null : `${source}:${agreementId}`;
}

function splitIdentity(value: string): {
	agreement_source: 'employee_salary_profile' | 'salary_structures';
	agreement_id: number;
} {
	const separator = value.indexOf(':');
	return {
		agreement_source: value.slice(0, separator) as
			| 'employee_salary_profile'
			| 'salary_structures',
		agreement_id: Number(value.slice(separator + 1)),
	};
}

function identityFromAudit(row: Row): string | null {
	for (const raw of [row.old_values, row.new_values]) {
		const values = jsonObject(raw);
		if (values === null) continue;
		const found = identity(
			values.salary_profile_source,
			values.salary_profile_id
		);
		if (found !== null) return found;
	}
	return null;
}

function candidatesFor(
	byEmployee: Map<number, Candidate[]>,
	employeeId: number,
	month: string,
	joiningDate: string | null
): Candidate[] {
	const anchor =
		joiningDate !== null && joiningDate > month ? joiningDate : month;
	return (byEmployee.get(employeeId) ?? []).filter(
		(candidate) =>
			candidate.effective_from <= anchor &&
			(candidate.effective_to === null || candidate.effective_to >= anchor)
	);
}

async function insertUse(
	db: MigrationDb,
	input: {
		employeeId: number;
		month: string | null;
		agreementId: number | null;
		agreementSource: string | null;
		evidence: string;
		isAmbiguous: boolean;
		context: Row;
		firstUsedAt: string;
	}
): Promise<void> {
	await executeMigrationSql(
		db,
		`INSERT INTO employee_salary_payroll_use
       (employee_id, month, agreement_id, agreement_source, evidence,
        is_ambiguous, evidence_context, first_used_by, first_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON DUPLICATE KEY UPDATE id = id`,
		[
			input.employeeId,
			input.month,
			input.agreementId,
			input.agreementSource,
			input.evidence,
			input.isAmbiguous ? 1 : 0,
			JSON.stringify(input.context),
			input.firstUsedAt,
		]
	);
}

async function collectCandidates(
	db: MigrationDb
): Promise<Map<number, Candidate[]>> {
	const byEmployee = new Map<number, Candidate[]>();
	const add = (
		row: Row,
		source: 'employee_salary_profile' | 'salary_structures'
	) => {
		const employeeId = positiveInteger(row.employee_id);
		const agreementId = positiveInteger(row.id);
		const from = dateOnly(row.effective_from);
		if (employeeId === null || agreementId === null || from === null) return;
		const rawTo = row.effective_to;
		const to = rawTo === null || rawTo === undefined ? null : dateOnly(rawTo);
		if (rawTo !== null && rawTo !== undefined && to === null) return;
		if (to !== null && to < from) return;
		if (Number(row.is_active ?? 1) === 0) return;
		if (text(row.cancelled_at) !== null) return;
		const rows = byEmployee.get(employeeId) ?? [];
		rows.push({
			agreement_id: agreementId,
			agreement_source: source,
			effective_from: from,
			effective_to: to,
		});
		byEmployee.set(employeeId, rows);
	};

	for (const row of rowsOf(
		await executeMigrationSql(
			db,
			`SELECT id, employee_id, effective_from, effective_to, is_active,
              cancelled_at
         FROM employee_salary_profile`
		)
	)) {
		add(row, 'employee_salary_profile');
	}
	if (await hasTable(db, 'salary_structures')) {
		for (const row of rowsOf(
			await executeMigrationSql(
				db,
				`SELECT id, employee_id, effective_from, effective_to, is_active
           FROM salary_structures`
			)
		)) {
			add(row, 'salary_structures');
		}
	}
	for (const rows of byEmployee.values()) {
		rows.sort(
			(left, right) =>
				left.effective_from.localeCompare(right.effective_from) ||
				left.agreement_source.localeCompare(right.agreement_source) ||
				left.agreement_id - right.agreement_id
		);
	}
	return byEmployee;
}

async function backfillPayrollUse(db: MigrationDb): Promise<void> {
	if (!(await hasTable(db, 'payroll_slips'))) return;

	const joiningByEmployee = new Map<number, string | null>();
	if (await hasTable(db, 'employees')) {
		for (const row of rowsOf(
			await executeMigrationSql(
				db,
				`SELECT id, joining_date, hire_date
           FROM employees
          WHERE isDelete = 0`
			)
		)) {
			const employeeId = positiveInteger(row.id);
			if (employeeId === null) continue;
			joiningByEmployee.set(
				employeeId,
				dateOnly(row.joining_date) ?? dateOnly(row.hire_date)
			);
		}
	}

	const candidates = await collectCandidates(db);
	const keys = new Map<string, EvidenceKey>();
	const ensureKey = (employeeId: number, month: string): EvidenceKey => {
		const key = `${employeeId}:${month}`;
		let entry = keys.get(key);
		if (entry === undefined) {
			entry = {
				employee_id: employeeId,
				month,
				slip_ids: new Set(),
				slip_identities: new Set(),
				audit_ids: new Set(),
				audit_actions: new Set(),
				audit_identities: new Set(),
				roster_run_ids: new Set(),
				roster_versions: new Set(),
				roster_identities: new Set(),
				first_used_at: null,
			};
			keys.set(key, entry);
		}
		return entry;
	};

	for (const row of rowsOf(
		await executeMigrationSql(
			db,
			`SELECT id, employee_id, month, salary_profile_id,
              salary_profile_source, created_at
         FROM payroll_slips
        WHERE month IS NOT NULL
        ORDER BY employee_id, month, id`
		)
	)) {
		const employeeId = positiveInteger(row.employee_id);
		const month = monthStart(row.month);
		if (employeeId === null || month === null) continue;
		const entry = ensureKey(employeeId, month);
		const slipId = positiveInteger(row.id);
		if (slipId !== null) entry.slip_ids.add(slipId);
		const found = identity(row.salary_profile_source, row.salary_profile_id);
		if (found !== null) entry.slip_identities.add(found);
		entry.first_used_at = earlier(
			entry.first_used_at,
			sqlDateTime(row.created_at)
		);
	}

	if (await hasTable(db, 'payroll_run_rosters')) {
		for (const row of rowsOf(
			await executeMigrationSql(
				db,
				`SELECT run_id, month, version, members, frozen_at
           FROM payroll_run_rosters
          WHERE isDelete = 0
          ORDER BY month, run_id, version`
			)
		)) {
			const month = monthStart(row.month);
			const rawMembers = row.members;
			let members: unknown = rawMembers;
			if (typeof rawMembers === 'string') {
				try {
					members = JSON.parse(rawMembers);
				} catch {
					members = [];
				}
			}
			if (!Array.isArray(members)) continue;
			const runId = positiveInteger(row.run_id);
			const version = positiveInteger(row.version);
			for (const raw of members) {
				if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
					continue;
				const member = raw as Row;
				const employeeId = positiveInteger(member.employee_id);
				if (employeeId === null || month === null) continue;
				const entry = ensureKey(employeeId, month);
				if (runId !== null) entry.roster_run_ids.add(runId);
				if (version !== null) entry.roster_versions.add(version);
				const found = identity(member.profile_source, member.profile_id);
				if (found !== null) entry.roster_identities.add(found);
				entry.first_used_at = earlier(
					entry.first_used_at,
					sqlDateTime(row.frozen_at)
				);
			}
		}
	}

	if (await hasTable(db, 'payroll_audit_logs')) {
		for (const row of rowsOf(
			await executeMigrationSql(
				db,
				`SELECT id, employee_id, action, month, year, old_values,
                new_values, performed_at
           FROM payroll_audit_logs
          WHERE entity_type = 'payroll_slip'
            AND employee_id IS NOT NULL
            AND month IS NOT NULL
            AND year IS NOT NULL
          ORDER BY employee_id, year, month, id`
			)
		)) {
			const employeeId = positiveInteger(row.employee_id);
			const monthNumber = positiveInteger(row.month);
			const year = positiveInteger(row.year);
			if (
				employeeId === null ||
				monthNumber === null ||
				monthNumber > 12 ||
				year === null
			) {
				continue;
			}
			const month = `${pad(year, 4)}-${pad(monthNumber, 2)}-01`;
			const entry = ensureKey(employeeId, month);
			const auditId = positiveInteger(row.id);
			if (auditId !== null) entry.audit_ids.add(auditId);
			const action = text(row.action);
			if (action !== null) entry.audit_actions.add(action);
			const found = identityFromAudit(row);
			if (found !== null) entry.audit_identities.add(found);
			entry.first_used_at = earlier(
				entry.first_used_at,
				sqlDateTime(row.performed_at)
			);
		}
	}

	const now = new Date();
	const fallbackFirstUsed = sqlDateTime(now) as string;
	for (const entry of keys.values()) {
		const joiningDate = joiningByEmployee.get(entry.employee_id) ?? null;
		const candidateRows = candidatesFor(
			candidates,
			entry.employee_id,
			entry.month,
			joiningDate
		).map((candidate) => ({
			agreement_id: candidate.agreement_id,
			agreement_source: candidate.agreement_source,
		}));
		const exactBySource = new Map<string, string[]>();
		for (const [source, identities] of [
			['legacy_roster', entry.roster_identities],
			['legacy_slip', entry.slip_identities],
			['legacy_audit', entry.audit_identities],
		] as const) {
			if (identities.size > 0) {
				exactBySource.set(source, [...identities].sort());
			}
		}
		const conflicting = [...exactBySource.values()].some(
			(identities) => identities.length > 1
		);
		const distinct = new Set<string>();
		for (const identities of exactBySource.values()) {
			if (identities.length === 1) distinct.add(identities[0]);
		}

		const context: Row = {
			slip_ids: [...entry.slip_ids].sort((a, b) => a - b),
			audit_log_ids: [...entry.audit_ids].sort((a, b) => a - b),
			audit_actions: [...entry.audit_actions].sort(),
			roster_run_ids: [...entry.roster_run_ids].sort((a, b) => a - b),
			roster_versions: [...entry.roster_versions].sort((a, b) => a - b),
			candidate_agreements: candidateRows,
		};
		const firstUsedAt = entry.first_used_at ?? fallbackFirstUsed;

		if (!conflicting && distinct.size === 1) {
			const [source, identities] = [...exactBySource.entries()].find(
				([, values]) => values.length === 1
			) as [string, string[]];
			const exact = splitIdentity(identities[0]);
			await insertUse(db, {
				employeeId: entry.employee_id,
				month: entry.month,
				agreementId: exact.agreement_id,
				agreementSource: exact.agreement_source,
				evidence: source,
				isAmbiguous: false,
				context,
				firstUsedAt,
			});
			continue;
		}

		const evidence =
			entry.roster_identities.size > 0
				? 'legacy_roster'
				: entry.slip_identities.size > 0 || entry.slip_ids.size > 0
					? 'legacy_slip'
					: 'legacy_audit';
		await insertUse(db, {
			employeeId: entry.employee_id,
			month: entry.month,
			agreementId: null,
			agreementSource: null,
			evidence,
			isAmbiguous: true,
			context: {
				...context,
				reason: conflicting
					? 'conflicting_legacy_provenance'
					: 'unproven_legacy_provenance',
			},
			firstUsedAt,
		});
	}

	await executeMigrationSql(
		db,
		`INSERT INTO employee_salary_timelines (employee_id, version)
     SELECT u.employee_id, 1
       FROM (SELECT DISTINCT employee_id FROM employee_salary_payroll_use) u
       LEFT JOIN employee_salary_timelines t ON t.employee_id = u.employee_id
      WHERE t.employee_id IS NULL`
	);
}

export async function up(db: MigrationDb): Promise<void> {
	// Retained cancellation state. `cancelled_at` is authoritative; writers
	// keep is_active = 0 in sync for legacy readers.
	for (const [column, definition] of [
		['cancelled_at', 'DATETIME NULL'],
		['cancelled_by', 'INT NULL'],
		['cancelled_reason', 'VARCHAR(255) NULL'],
	] as const) {
		if (!(await hasColumn(db, 'employee_salary_profile', column))) {
			await executeMigrationSql(
				db,
				`ALTER TABLE \`employee_salary_profile\`
           ADD COLUMN \`${column}\` ${definition}`
			);
		}
	}

	// A CTC-first agreement leaves the legacy gross amounts unset. Existing
	// zeros remain recorded values; the migration never rewrites them.
	await executeMigrationSql(
		db,
		`ALTER TABLE \`employee_salary_profile\`
       MODIFY COLUMN \`gross\` DECIMAL(12,2) NULL DEFAULT NULL,
       MODIFY COLUMN \`gross_salary\` DECIMAL(12,2) NULL DEFAULT NULL`
	);

	if (
		!(await hasColumn(db, 'employee_salary_profile', 'eligible_start_date'))
	) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`employee_salary_profile\`
         ADD COLUMN \`eligible_start_date\` DATE
         GENERATED ALWAYS AS (
           IF(\`is_active\` = 1 AND \`cancelled_at\` IS NULL,
              \`effective_from\`, NULL)
         ) STORED`
		);
	}
	if (
		!(await hasIndex(
			db,
			'employee_salary_profile',
			'uq_employee_salary_profile_eligible_start'
		))
	) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`employee_salary_profile\`
         ADD UNIQUE KEY \`uq_employee_salary_profile_eligible_start\`
           (\`employee_id\`, \`eligible_start_date\`)`
		);
	}
	if (await hasIndex(db, 'employee_salary_profile', 'unique_active_employee')) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`employee_salary_profile\`
         DROP INDEX \`unique_active_employee\``
		);
	}
	if (
		!(await hasIndex(
			db,
			'employee_salary_profile',
			'idx_employee_salary_profile_timeline'
		))
	) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`employee_salary_profile\`
         ADD KEY \`idx_employee_salary_profile_timeline\`
           (\`employee_id\`, \`is_active\`, \`cancelled_at\`, \`effective_from\`)`
		);
	}

	if (!(await hasTable(db, 'employee_salary_timelines'))) {
		await executeMigrationSql(
			db,
			`
      CREATE TABLE \`employee_salary_timelines\` (
        \`employee_id\` INT NOT NULL PRIMARY KEY,
        \`version\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        \`updated_by\` INT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
		);
	}

	if (!(await hasTable(db, 'employee_salary_payroll_use'))) {
		await executeMigrationSql(
			db,
			`
      CREATE TABLE \`employee_salary_payroll_use\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`employee_id\` INT NOT NULL,
        \`month\` DATE NULL
          COMMENT 'First day of payroll month; NULL only for unknown-month ambiguity',
        \`agreement_id\` INT NULL
          COMMENT 'employee_salary_profile.id or salary_structures.id',
        \`agreement_source\` VARCHAR(32) NULL
          COMMENT 'employee_salary_profile | salary_structures',
        \`evidence\` ENUM(
          'payroll_generation','payroll_finalization','legacy_slip',
          'legacy_audit','legacy_roster'
        ) NOT NULL,
        \`is_ambiguous\` TINYINT(1) NOT NULL DEFAULT 0,
        \`evidence_context\` LONGTEXT CHARACTER SET utf8mb4
          COLLATE utf8mb4_bin NULL
          CHECK (json_valid(\`evidence_context\`)),
        \`first_used_by\` INT NULL,
        \`first_used_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`month_key\` DATE GENERATED ALWAYS AS
          (IFNULL(\`month\`, '1000-01-01')) STORED,
        \`agreement_key\` INT GENERATED ALWAYS AS
          (IFNULL(\`agreement_id\`, 0)) STORED,
        \`agreement_source_key\` VARCHAR(32) GENERATED ALWAYS AS
          (IFNULL(\`agreement_source\`, '')) STORED,
        UNIQUE KEY \`uq_employee_salary_payroll_use\`
          (\`employee_id\`, \`month_key\`, \`agreement_source_key\`,
           \`agreement_key\`),
        KEY \`idx_employee_salary_payroll_use_month\`
          (\`employee_id\`, \`month_key\`, \`is_ambiguous\`),
        KEY \`idx_employee_salary_payroll_use_agreement\`
          (\`agreement_source\`, \`agreement_id\`, \`month_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `
		);
	}

	for (const [column, definition] of [
		['salary_profile_id', 'INT NULL'],
		['salary_profile_source', 'VARCHAR(32) NULL'],
		['salary_type', 'VARCHAR(20) NULL'],
	] as const) {
		if (!(await hasColumn(db, 'payroll_slips', column))) {
			await executeMigrationSql(
				db,
				`ALTER TABLE \`payroll_slips\`
           ADD COLUMN \`${column}\` ${definition}`
			);
		}
	}
	if (
		!(await hasIndex(db, 'payroll_slips', 'idx_payroll_slips_salary_profile'))
	) {
		await executeMigrationSql(
			db,
			`ALTER TABLE \`payroll_slips\`
         ADD KEY \`idx_payroll_slips_salary_profile\`
           (\`salary_profile_id\`, \`month\`)`
		);
	}

	await executeMigrationSql(
		db,
		`ALTER TABLE \`payroll_audit_logs\`
       MODIFY COLUMN \`action\` ${AUDIT_ACTION_ENUM} NOT NULL`
	);

	await backfillPayrollUse(db);
}
