import { readFile } from 'node:fs/promises';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import { createJourneyUser } from '../fixtures/journey-user.ts';
import {
	cleanupAttendanceFixture,
	readAttendanceRow,
	readAttendanceSummary,
	readPunchRows,
	seedAttendanceFixture,
	type AttendanceFixture,
} from '../fixtures/attendance.ts';

// The owned Next dev server compiles the grid/report routes on first visit.
// Assertions still wait for their visible result; this only bounds compile time.
test.setTimeout(240_000);

const SAVE_MONTH = '2029-09';
const SAVE_DATE = '2029-09-17';
const SAVE_IN_TIME = '09:15';
const SAVE_OUT_TIME = '18:30';
const SAVE_OVERTIME = 3;
const SAVE_REMARKS = 'E2E authored attendance day';

const CSV_MONTH = '2030-10';
const CSV_DAYS = [
	{
		date: '2030-10-05',
		status: 'P',
		inTime: '09:00',
		outTime: '17:30',
		overtimeHours: 3.5,
	},
	{ date: '2030-10-06', status: 'A' },
	{ date: '2030-10-07', status: 'HD', inTime: '09:00', outTime: '13:00' },
	{ date: '2030-10-08', status: 'WO' },
	{ date: '2030-10-09', status: 'H' },
] as const;

const REPORT_MONTH = '2031-11';
const REPORT_DATE = '2031-11-10';
const REPORT_SERIAL = 'E2E-ATT-DEVICE';
const REPORT_PUNCHES = [
	{
		logDate: '2031-11-10 09:05:00',
		serialNumber: REPORT_SERIAL,
		direction: 'in' as const,
	},
	{
		logDate: '2031-11-10 17:35:00',
		serialNumber: REPORT_SERIAL,
		direction: 'out' as const,
	},
] as const;

