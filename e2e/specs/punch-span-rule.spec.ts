import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { ATTENDANCE_MONTH } from '../lib/attendance-fixtures';

/**
 * The day's punch span — an Employee-day's first punch, last punch and punch
 * count, with the cross-midnight merge, its consumption and its refusal —
 * proven end to end through the Attendance report API (issue #330).
 *
 * The report is the seam on purpose. It reads the one definition of the rule
 * (`@/lib/time-present`), and its cells already carry the figures the ticket
 * names: the day's hours, the null hours of an uncomputable day, the day's
 * `punch_count` and the `merge_refused` flag. Every expected value below is
 * re-derived HERE, in this file, from the rows this spec seeds through the
 * harness's own database client — nothing imports the app's calculator, so the
 * app cannot mark its own homework. The re-derivation counts punches per day
 * whether or not a merge consumed them, because a punch consumed as another
 * day's tail still counts on the day it was recorded.
 *
 * One namespaced fixture Employee per case, so no two cases can lean on each
 * other's punches:
 *  (a) a lone punch day is uncomputable — null hours, never a zero-length span;
 *  (b) a next-day punch within 12 hours joins the day, is consumed, and still
 *      counts on its own date;
 *  (c) a merge candidate past 12 hours is refused, so the day that needed the
 *      merge stays uncomputable;
 *  (d) a punch recorded under a device code the Employee was later re-enrolled
 *      from still belongs to that Employee, because attribution follows the
 *      ingest stamp and never the device code.
 *
 * `e2e/specs/attendance-report.spec.ts` proves the same report's grid
 * unchanged, untouched, in its own run.
 */

// The report's API is read over the fixture month the harness already seeds
// into, so the rows sit inside the report's padded fetch window beside them.
test.use({ storageState: 'e2e/.auth/admin-report.json' });

/* ── The month under test ─────────────────────────────────────────── */

const MONTH = ATTENDANCE_MONTH;
const MONTH_PREFIX = `${MONTH}-`;
const DAY_MS = 86_400_000;
const day = (n: number): string =>
	`${MONTH_PREFIX}${String(n).padStart(2, '0')}`;

/* ── The fixture namespaces ───────────────────────────────────────── */

/**
 * These Employees are their own namespace under the harness's attendance
 * prefix, and their punches arrive under a device-code namespace the
 * attendance fixtures never use — so neither spec can read the other's rows,
 * and the harness's own cleanup purges both.
 */
const EMPLOYEE_CODE_PREFIX = 'E2E-ATT-PUNCHSPAN-';
const DEVICE_CODE_PREFIX = 'E2E-PUNCHSPAN-';

interface FixtureEmployee {
	/** Roster number, and the suffix of the code it is enrolled under. */
	n: string;
	/** The device code the Employee is currently enrolled under. */
	deviceCode: string;
	/** The day's punches, in device-clock order. */
	punches: {
		day: number;
		time: string;
		/** Overrides the Employee's own code. */ code?: string;
	}[];
}

const FIXTURE: readonly FixtureEmployee[] = [
	// (a) One punch, and nothing after it: uncomputable.
	{
		n: '01',
		deviceCode: `${DEVICE_CODE_PREFIX}01`,
		punches: [{ day: 8, time: '09:00:00' }],
	},
	// (b) A night shift: 09-09 22:00 → 09-10 06:30 is 8.5 hours of elapsed
	// time, credited to the day it began. The 06:30 punch is consumed, so
	// 09-10 holds no span of its own — yet it still counts as a punch.
	{
		n: '02',
		deviceCode: `${DEVICE_CODE_PREFIX}02`,
		punches: [
			{ day: 9, time: '22:00:00' },
			{ day: 10, time: '06:30:00' },
		],
	},
	// (c) 09-17 18:00 → 09-18 09:00 is 15 hours, past the 12-hour window, so
	// the merge is refused and the day that needed it stays null.
	{
		n: '03',
		deviceCode: `${DEVICE_CODE_PREFIX}03`,
		punches: [
			{ day: 17, time: '18:00:00' },
			{ day: 18, time: '09:00:00' },
		],
	},
	// (d) The Employee was re-enrolled from its morning code before the month
	// ended: the 09-22 morning punch arrived under the retired code and the
	// evening punch under the current one, both stamped to this Employee.
	{
		n: '04',
		deviceCode: `${DEVICE_CODE_PREFIX}04`,
		punches: [
			{ day: 22, time: '09:00:00', code: `${DEVICE_CODE_PREFIX}RETIRED-04` },
			{ day: 22, time: '18:00:00' },
		],
	},
];

