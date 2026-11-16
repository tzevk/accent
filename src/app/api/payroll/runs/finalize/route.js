import { NextResponse } from 'next/server';
import { withTransaction } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { formatMonth } from '@/lib/format';
import { employmentIssueLabel } from '@/utils/payroll-calculator';
import {
	payrollPeriod,
	findPayrollRun,
	isRunLocked,
	findMonthSlips,
	summarizeSlipRows,
	salaryIssueOf,
	salaryIssueLabel,
	SALARY_ISSUE,
} from '@/app/api/payroll/_lib/payroll-run';
import {
	loadPayrollRunRoster,
	savePayrollRunRoster,
} from '@/lib/payroll-run-roster';
import { recordSalaryAgreementUse } from '@/lib/salary-profile-store';
import {
	PAYROLL_AUDIT_ACTION,
	PAYROLL_AUDIT_ENTITY,
	recordPayrollAudit,
} from '@/app/api/payroll/_lib/payroll-audit';
import { freezeMonthAllocations } from '@/lib/company-expenditure';

/** "Asha Rao (EMP011), Ravi Kumar (EMP012)" — the people a refusal names. */
const nameList = (employees) =>
	employees
		.map((employee) => `${employee.name} (${employee.employee_code})`)
		.join(', ');

const countLabel = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * POST - Finalize the month's Payroll Run, locking the month.
 *
 * Body: { month: 'YYYY-MM-01' }
 *
 * Finalizing flips the run from `draft` to `finalized` and records the
 * headcount and money totals of its Payroll Slips. From then on Generate
 * refuses to (re)create slips for the month.
 *
 * Completeness is checked against the shared monthly roster:
 *  - employment-date issues that make a person's month ambiguous,
 *  - employees without a Salary Profile for the month,
 *  - competing Salary Profiles that make the month's salary ambiguous,
 *  - a Salary Profile with no usable explicit/legacy monthly CTC,
 *  - eligible employees with no Payroll Slip,
 *  - slips belonging to nobody the roster expects.
 * Every gap is named; none of them is silently dropped.
 *
 * The whole write is one transaction holding `SELECT ... FOR UPDATE` on the
 * run row, then the shared sorted Employee locks and current salary reads, so
 * concurrent Generate/Finalize/Reopen and salary commands for the same month
 * or Employee serialise. After the guarded `draft → finalized` transition the
 * validated roster is saved, every slip's employer-cost allocation is frozen,
 * and durable source-qualified finalization use is recorded for each frozen
 * member — all in the same transaction. A failure in any of those writes rolls
 * the run transition, roster, allocations and use evidence back; freezing is a
 * postcondition of finalizing, never a prerequisite.
 *
 * Completeness separates employment-date review from salary readiness: a
 * missing covering agreement, competing covering agreements and an agreement
 * with no usable CTC are distinct refusals and are never reported as an
 * employment-date problem.
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

	try {
		const { month } = await request.json();
		const period = payrollPeriod(month);

		if (!period) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		const finalizedBy = authResult.user?.id ?? null;

		const outcome = await withTransaction(async (db) => {
			const run = await findPayrollRun(db, period, { forUpdate: true });
			if (!run) {
				return {
					status: 404,
					body: {
						success: false,
						error: `No Payroll Run exists for ${formatMonth(
							month
						)}. Generate Payroll Slips for the month first.`,
					},
				};
			}

			if (isRunLocked(run)) {
				return {
					status: 409,
					body: {
						success: false,
						error: `The Payroll Run for ${formatMonth(
							month
						)} is already finalized.`,
					},
				};
			}

			// The run row lock is held; this takes the sorted Employee locks and
			// re-reads current terms under them, so a salary correction either
			// commits before this roster read or waits for the use evidence below.
			const roster = await loadPayrollRunRoster(db, period.month, {
				forUpdate: true,
			});
			const members = roster.members;

			// Employment-date review: an inactive employee with a known start and
			// no exit, a missing/inverted start, or work/slip evidence outside the
			// employment window. Never silently omitted and never guessed at.
			const review = members.filter((member) => member.issue);
			const salaryReady = members.filter((member) => !member.issue);
			// Ordinary missing salary: no covering canonical/legacy agreement. A
			// Payroll/Contract employee with no agreement, or month work with no
			// agreement, cannot be priced at all.
			const withoutProfiles = salaryReady.filter(
				(member) => salaryIssueOf(member) === SALARY_ISSUE.MISSING_PROFILE
			);
			// Competing covering agreements: no row is chosen, so nothing prices.
			// This is not an employment-date problem.
			const ambiguousSalaries = salaryReady.filter(
				(member) => salaryIssueOf(member) === SALARY_ISSUE.AMBIGUOUS_PROFILE
			);
			// A covering agreement whose explicit/legacy CTC is missing or invalid.
			const unpricedSalaries = salaryReady.filter((member) => {
				const issue = salaryIssueOf(member);
				return (
					issue === SALARY_ISSUE.MISSING_CTC ||
					issue === SALARY_ISSUE.INVALID_CTC
				);
			});
			const eligible = salaryReady.filter(
				(member) => salaryIssueOf(member) === null
			);

			const slips = await findMonthSlips(db, period.month);
			const slipEmployeeIds = new Set(
				slips.map((slip) => Number(slip.employee_id))
			);
			const missing = eligible.filter(
				(member) => !slipEmployeeIds.has(Number(member.employee_id))
			);
			const rosterEmployeeIds = new Set(
				members.map((member) => Number(member.employee_id))
			);
			const unexpected = slips.filter(
				(slip) => !rosterEmployeeIds.has(Number(slip.employee_id))
			);

			if (
				eligible.length === 0 ||
				review.length > 0 ||
				withoutProfiles.length > 0 ||
				ambiguousSalaries.length > 0 ||
				unpricedSalaries.length > 0 ||
				missing.length > 0 ||
				unexpected.length > 0
			) {
				const problems = [];
				if (eligible.length === 0) {
					problems.push(
						`no employees are eligible for payroll in ${formatMonth(
							month
						)} — add a Salary Profile, resolve ambiguous salary history, or correct employment dates before locking an empty Payroll Run`
					);
				}
				if (missing.length > 0) {
					problems.push(
						`${countLabel(
							missing.length,
							'employee has',
							'employees have'
						)} no Payroll Slip — ${nameList(missing)}`
					);
				}
				if (withoutProfiles.length > 0) {
					problems.push(
						`${countLabel(
							withoutProfiles.length,
							'employee has',
							'employees have'
						)} no Salary Profile for the month and cannot be paid — ${nameList(
							withoutProfiles
						)}`
					);
				}
				if (ambiguousSalaries.length > 0) {
					problems.push(
						`${countLabel(
							ambiguousSalaries.length,
							'employee has',
							'employees have'
						)} overlapping Salary Profiles for the month and cannot be priced — ${ambiguousSalaries
							.map(
								(member) =>
									`${member.name} (${member.employee_code}): agreement ids ${
										(member.salary_conflict_ids ?? []).join(', ') || 'unknown'
									}`
							)
							.join(', ')}`
					);
				}
				if (unpricedSalaries.length > 0) {
					problems.push(
						`${countLabel(
							unpricedSalaries.length,
							'employee has',
							'employees have'
						)} a Salary Profile without a usable monthly CTC — ${unpricedSalaries
							.map(
								(member) =>
									`${member.name} (${member.employee_code}): ${salaryIssueLabel(
										salaryIssueOf(member)
									)}`
							)
							.join(', ')}`
					);
				}
				if (review.length > 0) {
					problems.push(
						`${countLabel(
							review.length,
							'employee needs',
							'employees need'
						)} employment-date review — ${review
							.map(
								(member) =>
									`${member.name} (${
										member.employee_code
									}): ${employmentIssueLabel(member.issue)}`
							)
							.join(', ')}`
					);
				}
				if (unexpected.length > 0) {
					problems.push(
						`${countLabel(
							unexpected.length,
							'Payroll Slip belongs',
							'Payroll Slips belong'
						)} to no expected member for the month — ${unexpected
							.map(
								(slip) =>
									`${slip.name || `Employee #${slip.employee_id}`} (${
										slip.employee_code || `#${slip.employee_id}`
									})`
							)
							.join(', ')}`
					);
				}

				return {
					status: 409,
					body: {
						success: false,
						error: `Cannot finalize ${formatMonth(
							month
						)}: ${problems.join('; ')}`,
						missing_employees: missing.map((member) => ({
							employee_id: member.employee_id,
							employee_code: member.employee_code,
							name: member.name,
						})),
						employees_without_profiles: withoutProfiles.map((member) => ({
							employee_id: member.employee_id,
							employee_code: member.employee_code,
							employee_type: member.employee_type,
							name: member.name,
						})),
						employees_with_ambiguous_salaries: ambiguousSalaries.map(
							(member) => ({
								employee_id: member.employee_id,
								employee_code: member.employee_code,
								name: member.name,
								conflict_ids: [...(member.salary_conflict_ids ?? [])],
							})
						),
						employees_with_unpriced_salaries: unpricedSalaries.map(
							(member) => ({
								employee_id: member.employee_id,
								employee_code: member.employee_code,
								name: member.name,
								reason: salaryIssueOf(member),
							})
						),
						employees_needing_review: review.map((member) => ({
							employee_id: member.employee_id,
							employee_code: member.employee_code,
							name: member.name,
							review_reason: member.issue,
						})),
						slips_outside_roster: unexpected.map((slip) => ({
							slip_id: slip.id,
							employee_id: slip.employee_id,
							employee_code: slip.employee_code ?? null,
							name: slip.name ?? null,
						})),
					},
				};
			}

			// The slips read above are the rows signed off; summarize those exact
			// rows rather than re-reading and risking a different set.
			const summary = summarizeSlipRows(slips, period.month);

			// `AND status = 'draft'` makes the transition atomic: if a concurrent
			// request finalized this run first, this matches no row and we report the
			// conflict instead of overwriting its finalized_by/at and totals.
			const [result] = await db.execute(
				`UPDATE payroll_runs
          SET status = 'finalized',
              finalized_by = ?,
              finalized_at = NOW(),
              total_employees = ?,
              total_gross = ?,
              total_deductions = ?,
              total_net_pay = ?,
              total_employer_contribution = ?
        WHERE id = ? AND status = 'draft'`,
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

			if (result.affectedRows === 0) {
				return {
					status: 409,
					body: {
						success: false,
						error: `The Payroll Run for ${formatMonth(
							period.month
						)} was finalized by another request.`,
					},
				};
			}

			// Persist the full validated expected set (not just the people who
			// happened to have slips) and freeze the recorded employer-cost
			// allocation of every Payroll Slip. Both are postconditions: either
			// failure throws and rolls back the run transition too.
			const frozenRoster = await savePayrollRunRoster(
				db,
				run.id,
				roster,
				finalizedBy
			);
			const freeze = await freezeMonthAllocations(
				db,
				period.month,
				finalizedBy
			);

			// Durable, source-qualified use for every frozen member, in ascending
			// Employee id (the roster loader already holds those locks): a later
			// salary correction must see that this month was finalized from these
			// terms, even after these slips are deleted or the run is reopened.
			// Any failure here rolls the status, snapshot and allocations back too.
			const frozenMembers = [...frozenRoster.members].sort(
				(left, right) => left.employee_id - right.employee_id
			);
			for (const member of frozenMembers) {
				await recordSalaryAgreementUse(db, {
					employeeId: member.employee_id,
					agreementId: member.profile_id,
					agreementSource: member.profile_source,
					month: period.month,
					evidence: 'payroll_finalization',
					evidenceContext: {
						payroll_run_id: run.id,
						roster_version: frozenRoster.version,
					},
					actorId: finalizedBy,
				});
			}

			// The month is now locked, so who locked it and on what numbers is the
			// entry a dispute starts from.
			await recordPayrollAudit(db, {
				entityType: PAYROLL_AUDIT_ENTITY.PAYROLL_RUN,
				entityId: run.id,
				action: PAYROLL_AUDIT_ACTION.FINALIZE,
				payrollRunId: run.id,
				month: period.monthNumber,
				year: period.year,
				performedBy: finalizedBy,
				oldValues: { status: 'draft' },
				newValues: {
					status: 'finalized',
					roster_version: frozenRoster.version,
					total_employees: summary.headcount,
					total_gross: summary.total_gross,
					total_deductions: summary.total_deductions,
					total_net_pay: summary.total_net_pay,
					total_employer_contribution: summary.total_employer_contribution,
				},
			});

			return {
				status: 200,
				body: {
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
						roster_version: frozenRoster.version,
						employee_allocations: freeze.allocations,
						employee_allocation_total: freeze.total,
					},
				},
			};
		});

		return NextResponse.json(outcome.body, { status: outcome.status });
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
	}
}
