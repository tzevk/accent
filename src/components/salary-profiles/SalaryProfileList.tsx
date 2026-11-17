'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
	ArrowPathIcon,
	ExclamationCircleIcon,
	MagnifyingGlassIcon,
	UsersIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn';
import { formatCurrency } from '@/lib/format';
import type {
	SalaryCtcProjection,
	SalaryDirectoryFilter,
	SalaryDirectoryRow,
} from '@/lib/salary-profile-directory';
import { useSalaryProfileDirectory } from '@/hooks/useSalaryProfiles';
import {
	displayDate,
	statusLabel,
	todayInput,
} from '@/components/salary-profiles/salary-profile-form';

const PAGE_SIZE = 25;

type StreamFilter = SalaryDirectoryFilter | 'all';

const STREAM_TABS: ReadonlyArray<{ value: StreamFilter; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'payroll', label: 'Payroll' },
	{ value: 'contract', label: 'Contract' },
	{ value: 'missing', label: 'Missing Profile' },
];

const CLASSIFICATION_TONES: Record<string, string> = {
	current: 'bg-purple-100 text-purple-800',
	scheduled: 'bg-blue-100 text-blue-800',
	previous: 'bg-gray-100 text-gray-700',
	cancelled: 'bg-amber-100 text-amber-800',
};

function Badge({
	children,
	tone = 'bg-gray-100 text-gray-700',
}: {
	children: ReactNode;
	tone?: string;
}) {
	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
				tone
			)}
		>
			{children}
		</span>
	);
}

function CtcText({ ctc }: { ctc: SalaryCtcProjection | null | undefined }) {
	if (!ctc || ctc.status === 'missing' || ctc.amount === null) {
		return (
			<span className="text-sm text-gray-500">
				{ctc?.status === 'invalid' ? 'Invalid CTC' : 'CTC not recorded'}
			</span>
		);
	}
	return (
		<span className="text-sm text-gray-900">
			<span className="font-semibold">{formatCurrency(ctc.amount)}</span>
			<span className="ml-1 text-xs text-gray-500">monthly CTC</span>
			{ctc.legacy_fallback && (
				<span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
					legacy {ctc.source === 'gross' ? 'gross' : 'gross salary'}
				</span>
			)}
		</span>
	);
}

function AgreementCell({ row }: { row: SalaryDirectoryRow }) {
	if (row.state === 'ambiguous') {
		return (
			<div className="space-y-1">
				<Badge tone="bg-amber-100 text-amber-800">Ambiguous agreement</Badge>
				<p className="text-xs text-amber-800">
					{row.conflict_ids.length > 1
						? `${row.conflict_ids.length} agreements cover ${displayDate(
								row.anchor
							)}. Open the profile to review the conflict.`
						: `Agreement history conflicts at ${displayDate(row.anchor)}. Open the profile to review it.`}
				</p>
			</div>
		);
	}
	if (row.state === 'unavailable' || !row.agreement) {
		return (
			<div className="space-y-1">
				<Badge tone="bg-red-50 text-red-700">No salary profile</Badge>
				<p className="text-xs text-gray-500">
					No agreement covers {displayDate(row.anchor)}.
				</p>
			</div>
		);
	}
	const agreement = row.agreement;
	return (
		<div className="space-y-1">
			<div className="flex flex-wrap items-center gap-2">
				<Badge
					tone={
						agreement.pay_stream === 'contract'
							? 'bg-indigo-100 text-indigo-800'
							: 'bg-purple-100 text-purple-800'
					}
				>
					{agreement.pay_stream === 'contract' ? 'Contract' : 'Payroll'}
				</Badge>
				<Badge
					tone={
						CLASSIFICATION_TONES[agreement.classification] ??
						'bg-gray-100 text-gray-700'
					}
				>
					{agreement.classification.charAt(0).toUpperCase() +
						agreement.classification.slice(1)}
				</Badge>
				{agreement.used && (
					<Badge tone="bg-emerald-100 text-emerald-800">Used by payroll</Badge>
				)}
			</div>
			<p className="text-xs text-gray-500">
				{displayDate(agreement.effective_from)} –{' '}
				{agreement.effective_to
					? displayDate(agreement.effective_to)
					: 'Open-ended'}
				{' · '}
				{agreement.salary_type}
			</p>
			<CtcText ctc={agreement.ctc} />
		</div>
	);
}

