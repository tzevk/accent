export type AccountLinkQueryExecutor = (
	sql: string,
	bindings?: readonly (string | number | boolean | null)[]
) => Promise<unknown>;

type AuditRow = Record<string, unknown>;
type CountedRows<T> = { count: number; records: T[] };

export type AccountLinkAudit = {
	canMigrate: boolean;
	blocking: {
		duplicateLiveEmployeeLinks: CountedRows<{
			employeeId: number;
			userIds: number[];
		}>;
		danglingEmployeeReferences: CountedRows<{
			userId: number;
			employeeId: number;
		}>;
		liveAccountsWithDeletedEmployee: CountedRows<{
			userId: number;
			employeeId: number;
		}>;
		conflictingLegacyUsernames: CountedRows<{ employeeId: number }>;
	};
	informational: {
		accessFlagConflicts: CountedRows<{
			userId: number;
			status: string | null;
			isActive: number | null;
		}>;
		historicalAttribution: {
			unresolvedAssignments: number;
			unresolvedActivityLogs: number;
			unresolvedScreenTime: number;
			unresolvedTotal: number;
		};
	};
};

const CORE_COLUMNS: Record<string, readonly string[]> = {
	users: ['id', 'employee_id', 'isDelete'],
	employees: ['id', 'isDelete'],
};

function rowsFrom(result: unknown): AuditRow[] {
	if (!Array.isArray(result)) {
		throw new Error('Account-link audit query returned a non-array result.');
	}
	const rows = Array.isArray(result[0]) ? result[0] : result;
	return rows as AuditRow[];
}

async function queryRows(
	execute: AccountLinkQueryExecutor,
	sql: string,
	bindings: readonly (string | number | boolean | null)[] = []
): Promise<AuditRow[]> {
	return rowsFrom(await execute(sql, bindings));
}

function numberValue(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown): number | null {
	return value === null || value === undefined ? null : numberValue(value);
}

function nullableString(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}

function hasColumn(
	columns: Map<string, Set<string>>,
	table: string,
	column: string
): boolean {
	return columns.get(table.toLowerCase())?.has(column.toLowerCase()) ?? false;
}

async function countUnresolvedRows(
	execute: AccountLinkQueryExecutor,
	table: 'user_activity_logs' | 'user_screen_time',
	columns: Map<string, Set<string>>
): Promise<number> {
	if (
		!hasColumn(columns, table, 'user_id') ||
		!hasColumn(columns, 'users', 'employee_id')
	) {
		return 0;
	}
	const [row] = await queryRows(
		execute,
		`SELECT COUNT(*) AS unresolved_count
		 FROM \`${table}\` source
		 LEFT JOIN users u ON u.id = source.user_id
		 LEFT JOIN employees e
		   ON e.id = u.employee_id AND e.isDelete = 0
		 WHERE e.id IS NULL`
	);
	return numberValue(row?.unresolved_count);
}

async function countUnresolvedAssignments(
	execute: AccountLinkQueryExecutor,
	columns: Map<string, Set<string>>
): Promise<number> {
	const table = 'user_activity_assignments';
	if (
		!hasColumn(columns, table, 'user_id') ||
		!hasColumn(columns, table, 'daily_entries') ||
		!hasColumn(columns, 'users', 'employee_id')
	) {
		return 0;
	}
	const directEmployeeId = hasColumn(columns, table, 'employee_id');
	const notCancelled = hasColumn(columns, table, 'status')
		? "AND (source.status IS NULL OR source.status <> 'Cancelled')"
		: '';
	const explicitEmployeeJoin = directEmployeeId
		? `LEFT JOIN employees explicit_employee
		     ON explicit_employee.id = source.employee_id
		    AND explicit_employee.isDelete = 0`
		: '';
	const unresolvedIdentity = directEmployeeId
		? `AND ((source.employee_id IS NOT NULL AND explicit_employee.id IS NULL)
		     OR (source.employee_id IS NULL AND canonical_employee.id IS NULL))`
		: 'AND canonical_employee.id IS NULL';
	const [row] = await queryRows(
		execute,
		`SELECT COUNT(*) AS unresolved_count
		 FROM \`${table}\` source
		 LEFT JOIN users u ON u.id = source.user_id
		 LEFT JOIN employees canonical_employee
		   ON canonical_employee.id = u.employee_id
		  AND canonical_employee.isDelete = 0
		 ${explicitEmployeeJoin}
		 WHERE source.daily_entries IS NOT NULL
		   AND source.daily_entries NOT IN ('', '[]')
		   ${unresolvedIdentity}
		   ${notCancelled}`
	);
	return numberValue(row?.unresolved_count);
}

/**
 * Read-only preflight shared by the migration and the operator audit command.
 * The four `blocking` groups prevent the migration; access inconsistencies and
 * historical attribution gaps are disclosed separately and never repaired.
 */
