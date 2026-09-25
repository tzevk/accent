import { R, add, sub, toNumber } from '@/lib/money';

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
 * February's Professional Tax is a flat ₹300 for everyone, whatever a slip
 * stored. The run dashboard and the Excel export both apply this correction, so
 * the rule lives in one place rather than as a literal in each reader.
 */
export const FEBRUARY_PT = 300;

/** True for a month whose Professional Tax is the flat FEBRUARY_PT for everyone. */
export const isFebruaryMonth = (month) => String(month).slice(5, 7) === '02';

/**
 * The correction one Payroll Slip's stored PT needs for its month: February's
 * flat FEBRUARY_PT minus what the slip stored, and nothing in any other month.
 *
 * The run dashboard and the Payroll Run summary both apply it, so the screen
 * and the confirmation that signs off on the same month cannot disagree about
 * its deductions. The Excel sheet keeps its own pro-rated PT value instead —
 * that sheet prorates the month, it does not report the slip as stored.
 */
export const ptAdjustmentFor = (slip, month) =>
	isFebruaryMonth(month) ? sub(FEBRUARY_PT, slip.pt) : R(0);

/** A numeric read of a column that may be a DECIMAL string, null or missing. */
export const safeNum = (v) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};

/**
 * The six money figures of one Payroll Slip, derived in exactly one place.
 *
 * A Payroll Slip is a snapshot (CONTEXT.md): the Basic, DA and the three totals
 * below are what payroll computed and paid for that month, so the slip's own
 * columns win. A reader that re-prices them from today's Salary Profile is how
 * one slip reports two amounts at once — and how the printed slip stops adding
 * up, because its rows move while its totals do not.
 *
 * The canonical sources are the repair, for a slip whose Basic column is
 * missing or zero: the Salary Profile first, the legacy Salary Structure last
 * (ADR-0001). Every candidate is compared as a NUMBER: a stored `"0.00"` is a
 * real zero and falls through to the next source, which string truthiness would
 * get wrong.
 *
 * `scheduledDA` is the month's DA Component Rate (`resolveScheduledDA`) and
 * stays authoritative for DA (ADR-0001, #248): a percentage-valued or absent
 * rate is 0 and the slip's own DA stands in. When a fixed rate replaces the
 * slip's DA, Basic absorbs the difference, so the snapshot's Basic+DA — the
 * number the month was computed with — never moves.
 *
 * Takes a RAW slip row, the shape the queries select. A row that has already
 * been through this (its `basic` is the derived one) must not be fed back in —
 * readers of a normalized row take `gross`/`deductions`/`net` from here and
 * leave Basic and DA as they were written.
 */
export function slipFigures(row, { scheduledDA = 0 } = {}) {
	const storedDa = safeNum(row.da_used) || safeNum(row.da);
	const storedBasic = safeNum(row.basic);
	// Salary figures go through the money library, never float arithmetic
	// (AGENTS.md): drift from a `+` here would reach every reader at once.
	const canonicalBasicPlusDa = Math.max(
		0,
		safeNum(row.profile_basic) ||
			safeNum(row.profile_basic_plus_da) ||
			safeNum(row.structure_basic_salary)
	);
	const basicPlusDa =
		storedBasic > 0 ? add(storedBasic, storedDa) : R(canonicalBasicPlusDa);
	const da = R(scheduledDA > 0 ? scheduledDA : storedDa);
	const basic = sub(basicPlusDa, da);

	return {
		basic: toNumber(basic.lt(0) ? R(0) : basic),
		da: toNumber(da),
		basicPlusDa: toNumber(basicPlusDa),
		// The slip's own earnings total; its `gross` column is the full-month
		// contractual gross, so it only stands in for a slip that has no total.
		gross: safeNum(row.total_earnings) || safeNum(row.gross),
		deductions: safeNum(row.total_deductions),
		net: safeNum(row.net_pay),
	};
}

/**
 * The same six figures for a row the slips listing has ALREADY normalized —
 * the shape `/api/payroll/slips` returns and `normalizeSlips` hands the PDF.
 *
 * Its Basic, DA and Basic+DA are the derivation's own output, so this never
 * re-derives them: feeding a normalized row back through `slipFigures` would
 * take the row's derived Basic and the raw `da_used` behind it and move the
 * split a second time — a reader showing Basic the slip document does not.
 * Readers of a normalized row use this; readers of a raw row use `slipFigures`.
 */
export function normalizedSlipFigures(row) {
	return {
		basic: safeNum(row.basic),
		da: safeNum(row.da),
		basicPlusDa: safeNum(row.basic_plus_da_source),
		gross: safeNum(row.total_earnings) || safeNum(row.gross),
		deductions: safeNum(row.total_deductions),
		net: safeNum(row.net_pay),
	};
}

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