export interface SalaryProfileListProps {
	initialStream?: StreamFilter;
	initialDate?: string;
}

/**
 * The Payroll → Salary Profiles directory (#444).
 *
 * Every Employee is discoverable at the selected date, including Employees
 * without an agreement and leavers with history. Salary Type, not Employee
 * Type, decides the Payroll/Contract stream here; the rows come from the
 * payroll-authorized directory projection and never grant employee access.
 */
export function SalaryProfileList({
	initialStream = 'all',
	initialDate,
}: SalaryProfileListProps) {
	const [date, setDate] = useState(initialDate || todayInput());
	const [searchInput, setSearchInput] = useState('');
	const [search, setSearch] = useState('');
	const [stream, setStream] = useState<StreamFilter>(initialStream);
	const [page, setPage] = useState(1);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setSearch(searchInput.trim());
			setPage(1);
		}, 300);
		return () => window.clearTimeout(timer);
	}, [searchInput]);

	const request = useMemo(
		() => ({ date, search, stream, page, limit: PAGE_SIZE }),
		[date, search, stream, page]
	);
	const directoryQuery = useSalaryProfileDirectory(request, Boolean(date));

	const payload = directoryQuery.data;
	const rows = payload?.data ?? [];
	const counts = payload?.counts ?? {
		total: 0,
		payroll: 0,
		contract: 0,
		missing: 0,
		ambiguous: 0,
	};

	const from = payload && payload.total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
	const to = payload ? Math.min(page * PAGE_SIZE, payload.total) : 0;

	return (
		<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
			<header className="mb-6">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
					<div>
						<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
							<UsersIcon className="h-7 w-7 text-[#64126D]" />
							Salary Profiles
						</h1>
						<p className="mt-1 max-w-3xl text-sm text-gray-500">
							Search Employees and open their Payroll or Contract salary
							agreement. Salary Type decides the pay stream; Employee Type is
							only a directory category. Employees without an agreement stay
							listed so missing profiles cannot hide their owners.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Link
							href="/admin/payroll"
							className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						>
							Payroll Run
						</Link>
						<Link
							href="/admin/payroll/rates"
							className="inline-flex items-center rounded-lg border border-[#64126D] bg-white px-3 py-2 text-sm font-medium text-[#64126D] hover:bg-purple-50"
						>
							Component Rates
						</Link>
					</div>
				</div>
			</header>

			<div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
						<div>
							<label
								htmlFor="salary-directory-date"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								Agreements as of
							</label>
							<input
								id="salary-directory-date"
								type="date"
								required
								value={date}
								onChange={(event) => {
									setDate(event.target.value);
									setPage(1);
								}}
								className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]"
							/>
						</div>
						<div className="min-w-0 sm:w-80">
							<label
								htmlFor="salary-directory-search"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								Search employees
							</label>
							<div className="relative">
								<MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
								<input
									id="salary-directory-search"
									type="search"
									value={searchInput}
									onChange={(event) => setSearchInput(event.target.value)}
									placeholder="Name, employee code or department"
									className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]"
								/>
							</div>
						</div>
					</div>

					<fieldset>
						<legend className="mb-1 block text-sm font-medium text-gray-700">
							Pay stream
						</legend>
						<div className="inline-flex flex-wrap rounded-lg border border-gray-300 bg-gray-100 p-0.5">
							{STREAM_TABS.map((tab) => {
								const count =
									tab.value === 'all'
										? counts.total
										: counts[tab.value as SalaryDirectoryFilter];
								return (
									<button
										key={tab.value}
										type="button"
										aria-pressed={stream === tab.value}
										onClick={() => {
											setStream(tab.value);
											setPage(1);
										}}
										className={cn(
											'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
											stream === tab.value
												? 'bg-white text-gray-900 shadow-sm'
												: 'text-gray-600 hover:text-gray-900'
										)}
									>
										{tab.label}
										<span
											aria-hidden="true"
											className="rounded-full bg-gray-200 px-1.5 text-xs text-gray-700"
										>
											{count}
										</span>
									</button>
								);
							})}
						</div>
					</fieldset>
				</div>

				{counts.ambiguous > 0 && (
					<p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
						{counts.ambiguous} Employee
						{counts.ambiguous === 1 ? '' : 's'} with ambiguous agreement
						history. Ambiguity is neither Payroll, Contract nor Missing; open
						the profile to review it.
					</p>
				)}
			</div>

			{!date ? (
				<p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
					Choose an as-of date to list salary profiles.
				</p>
			) : directoryQuery.isPending ? (
				<p
					role="status"
					className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600"
				>
					Loading salary profiles…
				</p>
			) : directoryQuery.isError ? (
				<div
					role="alert"
					className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
				>
					<span className="flex items-center gap-2">
						<ExclamationCircleIcon className="h-5 w-5 flex-shrink-0" />
						Unable to load salary profiles: {directoryQuery.error?.message}
					</span>
					<button
						type="button"
						onClick={() => void directoryQuery.refetch()}
						className="inline-flex items-center gap-2 self-start rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
					>
						<ArrowPathIcon className="h-4 w-4" />
						Retry
					</button>
				</div>
			) : rows.length === 0 ? (
				<p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
					No Employees match the selected date and filters. Employees without a
					salary profile appear in All and Missing Profile.
				</p>
			) : (
				<>
					{directoryQuery.isFetching && (
						<p role="status" className="mb-2 text-xs text-gray-500">
							Refreshing salary profiles…
						</p>
					)}
					<ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
						{rows.map((row) => {
							const href = `/admin/payroll/salary-profiles/${row.id}?date=${encodeURIComponent(
								date
							)}`;
							return (
								<li
									key={row.id}
									className="flex flex-col gap-3 p-4 transition-colors hover:bg-purple-50/40 lg:flex-row lg:items-center lg:justify-between"
								>
									<div className="min-w-0">
										<Link
											href={href}
											aria-label={`Open salary profile for ${row.full_name} (${row.employee_id})`}
											className="text-base font-semibold text-[#64126D] hover:underline"
										>
											{row.full_name}
										</Link>
										<p className="mt-0.5 text-xs text-gray-500">
											{row.employee_id}
											{row.department ? ` · ${row.department}` : ''}
										</p>
										<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
											<span>
												Employee Type:{' '}
												<span>{row.employee_type || 'Not set'}</span>
											</span>
											<Badge
												tone={
													row.status === 'active'
														? 'bg-green-50 text-green-700'
														: 'bg-gray-100 text-gray-700'
												}
											>
												{statusLabel(row.status)}
											</Badge>
											{row.exit_date && (
												<span>Exited {displayDate(row.exit_date)}</span>
											)}
										</p>
									</div>
									<div className="lg:w-80">
										<AgreementCell row={row} />
									</div>
									<div className="text-right">
										<Link
											href={href}
											className="text-sm font-medium text-[#64126D] hover:underline"
										>
											Open profile
										</Link>
									</div>
								</li>
							);
						})}
					</ul>

					<nav
						aria-label="Salary profile pages"
						className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
					>
						<p role="status" className="text-sm text-gray-600">
							Showing {from}–{to} of {payload?.total ?? 0}
						</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								disabled={page <= 1}
								onClick={() => setPage((current) => Math.max(1, current - 1))}
								className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Previous page
							</button>
							<button
								type="button"
								disabled={to >= (payload?.total ?? 0)}
								onClick={() => setPage((current) => current + 1)}
								className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Next page
							</button>
						</div>
					</nav>
				</>
			)}
		</div>
	);
}
