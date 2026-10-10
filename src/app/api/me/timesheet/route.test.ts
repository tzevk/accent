import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const mockExecute = vi.fn();
	return {
		mockExecute,
		mockGetCurrentUser: vi.fn(),
		mockFetchTimesheetMeta: vi.fn(),
		mockFetchTimesheetData: vi.fn(),
	};
});

vi.mock('@/utils/database', () => ({
	withDb: vi.fn((fn) => fn({ execute: mocks.mockExecute })),
	query: vi.fn(),
	dbConnect: vi.fn(),
}));
vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.mockGetCurrentUser,
}));
// Handler boundaries, not app internals: what the response is built from.
vi.mock('@/app/reports/timesheet-report/data-source', () => ({
	fetchTimesheetMeta: mocks.mockFetchTimesheetMeta,
	fetchTimesheetData: mocks.mockFetchTimesheetData,
}));

// Loaded after the mocks are registered: a static import would bind the real
// database, permission and data-source modules before the factories run.
const { GET } = await import('@/app/api/me/timesheet/route');

const SESSION_USER = { id: 7, email: 'member@example.com' };
/** The Employee the session user is linked to — a different id on purpose. */
const LINKED_EMPLOYEE_ID = 42;

/** The current calendar month, the route's own default, in the same shape. */
const CURRENT_MONTH = (() => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
})();

function get(search = '') {
	return GET(new Request(`http://localhost/api/me/timesheet${search}`));
}

/** The link exists, so the identity resolves to LINKED_EMPLOYEE_ID. */
function mockLinkedEmployee(employeeId: number | null) {
	// db.execute resolves [rows, fields]; no row means no linked Employee.
	mocks.mockExecute.mockResolvedValue([
		employeeId === null ? [] : [{ employee_id: employeeId }],
		[],
	]);
}

describe('GET /api/me/timesheet — the signed-in employee\u2019s own Timesheet', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockGetCurrentUser.mockResolvedValue(SESSION_USER);
		mocks.mockFetchTimesheetMeta.mockResolvedValue({ months: ['2026-07'] });
		mocks.mockFetchTimesheetData.mockResolvedValue({
			employee: { id: LINKED_EMPLOYEE_ID, name: 'Member' },
		});
	});

	it('ends an anonymous request with 401 and reads no Employee', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue(null);

		const res = await get();

		expect(res.status).toBe(401);
		expect(mocks.mockExecute).not.toHaveBeenCalled();
	});

	it("takes the identity from the session user's linked Employee, never from the request", async () => {
		mockLinkedEmployee(LINKED_EMPLOYEE_ID);

		// A caller-supplied employee identifier, ignored rather than validated.
		const res = await get('?employee_id=999');

		expect(res.status).toBe(200);
		// The link was read for the session user, not for the requested id.
		expect(mocks.mockExecute).toHaveBeenCalledTimes(1);
		expect(mocks.mockExecute.mock.calls[0][1]).toEqual([SESSION_USER.id]);
		// The figures are the linked Employee's — no request shape can read
		// another Employee's Timesheet.
		expect(mocks.mockFetchTimesheetData).toHaveBeenCalledWith(
			LINKED_EMPLOYEE_ID,
			CURRENT_MONTH
		);
		expect(mocks.mockFetchTimesheetData).not.toHaveBeenCalledWith(
			999,
			expect.anything()
		);
		expect((await res.json()).meta.current_month).toBe(CURRENT_MONTH);
	});

	it('succeeds with no data when the account links to no Employee record', async () => {
		mockLinkedEmployee(null);

		const res = await get();
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toEqual({
			success: true,
			meta: { months: [CURRENT_MONTH], current_month: CURRENT_MONTH },
			data: null,
		});
		expect(mocks.mockFetchTimesheetData).not.toHaveBeenCalled();
	});

	it('falls back to the current month for a month outside the offered set', async () => {
		mockLinkedEmployee(LINKED_EMPLOYEE_ID);

		await get('?month=2099-12');

		expect(mocks.mockFetchTimesheetData).toHaveBeenCalledWith(
			LINKED_EMPLOYEE_ID,
			CURRENT_MONTH
		);
	});

	it('honours a requested month the report offers', async () => {
		mockLinkedEmployee(LINKED_EMPLOYEE_ID);

		await get('?month=2026-07');

		expect(mocks.mockFetchTimesheetData).toHaveBeenCalledWith(
			LINKED_EMPLOYEE_ID,
			'2026-07'
		);
	});
});
