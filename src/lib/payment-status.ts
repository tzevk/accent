/**
 * `payroll_slips.payment_status` → badge.
 *
 * One map for both readers of a slip — the admin Payroll Run dashboard and the
 * employee's own My Payslips page — so a status reads the same to whoever sees
 * it. Tokens follow AGENTS.md: paid green, processed slate, pending amber,
 * hold orange.
 */
/** One status's display tokens. */
type PaymentStatusStyle = {
	label: string;
	badge: string;
	text: string;
};

export const PAYMENT_STATUS: Record<string, PaymentStatusStyle> = {
	paid: {
		label: 'paid',
		badge: 'bg-green-100 text-green-700',
		text: 'text-green-600',
	},
	processed: {
		label: 'processed',
		badge: 'bg-gray-100 text-gray-700',
		text: 'text-gray-600',
	},
	pending: {
		label: 'pending',
		badge: 'bg-yellow-100 text-yellow-700',
		text: 'text-yellow-600',
	},
	hold: {
		label: 'hold',
		badge: 'bg-orange-100 text-orange-700',
		text: 'text-orange-600',
	},
};

/** The badge for a slip's status; an unknown or missing status reads pending. */
export const paymentStatusBadge = (
	status?: string | null
): PaymentStatusStyle => PAYMENT_STATUS[status ?? ''] || PAYMENT_STATUS.pending;
