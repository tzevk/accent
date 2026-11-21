import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import { createJourneyUser } from '../fixtures/journey-user.ts';
import {
	HOLIDAY_DATE,
	cleanupAttendanceFixture,
	cleanupHolidayFixture,
	holidayFixture,
	readHolidayRows,
	seedAttendanceFixture,
	type AttendanceFixture,
	type HolidayFixture,
} from '../fixtures/attendance.ts';

// The owned Next dev server compiles the Holiday Master and report routes on
// first visit. Assertions still wait for their visible result.
test.setTimeout(240_000);

const HOLIDAY_REPORT_MONTH = HOLIDAY_DATE.slice(0, 7);
/** A working day after the holiday, so the report month owns real punches. */
const REPORT_PUNCH_DATE = '2027-03-16';

interface CreateHolidayBody {
	success: boolean;
	id?: number;
}

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * employees:read, employees:create and reports:read — no administrator or
 * super-admin. `employees:read` opens Holiday Master's fetch and the grid;
 * `employees:create` is the POST gate; `reports:read` opens the Attendance
 * Report.
 *
 * Starting state: an active Payroll employee at Mumbai with two punches on
 * 16 March 2027 (so the report month has device evidence), and no holiday with
 * the namespaced name on 15 March 2027.
 *
 * Action: select 2027 in Holiday Master, Add Holiday with the authored name,
 * date, Company type and description, save, reload, reopen the row's Edit
 * dialog; then open the Attendance Report for March 2027 and find that
 * employee's 15 March cell.
 *
 * Proof: after the reload the row and Edit dialog show the same name, date,
 * type and description; an independent `holiday_master` read matches. The
 * report's 15 March cell visibly says Holiday with no punches, proving the
 * saved non-optional holiday reaches attendance. A lost save or an ignored
 * holiday fails.
 */
