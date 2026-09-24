import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { SLIP_VISIBILITY } from '@/app/api/payroll/_lib/payroll-run';
import { linkedEmployeeId } from '@/app/api/me/_lib/session-employee';

/**
 * GET /api/me/payslips — the signed-in employee's own Payroll Slips, newest
 * month first.
 *
 * The self-service sibling of /api/payroll/slips (ADR-0008). It deliberately
 * does not call ensurePermission: a normal employee holds no payroll
 * permission, which is the whole reason the page exists. Identity is the
 * session's own Employee, so a client-supplied `employee_id` is ignored rather
 * than validated, and the publish rule (no run row → visible, run exists →
 * visible when finalized/paid) is applied in SQL by SLIP_VISIBILITY.
 */
export async function GET(request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	let db;
	try {
		db = await dbConnect();

		const employeeId = await linkedEmployeeId(db, user.id);
		// No linked Employee record means no Payroll Slips — an empty list, not
		// an error, and never a peek at anyone else's.
		if (!employeeId) {
			return NextResponse.json({ success: true, data: [] });
		}

		const [rows] = await db.execute(
			`SELECT ps.id,
              ps.month,
              ps.net_pay,
              ps.payment_status,
              ps.payment_date,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name
         FROM payroll_slips ps
         JOIN employees e ON e.id = ps.employee_id
         ${SLIP_VISIBILITY.join}
        WHERE ps.employee_id = ?
          AND ${SLIP_VISIBILITY.where}
        ORDER BY ps.month DESC`,
			[employeeId, ...SLIP_VISIBILITY.params]
		);

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('GET /api/me/payslips error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch Payroll Slips' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
