import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { payrollAuditRows } from '@/app/api/payroll/audit-rows';
import { recordPayrollAudit } from './payroll-audit';

/**
 * `recordPayrollAudit` is the seam every payroll mutation writes through.
 * Salary commands (#434) need the audit row to commit with the agreement,
 * ranges and timeline version, so they ask for `required: true` and must see
 * an audit failure as their own failure. Every other payroll caller keeps the
 * documented best-effort contract: an audit write never breaks its mutation.
 */

const dbWith = (execute: Mock) => ({ execute });

type AuditEntry = {
	entityType: string;
	entityId: number;
	action: string;
	employeeId?: number | null;
	performedBy?: unknown;
	oldValues?: Record<string, unknown> | null;
	newValues?: Record<string, unknown> | null;
	required?: boolean;
};

/** A salary correction as the command layer would attribute it. */
const auditEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
	entityType: 'salary_profile',
	entityId: 42,
	action: 'correct',
	employeeId: 9,
	performedBy: 5,
	oldValues: { ctc_amount: '1000.00' },
	newValues: { ctc_amount: '1200.00' },
	...overrides,
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('payroll audit — required mode for salary commands (issue #434)', () => {
	it('fails the caller when a required audit INSERT fails', async () => {
		const execute = vi.fn().mockRejectedValue(new Error('audit insert failed'));

		await expect(
			recordPayrollAudit(dbWith(execute), auditEntry({ required: true }))
		).rejects.toThrow('audit insert failed');
	});

	it.each([undefined, null, '', 'not-a-user', 0, -1])(
		'rejects a required audit attributed to %s instead of skipping it',
		async (performedBy) => {
			const execute = vi.fn().mockResolvedValue([{ insertId: 1 }]);

			await expect(
				recordPayrollAudit(
					dbWith(execute),
					auditEntry({ performedBy, required: true })
				)
			).rejects.toThrow(/session performer/);

			expect(execute).not.toHaveBeenCalled();
		}
	);

	it('records the audit entry for a valid session performer', async () => {
		const execute = vi.fn().mockResolvedValue([{ insertId: 77 }]);

		await expect(
			recordPayrollAudit(dbWith(execute), auditEntry({ required: true }))
		).resolves.toBeUndefined();

		expect(payrollAuditRows(execute)).toHaveLength(1);
		expect(payrollAuditRows(execute)[0]).toMatchObject({
			entityType: 'salary_profile',
			entityId: 42,
			employeeId: 9,
			action: 'correct',
			performedBy: 5,
			oldValues: { ctc_amount: '1000.00' },
			newValues: { ctc_amount: '1200.00' },
		});
	});

	it('keeps the best-effort default: a failed audit write does not fail the mutation', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const execute = vi.fn().mockRejectedValue(new Error('audit insert failed'));

		await expect(
			recordPayrollAudit(dbWith(execute), auditEntry())
		).resolves.toBeUndefined();
	});

	it('keeps the best-effort default: an unattributable audit is skipped, not thrown', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const execute = vi.fn().mockResolvedValue([{ insertId: 1 }]);

		await expect(
			recordPayrollAudit(dbWith(execute), auditEntry({ performedBy: null }))
		).resolves.toBeUndefined();

		expect(execute).not.toHaveBeenCalled();
	});
});
