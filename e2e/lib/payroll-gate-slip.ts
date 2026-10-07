import { exec, rows } from './db';

/**
 * Payroll Finalize refuses a month while an active Payroll/Contract
 * employee has no Salary Profile covering it. Fixture employees from
 * other namespaces are eligible for the fixture month too — the
 * Utilization roster's open-ended Contract member is an intentional
 * no-profile case — so without an inert slip for them a fixture could
 * not finalize its own month. They cannot be generated a slip the
 * normal way, so this writes the zero slip Generate would have
 * written — scoped to the fixture month, deleted by the calling
 * fixture's cleanup, never touching their other fixtures or months.
 *
 * The population is read with the gate's own predicate
 * (`findEmployeesWithoutProfiles`, src/app/api/payroll/_lib/payroll-run.js)
 * narrowed to `E2E-` fixture Employees outside the calling file's
 * namespace, so a new fixture member cannot reintroduce the
 * collision, while the caller's own deliberate no-profile cases stay
 * visible to the gate. A non-fixture Employee is never given an
 * inert slip; the payroll call that names them fails instead of
 * fabricating payroll for a real person.
 */
export async function seedInertGateSlips(input: {
	/** The fixture month the caller finalizes, e.g. `2018-03-01`. */
	monthDay: string;
	/** The calling fixture's own Employee-code namespace. */
	ownPrefix: string;
}): Promise<number> {
	const { monthDay, ownPrefix } = input;
	const uncovered = await rows<{ id: number; employee_id: string }>(
		`SELECT e.id, e.employee_id
       FROM employees e
      WHERE e.employee_id LIKE 'E2E-%'
        AND e.employee_id NOT LIKE ?
        AND (e.status = 'active' OR e.status IS NULL)
        AND e.isDelete = 0
        AND e.employee_type IN ('Payroll', 'Contract')
        AND NOT EXISTS (
          SELECT 1 FROM employee_salary_profile esp
           WHERE esp.employee_id = e.id AND esp.is_active = 1
             AND esp.effective_from <= ?
             AND (esp.effective_to IS NULL OR esp.effective_to >= ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM salary_structures ss
           WHERE ss.employee_id = e.id AND ss.is_active = 1
             AND ss.effective_from <= ?
             AND (ss.effective_to IS NULL OR ss.effective_to >= ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_slips ps
           WHERE ps.employee_id = e.id AND ps.month = ?
        )
      ORDER BY e.employee_id`,
		[`${ownPrefix}%`, monthDay, monthDay, monthDay, monthDay, monthDay]
	);
	let written = 0;
	for (const employee of uncovered) {
		await exec(
			`INSERT INTO payroll_slips
         (month, employee_id, gross, basic, hra, conveyance, call_allowance,
          total_earnings, total_deductions, net_pay, pf_employer, esic_employer,
          total_employer_contributions, employer_cost, payment_status)
       VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'pending')`,
			[monthDay, employee.id]
		);
		written++;
	}
	return written;
}
