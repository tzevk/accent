/**
 * The bulk-PDF endpoint also serves a single slip when it is scoped to one
 * employee and month. Both the Payroll Slips list and the Payroll Slip detail
 * route ask the same endpoint for the same document, so its URL and download
 * filename are derived in exactly one place.
 */
export function payrollSlipPdfRequest(slip, month) {
	const slipMonth = String(slip.month || month || '');

	return {
		url: `/api/payroll/bulk-pdf?month=${slipMonth}&employee_id=${slip.employee_id}`,
		filename: `Payroll_Slip_${slip.employee_name?.replace(/\s+/g, '_') || slip.employee_id}_${slipMonth.substring(0, 7)}.pdf`,
	};
}
