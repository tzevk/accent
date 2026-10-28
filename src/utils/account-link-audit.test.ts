import { describe, expect, it } from 'vitest';
import {
	auditAccountLinks,
	type AccountLinkQueryExecutor,
} from './account-link-audit';

type QueryFixture = {
	duplicateLinks?: Array<{ employee_id: number; user_id: number }>;
	dangling?: Array<{ user_id: number; employee_id: number }>;
	deletedEmployeeLinks?: Array<{ user_id: number; employee_id: number }>;
	legacyUsernames?: Array<{ employee_id: number; username: string }>;
	accessConflicts?: Array<{
		user_id: number;
		status: string | null;
		is_active: number | null;
	}>;
	unresolvedAssignments?: number;
	unresolvedActivityLogs?: number;
	unresolvedScreenTime?: number;
};

const schemaColumns = [
	...['id', 'employee_id', 'isDelete', 'username', 'status', 'is_active'].map(
		(column_name) => ({ table_name: 'users', column_name })
	),
	...['id', 'isDelete', 'username'].map((column_name) => ({
		table_name: 'employees',
		column_name,
	})),
	...['id', 'user_id', 'employee_id', 'daily_entries', 'status'].map(
		(column_name) => ({
			table_name: 'user_activity_assignments',
			column_name,
		})
	),
	...['id', 'user_id'].map((column_name) => ({
		table_name: 'user_activity_logs',
		column_name,
	})),
	...['id', 'user_id'].map((column_name) => ({
		table_name: 'user_screen_time',
		column_name,
	})),
];

function fixtureExecutor(fixture: QueryFixture): AccountLinkQueryExecutor {
	return async (sql) => {
		if (sql.includes('information_schema.columns')) return [schemaColumns, []];
		if (sql.includes('COUNT(*) OVER (PARTITION BY employee_id)')) {
			return [fixture.duplicateLinks ?? [], []];
		}
		if (sql.includes('LEFT JOIN employees e ON e.id = u.employee_id')) {
			return [fixture.dangling ?? [], []];
		}
		if (sql.includes('COALESCE(e.isDelete, 1)')) {
			return [fixture.deletedEmployeeLinks ?? [], []];
		}
		if (sql.includes('u.username = e.username')) {
			return [fixture.legacyUsernames ?? [], []];
		}
		if (sql.includes("status = 'active' AND is_active = 0")) {
			return [fixture.accessConflicts ?? [], []];
		}
		if (sql.includes('FROM `user_activity_assignments`')) {
			return [[{ unresolved_count: fixture.unresolvedAssignments ?? 0 }], []];
		}
		if (sql.includes('FROM `user_activity_logs`')) {
			return [[{ unresolved_count: fixture.unresolvedActivityLogs ?? 0 }], []];
		}
		if (sql.includes('FROM `user_screen_time`')) {
			return [[{ unresolved_count: fixture.unresolvedScreenTime ?? 0 }], []];
		}
		throw new Error(`Unexpected audit query: ${sql}`);
	};
}

describe('auditAccountLinks', () => {
	it('keeps historical and access inconsistencies informational on clean links', async () => {
		const audit = await auditAccountLinks(
			fixtureExecutor({
				accessConflicts: [{ user_id: 14, status: 'inactive', is_active: 1 }],
				unresolvedAssignments: 3,
				unresolvedActivityLogs: 2,
				unresolvedScreenTime: 1,
			})
		);

		expect(audit.canMigrate).toBe(true);
		expect(audit.blocking.duplicateLiveEmployeeLinks).toEqual({
			count: 0,
			records: [],
		});
		expect(audit.informational.accessFlagConflicts).toEqual({
			count: 1,
			records: [{ userId: 14, status: 'inactive', isActive: 1 }],
		});
		expect(audit.informational.historicalAttribution).toEqual({
			unresolvedAssignments: 3,
			unresolvedActivityLogs: 2,
			unresolvedScreenTime: 1,
			unresolvedTotal: 6,
		});
	});

	it('blocks dangling, deleted-Employee, duplicate, and shadow-username links', async () => {
		const audit = await auditAccountLinks(
			fixtureExecutor({
				duplicateLinks: [
					{ employee_id: 8, user_id: 21 },
					{ employee_id: 8, user_id: 22 },
				],
				dangling: [{ user_id: 23, employee_id: 404 }],
				deletedEmployeeLinks: [{ user_id: 24, employee_id: 9 }],
				legacyUsernames: [{ employee_id: 10, username: 'legacy-login' }],
			})
		);

		expect(audit.canMigrate).toBe(false);
		expect(audit.blocking.duplicateLiveEmployeeLinks).toEqual({
			count: 1,
			records: [{ employeeId: 8, userIds: [21, 22] }],
		});
		expect(audit.blocking.danglingEmployeeReferences.records).toEqual([
			{ userId: 23, employeeId: 404 },
		]);
		expect(audit.blocking.liveAccountsWithDeletedEmployee.records).toEqual([
			{ userId: 24, employeeId: 9 },
		]);
		expect(audit.blocking.conflictingLegacyUsernames.records).toEqual([
			{ employeeId: 10 },
		]);
	});
});
