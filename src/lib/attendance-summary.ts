/**
 * Attendance grid summary — single source for Payable Day math.
 *
 * Payable Day: P = 1, HD = 0.5, paid leave (PL/CL/SL/EL) = 1;
 * WO/H/A/LWP/UL = 0. Overtime rows (OT) count as Present for
 * working-hours totals. Unpaid codes (UL) group with LWP.
 *
 * Overtime column is gate-filtered Payable OT: daily excess over
 * standard hours counts only past the 2h payability gate (see
 * ADR-0006). The timesheet report remains the worked-hours truth.
 */

import { R, add, mul, div, toNumber } from './money';

export const STANDARD_HOURS_PER_DAY = 8;
export const HALF_DAY_HOURS = 4;
export const PAYABLE_OT_GATE_HOURS = 2;

export const PAYABLE_OT_HEADER = 'Payable OT (>2h)';
export const PAYABLE_OT_TOOLTIP =
	'Gate-filtered payable overtime: daily excess over 8h counts only past 2h. Timesheet report shows every minute past 8h.';

export const PAID_LEAVE_CODES: readonly string[] = ['PL', 'CL', 'SL', 'EL'];
export const UNPAID_CODES: readonly string[] = ['LWP', 'UL'];
export interface AttendanceDayInput {
	status?: string | null;
	overtime_hours?: number | string | null;
	in_time?: string | null;
	out_time?: string | null;
}

export interface SalaryProfileInput {
	basic_plus_da?: number | string | null;
	basic?: number | string | null;
	da?: number | string | null;
}

export interface AttendanceSummary {
	P: number;
	A: number;
	HD: number;
	WO: number;
	H: number;
	PL: number;
	CL: number;
	SL: number;
	EL: number;
	LWP: number;
	OT: number;
	payable: number;
	totalHours: number;
	totalOTHours: number;
	totalOTAmount: number;
}

function toNum(value: unknown): number {
	const n = typeof value === 'string' ? parseFloat(value) : (value as number);
	return Number.isFinite(n) ? (n as number) : 0;
}

function hoursForDay(day: AttendanceDayInput): number {
	const status = (day.status ?? '').toUpperCase();
	if (status !== 'P' && status !== 'HD' && status !== 'OT') return 0;
	if (day.in_time != null && day.out_time != null) {
		const inStr = String(day.in_time).substring(0, 5);
		const outStr = String(day.out_time).substring(0, 5);
		const [inH, inM] = inStr.split(':').map(Number);
		const [outH, outM] = outStr.split(':').map(Number);
		if (
			Number.isFinite(inH) &&
			Number.isFinite(inM) &&
			Number.isFinite(outH) &&
			Number.isFinite(outM)
		) {
			const hrs = outH + outM / 60 - (inH + inM / 60);
			if (hrs > 0) return hrs;
		}
	}
	return status === 'HD' ? HALF_DAY_HOURS : STANDARD_HOURS_PER_DAY;
}

export function computeAttendanceSummary(
	days: Record<string, AttendanceDayInput>,
	profile: SalaryProfileInput = {}
): AttendanceSummary {
	const summary: AttendanceSummary = {
		P: 0,
		A: 0,
		HD: 0,
		WO: 0,
		H: 0,
		PL: 0,
		CL: 0,
		SL: 0,
		EL: 0,
		LWP: 0,
		OT: 0,
		payable: 0,
		totalHours: 0,
		totalOTHours: 0,
		totalOTAmount: 0,
	};

	const fromPlusDa = R(profile.basic_plus_da ?? 0);
	const basicDa = fromPlusDa.isZero()
		? add(R(profile.basic ?? 0), R(profile.da ?? 0))
		: fromPlusDa;
	const perHourRate = basicDa.isZero()
		? R(0)
		: div(basicDa, STANDARD_HOURS_PER_DAY);
	let otAmount = R(0);

	for (const d of Object.values(days)) {
		const status = (d.status ?? '').toUpperCase();
		switch (status) {
			case 'OT':
				summary.OT += 1;
				summary.P += 1;
				break;
			case 'P':
			case 'A':
			case 'HD':
			case 'WO':
			case 'H':
			case 'PL':
			case 'CL':
			case 'SL':
			case 'EL':
				summary[status] += 1;
				break;
			case 'LWP':
			case 'UL':
				// Unpaid codes group with Leave Without Pay.
				summary.LWP += 1;
				break;
			default:
				break;
		}

		summary.totalHours += hoursForDay(d);

		// Payable-OT gate on the read path: sub-gate rows (legacy/API)
		// never display as payable, matching the >2h write gate.
		const ot = toNum(d.overtime_hours);
		if (ot > PAYABLE_OT_GATE_HOURS) {
			summary.totalOTHours += ot;
			otAmount = add(otAmount, mul(perHourRate, ot));
		}
	}
	summary.totalOTAmount = toNumber(otAmount);

	summary.payable =
		summary.P +
		summary.HD * 0.5 +
		summary.PL +
		summary.CL +
		summary.SL +
		summary.EL;

	return summary;
}