const employeeCode = (n: string): string => `${EMPLOYEE_CODE_PREFIX}${n}`;

/* ── Seeding through the harness's own client ─────────────────────── */

interface SeededEmployee {
	code: string;
	id: number;
}

interface SeededPunch {
	id: number;
	employee_id: number;
	employee_code: string;
	log_date: string;
	serial_number: string;
}

/** Remove every row this spec owns. Safe to run repeatedly. */
async function purgePunchSpanFixtures(): Promise<number> {
	const employees = await rows<{ id: number }>(
		`SELECT id FROM employees WHERE employee_id LIKE ?`,
		[`${EMPLOYEE_CODE_PREFIX}%`]
	);

	// Children before parents: punch rows reference the employee.
	if (employees.length) {
		const ids = employees.map((row) => row.id);
		const placeholders = ids.map(() => '?').join(', ');
		await exec(
			`DELETE FROM attendance_logs WHERE employee_id IN (${placeholders})`,
			ids
		);
		await exec(`DELETE FROM employees WHERE id IN (${placeholders})`, ids);
	}

	// A device-code row survives the employee it was stamped to, so an aborted
	// run's leftovers are purged on the code namespace as well.
	await exec(`DELETE FROM attendance_logs WHERE employee_code LIKE ?`, [
		`${DEVICE_CODE_PREFIX}%`,
	]);

	return employees.length;
}

/** Seed the roster rows and their raw punches, then read them back. */
async function seedPunchSpanFixtures(): Promise<{
	employees: SeededEmployee[];
	punches: SeededPunch[];
}> {
	const employees: SeededEmployee[] = [];
	const punchRows: {
		employee_id: number;
		employee_code: string;
		log_date: string;
		serial_number: string;
	}[] = [];

	for (const member of FIXTURE) {
		const code = employeeCode(member.n);
		const inserted = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type,
          joining_date, smartoffice_code, isDelete)
       VALUES (?, 'E2E', ?, ?, 'active', 'Payroll', '2024-01-01', ?, 0)`,
			[
				code,
				`Punch Span ${member.n}`,
				`e2e.punchspan.${member.n}@accent.test`,
				member.deviceCode,
			]
		);
		const employeeId = Number(inserted.insertId);
		employees.push({ code, id: employeeId });

		member.punches.forEach((punch, index) => {
			punchRows.push({
				employee_id: employeeId,
				employee_code: punch.code ?? member.deviceCode,
				log_date: `${day(punch.day)} ${punch.time}`,
				serial_number: `${DEVICE_CODE_PREFIX}S${member.n}-${index + 1}`,
			});
		});
	}

	const ids = employees.map((employee) => employee.id);
	// mysql2's prepared-statement path renders an array bind as a JSON
	// string, so `VALUES ?` bulk inserts are unavailable: one placeholder
	// tuple per row, with the parameters flattened.
	await exec(
		`INSERT INTO attendance_logs
       (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
     VALUES ${punchRows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
		punchRows.flatMap((punch) => [
			punch.employee_code,
			punch.log_date,
			punch.serial_number,
			null, // real devices report no direction
			JSON.stringify({
				UserId: punch.employee_code,
				LogDate: punch.log_date,
			}),
			punch.employee_id,
		])
	);

	const seeded = await rows<SeededPunch>(
		`SELECT id, employee_id, employee_code, log_date, serial_number
     FROM attendance_logs
     WHERE employee_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY log_date, id`,
		ids
	);

	return { employees, punches: seeded };
}

/* ── The rule, re-derived from the seeded rows ────────────────────── */

const MS_PER_HOUR = 3_600_000;
/** A merged next-day punch may not stretch a day's presence past this. */
const MAX_MERGED_SPAN_HOURS = 12;

interface DerivedDay {
	/** First punch → last punch, or null when the day is uncomputable. */
	hours: number | null;
	/** A next-day punch existed but the 12-hour window refused it. */
	mergeRefused: boolean;
	/** Punches recorded on the day, whether or not a merge consumed one. */
	punchCount: number;
	/** The day's punches became another day's merge tail. */
	consumedTail: boolean;
}

/** 'YYYY-MM-DD HH:mm:ss' device wall clock read as UTC, so a subtraction
 *  across midnight is elapsed time and never a minutes-of-day comparison. */
function punchMs(logDate: string): number {
	return Date.parse(`${logDate.replace(' ', 'T')}Z`);
}

/** 'YYYY-MM-DD' → the following calendar day. */
function nextDate(date: string): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS)
		.toISOString()
		.slice(0, 10);
}