export async function auditAccountLinks(
	execute: AccountLinkQueryExecutor
): Promise<AccountLinkAudit> {
	const schemaRows = await queryRows(
		execute,
		`SELECT table_name, column_name
		 FROM information_schema.columns
		 WHERE table_schema = DATABASE()
		   AND table_name IN (
		     'users', 'employees', 'user_activity_assignments',
		     'user_activity_logs', 'user_screen_time'
		   )`
	);
	const columns = new Map<string, Set<string>>();
	for (const row of schemaRows) {
		const table = String(row.table_name ?? '').toLowerCase();
		const column = String(row.column_name ?? '').toLowerCase();
		if (!table || !column) continue;
		const tableColumns = columns.get(table) ?? new Set<string>();
		tableColumns.add(column);
		columns.set(table, tableColumns);
	}

	for (const [table, requiredColumns] of Object.entries(CORE_COLUMNS)) {
		const missing = requiredColumns.filter(
			(column) => !hasColumn(columns, table, column)
		);
		if (missing.length > 0) {
			throw new Error(
				`Account-link audit requires ${table}.${missing.join(', ')}.`
			);
		}
	}

	const duplicateRows = await queryRows(
		execute,
		`SELECT employee_id, id AS user_id
		 FROM (
		   SELECT employee_id, id,
		          COUNT(*) OVER (PARTITION BY employee_id) AS link_count
		   FROM users
		   WHERE isDelete = 0 AND employee_id IS NOT NULL
		 ) live_links
		 WHERE link_count > 1
		 ORDER BY employee_id, user_id`
	);
	const duplicateGroups = new Map<number, number[]>();
	for (const row of duplicateRows) {
		const employeeId = numberValue(row.employee_id);
		const userIds = duplicateGroups.get(employeeId) ?? [];
		userIds.push(numberValue(row.user_id));
		duplicateGroups.set(employeeId, userIds);
	}
	const duplicateLiveEmployeeLinks = {
		count: duplicateGroups.size,
		records: Array.from(duplicateGroups, ([employeeId, userIds]) => ({
			employeeId,
			userIds,
		})),
	};

	const danglingRows = await queryRows(
		execute,
		`SELECT u.id AS user_id, u.employee_id
		 FROM users u
		 LEFT JOIN employees e ON e.id = u.employee_id
		 WHERE u.employee_id IS NOT NULL AND e.id IS NULL
		 ORDER BY u.id`
	);
	const danglingEmployeeReferences = {
		count: danglingRows.length,
		records: danglingRows.map((row) => ({
			userId: numberValue(row.user_id),
			employeeId: numberValue(row.employee_id),
		})),
	};

	const deletedEmployeeRows = await queryRows(
		execute,
		`SELECT u.id AS user_id, u.employee_id
		 FROM users u
		 JOIN employees e ON e.id = u.employee_id
		 WHERE u.isDelete = 0 AND COALESCE(e.isDelete, 1) <> 0
		 ORDER BY u.id`
	);
	const liveAccountsWithDeletedEmployee = {
		count: deletedEmployeeRows.length,
		records: deletedEmployeeRows.map((row) => ({
			userId: numberValue(row.user_id),
			employeeId: numberValue(row.employee_id),
		})),
	};

	const conflictingLegacyUsernames: CountedRows<{ employeeId: number }> = {
		count: 0,
		records: [],
	};
	if (hasColumn(columns, 'employees', 'username')) {
		const shadowRows = hasColumn(columns, 'users', 'username')
			? await queryRows(
					execute,
					`SELECT e.id AS employee_id, e.username
					 FROM employees e
					 LEFT JOIN users u
					   ON u.employee_id = e.id
					  AND u.isDelete = 0
					  AND u.username = e.username
					 WHERE e.username IS NOT NULL AND TRIM(e.username) <> ''
					   AND u.id IS NULL
					 ORDER BY e.id`
				)
			: await queryRows(
					execute,
					`SELECT id AS employee_id, username
					 FROM employees
					 WHERE username IS NOT NULL AND TRIM(username) <> ''
					 ORDER BY id`
				);
		conflictingLegacyUsernames.count = shadowRows.length;
		conflictingLegacyUsernames.records = shadowRows.map((row) => ({
			employeeId: numberValue(row.employee_id),
		}));
	}

	const accessFlagConflicts: CountedRows<{
		userId: number;
		status: string | null;
		isActive: number | null;
	}> = { count: 0, records: [] };
	if (
		hasColumn(columns, 'users', 'status') &&
		hasColumn(columns, 'users', 'is_active')
	) {
		const accessRows = await queryRows(
			execute,
			`SELECT id AS user_id, status, is_active
			 FROM users
			 WHERE isDelete = 0
			   AND ((status = 'active' AND is_active = 0)
			     OR (status = 'inactive' AND (is_active = 1 OR is_active IS NULL)))
			 ORDER BY id`
		);
		accessFlagConflicts.count = accessRows.length;
		accessFlagConflicts.records = accessRows.map((row) => ({
			userId: numberValue(row.user_id),
			status: nullableString(row.status),
			isActive: nullableNumber(row.is_active),
		}));
	}

	const [unresolvedAssignments, unresolvedActivityLogs, unresolvedScreenTime] =
		await Promise.all([
			countUnresolvedAssignments(execute, columns),
			countUnresolvedRows(execute, 'user_activity_logs', columns),
			countUnresolvedRows(execute, 'user_screen_time', columns),
		]);
	const historicalAttribution = {
		unresolvedAssignments,
		unresolvedActivityLogs,
		unresolvedScreenTime,
		unresolvedTotal:
			unresolvedAssignments + unresolvedActivityLogs + unresolvedScreenTime,
	};

	const blocking = {
		duplicateLiveEmployeeLinks,
		danglingEmployeeReferences,
		liveAccountsWithDeletedEmployee,
		conflictingLegacyUsernames,
	};
	const canMigrate = Object.values(blocking).every(
		(finding) => finding.count === 0
	);

	return {
		canMigrate,
		blocking,
		informational: { accessFlagConflicts, historicalAttribution },
	};
}
