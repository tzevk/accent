import { expect, test } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import {
	computeMonthBasis,
	E2E_CTC,
	E2E_LOGGED_HOURS,
	E2E_MONTH,
	expectedSlip,
	WORKER,
	ZERO_HOURS_WORKER,
} from '../lib/fixtures';

/**
 * The money flow the product lives on (ADR-0010): a Payroll Slip pays
 * CTC ÷ basis hours at the hours logged; zero logged hours pays zero.
 * Expected values are recomputed from the raw calendar + holiday table, not
 * from the app's own helpers, so the assertion is independent.
 */

interface EmployeeRow {
	id: number;
	employee_id: string;
}

interface SlipRow {
	month: string;
	ctc_used: string;
	basis_hours: string;
	hourly_rate: string;
	logged_hours: string;
	total_earnings: string;
	total_deductions: string;
	net_pay: string;
}

test.describe('payroll money', () => {
	test('hours logged × CTC/basis is what the slip pays', async ({
		request,
	}) => {
		const basis = await computeMonthBasis(E2E_MONTH);
		const expected = expectedSlip(basis.basisHours, E2E_LOGGED_HOURS);

		const employees = await rows<EmployeeRow>(
			`SELECT id, employee_id FROM employees WHERE employee_id IN (?, ?) ORDER BY employee_id`,
			[WORKER.code, ZERO_HOURS_WORKER.code]
		);
		expect(employees).toHaveLength(2);
		const workerId = employees[0].id;
		const zeroHoursId = employees[1].id;

		// ── Employee with 104 logged hours ──
		const workerRes = await request.post('/api/payroll/generate', {
			data: { employee_id: workerId, month: E2E_MONTH },
		});
		expect(workerRes.status(), await workerRes.text()).toBe(201);
		const workerSlip = (await workerRes.json()).data;

		expect(Number(workerSlip.basis_hours)).toBe(basis.basisHours);
		expect(Number(workerSlip.hourly_rate)).toBe(expected.hourlyRate);
		expect(Number(workerSlip.logged_hours)).toBe(E2E_LOGGED_HOURS);
		expect(Number(workerSlip.total_earnings)).toBe(expected.gross);
		expect(Number(workerSlip.total_deductions)).toBe(0);
		expect(Number(workerSlip.net_pay)).toBe(expected.gross);

		// Independent DB verification: the persisted slip matches.
		const [dbSlip] = await rows<SlipRow>(
			`SELECT month, ctc_used, basis_hours, hourly_rate, logged_hours,
              total_earnings, total_deductions, net_pay
         FROM payroll_slips WHERE employee_id = ? AND month = ?`,
			[workerId, E2E_MONTH]
		);
		expect(dbSlip).toBeTruthy();
		expect(String(dbSlip.month).slice(0, 10)).toBe(E2E_MONTH);
		expect(Number(dbSlip.ctc_used)).toBe(E2E_CTC);
		expect(Number(dbSlip.basis_hours)).toBe(basis.basisHours);
		expect(Number(dbSlip.hourly_rate)).toBe(expected.hourlyRate);
		expect(Number(dbSlip.logged_hours)).toBe(E2E_LOGGED_HOURS);
		expect(Number(dbSlip.total_earnings)).toBe(expected.gross);
		expect(Number(dbSlip.total_deductions)).toBe(0);
		expect(Number(dbSlip.net_pay)).toBe(expected.gross);

		// ── Employee with zero logged hours pays ₹0 ──
		const zeroRes = await request.post('/api/payroll/generate', {
			data: { employee_id: zeroHoursId, month: E2E_MONTH },
		});
		expect(zeroRes.status(), await zeroRes.text()).toBe(201);
		const zeroSlip = (await zeroRes.json()).data;
		expect(Number(zeroSlip.logged_hours)).toBe(0);
		expect(Number(zeroSlip.total_earnings)).toBe(0);
		expect(Number(zeroSlip.net_pay)).toBe(0);

		// ── The consumer-visible listing agrees with both ──
		const listRes = await request.get(
			`/api/payroll/slips?month=${E2E_MONTH}&employee_id=${workerId}`
		);
		expect(listRes.status()).toBe(200);
		const listBody = await listRes.json();
		const listed = (listBody.data ?? []).find(
			(row: { employee_id: number }) => Number(row.employee_id) === workerId
		);
		expect(listed, JSON.stringify(listBody)).toBeTruthy();
		expect(Number(listed.total_earnings)).toBe(expected.gross);
		expect(Number(listed.net_pay)).toBe(expected.gross);

		writeArtifact('payroll-money', {
			month: E2E_MONTH,
			inputs: {
				ctc: E2E_CTC,
				stdHoursPerDay: 8,
				loggedHours: E2E_LOGGED_HOURS,
			},
			basis,
			expected,
			observed: {
				api: {
					basisHours: Number(workerSlip.basis_hours),
					hourlyRate: Number(workerSlip.hourly_rate),
					loggedHours: Number(workerSlip.logged_hours),
					totalEarnings: Number(workerSlip.total_earnings),
					netPay: Number(workerSlip.net_pay),
				},
				db: {
					basisHours: Number(dbSlip.basis_hours),
					hourlyRate: Number(dbSlip.hourly_rate),
					loggedHours: Number(dbSlip.logged_hours),
					totalEarnings: Number(dbSlip.total_earnings),
					netPay: Number(dbSlip.net_pay),
				},
				zeroHours: {
					loggedHours: Number(zeroSlip.logged_hours),
					totalEarnings: Number(zeroSlip.total_earnings),
					netPay: Number(zeroSlip.net_pay),
				},
			},
			ok: true,
		});
		expect(readArtifact('payroll-money')).toMatchObject({ ok: true });
	});
});
