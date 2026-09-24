/**
 * Download filename for one Payroll Slip's PDF. The single-slip shape, so a
 * slip carries the same name whether an admin exports it or the employee
 * downloads it from /api/me/payslips/pdf.
 */
export function slipPdfFilename(slip) {
	const slipMonth = String(slip.month || '');
	return `Payroll_Slip_${slip.employee_name?.replace(/\s+/g, '_') || slip.employee_id}_${slipMonth.substring(0, 7)}.pdf`;
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
