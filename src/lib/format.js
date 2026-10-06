const currencyFormatter = new Intl.NumberFormat('en-IN', {
	style: 'currency',
	currency: 'INR',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-IN', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/** One Intl formatter per currency code, built on first use. */
const currencyFormatters = new Map();

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
});

const monthFormatter = new Intl.DateTimeFormat('en-IN', {
	month: 'long',
	year: 'numeric',
});

export function formatCurrency(value) {
	if (value === null || value === undefined || value === '') return '—';
	const n = typeof value === 'string' ? parseFloat(value) : value;
	if (Number.isNaN(n)) return '—';
	return currencyFormatter.format(n);
}

export function formatNumber(value) {
	if (value === null || value === undefined || value === '') return '—';
	const n = typeof value === 'string' ? parseFloat(value) : value;
	if (Number.isNaN(n)) return '—';
	return numberFormatter.format(n);
}

/**
 * Money in the currency it was recorded in. The expenditure reconciliation
 * keeps currencies apart, so it cannot print every figure with the INR
 * formatter; an unrecognised code falls back to a plain decimal with the code
 * in front, never to a wrong currency symbol.
 */
export function formatCurrencyIn(value, currency) {
	if (value === null || value === undefined || value === '') return '—';
	const n = typeof value === 'string' ? parseFloat(value) : value;
	if (Number.isNaN(n)) return '—';
	const code = currency || 'INR';
	let formatter = currencyFormatters.get(code);
	if (!formatter) {
		try {
			formatter = new Intl.NumberFormat('en-IN', {
				style: 'currency',
				currency: code,
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});
		} catch {
			formatter = null;
		}
		currencyFormatters.set(code, formatter);
	}
	return formatter ? formatter.format(n) : `${code} ${numberFormatter.format(n)}`;
}

export function formatDate(value) {
	if (!value) return '—';
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return dateFormatter.format(d);
}

export function formatDateTime(value) {
	if (!value) return '—';
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return dateTimeFormatter.format(d);
}

const dateNumericFormatter = new Intl.DateTimeFormat('en-IN');

/**
 * dd/mm/yyyy for the payroll documents, which render dates this way on both
 * the on-screen Payroll Slip and the generated PDF.
 */
export function formatDateNumeric(value) {
	if (!value) return '—';
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return dateNumericFormatter.format(d);
}

export function formatMonth(value) {
	if (!value) return '—';
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return '—';
	return monthFormatter.format(d);
}

export function formatDateInput(value) {
	if (!value) return '';
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString().slice(0, 10);
}
