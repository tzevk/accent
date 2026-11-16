import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	payrollPeriod,
	SLIP_VISIBILITY,
} from '@/app/api/payroll/_lib/payroll-run';
import { linkedEmployeeId } from '@/app/api/me/_lib/session-employee';
import { normalizeSlips, renderSlipsPdf } from '@/lib/slip-pdf';
import { slipPdfFilename } from '@/lib/payroll';
import { readSlipSalaryContexts } from '@/lib/payroll-slip-salary';

/**
 * GET /api/me/payslips/pdf?month=YYYY-MM — the signed-in employee's own Payroll
 * Slip for one month, as a PDF.
 *
 * The same session identity and the same publish rule as the list: no payroll
 * permission is required, the Employee is the session's own, and a month whose
 * Payroll Run is still draft is not downloadable. Rendering goes through the
 * shared slip renderer, so this is the document an admin would export.
 *
 * Basic/DA come from the slip's own recorded/confirmed salary context, not a
 * joined current profile, so a later Salary Revision cannot re-price an older
 * document or multiply it through a second active agreement.
 */
export async function GET(request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	const period = payrollPeriod(new URL(request.url).searchParams.get('month'));
	if (!period) {
		return NextResponse.json(
			{ success: false, error: 'Month is required (format: YYYY-MM)' },
			{ status: 400 }
		);
	}

	let db;
	try {
		db = await dbConnect();

		const employeeId = await linkedEmployeeId(db, user.id);
		// No linked Employee record, a month the employee has no slip for, and a
		// month whose run is not published yet are one answer: no slip to hand
		// over. The reason is never narrowed down, so nothing leaks.
		const notFound = () =>
			NextResponse.json(
				{ success: false, error: 'No Payroll Slip found for this month' },
				{ status: 404 }
			);

		if (!employeeId) return notFound();

		const [slips] = await db.execute(
			`SELECT ps.*,
              CONCAT(e.first_name, ' ', e.last_name) as employee_name,
              e.employee_id as employee_code,
              e.department,
              e.grade as designation,
              e.position,
              e.joining_date,
              e.uan as uan_number,
              e.pf_no as pf_number,
              e.esi_no as esic_number,
              e.pan as pan_number
         FROM payroll_slips ps
         JOIN employees e ON e.id = ps.employee_id AND e.isDelete = 0
         ${SLIP_VISIBILITY.join}
        WHERE ps.employee_id = ?
          AND ps.month = ?
          AND ${SLIP_VISIBILITY.where}
        ORDER BY ps.id ASC`,
			[employeeId, period.month, ...SLIP_VISIBILITY.params]
		);

		if (slips.length === 0) return notFound();

		// One context per slip from its own recorded provenance or the one
		// agreement that covers the slip month. This read no longer joins an
		// active profile, so a second historical agreement cannot multiply the
		// document or let an arbitrary/current row re-price Basic.
		const contexts = await readSlipSalaryContexts(db, slips);
		const contextualSlips = slips.map((slip, index) => ({
			...slip,
			salary_context: contexts[index],
		}));

		const normalizedSlips = await normalizeSlips(
			db,
			contextualSlips,
			period.month
		);
		const pdfBuffer = renderSlipsPdf(normalizedSlips);
		const filename = slipPdfFilename(normalizedSlips[0]);

		return new Response(pdfBuffer, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': pdfBuffer.length.toString(),
			},
		});
	} catch (error) {
		console.error('GET /api/me/payslips/pdf error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to generate the Payroll Slip PDF' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
