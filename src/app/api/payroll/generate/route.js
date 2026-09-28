import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { formatMonth } from '@/lib/format';
import {
	generatePayrollSlip,
	generatePayrollSlipsBatch,
	generateMonthlyPayroll,
	calculateEmployeePayroll,
} from '@/utils/payroll-calculator';
import {
	payrollPeriod,
	findPayrollRun,
	createDraftPayrollRun,
	isRunLocked,
} from '@/app/api/payroll/_lib/payroll-run';

/**
 * POST - Generate payroll slip(s)
 *
 * Body options:
 * 1. Generate for single employee: { employee_id: 123, month: '2025-12-01' }
 * 2. Generate for all employees: { month: '2025-12-01', all: true }
 * 3. Calculate without saving: { employee_id: 123, month: '2025-12-01', preview: true }
 *
 * Generating creates the month's Payroll Run as `draft` on first use and
 * reuses it afterwards; a finalized run locks the month and refuses to
 * regenerate its Payroll Slips (issue #242).
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
			const payroll = await calculateEmployeePayroll(employee_id, periodMonth, {
				include_bonus: !!include_bonus,
			});

			return NextResponse.json({
				success: true,
				preview: true,
				data: payroll,
			});
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
		// against the month itself — they carry no FK to the run.
		let db;
		let run;
		try {
			db = await dbConnect();
			run = await findPayrollRun(db, period);
			if (isRunLocked(run)) {
				return NextResponse.json(
					{
						success: false,
						error: `The Payroll Run for ${formatMonth(
							periodMonth
						)} is finalized — the month is locked, so Payroll Slips cannot be regenerated.`,
					},
					{ status: 409 }
				);
			}
			if (!run) run = await createDraftPayrollRun(db, period);
		} finally {
			if (db) {
				try {
					db.release();
				} catch {
					// Ignore release errors
				}
			}
		}

		// Generate for all employees
		if (all) {
			const bonusIds = Array.isArray(bonus_employee_ids)
				? bonus_employee_ids
				: null;
			const results = await generateMonthlyPayroll(
				periodMonth,
				salary_type || null,
				!!include_bonus,
				bonusIds
			);

			return NextResponse.json({
				success: true,
				message: `Payroll generation completed for ${periodMonth}`,
				results,
				run,
			});
		}

		// Generate for multiple employees (batch-optimized)
		if (
			employee_ids &&
			Array.isArray(employee_ids) &&
			employee_ids.length > 0
		) {
			const bonusIds = Array.isArray(bonus_employee_ids)
				? bonus_employee_ids
				: null;
			const results = await generatePayrollSlipsBatch(
				employee_ids,
				periodMonth,
				!!include_bonus,
				bonusIds
			);

			return NextResponse.json({
				success: true,
				message: `Payroll generation completed for ${employee_ids.length} employees`,
				results,
				run,
			});
		}

		// Generate for single employee
		try {
			const slip = await generatePayrollSlip(employee_id, periodMonth, {
				include_bonus: !!include_bonus,
			});

			return NextResponse.json(
				{
					success: true,
					message: 'Payroll slip generated successfully',
					data: slip,
					run,
				},
				{ status: 201 }
			);
		} catch (genError) {
			// Check if it's a "no salary profile" error
			if (genError.message.includes('No active salary profile')) {
				return NextResponse.json(
					{
						success: false,
						error: genError.message,
						suggestion:
							'Please set up a salary structure for this employee before generating payroll.',
					},
					{ status: 400 }
				);
			}
			throw genError;
		}
	} catch (error) {
		console.error('POST /api/payroll/generate error:', error);

		// Handle duplicate entry error
		if (error.message.includes('already exists')) {
			return NextResponse.json(
				{ success: false, error: error.message },
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