interface SaveAttendanceBody {
	success: boolean;
	successCount: number;
}

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * employees:read and employees:update (the grid's shell gate and the save
 * route's write gate) — no administrator or super-admin.
 *
 * Starting state: one active Payroll employee at Mumbai and no attendance row
 * for the authored September 2029 day.
 *
 * Action: open the Attendance grid pinned to that employee/month, click the
 * 17 September cell, author Present 09:15–18:30 with 3 payable OT hours and a
 * remark, Save the modal, then Save Attendance and reload the same deep link.
 *
 * Proof: after the reload the cell still reads Present, the row's Pay and Hrs
 * columns show 1.0 and 9.3, Payable OT shows 3.0, and an independent database
 * read finds the exact status/times/OT/remark plus the monthly summary. A lost
 * write, a client-only status, or a wrong hours calculation fails.
 */
test('attendance grid saves one authored day and reopens with the exact status and hours', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(db, `${namespace}-att-save`, [
		'employees:read',
		'employees:update',
	]);
	let fixture: AttendanceFixture | null = null;
	try {
		fixture = await seedAttendanceFixture(db, namespace, {
			suffix: 'save',
			month: SAVE_MONTH,
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});

		const gridUrl = `/employees/attendance?employee_id=${fixture.employeeId}&month=${fixture.month}`;
		const initialLoad = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/attendance' &&
				url.searchParams.get('month') === fixture?.month
			);
		});
		await page.goto(gridUrl);
		await expect(
			page.getByRole('heading', { name: 'Attendance Management', exact: true })
		).toBeVisible({ timeout: 60_000 });
		expect((await initialLoad).ok()).toBe(true);
		await expect(
			page.getByText('September 2029', { exact: true })
		).toBeVisible();

		const row = page.getByRole('row').filter({ hasText: fixture.fullName });
		await expect(row).toHaveCount(1);
		const dayNumber = Number(SAVE_DATE.slice(8, 10));
		const targetCell = row.getByRole('cell').nth(dayNumber);
		await targetCell.click();

		await page
			.getByRole('button', { name: 'P — Present', exact: true })
			.click();
		const timeInputs = page.locator('input[type="time"]');
		await timeInputs.nth(0).fill(SAVE_IN_TIME);
		await timeInputs.nth(1).fill(SAVE_OUT_TIME);
		await page.locator('input[type="number"]').fill(String(SAVE_OVERTIME));
		await page
			.getByPlaceholder('Optional note...', { exact: true })
			.fill(SAVE_REMARKS);
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		await expect(
			page.getByText('You have unsaved changes', { exact: true })
		).toBeVisible();
		const saveResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'POST' &&
				url.pathname === '/api/attendance'
			);
		});
		await page
			.getByRole('button', { name: 'Save Attendance', exact: true })
			.click();
		const saved = await saveResponse;
		expect(saved.ok()).toBe(true);
		const savedBody = (await saved.json()) as SaveAttendanceBody;
		expect(savedBody.success).toBe(true);
		expect(savedBody.successCount).toBe(1);
		await expect(
			page.getByText('Saved 1 records successfully!', { exact: true })
		).toBeVisible();

		// Reopen the same deep link so the assertions below read the stored row,
		// not the grid's optimistic client state.
		const reopenResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/attendance' &&
				url.searchParams.get('month') === fixture?.month
			);
		});
		await page.reload();
		expect((await reopenResponse).ok()).toBe(true);
		await expect(
			page.getByText('September 2029', { exact: true })
		).toBeVisible();

		const reopenedRow = page
			.getByRole('row')
			.filter({ hasText: fixture.fullName });
		await expect(reopenedRow).toHaveCount(1);
		const reopenedCell = reopenedRow.getByRole('cell').nth(dayNumber);
		await expect(reopenedCell.getByText('P', { exact: true })).toBeVisible();
		await expect(reopenedCell).toHaveAttribute('title', /Present/);

		const table = page.getByRole('table');
		const headers = (
			await table.getByRole('columnheader').allTextContents()
		).map((header) => header.replace(/\s+/g, ' ').trim());
		const summaryCell = (label: string) => {
			const index = headers.indexOf(label);
			if (index < 0) {
				throw new Error(`[attendance] missing summary column ${label}`);
			}
			return reopenedRow.getByRole('cell').nth(index);
		};
		await expect(summaryCell('P')).toHaveText('1');
		await expect(summaryCell('Pay')).toHaveText('1.0');
		await expect(summaryCell('Hrs')).toHaveText('9.3');
		await expect(summaryCell('Payable OT (>2h)')).toHaveText('3.0');

		const stored = await readAttendanceRow(db, fixture, SAVE_DATE);
		expect(stored).not.toBeNull();
		expect(stored?.employee_id).toBe(fixture.employeeId);
		expect(stored?.status).toBe('P');
		expect(Number(stored?.overtime_hours)).toBe(SAVE_OVERTIME);
		expect(stored?.in_time).toBe('09:15:00');
		expect(stored?.out_time).toBe('18:30:00');
		expect(stored?.remarks).toBe(SAVE_REMARKS);
		expect(stored?.is_weekly_off).toBe(0);
		expect(stored?.is_holiday).toBe(0);

		const summary = await readAttendanceSummary(db, fixture);
		expect(summary).not.toBeNull();
		expect(summary?.total_present).toBe(1);
		expect(Number(summary?.total_overtime_hours)).toBe(SAVE_OVERTIME);
		expect(Number(summary?.total_working_hours)).toBe(9.25);
	} finally {
		if (fixture !== null) await cleanupAttendanceFixture(db, fixture);
		await user.dispose();
	}
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * employees:read — no payroll grant, so no salary profile can price the OT
 * amount column.
 *
 * Starting state: one active Payroll employee with five authored October 2030
 * attendance days: P with 3.5 OT hours, A, HD, WO and H.
 *
 * Action: open the Attendance grid pinned to that employee/month and click CSV.
 *
 * Proof: the downloaded file is named for October 2030 and its row for the
 * owned employee carries exactly those day statuses, Present/Absent/Half Day/
 * WO/Holiday = 1 each, Payable 1.5, Total Hours 12.5, Payable OT 3.5 and an
 * empty amount. A month-independent export, a stale grid, or a changed total
 * fails.
 */
test('attendance CSV downloads the selected month with the authored values', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(db, `${namespace}-att-csv`, [
		'employees:read',
	]);
	let fixture: AttendanceFixture | null = null;
	try {
		fixture = await seedAttendanceFixture(db, namespace, {
			suffix: 'csv',
			month: CSV_MONTH,
			attendance: CSV_DAYS,
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});

		const gridUrl = `/employees/attendance?employee_id=${fixture.employeeId}&month=${fixture.month}`;
		const initialLoad = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/attendance' &&
				url.searchParams.get('month') === fixture?.month
			);
		});
		await page.goto(gridUrl);
		expect((await initialLoad).ok()).toBe(true);
		await expect(page.getByText('October 2030', { exact: true })).toBeVisible();
		const row = page.getByRole('row').filter({ hasText: fixture.fullName });
		await expect(row).toHaveCount(1);

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'CSV', exact: true }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('Attendance_October_2030.csv');
		const downloadPath = await download.path();
		if (downloadPath === null) {
			throw new Error('[attendance] CSV download produced no local file path.');
		}
		const csv = await readFile(downloadPath, 'utf8');
		const table = parseCsv(csv);
		const headers = table[0];
		const found = table
			.slice(1)
			.find(
				(cells) =>
					cells[headers.indexOf('Employee ID')] === fixture?.employeeCode
			);
		if (!found) {
			throw new Error(
				`[attendance] CSV has no row for employee ${fixture.employeeCode}.`
			);
		}
		const value = (column: string) => {
			const index = headers.indexOf(column);
			if (index < 0) {
				throw new Error(`[attendance] CSV is missing column ${column}.`);
			}
			return found[index];
		};

		expect(value('Employee Name')).toBe(fixture.fullName);
		expect(value('Department')).toBe(fixture.department);
		for (const day of CSV_DAYS) {
			expect(value(String(Number(day.date.slice(8, 10))))).toBe(day.status);
		}
		expect(value('Present')).toBe('1');
		expect(value('Absent')).toBe('1');
		expect(value('Half Day')).toBe('1');
		expect(value('WO')).toBe('1');
		expect(value('Holiday')).toBe('1');
		expect(value('Payable Days')).toBe('1.5');
		expect(value('Total Hours')).toBe('12.5');
		expect(value('Payable OT Hours')).toBe('3.5');
		expect(value('OT Amount')).toBe('');
	} finally {
		if (fixture !== null) await cleanupAttendanceFixture(db, fixture);
		await user.dispose();
	}
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * reports:read — no employee or payroll grant is needed to read the report.
 *
 * Starting state: one active Payroll employee at Mumbai with two device
 * punches on 10 November 2031 (09:05 in, 17:35 out).
 *
 * Action: open Attendance Report, choose November 2031, find that employee's
 * 10 November cell and open it.
 *
 * Proof: the cell shows First Punch 09:05 and Last Punch 17:35 with a punch
 * count of 2; the drill-down lists both raw punches with the owned device
 * serial, device code and IN/OUT directions. An independent read of the owned
 * `attendance_logs` rows matches. A report that hides the punch evidence on a
 * day without an authored status fails.
 */
