import { NextResponse } from 'next/server';
import { withDb } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { linkedEmployeeId } from '@/app/api/me/_lib/session-employee';
import {
	fetchTimesheetMeta,
	fetchTimesheetData,
	type TimesheetData,
} from '@/app/reports/timesheet-report/data-source';

/**
 * GET /api/me/timesheet — the signed-in employee's own Timesheet.
 *
 * The self-service sibling of /api/reports/timesheet-report. It deliberately
 * does not call ensurePermission: a normal employee holds no report
 * permission, which is the whole reason the page exists. Identity comes from
 * the session user's linked Employee record (`users.employee_id`), so a
 * caller-supplied `employee_id` is ignored rather than validated and no one
 * can read another Employee's Timesheet through this route.
 *
 * Without params          → the current calendar month's data.
 * ?month=YYYY-MM          → that month's data, when the month is offered.
 *
 * `data` is null when the session resolves to no readable Employee record
 * (no link, or a link to a deleted Employee). The page renders an explanatory
 * empty state then — never an error, and never an empty grid.
 *
 * The figures come from the report's own data source (`fetchTimesheetData`),
 * so hours mean exactly what they mean on the admin report. Uses `query()`
 * (via the data source) — no long-held connection.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TimesheetMetaResponse {
	/** YYYY-MM months the page offers, newest first, current month included */
	months: string[];
	/** The current calendar month, the page's default */
	current_month: string;
}

interface TimesheetResponse {
	success: boolean;
	meta: TimesheetMetaResponse;
	data: TimesheetData | null;
}

function currentCalendarMonth(now: Date): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: Request) {
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const currentMonth = currentCalendarMonth(new Date());
		// The identity is the session's own Employee — re-read here rather than
		// trusting the cached copy on the session object.
		const employeeId = await withDb((db) => linkedEmployeeId(db, user.id));
		if (!employeeId) {
			return NextResponse.json({
				success: true,
				meta: { months: [currentMonth], current_month: currentMonth },
				data: null,
			} satisfies TimesheetResponse);
		}

		// The union the admin report's filter bar computes — months with
		// attendance rows plus months with project daily entries — with the
		// current calendar month always offered, newest first.
		const meta = await fetchTimesheetMeta();
		const months = Array.from(new Set([...meta.months, currentMonth]))
			.sort()
			.reverse();

		const requested = new URL(request.url).searchParams.get('month');
		const month =
			requested && /^\d{4}-\d{2}$/.test(requested) && months.includes(requested)
				? requested
				: currentMonth;

		const data = await fetchTimesheetData(Number(employeeId), month);
		return NextResponse.json({
			success: true,
			meta: { months, current_month: currentMonth },
			// No readable Employee record behind the link: the page shows its
			// explanatory empty state instead of a grid with nobody on it.
			data: data.employee ? data : null,
		} satisfies TimesheetResponse);
	} catch (error: unknown) {
		console.error('My timesheet error:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : 'Failed to load timesheet',
			},
			{ status: 500 }
		);
	}
}