/**
 * The day's span for every Employee of the seeded rows, keyed
 * `${employee_id}` → 'YYYY-MM-DD'.
 *
 * A punch belongs to the Employee stamped on its row, so the device code it
 * arrived under never splits a person. Days are walked in date order, so the
 * day that owns a tail is measured before the day the tail landed on: the tail
 * is credited once and dropped from the following day. A day the merge emptied
 * has no presence of its own, but its punches still count on their own date.
 * A lone punch — its own, or a lone surviving punch — is uncomputable.
 */
function deriveDaySpans(
	seeded: SeededPunch[]
): Map<number, Map<string, DerivedDay>> {
	const byEmployee = new Map<number, SeededPunch[]>();
	for (const punch of seeded) {
		const bucket = byEmployee.get(punch.employee_id);
		if (bucket) bucket.push(punch);
		else byEmployee.set(punch.employee_id, [punch]);
	}

	const derived = new Map<number, Map<string, DerivedDay>>();
	for (const [employeeId, own] of byEmployee) {
		const byDate = new Map<string, SeededPunch[]>();
		for (const punch of own) {
			const date = punch.log_date.slice(0, 10);
			const bucket = byDate.get(date);
			if (bucket) bucket.push(punch);
			else byDate.set(date, [punch]);
		}
		for (const bucket of byDate.values()) {
			bucket.sort((a, b) =>
				a.log_date === b.log_date
					? a.id - b.id
					: a.log_date < b.log_date
						? -1
						: 1
			);
		}

		const consumed = new Set<number>();
		const days = new Map<string, DerivedDay>();
		for (const date of [...byDate.keys()].sort()) {
			const bucket = byDate.get(date) ?? [];
			const punchCount = bucket.length;
			const surviving = bucket.filter((punch) => !consumed.has(punch.id));
			if (surviving.length === 0) {
				days.set(date, {
					hours: null,
					mergeRefused: false,
					punchCount,
					consumedTail: true,
				});
				continue;
			}

			const firstMs = punchMs(surviving[0].log_date);
			let lastMs = punchMs(surviving[surviving.length - 1].log_date);
			let merged = false;
			let mergeRefused = false;

			const following = nextDate(date);
			const tail = (byDate.get(following) ?? []).find(
				(punch) => !consumed.has(punch.id)
			);
			if (tail && Number.isFinite(firstMs) && Number.isFinite(lastMs)) {
				const tailMs = punchMs(tail.log_date);
				if (tailMs > lastMs) {
					if (tailMs - firstMs <= MAX_MERGED_SPAN_HOURS * MS_PER_HOUR) {
						consumed.add(tail.id);
						lastMs = tailMs;
						merged = true;
					} else if (surviving.length < 2) {
						// Only a day with no span of its own can be refused.
						mergeRefused = true;
					}
				}
			}

			const effectivePunches = surviving.length + (merged ? 1 : 0);
			const hours =
				!mergeRefused &&
				effectivePunches >= 2 &&
				Number.isFinite(firstMs) &&
				Number.isFinite(lastMs)
					? Math.round(((lastMs - firstMs) / MS_PER_HOUR) * 100) / 100
					: null;
			days.set(date, { hours, mergeRefused, punchCount, consumedTail: false });
		}
		derived.set(employeeId, days);
	}
	return derived;
}

/* ── The report's own response shape, spelled out here ────────────── */

interface ArCell {
	date: string;
	hours: number | null;
	logged_hours: number | null;
	status: string | null;
	punch_count: number;
	merge_refused: boolean;
}

interface ArMatrixRow {
	id: number;
	employee_id: string;
	name: string;
	smartoffice_code: string | null;
	/** Punches recorded under the Employee's own code in the month. */
	punch_count: number;
	cells: ArCell[];
}

interface ArData {
	month: string;
	days: string[];
	employees: ArMatrixRow[];
}