test('attendance report opens the seeded punch day and lists its device evidence', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(db, `${namespace}-att-report`, [
		'reports:read',
	]);
	let fixture: AttendanceFixture | null = null;
	try {
		fixture = await seedAttendanceFixture(db, namespace, {
			suffix: 'report',
			month: REPORT_MONTH,
			punches: REPORT_PUNCHES,
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});
		await page.goto('/reports/attendance-report');
		await expect(
			page.getByRole('heading', { name: 'Attendance Report', exact: true })
		).toBeVisible({ timeout: 60_000 });
		await page.getByLabel('Month', { exact: true }).fill(fixture.month);

		const row = page.getByRole('row').filter({ hasText: fixture.fullName });
		await expect(row).toBeVisible({ timeout: 60_000 });
		const cell = row.locator(
			`[data-testid="attendance-cell"][data-date="${REPORT_DATE}"]`
		);
		await expect(cell).toHaveAttribute('data-punch-count', '2');
		await expect(cell).toHaveAttribute('data-in-label', '09:05');
		await expect(cell).toHaveAttribute('data-out-label', '17:35');
		await expect(cell).toContainText('09:05');
		await expect(cell).toContainText('17:35');

		await cell.getByTestId('cell-punch-trigger').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		const modal = page.getByTestId('cell-punch-modal');
		await expect(modal).toHaveAttribute('data-date', REPORT_DATE);
		await expect(modal).toHaveAttribute('data-count', '2');
		await expect(page.getByTestId('cell-punch-device-caption')).toHaveText(
			'Showing all 2 punches from all devices'
		);

		const punchRows = page.getByTestId('cell-punch-row');
		await expect(punchRows).toHaveCount(2);
		await expect(punchRows.nth(0)).toHaveAttribute('data-time', '09:05:00');
		await expect(punchRows.nth(0)).toHaveAttribute(
			'data-serial',
			REPORT_SERIAL
		);
		await expect(punchRows.nth(0)).toHaveAttribute(
			'data-employee-code',
			fixture.smartofficeCode
		);
		await expect(punchRows.nth(0)).toHaveAttribute('data-direction', 'in');
		await expect(punchRows.nth(1)).toHaveAttribute('data-time', '17:35:00');
		await expect(punchRows.nth(1)).toHaveAttribute('data-direction', 'out');
		await expect(modal).toContainText(REPORT_SERIAL);

		const storedPunches = await readPunchRows(db, fixture);
		expect(storedPunches).toHaveLength(2);
		expect(storedPunches[0]?.employee_code).toBe(fixture.smartofficeCode);
		expect(storedPunches[0]?.log_date).toBe('2031-11-10 09:05:00');
		expect(storedPunches[0]?.direction).toBe('in');
		expect(storedPunches[1]?.log_date).toBe('2031-11-10 17:35:00');
		expect(storedPunches[1]?.direction).toBe('out');
	} finally {
		if (fixture !== null) await cleanupAttendanceFixture(db, fixture);
		await user.dispose();
	}
});

/* ── Local helpers ───────────────────────────────────────────────── */

/** The page's own quoted CSV shape: fields wrapped in double quotes. */
function parseCsv(content: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	for (let index = 0; index < content.length; index += 1) {
		const character = content[index];
		if (quoted) {
			if (character === '"') {
				if (content[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				field += character;
			}
			continue;
		}
		if (character === '"') {
			quoted = true;
		} else if (character === ',') {
			row.push(field);
			field = '';
		} else if (character === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (character !== '\r') {
			field += character;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}
