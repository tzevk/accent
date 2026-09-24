import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { formatMonth } from '@/lib/format';
import {
	payrollPeriod,
	findPayrollRun,
	isRunLocked,
	findEmployeesMissingSlips,
	findEmployeesWithoutProfiles,
	summarizeMonthSlips,
} from '@/app/api/payroll/_lib/payroll-run';

/** "Asha Rao (EMP011), Ravi Kumar (EMP012)" — the people a refusal names. */
const nameList = (employees) =>
	employees
		.map((employee) => `${employee.name} (${employee.employee_code})`)
		.join(', ');

/**
 * POST - Finalize the month's Payroll Run, locking the month.
 *
 * Body: { month: 'YYYY-MM-01' }
 *
 * Finalizing flips the run from `draft` to `finalized` and records the
 * headcount and money totals of its Payroll Slips. From then on Generate
 * refuses to (re)create slips for the month.
 *
 * The completeness gate blocks while anyone who should be paid for the month is
 * not, naming every one of them. The two blocking populations are reported
 * separately because they need different fixes: employees with a Salary Profile
 * but no Payroll Slip (press Generate again), and active Payroll/Contract
 * employees with no Salary Profile at all (fix master data — Generate cannot
 * compute a slip for them).
 */
export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { month } = await request.json();
		const period = payrollPeriod(month);

		if (!period) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const run = await findPayrollRun(db, period);
		if (!run) {
			return NextResponse.json(
				{
					success: false,
					error: `No Payroll Run exists for ${formatMonth(month)}. Generate Payroll Slips for the month first.`,
				},
				{ status: 404 }
			);
		}

		if (isRunLocked(run)) {
			return NextResponse.json(
				{
					success: false,
					error: `The Payroll Run for ${formatMonth(month)} is already finalized.`,
				},
				{ status: 409 }
			);
		}

		const missing = await findEmployeesMissingSlips(db, month);
		const withoutProfiles = await findEmployeesWithoutProfiles(db, month);

		if (missing.length > 0 || withoutProfiles.length > 0) {
			const problems = [];
			if (missing.length > 0) {
				problems.push(
					`${missing.length} employee${
						missing.length === 1 ? ' has' : 's have'
					} no Payroll Slip — ${nameList(missing)}`
				);
			}
			if (withoutProfiles.length > 0) {
				problems.push(
					`${withoutProfiles.length} Payroll/Contract employee${
						withoutProfiles.length === 1 ? ' has' : 's have'
					} no Salary Profile for the month and cannot be paid — ${nameList(
						withoutProfiles
					)}`
				);
			}

			return NextResponse.json(
				{
					success: false,
					error: `Cannot finalize ${formatMonth(
						month
					)}: ${problems.join('; ')}`,
					missing_employees: missing,
					employees_without_profiles: withoutProfiles,
				},
				{ status: 409 }
			);
		}

		const summary = await summarizeMonthSlips(db, month);
		const finalizedBy = authResult.user?.id ?? null;

		await db.execute(
			`UPDATE payroll_runs
          SET status = 'finalized',
              finalized_by = ?,
              finalized_at = NOW(),
              total_employees = ?,
              total_gross = ?,
              total_deductions = ?,
              total_net_pay = ?,
              total_employer_contribution = ?
        WHERE id = ?`,
			[
				finalizedBy,
				summary.headcount,
				summary.total_gross,
				summary.total_deductions,
				summary.total_net_pay,
				summary.total_employer_contribution,
				run.id,
			]
		);

		return NextResponse.json({
			success: true,
			message: `Payroll Run for ${formatMonth(month)} finalized — ${summary.headcount} employees locked`,
			data: {
				...run,
				status: 'finalized',
				finalized_by: finalizedBy,
				total_employees: summary.headcount,
				total_gross: summary.total_gross,
				total_deductions: summary.total_deductions,
				total_net_pay: summary.total_net_pay,
				total_employer_contribution: summary.total_employer_contribution,
			},
		});
	} catch (error) {
		console.error('POST /api/payroll/runs/finalize error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to finalize the Payroll Run',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch {
				// Ignore release errors
			}
		}
	}
}