async function fetchReport(request: APIRequestContext): Promise<ArData> {
	const response = await request.get(
		`/api/reports/attendance-report?month=${encodeURIComponent(MONTH)}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ArData;
}

function rowFor(api: ArData, code: string): ArMatrixRow {
	const row = api.employees.find((candidate) => candidate.employee_id === code);
	if (!row) throw new Error(`No report row for ${code}`);
	return row;
}

function cellFor(api: ArData, code: string, date: string): ArCell {
	const cell = rowFor(api, code).cells.find(
		(candidate) => candidate.date === date
	);
	if (!cell) throw new Error(`No report cell for ${code} ${date}`);
	return cell;
}

/* ── State ───────────────────────────────────────────────────────── */

let seededEmployees: SeededEmployee[];
let expected: Map<number, Map<string, DerivedDay>>;
let api: ArData;
const observed: Record<string, unknown> = {};

test.beforeAll(async () => {
	await purgePunchSpanFixtures();
	const seeded = await seedPunchSpanFixtures();
	seededEmployees = seeded.employees;
	expected = deriveDaySpans(seeded.punches);
});

test.beforeAll(async ({ request }) => {
	api = await fetchReport(request);
});

test.afterAll(async () => {
	await purgePunchSpanFixtures();
});

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('the day punch span through the attendance report', () => {
	test('(a) a lone punch day is uncomputable, never a zero-length span', () => {
		const code = employeeCode('01');
		const cell = cellFor(api, code, day(8));

		expect(cell.hours).toBeNull();
		expect(cell.hours).not.toBe(0);
		expect(cell.punch_count).toBe(1);
		expect(cell.merge_refused).toBe(false);

		// Nothing before or after it to merge with: both stay blank.
		for (const date of [day(7), day(9)]) {
			const empty = cellFor(api, code, date);
			expect(empty.hours, date).toBeNull();
			expect(empty.punch_count, date).toBe(0);
			expect(empty.merge_refused, date).toBe(false);
		}

		observed.lonePunchDay = { ...cell };
	});

	test('(b) a next-day punch within 12 hours joins, is consumed, and still counts on its own date', () => {
		const code = employeeCode('02');
		const began = cellFor(api, code, day(9));
		expect(began.hours).toBe(8.5); // 09-09 22:00 → 09-10 06:30
		expect(began.punch_count).toBe(1);
		expect(began.merge_refused).toBe(false);

		// The joined punch is consumed, so the day it landed on holds no span
		// of its own — and still counts the punch that was recorded on it.
		const continued = cellFor(api, code, day(10));
		expect(continued.hours).toBeNull();
		expect(continued.hours).not.toBe(0);
		expect(continued.punch_count).toBe(1);
		expect(continued.merge_refused).toBe(false);

		// The day before the shift never existed for this employee.
		const before = cellFor(api, code, day(8));
		expect(before.hours).toBeNull();
		expect(before.punch_count).toBe(0);

		observed.mergedDay = { ...began };
		observed.consumedDay = { ...continued };
	});

	test('(c) a merge past 12 hours is refused and the day stays uncomputable', () => {
		const code = employeeCode('03');
		const refused = cellFor(api, code, day(17));
		expect(refused.hours).toBeNull(); // 15h apart, outside the window
		expect(refused.merge_refused).toBe(true);
		expect(refused.punch_count).toBe(1);

		// The refused candidate stays a punch of the day it was recorded on,
		// which is itself uncomputable: one punch, nothing to measure.
		const candidate = cellFor(api, code, day(18));
		expect(candidate.hours).toBeNull();
		expect(candidate.merge_refused).toBe(false);
		expect(candidate.punch_count).toBe(1);

		observed.refusedDay = { ...refused };
		observed.candidateDay = { ...candidate };
	});

	test('(d) a punch under a code the Employee was re-enrolled from still belongs to that Employee', () => {
		const code = employeeCode('04');
		const row = rowFor(api, code);
		// The Employee is enrolled under the current code only, so the
		// morning punch under the retired code is proof that attribution
		// follows the ingest stamp rather than the device code.
		expect(row.smartoffice_code).toBe(`${DEVICE_CODE_PREFIX}04`);
		expect(row.smartoffice_code).not.toBe(`${DEVICE_CODE_PREFIX}RETIRED-04`);

		const cell = cellFor(api, code, day(22));
		expect(cell.hours).toBe(9); // 09:00 → 18:00 across the two codes
		expect(cell.punch_count).toBe(2);
		expect(cell.merge_refused).toBe(false);

		observed.reenrolledDay = {
			retiredCode: `${DEVICE_CODE_PREFIX}RETIRED-04`,
			currentCode: `${DEVICE_CODE_PREFIX}04`,
			...cell,
		};
	});

	test('every seeded day matches the span rule re-derived from the raw rows', () => {
		const rowsChecked: string[] = [];
		for (const employee of seededEmployees) {
			const row = rowFor(api, employee.code);
			const days = expected.get(employee.id);
			if (!days) throw new Error(`No derivation for ${employee.code}`);

			for (const [date, derived] of days) {
				const cell = row.cells.find((candidate) => candidate.date === date);
				if (!cell) throw new Error(`No API cell for ${employee.code} ${date}`);
				expect(cell.hours, `${employee.code} ${date} hours`).toBe(
					derived.hours
				);
				expect(
					cell.merge_refused,
					`${employee.code} ${date} merge_refused`
				).toBe(derived.mergeRefused);
				expect(cell.punch_count, `${employee.code} ${date} punch_count`).toBe(
					derived.punchCount
				);
				rowsChecked.push(`${employee.code} ${date}`);
			}

			// The row total is the month's own punches, consumed or not.
			const seededTotal = [...days.values()].reduce(
				(sum, derived) => sum + derived.punchCount,
				0
			);
			expect(row.punch_count, `${employee.code} row total`).toBe(seededTotal);
			const cellTotal = row.cells.reduce(
				(sum, cell) => sum + cell.punch_count,
				0
			);
			expect(cellTotal, `${employee.code} cell total`).toBe(seededTotal);
		}
		observed.derivedRowsChecked = rowsChecked;
	});

	test('no day is ever a zero-length span, and a punch-free day is blank', () => {
		let blankDaysChecked = 0;
		for (const employee of seededEmployees) {
			const row = rowFor(api, employee.code);
			const days = expected.get(employee.id);
			if (!days) continue;
			for (const cell of row.cells) {
				expect(cell.hours, `${employee.code} ${cell.date}`).not.toBe(0);
				if (!days.has(cell.date)) {
					expect(cell.hours, `${employee.code} ${cell.date}`).toBeNull();
					expect(cell.punch_count, `${employee.code} ${cell.date}`).toBe(0);
					expect(cell.merge_refused, `${employee.code} ${cell.date}`).toBe(
						false
					);
					blankDaysChecked += 1;
				}
			}
		}
		expect(blankDaysChecked).toBeGreaterThan(0);
		observed.blankDaysChecked = blankDaysChecked;
	});

	test('the fixture leaves no rows behind once cleaned up', async () => {
		const purged = await purgePunchSpanFixtures();

		const after = {
			employees: await rows<{ c: number }>(
				`SELECT COUNT(*) AS c FROM employees WHERE employee_id LIKE ?`,
				[`${EMPLOYEE_CODE_PREFIX}%`]
			),
			punches: await rows<{ c: number }>(
				`SELECT COUNT(*) AS c FROM attendance_logs WHERE employee_code LIKE ?`,
				[`${DEVICE_CODE_PREFIX}%`]
			),
		};
		expect(Number(after.employees[0]?.c ?? 0)).toBe(0);
		expect(Number(after.punches[0]?.c ?? 0)).toBe(0);

		writeArtifact('punch-span-rule', {
			month: MONTH,
			page: '/api/reports/attendance-report',
			derivation: {
				timePresent:
					"Re-implemented in this spec from the raw attendance_logs rows it seeded, over the same padded fetch window the report uses (one calendar day either side of the month): a day's punches are pooled by the Employee stamped at ingest (the device code is display metadata, so a re-enrolment cannot split a day), measured first-to-last and direction-agnostic; the next day's first punch joins it only when it lands after this day's last punch and within 12 hours of this day's first, and a joined punch is consumed; a lone punch, a lone surviving punch or a refused join is uncomputable (null), never 0. The punch count is per recorded day, unchanged by a merge consuming a tail.",
				applicationHelpersImported: [],
			},
			seeded: {
				employees: FIXTURE.length,
				punches: FIXTURE.reduce(
					(sum, member) => sum + member.punches.length,
					0
				),
			},
			...observed,
			residue: { employeesPurged: purged, afterCleanup: 0 },
			ok: true,
		});
		expect(readArtifact('punch-span-rule')).toMatchObject({
			month: MONTH,
			ok: true,
		});
	});
});
