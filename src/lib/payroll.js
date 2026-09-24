/**
 * Download filename for one Payroll Slip's PDF. The single-slip shape, so a
 * slip carries the same name whether an admin exports it or the employee
 * downloads it from /api/me/payslips/pdf.
 */
export function slipPdfFilename(slip) {
	const slipMonth = String(slip.month || '');
	return `Payroll_Slip_${slip.employee_name?.replace(/\s+/g, '_') || slip.employee_id}_${slipMonth.substring(0, 7)}.pdf`;
}

/** First-of-month date for a slip month, which arrives as `YYYY-MM` or `YYYY-MM-DD`. */
const monthDate = (month) =>
	`${(month instanceof Date ? month.toISOString() : String(month)).slice(0, 7)}-01`;

/**
 * The DA Component Rate in force on a date, or null when none is scheduled.
 *
 * `payroll_schedules` is the single source for every component rate, DA
 * included (ADR-0001, #248), so the run dashboard, the Excel export, the
 * Payroll Slip PDF and the DA endpoint all read it through here rather than
 * each carrying their own copy of the lookup — a rate entered once is then the
 * same number everywhere.
 */
export async function findEffectiveDAOn(db, forDate) {
	const [rows] = await db.execute(
		`SELECT value_type, value, effective_from, effective_to
       FROM payroll_schedules
       WHERE component_type = 'da' AND is_active = 1
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC, id DESC
       LIMIT 1`,
		[forDate, forDate]
	);
	return rows[0] || null;
}

/**
 * The fixed DA amount in force for a month. A percentage-valued DA row, or no
 * row at all, contributes nothing to the fixed amount readers expect.
 */
export async function resolveScheduledDA(db, month) {
	const row = await findEffectiveDAOn(db, monthDate(month));
	return !row || row.value_type === 'percentage' ? 0 : Number(row.value) || 0;
}

/**
 * The bulk-PDF endpoint also serves a single slip when it is scoped to one
 * employee and month: the Payroll Slip detail route asks it for the document,
 * so its URL and download filename are derived in exactly one place.
 */
export function payrollSlipPdfRequest(slip) {
	const slipMonth = String(slip.month || '');

	return {
		url: `/api/payroll/bulk-pdf?month=${slipMonth}&employee_id=${slip.employee_id}`,
		filename: slipPdfFilename(slip),
	};
}

/**
 * The employee's own Payroll Slip PDF: the self-service endpoint, whose
 * identity comes from the session rather than the query, and the same
 * filename an admin export of that slip carries.
 */
export function myPayrollSlipPdfRequest(slip) {
	return {
		url: `/api/me/payslips/pdf?month=${String(slip.month || '').substring(0, 10)}`,
		filename: slipPdfFilename(slip),
	};
}
