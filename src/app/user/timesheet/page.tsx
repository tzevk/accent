'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
	CalendarIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useSession } from '@/context/SessionContext';
import { apiGet } from '@/lib/api-client';
import TimesheetGrid, {
	monthLabel,
	type TimesheetGridData,
} from '@/app/reports/timesheet-report/timesheet-grid';

/**
 * My Timesheet — the signed-in employee's own monthly timesheet, read-only.
 *
 * Served by /api/me/timesheet, which derives identity from the session user's
 * linked Employee record, so the page has no employee picker: it can only ever
 * show the caller's own rows. The grid is the admin report's own rendering
 * (`TimesheetGrid`), so hours mean the same thing here as on the report.
 * There is no export control on this page.
 */

/** GET /api/me/timesheet — one month of the session's own timesheet. */
interface MyTimesheetResponse {
	success: boolean;
	meta: {
		/** Offered YYYY-MM months, newest first, current month included */
		months: string[];
		/** The current calendar month — the page's default */
		current_month: string;
	};
	/** Null when the account has no linked Employee record */
	data: TimesheetGridData | null;
}

function UserTimesheetPageInner() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const session = useSession() as {
		loading: boolean;
		authenticated: boolean;
	};
	// A month in the URL opens that month directly; the offered months decide
	// whether it is honoured, exactly like the endpoint decides.
	const [requestedMonth, setRequestedMonth] = useState(
		() => searchParams.get('month') ?? ''
	);

	// Session gate — proxy.ts checks cookie presence only.
	useEffect(() => {
		if (!session.loading && !session.authenticated) {
			router.replace('/signin');
		}
	}, [session.loading, session.authenticated, router]);

	const timesheetQuery = useQuery<MyTimesheetResponse>({
		queryKey: ['me', 'timesheet', requestedMonth || 'current'],
		queryFn: () =>
			apiGet<MyTimesheetResponse>(
				`/api/me/timesheet${requestedMonth ? `?month=${requestedMonth}` : ''}`
			),
		// The session lands after mount; reading before it does would 401.
		enabled: !session.loading && session.authenticated,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const meta = timesheetQuery.data?.meta ?? null;
	const data = timesheetQuery.data?.data ?? null;
	const months = meta?.months ?? [];
	const loadError = timesheetQuery.error?.message ?? '';

	// The month on screen: the honoured request, else the month the response
	// carries (the current month), else the endpoint's stated default.
	const activeMonth =
		requestedMonth && months.includes(requestedMonth)
			? requestedMonth
			: (data?.month ?? meta?.current_month ?? '');
	const monthIndex = activeMonth ? months.indexOf(activeMonth) : -1;
	// Months arrive newest first, so the previous month is the next entry.
	const previousMonth = monthIndex >= 0 ? months[monthIndex + 1] : undefined;
	const nextMonth = monthIndex > 0 ? months[monthIndex - 1] : undefined;

	// A month the endpoint does not offer (a stale deep link) falls back to
	// the current month rather than showing another month's data.
	useEffect(() => {
		if (requestedMonth && meta && !months.includes(requestedMonth)) {
			setRequestedMonth('');
		}
	}, [requestedMonth, meta, months]);

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="flex pt-2 sm:pl-16">
				<main className="flex-1 min-w-0">
					<div className="pl-0 pr-1 sm:pl-0.5 sm:pr-1.5 lg:pl-1 lg:pr-2 py-2 max-w-6xl mx-auto w-full">
						<button
							type="button"
							onClick={() => router.push('/user/dashboard')}
							className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#64126D] transition-colors rounded-md px-1.5 py-1 -ml-1.5 mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]/40"
						>
							<ChevronLeftIcon className="h-4 w-4" aria-hidden />
							Back to Dashboard
						</button>

						{session.loading || timesheetQuery.isPending ? (
							<LoadingSpinner
								message="Loading your Timesheet"
								subMessage="Fetching your hours…"
								showTimer={false}
								fullScreen={false}
								size="md"
							/>
						) : (
							<div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-3 sm:p-4 xl:p-5">
								<div className="mb-4">
									<h2 className="text-lg font-bold text-gray-900">
										My Timesheet
									</h2>
									<p className="text-sm text-gray-500 mt-0.5">
										Your hours for one month, read-only. A present day counts 8
										hours and a half day 4, with Logged Hours from your project
										assignments beside them.
									</p>
								</div>

								{loadError ? (
									<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 flex items-center gap-2 text-sm text-red-700">
										<ExclamationCircleIcon className="h-5 w-5 shrink-0" />
										Could not load your Timesheet.
										<Button
											variant="outline"
											size="sm"
											onClick={() => timesheetQuery.refetch()}
											className="ml-auto"
										>
											Retry
										</Button>
									</div>
								) : !data ? (
									<div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center">
										<CalendarIcon className="mx-auto mb-3 h-8 w-8 text-gray-300" />
										<p className="font-medium text-gray-700">
											No Timesheet yet
										</p>
										<p className="mt-1 text-sm text-gray-500">
											Your account is not linked to an Employee record. Ask an
											administrator to link your account, and this page shows
											your hours.
										</p>
									</div>
								) : (
									<>
										<div className="mb-3 flex flex-wrap items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													previousMonth && setRequestedMonth(previousMonth)
												}
												disabled={!previousMonth}
												aria-label="Show the previous offered month"
											>
												<ChevronLeftIcon className="h-4 w-4" aria-hidden />
												Previous month
											</Button>
											<span
												data-testid="active-month"
												className="text-sm font-semibold text-gray-900 tabular-nums"
											>
												{activeMonth ? monthLabel(activeMonth) : ''}
											</span>
											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													nextMonth && setRequestedMonth(nextMonth)
												}
												disabled={!nextMonth}
												aria-label="Show the next offered month"
											>
												Next month
												<ChevronRightIcon className="h-4 w-4" aria-hidden />
											</Button>
										</div>
										<div className="overflow-x-auto">
											<TimesheetGrid data={data} />
										</div>
									</>
								)}
							</div>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}

export default function UserTimesheetPage() {
	return (
		<Suspense fallback={null}>
			<UserTimesheetPageInner />
		</Suspense>
	);
}
