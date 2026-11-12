import { NextResponse } from 'next/server';
import { dbConnect, withTransaction } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { formatMonth } from '@/lib/format';
import {
	PayrollGenerationError,
	calculateEmployeePayroll,
	generateMonthlyPayroll,
	generatePayrollSlip,
	generatePayrollSlipsBatch,
	payrollGenerationRefusal,
} from '@/utils/payroll-calculator';
import { loadPayrollRunRoster } from '@/lib/payroll-run-roster';
import {
	payrollPeriod,
	findPayrollRun,
	createDraftPayrollRun,
	isRunLocked,
} from '@/app/api/payroll/_lib/payroll-run';

const refusalResponse = (error) =>
	NextResponse.json(
		{
			success: false,
			error: error.message,
			code: error.code,
			review_reason: error.reviewReason,
		},
		{ status: error.status }
	);

/** "Asha Rao (EMP011)" — the people a refusal names. */
const memberLabel = (member) =>
	member?.name ? `${member.name} (${member.employee_code})` : null;

/**
 * POST - Generate payroll slip(s)
 *
 * Body options:
 * 1. Generate for single employee: { employee_id: 123, month: '2025-12-01' }
 * 2. Generate for all employees: { month: '2025-12-01', all: true }
 * 3. Generate without saving: { employee_id: 123, month: '2025-12-01', preview: true }
 *
 * Generating creates the month's Payroll Run as `draft` on first use and
 * reuses it afterwards; a finalized run locks the month and refuses to
 * regenerate its Payroll Slips (issue #242).
 *
 * Every mode — single, batch, all and preview — takes its membership and
 * Salary Profile from `loadPayrollRunRoster`. The write modes run inside one
 * transaction holding `SELECT ... FOR UPDATE` on the month's Payroll Run row,
 * so Generate and Finalize for the same month cannot interleave: a Generate
 * that starts first either commits its slips before Finalize's completeness
 * check or loses the race and sees the locked run.
 */
export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = await request.json();
		const {
			employee_id,
			employee_ids,
			month,
			all,
			preview,
			salary_type,
			include_bonus,
			bonus_employee_ids,
		} = body;

		if (!month) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		// Validate month format
		const period = payrollPeriod(month);
		if (!period) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month format. Use YYYY-MM-01' },
				{ status: 400 }
			);
		}

		// Normalised to the first of the month, so the Payroll Run lookup, the slip
		// rows and the completeness gate all compare the same DATE.
		const periodMonth = period.month;

		// Preview mode - calculate without saving
		if (preview && employee_id) {
			let db;
			try {
				db = await dbConnect();
				const roster = await loadPayrollRunRoster(db, periodMonth);
				const member =
					roster.members.find(
						(row) => Number(row.employee_id) === Number(employee_id)
					) || null;
				const refusal = payrollGenerationRefusal(
					member,
					employee_id,
					periodMonth
				);
				if (refusal) return refusalResponse(refusal);

				const payroll = await calculateEmployeePayroll(
					employee_id,
					periodMonth,
					{
						include_bonus: !!include_bonus,
						db,
						roster,
						salaryProfile: member.salary_profile,
					}
				);

				if (!payroll) {
					return NextResponse.json(
						{
							success: false,
							error: `No active salary profile found for ${memberLabel(
								member
							)} in ${formatMonth(periodMonth)}.`,
							code: 'payroll_profile_missing',
						},
						{ status: 422 }
					);
				}

				return NextResponse.json({
					success: true,
					preview: true,
					data: payroll,
				});
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

		const generates =
			!!all ||
			(Array.isArray(employee_ids) && employee_ids.length > 0) ||
			!!employee_id;

		if (!generates) {
			return NextResponse.json(
				{
					success: false,
					error:
						'Either employee_id, employee_ids array, or all=true must be provided',
				},
				{ status: 400 }
			);
		}

		// The month's Payroll Run is the lock for the month. Payroll Slips record
		// against the month itself — they carry no FK to the run — so the row lock
		// taken here is what serialises this insert batch against Finalize.
		const outcome = await withTransaction(async (db) => {
			let run = await findPayrollRun(db, period, { forUpdate: true });
			if (isRunLocked(run)) {
				return {
					status: 409,
					body: {
						success: false,
						error: `The Payroll Run for ${formatMonth(
							periodMonth
						)} is finalized — the month is locked, so Payroll Slips cannot be regenerated.`,
					},
				};
			}

			if (!run) {
				await createDraftPayrollRun(db, period);
				// Re-read with the lock: a concurrent first Generate may have created
				// (and then finalized) the row between the insert and this lookup.
				run = await findPayrollRun(db, period, { forUpdate: true });
				if (isRunLocked(run)) {
					return {
						status: 409,
						body: {
							success: false,
							error: `The Payroll Run for ${formatMonth(
								periodMonth
							)} is finalized — the month is locked, so Payroll Slips cannot be regenerated.`,
						},
					};
				}
				if (!run) {
					throw new Error(
						`The Payroll Run for ${formatMonth(
							periodMonth
						)} could not be created.`
					);
				}
			}

			const bonusIds = Array.isArray(bonus_employee_ids)
				? bonus_employee_ids
				: null;

			// Generate for all eligible employees
			if (all) {
				const results = await generateMonthlyPayroll(
					periodMonth,
					salary_type || null,
					!!include_bonus,
					bonusIds,
					{ db }
				);

				return {
					status: 200,
					body: {
						success: true,
						message: `Payroll generation completed for ${periodMonth}`,
						results,
						run,
					},
				};
			}

			// Generate for multiple employees (batch-optimized)
			if (
				employee_ids &&
				Array.isArray(employee_ids) &&
				employee_ids.length > 0
			) {
				const results = await generatePayrollSlipsBatch(
					employee_ids,
					periodMonth,
					!!include_bonus,
					bonusIds,
					{ db }
				);

				return {
					status: 200,
					body: {
						success: true,
						message: `Payroll generation completed for ${employee_ids.length} employees`,
						results,
						run,
					},
				};
			}

			// Generate for single employee
			const slip = await generatePayrollSlip(employee_id, periodMonth, {
				include_bonus: !!include_bonus,
				db,
			});

			return {
				status: 201,
				body: {
					success: true,
					message: 'Payroll slip generated successfully',
					data: slip,
					run,
				},
			};
		});

		return NextResponse.json(outcome.body, { status: outcome.status });
	} catch (error) {
		console.error('POST /api/payroll/generate error:', error);

		if (error instanceof PayrollGenerationError) {
			return refusalResponse(error);
		}

		// Handle duplicate entry error
		if (error.message?.includes('already exists')) {
			return NextResponse.json(
				{ success: false, error: error.message },
				{ status: 409 }
			);
		}

		// The month's run row is the mutex; a lock race is retryable, not a 500.
		if (
			error.code === 'ER_LOCK_DEADLOCK' ||
			error.code === 'ER_LOCK_WAIT_TIMEOUT'
		) {
			return NextResponse.json(
				{
					success: false,
					error: `The Payroll Run for ${month} is being updated by another request. Try again.`,
					code: 'payroll_run_busy',
				},
				{ status: 409 }
			);
		}

		return NextResponse.json(
			{
				success: false,
				error: 'Failed to generate payroll',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}