test('holiday saves and reopens, and the saved holiday marks the attendance report day', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(db, `${namespace}-holiday`, [
		'employees:read',
		'employees:create',
		'reports:read',
	]);
	const holiday: HolidayFixture = holidayFixture(namespace);
	let holidayId: number | null = null;
	let employee: AttendanceFixture | null = null;
	try {
		employee = await seedAttendanceFixture(db, namespace, {
			suffix: 'holiday',
			month: HOLIDAY_REPORT_MONTH,
			punches: [
				{
					logDate: `${REPORT_PUNCH_DATE} 09:00:00`,
					serialNumber: 'E2E-HOLIDAY-DEVICE',
					direction: 'in',
				},
				{
					logDate: `${REPORT_PUNCH_DATE} 17:00:00`,
					serialNumber: 'E2E-HOLIDAY-DEVICE',
					direction: 'out',
				},
			],
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});
		const firstHolidayLoad = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/masters/holidays'
			);
		});
		await page.goto('/masters/holidays');
		await expect(
			page.getByRole('heading', { name: /^Holiday Master - \d{4}$/ })
		).toBeVisible({ timeout: 60_000 });
		expect((await firstHolidayLoad).ok()).toBe(true);

		// Wait for the year's own fetch when the page did not already open it.
		const yearSelect = page.getByRole('combobox');
		if ((await yearSelect.inputValue()) !== holiday.year) {
			const yearLoad = page.waitForResponse((response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/masters/holidays' &&
					url.searchParams.get('year') === holiday.year
				);
			});
			await yearSelect.selectOption(holiday.year);
			expect((await yearLoad).ok()).toBe(true);
		}
		await expect(
			page.getByRole('heading', {
				name: `Holiday Master - ${holiday.year}`,
				exact: true,
			})
		).toBeVisible();

		await page
			.getByRole('button', { name: 'Add Holiday', exact: true })
			.click();
		const form = page.locator('form');
		await expect(
			page.getByRole('heading', { name: 'Add Holiday', exact: true })
		).toBeVisible();
		await form.getByPlaceholder('e.g., Republic Day').fill(holiday.name);
		await form.locator('input[type="date"]').fill(holiday.date);
		await form.getByRole('button', { name: 'Company', exact: true }).click();
		await form
			.getByPlaceholder('Optional description...')
			.fill(holiday.description);

		const createResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'POST' &&
				url.pathname === '/api/masters/holidays'
			);
		});
		await form
			.getByRole('button', { name: 'Add Holiday', exact: true })
			.click();
		const created = await createResponse;
		expect(created.ok()).toBe(true);
		const createdBody = (await created.json()) as CreateHolidayBody;
		expect(createdBody.success).toBe(true);
		expect(Number.isInteger(createdBody.id)).toBe(true);
		holidayId = Number(createdBody.id);
		await expect(
			page.getByText('Holiday added!', { exact: true })
		).toBeVisible();

		// Reopen the saved holiday from a fresh page load and the List view.
		const reloadedHolidayLoad = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/masters/holidays'
			);
		});
		await page.reload();
		await expect(
			page.getByRole('heading', { name: /^Holiday Master - \d{4}$/ })
		).toBeVisible();
		expect((await reloadedHolidayLoad).ok()).toBe(true);

		const reloadedYearSelect = page.getByRole('combobox');
		if ((await reloadedYearSelect.inputValue()) !== holiday.year) {
			const yearLoad = page.waitForResponse((response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/masters/holidays' &&
					url.searchParams.get('year') === holiday.year
				);
			});
			await reloadedYearSelect.selectOption(holiday.year);
			expect((await yearLoad).ok()).toBe(true);
		}
		await expect(
			page.getByRole('heading', {
				name: `Holiday Master - ${holiday.year}`,
				exact: true,
			})
		).toBeVisible();
		await page.getByRole('button', { name: 'List', exact: true }).click();
		const row = page.getByRole('row').filter({ hasText: holiday.name });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(holiday.description);
		await expect(row).toContainText('Company');

		await row.getByRole('button').first().click();
		await expect(
			page.getByRole('heading', { name: 'Edit Holiday', exact: true })
		).toBeVisible();
		const editForm = page.locator('form');
		await expect(editForm.getByPlaceholder('e.g., Republic Day')).toHaveValue(
			holiday.name
		);
		await expect(editForm.locator('input[type="date"]')).toHaveValue(
			holiday.date
		);
		await expect(
			editForm.getByPlaceholder('Optional description...')
		).toHaveValue(holiday.description);
		await expect(editForm.getByRole('checkbox')).not.toBeChecked();

		const stored = await readHolidayRows(db, holiday, holidayId);
		expect(stored).toHaveLength(1);
		expect(stored[0]?.name).toBe(holiday.name);
		expect(stored[0]?.date).toBe(holiday.date);
		expect(stored[0]?.type).toBe('company');
		expect(stored[0]?.description).toBe(holiday.description);
		expect(stored[0]?.is_optional).toBe(0);
		expect(stored[0]?.is_active).toBe(1);

		await editForm.getByRole('button', { name: 'Cancel', exact: true }).click();

		// The representative attendance effect: the saved non-optional holiday
		// is visible in the report as a muted Holiday cell with no punches.
		await page.goto('/reports/attendance-report');
		await expect(
			page.getByRole('heading', { name: 'Attendance Report', exact: true })
		).toBeVisible({ timeout: 60_000 });
		await page.getByLabel('Month', { exact: true }).fill(HOLIDAY_REPORT_MONTH);
		const employeeRow = page
			.getByRole('row')
			.filter({ hasText: employee.fullName });
		await expect(employeeRow).toBeVisible({ timeout: 60_000 });
		const holidayCell = employeeRow.locator(
			`[data-testid="attendance-cell"][data-date="${HOLIDAY_DATE}"]`
		);
		await expect(holidayCell).toHaveAttribute('data-muted', 'true');
		await expect(holidayCell).toHaveAttribute('data-punch-count', '0');
		await expect(holidayCell).toContainText('Holiday');
	} finally {
		await cleanupHolidayFixture(db, holiday, holidayId);
		if (employee !== null) await cleanupAttendanceFixture(db, employee);
		await user.dispose();
	}
});
