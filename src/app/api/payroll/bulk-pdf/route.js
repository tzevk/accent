import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { normalizeSlips, renderSlipsPdf } from '@/lib/slip-pdf';
import { slipPdfFilename } from '@/lib/payroll';

/**
 * GET /api/payroll/bulk-pdf?month=YYYY-MM-01&salary_type=payroll&employee_id=123
 * Returns a PDF containing salary slips for the selected month.
 * If employee_id is provided, returns single slip; otherwise returns all slips.
 */
export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const month = searchParams.get('month');
		const salaryType = searchParams.get('salary_type');
		const employeeId = searchParams.get('employee_id');

		if (!month) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		let query = `
      SELECT ps.*,
             CONCAT(e.first_name, ' ', e.last_name) as employee_name,
             e.employee_id as employee_code,
             e.department,
             e.grade as designation,
             e.position,
             e.joining_date,
             e.uan as uan_number,
             e.pf_no as pf_number,
             e.esi_no as esic_number,
         e.pan as pan_number,
         ss_inner.basic_salary as structure_basic_salary,
         sp_inner.basic as profile_basic,
         sp_inner.basic_plus_da as profile_basic_plus_da
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      LEFT JOIN salary_structures ss_inner ON ss_inner.employee_id = e.id AND ss_inner.is_active = 1
      LEFT JOIN employee_salary_profile sp_inner ON sp_inner.employee_id = e.id AND sp_inner.is_active = 1
      WHERE ps.month = ?
    `;
		const params = [month];

		// Filter by single employee if provided
		if (employeeId) {
			query += ` AND ps.employee_id = ?`;
			params.push(employeeId);
		}

		if (salaryType === 'payroll') {
			query += ` AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
		} else if (salaryType === 'contract') {
			query += ` AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
		}

		query += ` ORDER BY e.employee_id ASC`;

		const [slips] = await db.execute(query, params);

		if (slips.length === 0) {
			return NextResponse.json(
				{
					success: false,
					error: employeeId
						? 'No payroll slip found for this employee. Please generate payroll first.'
						: 'No payroll slips found for this month. Please generate payroll first.',
				},
				{ status: 404 }
			);
		}

		const normalizedSlips = await normalizeSlips(db, slips, month);
		const pdfBuffer = renderSlipsPdf(normalizedSlips);

		const monthLabel = month.substring(0, 7); // YYYY-MM
		// A single-employee export keeps the single-slip filename, so one slip has
		// one name wherever it is downloaded from.
		const filename =
			employeeId && normalizedSlips.length === 1
				? slipPdfFilename(normalizedSlips[0])
				: `Payroll_Slips_${monthLabel}.pdf`;

		return new Response(pdfBuffer, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': pdfBuffer.length.toString(),
			},
		});
	} catch (error) {
		console.error('GET /api/payroll/bulk-pdf error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to generate bulk PDF',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
