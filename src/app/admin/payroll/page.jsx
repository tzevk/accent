'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import { useSession } from '@/context/SessionContext';
import { R, add, mul, sub, toNumber } from '@/lib/money';
import { formatCurrency, formatMonth } from '@/lib/format';
import { FEBRUARY_PT, slipFigures } from '@/lib/payroll';
import { PAYMENT_STATUS, paymentStatusBadge } from '@/lib/payment-status';
import { apiGet, apiPost } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { InlineSpinner } from '@/components/LoadingSpinner';
import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	BanknotesIcon,
	CalendarIcon,
	CheckCircleIcon,
	CurrencyRupeeIcon,
	DocumentDuplicateIcon,
	DocumentTextIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';

/**
 * Payroll Run — the one dashboard for a month's Payroll Slips (issue #241).
 *
 * Replaces the former salary-sheet run page and the near-duplicate slips list:
 * a month picker, a Payroll | Contract Employee Type toggle that filters the
 * rows and scopes Generate and the Excel/PDF exports, and one row per employee
 * with payment status. Each row opens its Payroll Slip on the detail route,
 * which owns inspecting and printing a single slip.
 */
/**
 * payroll_runs.status → badge. A month with no run row has never been
 * generated, so it says so rather than pretending to be a draft.
 *
 * `paid` is not a stored status: it is derived from the month's Payroll Slips
 * (100% paid), which is why the header reads it from the summary rather than
 * from the run row — the two can then never disagree.
 */
const RUN_STATUSES = {
	draft: { label: 'Draft', badge: 'bg-slate-100 text-slate-700' },
	finalized: { label: 'Finalized', badge: 'bg-green-100 text-green-700' },
	paid: { label: 'Paid', badge: 'bg-emerald-100 text-emerald-700' },
};

const runStatus = (run) =>
	run
		? RUN_STATUSES[run.status] || {
				label: run.status,
				badge: 'bg-gray-100 text-gray-700',
			}
		: { label: 'Not generated', badge: 'bg-gray-100 text-gray-600' };

/** Today as a `type="date"` input wants it — local, like the month picker. */
const todayInput = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
		2,
		'0'
	)}-${String(now.getDate()).padStart(2, '0')}`;
};

const STREAMS = [
	{ value: 'payroll', label: 'Payroll' },
	{ value: 'contract', label: 'Contract' },
];

/**
 * The month's Payroll Run and the summary of the slips behind it: the run row
 * carries the month's lock, while the paid indicator and the reopen block come
 * from those slips, not from the run row. A month that was never generated
 * reads as two nulls.
 */
const readRun = async (month) => {
	const data = await apiGet('/api/payroll/runs', { month });
	return data.success
		? { run: data.data?.run ?? null, summary: data.data?.summary ?? null }
		: { run: null, summary: null };
};

/**
 * The DA Component Rate in force for the month. A month with no scheduled rate
 * and a refused read both come back 0, which is the fixed amount readers then
 * show — the slip's own stored DA is what a 0 falls back to.
 */
const readScheduledDA = async (month) => {
	const [yr, mn] = month.split('-');
	const data = await apiGet('/api/payroll/schedules', {
		component_type: 'da',
		active_only: 'true',
		date: `${yr}-${mn}-01`,
	});
	return data.success && data.data?.length
		? parseFloat(data.data[0].value) || 0
		: 0;
};

export default function PayrollRunDashboard() {
	const [month, setMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	});
	const [stream, setStream] = useState('payroll');
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [paymentDate, setPaymentDate] = useState(todayInput);
	const { user } = useSession();
	const queryClient = useQueryClient();

	// The month and the Employee Type are the reads' query keys, so the pickers
	// still drive what the page shows — only now the cache is the one place the
	// table, the header badge and the DA column come from.
	const runQuery = useQuery({
		queryKey: ['payroll', 'run', month],
		queryFn: () => readRun(month),
	});

	const slipsQuery = useQuery({
		queryKey: ['payroll', 'slips', month, stream],
		queryFn: async () => {
			const data = await apiGet('/api/payroll/slips', {
				month,
				salary_type: stream,
			});
			return data.success ? data.data || [] : [];
		},
	});

	const daQuery = useQuery({
		queryKey: ['payroll', 'schedules', 'da', month],
		queryFn: () => readScheduledDA(month),
	});

	const run = runQuery.data?.run ?? null;
	const summary = runQuery.data?.summary ?? null;
	const slips = slipsQuery.data || [];
	// "Loading" has always meant "a slips read is in flight": the first one, the
	// one a month or stream change starts, and the refetch a write triggers.
	const loading = slipsQuery.isFetching;
	const scheduledDA = daQuery.data ?? 0;
	// A refused slips read keeps the message the hand-rolled fetch showed; the
	// message state below still belongs to the actions.
	const readError = slipsQuery.error
		? slipsQuery.error.message || 'Failed to fetch payroll data'
		: '';

	const currentStream = STREAMS.find((s) => s.value === stream) || STREAMS[0];
	const streamLabel = currentStream.label;
	const monthSlug = month.substring(0, 7);
	const isFinalized = run?.status === 'finalized';
	// Derived from the month's slips, never stored on the run: paid means every
	// slip is paid, so it drops off the moment one slip leaves `paid`.
	const isPaid = !!summary?.is_paid;
	const runBadge = isPaid ? RUN_STATUSES.paid : runStatus(run);
	// Bulk payment belongs to a locked month, and reopening is for the
	// super-admin who has to unlock it — and only while no slip is paid, since
	// a paid month is permanent.
	const canMarkPaid = isFinalized && !isPaid;
	const canReopen =
		isFinalized && summary?.paid_slips === 0 && !!user?.is_super_admin;

	/**
	 * A write moved the month's Payroll Run and the slips behind it, so both
	 * reads refetch. The slips key stops at the month rather than at the Employee
	 * Type on screen: a bulk mark-paid and a reopen move every slip of the
	 * month, whichever stream the picker happens to be showing.
	 */
	const invalidateRunAndSlips = (monthKey) => {
		queryClient.invalidateQueries({ queryKey: ['payroll', 'run', monthKey] });
		queryClient.invalidateQueries({
			queryKey: ['payroll', 'slips', monthKey],
		});
	};

	const generateMutation = useMutation({
		mutationFn: ({ month: runMonth, salary_type }) =>
			apiPost('/api/payroll/generate', {
				month: runMonth,
				all: true,
				salary_type,
			}),
		onSuccess: (_data, variables) => invalidateRunAndSlips(variables.month),
	});

	const finalizeMutation = useMutation({
		mutationFn: ({ month: runMonth }) =>
			apiPost('/api/payroll/runs/finalize', { month: runMonth }),
		onSuccess: (_data, variables) => invalidateRunAndSlips(variables.month),
	});

	const markPaidMutation = useMutation({
		mutationFn: ({ month: runMonth, payment_date }) =>
			apiPost('/api/payroll/runs/mark-paid', {
				month: runMonth,
				payment_date,
			}),
		onSuccess: (_data, variables) => invalidateRunAndSlips(variables.month),
	});

	const reopenMutation = useMutation({
		mutationFn: ({ month: runMonth }) =>
			apiPost('/api/payroll/runs/reopen', { month: runMonth }),
		onSuccess: (_data, variables) => invalidateRunAndSlips(variables.month),
	});

	const generateSlips = async () => {
		if (
			!confirm(
				`Generate Payroll Slips for all ${streamLabel} employees for ${formatMonth(month)}?`
			)
		)
			return;

		try {
			setError('');
			setSuccess('');

			// A first generate also creates the month's Payroll Run; the mutation's
			// onSuccess refetches the run and the slips, so the header, the reopen
			// block and the mark-paid confirmation read the month as it now is.
			const data = await generateMutation.mutateAsync({
				month,
				salary_type: stream,
			});
			const results = data.results || {};
			setSuccess(
				`Payroll Slips generated for ${streamLabel} employees: ${results.success || 0} created, ${results.skipped || 0} skipped, ${results.failed || 0} failed`
			);
		} catch (err) {
			setError(err.message || 'Failed to generate payroll');
		}
	};

	const finalizeRun = async () => {
		try {
			setError('');
			setSuccess('');

			// Re-read the run so the confirmation signs off on current numbers.
			// Through the cache, so the badge above and the dialog can never quote
			// two different months; `staleTime: 0` because "current" means the read
			// that just happened, not a cache entry the mount left behind.
			const { run: monthRun, summary: monthSummary } =
				await queryClient.fetchQuery({
					queryKey: ['payroll', 'run', month],
					queryFn: () => readRun(month),
					staleTime: 0,
				});

			if (!monthRun) {
				setError(
					`No Payroll Run exists for ${formatMonth(month)} yet — generate Payroll Slips first.`
				);
				return;
			}

			if (
				!confirm(
					`Finalize the Payroll Run for ${formatMonth(month)}?\n\n` +
						`Employees: ${monthSummary.headcount}\n` +
						`Total Gross: ${formatCurrency(monthSummary.total_gross)}\n` +
						`Total Deductions: ${formatCurrency(monthSummary.total_deductions)}\n` +
						`Net Pay: ${formatCurrency(monthSummary.total_net_pay)}\n\n` +
						'Finalizing locks the month — Payroll Slips can no longer be generated.'
				)
			)
				return;

			// The mutation refetches the run and the slips on success, so the
			// locked month and its summary land in the cache the dialog read.
			const data = await finalizeMutation.mutateAsync({ month });
			setSuccess(data.message);
		} catch (err) {
			setError(err.message || 'Failed to finalize the Payroll Run');
		}
	};

	/**
	 * One bank batch, one action: every Payroll Slip of the month becomes paid
	 * on the chosen date, and each change is audit-logged slip by slip.
	 */
	const markMonthPaid = async () => {
		try {
			setError('');
			setSuccess('');

			// Re-read the run before asking, the way Finalize does: the
			// confirmation names the number of slips this batch will touch, so it
			// must not quote a summary the month has already moved past. Through
			// the cache, so the badge above cannot quote a different one.
			const { run: monthRun, summary: monthSummary } =
				await queryClient.fetchQuery({
					queryKey: ['payroll', 'run', month],
					queryFn: () => readRun(month),
					staleTime: 0,
				});

			if (!monthRun || monthRun.status !== 'finalized') {
				setError(
					`${formatMonth(month)} has no finalized Payroll Run — finalize the month before marking it paid.`
				);
				return;
			}

			if (
				!confirm(
					`Mark all ${monthSummary.headcount} Payroll Slips for ${formatMonth(
						month
					)} paid on ${paymentDate}?\n\n` +
						'Every slip of the month is set to paid with that payment date, and each change is audit-logged.'
				)
			)
				return;

			// Both reads refetch on success: the run's paid indicator moves, and so
			// does the payment status of every row behind it.
			const data = await markPaidMutation.mutateAsync({
				month,
				payment_date: paymentDate,
			});
			setSuccess(data.message);
		} catch (err) {
			setError(err.message || 'Failed to mark the month paid');
		}
	};

	/**
	 * Super-admin unlock: the month returns to draft, so a pre-payment error can
	 * be corrected and Generate works again.
	 */
	const reopenRun = async () => {
		if (
			!confirm(
				`Reopen the finalized Payroll Run for ${formatMonth(month)}?\n\n` +
					'The month returns to draft and its Payroll Slips can be generated again. The reopen is audit-logged.'
			)
		)
			return;

		try {
			setError('');
			setSuccess('');

			// The mutation refetches the run and the slips on success: the month is
			// draft again and its slips are back in play.
			const data = await reopenMutation.mutateAsync({ month });
			setSuccess(data.message);
		} catch (err) {
			setError(err.message || 'Failed to reopen the Payroll Run');
		}
	};

	const exportToExcel = async () => {
		try {
			setExporting(true);
			setError('');

			await downloadFile(
				`/api/payroll/export-sheet?month=${month}&salary_type=${stream}`,
				`${streamLabel}_Run_${monthSlug}.xlsx`
			);

			setSuccess('Excel file downloaded successfully');
		} catch (err) {
			setError(err.message || 'Failed to export Excel');
		} finally {
			setExporting(false);
		}
	};

	const exportBulkPDF = async () => {
		try {
			setExporting(true);
			setError('');

			await downloadFile(
				`/api/payroll/bulk-pdf?month=${month}&salary_type=${stream}`,
				`${streamLabel}_Slips_${monthSlug}.pdf`
			);

			setSuccess(`PDF downloaded for ${formatMonth(month)}`);
		} catch (err) {
			setError(err.message || 'Failed to export PDF');
		} finally {
			setExporting(false);
		}
	};

	// Calculate summary stats.
	//
	// February's PT is a flat ₹300 for everyone, so a slip's stored PT is
	// corrected by the difference. Both that correction and every total below go
	// through the money library — never float arithmetic (AGENTS.md), because
	// these are the numbers finance signs off on.
	const isFeb = month.split('-')[1] === '02';
	// Basic+DA comes from the shared slip figures (src/lib/payroll.js) — the same
	// candidate chain the Payroll Slip document and both exports read, so the
	// dashboard cannot report an amount the slip disagrees with.
	const calcBasicPlusDa = (s) => slipFigures(s, { scheduledDA }).basicPlusDa;
	const calcGross = (s) =>
		toNumber(
			add(
				calcBasicPlusDa(s),
				s.hra,
				s.conveyance,
				s.call_allowance,
				s.other_allowances,
				s.bonus,
				s.incentive,
				s.paid_holiday,
				s.ot_rate
			)
		);
	/** The February PT correction for one slip: flat 300 minus what it stored. */
	const ptAdjustment = (s) => (isFeb ? sub(FEBRUARY_PT, s.pt) : R(0));
	/** What the slip actually deducts this month, PT correction included. */
	const calcDeductions = (s) =>
		toNumber(add(s.total_deductions, ptAdjustment(s)));
	/** What the slip actually pays out this month. */
	const calcNet = (s) => toNumber(sub(calcGross(s), calcDeductions(s)));
	/** Basic+DA net of the month's scheduled DA, which is what the row shows. */
	const calcBasic = (s) => toNumber(sub(calcBasicPlusDa(s), scheduledDA));

	const sumBy = (fn) =>
		toNumber(slips.reduce((sum, s) => add(sum, fn(s)), R(0)));
	/** The footer total for one Payroll Slip column, summed the same way. */
	const columnTotal = (column) => sumBy((slip) => slip[column]);
	const totalGross = sumBy(calcGross);
	const totalNet = sumBy(calcNet);
	const totalDeductions = sumBy(calcDeductions);
	const statusCounts = slips.reduce((counts, s) => {
		const status = s.payment_status || 'pending';
		counts[status] = (counts[status] || 0) + 1;
		return counts;
	}, {});

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="w-full px-4 sm:px-6 lg:px-8 py-6">
				{/* Header */}
				<div className="mb-6">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
								<DocumentTextIcon className="w-7 h-7 text-[#64126D]" />
								Payroll Run
								<span
									className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${runBadge.badge}`}
								>
									{runBadge.label}
								</span>
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Review the month&apos;s Payroll Slips, generate, finalize and
								export
							</p>
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<button
								onClick={generateSlips}
								disabled={generateMutation.isPending || isFinalized}
								title={
									isFinalized
										? 'The month is locked by its finalized Payroll Run'
										: undefined
								}
								className="inline-flex items-center px-4 py-2 bg-[#64126D] text-white rounded-lg hover:bg-[#52105a] disabled:opacity-50 transition-colors text-sm font-medium"
							>
								{generateMutation.isPending ? (
									<InlineSpinner className="w-4 h-4 mr-2" />
								) : (
									<CurrencyRupeeIcon className="w-4 h-4 mr-2" />
								)}
								Generate Payroll Slips
							</button>

							<button
								onClick={finalizeRun}
								disabled={finalizeMutation.isPending || isFinalized}
								title={
									isFinalized ? 'This month is already finalized' : undefined
								}
								className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
							>
								{finalizeMutation.isPending ? (
									<InlineSpinner className="w-4 h-4 mr-2" />
								) : (
									<CheckCircleIcon className="w-4 h-4 mr-2" />
								)}
								Finalize Payroll Run
							</button>

							{canMarkPaid && (
								<>
									<label
										htmlFor="payroll-payment-date"
										className="text-sm font-medium text-gray-700"
									>
										Payment date:
									</label>
									<input
										id="payroll-payment-date"
										type="date"
										value={paymentDate}
										onChange={(e) => setPaymentDate(e.target.value)}
										className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
									/>
									<button
										onClick={markMonthPaid}
										disabled={markPaidMutation.isPending || !paymentDate}
										className="inline-flex items-center px-4 py-2 bg-[#7F2487] text-white rounded-lg hover:bg-[#86288F] disabled:opacity-50 transition-colors text-sm font-medium"
									>
										{markPaidMutation.isPending ? (
											<InlineSpinner className="w-4 h-4 mr-2" />
										) : (
											<BanknotesIcon className="w-4 h-4 mr-2" />
										)}
										Mark month paid
									</button>
								</>
							)}

							{canReopen && (
								<button
									onClick={reopenRun}
									disabled={reopenMutation.isPending}
									title="Super-admin only — returns the month to draft so its slips can be regenerated"
									className="inline-flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors text-sm font-medium"
								>
									{reopenMutation.isPending ? (
										<InlineSpinner className="w-4 h-4 mr-2" />
									) : (
										<ArrowPathIcon className="w-4 h-4 mr-2" />
									)}
									Reopen
								</button>
							)}

							<button
								onClick={exportToExcel}
								disabled={exporting || slips.length === 0}
								className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm font-medium"
							>
								{exporting ? (
									<InlineSpinner className="w-4 h-4 mr-2" />
								) : (
									<ArrowDownTrayIcon className="w-4 h-4 mr-2" />
								)}
								Export Excel
							</button>

							<button
								onClick={exportBulkPDF}
								disabled={exporting || slips.length === 0}
								className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
							>
								{exporting ? (
									<InlineSpinner className="w-4 h-4 mr-2" />
								) : (
									<DocumentDuplicateIcon className="w-4 h-4 mr-2" />
								)}
								Download All PDFs
							</button>
						</div>
					</div>
				</div>

				{/* Alerts */}
				{(error || readError) && (
					<div
						role="alert"
						className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"
					>
						<ExclamationCircleIcon className="w-5 h-5 flex-shrink-0" />
						<span className="text-sm">{error || readError}</span>
					</div>
				)}

				{success && (
					<div
						role="status"
						className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700"
					>
						<CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
						<span className="text-sm">{success}</span>
					</div>
				)}

				{/* Filters */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
					<div className="flex flex-wrap items-center gap-4">
						<div className="flex items-center gap-2">
							<CalendarIcon className="w-5 h-5 text-gray-400" />
							<label
								htmlFor="payroll-run-month"
								className="text-sm font-medium text-gray-700"
							>
								Month:
							</label>
							<input
								id="payroll-run-month"
								type="month"
								value={monthSlug}
								onChange={(e) => setMonth(`${e.target.value}-01`)}
								className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#64126D] focus:border-[#64126D]"
							/>
						</div>

						<fieldset className="flex items-center gap-2">
							<legend className="sr-only">Employee Type</legend>
							<div className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-0.5">
								{STREAMS.map((s) => (
									<button
										key={s.value}
										type="button"
										onClick={() => setStream(s.value)}
										aria-pressed={stream === s.value}
										className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
											stream === s.value
												? 'bg-white text-gray-900 shadow-sm'
												: 'text-gray-600 hover:text-gray-900'
										}`}
									>
										{s.label}
									</button>
								))}
							</div>
						</fieldset>
					</div>
				</div>

				{/* Stats Cards */}
				<div className="flex gap-4 mb-6">
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-blue-600">
							{slips.length}
						</div>
						<div className="text-xs text-gray-600">Employees</div>
					</div>

					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-green-600">
							{formatCurrency(totalGross)}
						</div>
						<div className="text-xs text-gray-600">Total Gross</div>
					</div>

					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-red-600">
							{formatCurrency(totalDeductions)}
						</div>
						<div className="text-xs text-gray-600">Deductions</div>
					</div>

					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-indigo-600">
							{formatCurrency(totalNet)}
						</div>
						<div className="text-xs text-gray-600">Net Pay</div>
					</div>

					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold flex flex-wrap items-baseline gap-x-2">
							{slips.length === 0 ? (
								<span className="text-gray-400">—</span>
							) : (
								Object.entries(PAYMENT_STATUS)
									.filter(([key]) => statusCounts[key])
									.map(([key, { label, text }]) => (
										<span key={key} className={text}>
											{statusCounts[key]} {label}
										</span>
									))
							)}
						</div>
						<div className="text-xs text-gray-600">Payment</div>
					</div>
				</div>

				{/* Table */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
					<div
						role="status"
						className="px-4 py-3 border-b border-gray-200 text-sm text-gray-600"
					>
						{loading
							? `Loading Payroll Slips...`
							: `Showing ${slips.length} ${stream} ${slips.length === 1 ? 'employee' : 'employees'} for ${formatMonth(month)}`}
					</div>

					<div className="overflow-x-auto">
						{loading ? (
							<div className="flex items-center justify-center py-12">
								<InlineSpinner className="w-8 h-8" />
							</div>
						) : slips.length === 0 ? (
							<div className="text-center py-12 text-gray-500">
								<DocumentTextIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
								<p className="font-medium">No Payroll Slips found</p>
								<p className="text-sm mt-1">
									Generate Payroll Slips for {formatMonth(month)} to see data
									here.
								</p>
							</div>
						) : (
							<table className="w-full text-sm">
								<thead className="bg-gray-50 border-b border-gray-200">
									<tr>
										<th className="px-3 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10">
											#
										</th>
										<th className="px-3 py-3 text-left font-semibold text-gray-700 sticky left-8 bg-gray-50 z-10 min-w-[160px]">
											Employee
										</th>
										<th className="px-3 py-3 text-left font-semibold text-gray-700 min-w-[100px]">
											Department
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											Days
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											Present
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">
											Basic
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											HRA
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">
											DA
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">
											Conveyance
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">
											Call Allow
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px]">
											Other Allow
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											Bonus
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											Incentive
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px] bg-green-50">
											Gross
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">
											PF
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">
											ESIC
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[60px]">
											PT
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">
											MLWF
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[70px]">
											TDS
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											Retention
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[80px]">
											LOP
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[90px] bg-red-50">
											Deductions
										</th>
										<th className="px-3 py-3 text-right font-semibold text-gray-700 min-w-[100px] bg-green-100 sticky right-0 z-10">
											Net Pay
										</th>
										<th className="px-3 py-3 text-center font-semibold text-gray-700 min-w-[80px]">
											Status
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{slips.map((slip, idx) => (
										<tr key={slip.id} className="hover:bg-gray-50">
											<td className="px-3 py-3 text-gray-500 sticky left-0 bg-white z-10">
												{idx + 1}
											</td>
											<td className="px-3 py-3 sticky left-8 bg-white z-10">
												<Link
													href={`/admin/payroll/slips/${slip.id}`}
													className="font-medium text-gray-900 hover:text-[#64126D] hover:underline"
												>
													{slip.employee_name}
												</Link>
												<div className="text-xs text-gray-500">
													{slip.employee_code}
												</div>
											</td>
											<td className="px-3 py-3 text-gray-600">
												{slip.department || '-'}
											</td>
											<td className="px-3 py-3 text-right text-gray-600">
												{slip.standard_working_days || 0}
											</td>
											<td className="px-3 py-3 text-right text-gray-600">
												{slip.payable_days || slip.standard_working_days || 0}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(calcBasic(slip))}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(slip.hra)}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(scheduledDA)}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(slip.conveyance)}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(slip.call_allowance)}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(slip.other_allowances)}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(slip.bonus)}
											</td>
											<td className="px-3 py-3 text-right text-gray-900">
												{formatCurrency(slip.incentive)}
											</td>
											<td className="px-3 py-3 text-right font-semibold text-gray-900 bg-green-50">
												{formatCurrency(calcGross(slip))}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(slip.pf_employee)}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(slip.esic_employee)}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(isFeb ? FEBRUARY_PT : slip.pt)}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(slip.mlwf)}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(slip.tds)}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(slip.retention)}
											</td>
											<td className="px-3 py-3 text-right text-red-600">
												{formatCurrency(slip.lop_deduction)}
											</td>
											<td className="px-3 py-3 text-right font-semibold text-red-600 bg-red-50">
												{formatCurrency(calcDeductions(slip))}
											</td>
											<td className="px-3 py-3 text-right font-bold text-green-700 bg-green-100 sticky right-0 z-10">
												{formatCurrency(calcNet(slip))}
											</td>
											<td className="px-3 py-3 text-center">
												<span
													className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusBadge(slip.payment_status).badge}`}
												>
													{paymentStatusBadge(slip.payment_status).label}
												</span>
											</td>
										</tr>
									))}
								</tbody>
								<tfoot className="bg-gray-50 border-t-2 border-gray-200">
									<tr className="font-bold">
										<td
											colSpan="3"
											className="px-3 py-3 text-right text-gray-700 sticky left-0 bg-gray-50 z-10"
										>
											TOTALS:
										</td>
										<td colSpan="2" className="px-3 py-3"></td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(sumBy(calcBasic))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(columnTotal('hra'))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(toNumber(mul(scheduledDA, slips.length)))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(columnTotal('conveyance'))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(columnTotal('call_allowance'))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(columnTotal('other_allowances'))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(columnTotal('bonus'))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(columnTotal('incentive'))}
										</td>
										<td className="px-3 py-3 text-right text-gray-900 bg-green-50">
											{formatCurrency(totalGross)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(columnTotal('pf_employee'))}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(columnTotal('esic_employee'))}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												isFeb
													? toNumber(mul(FEBRUARY_PT, slips.length))
													: columnTotal('pt')
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(columnTotal('mlwf'))}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(columnTotal('tds'))}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(columnTotal('retention'))}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(columnTotal('lop_deduction'))}
										</td>
										<td className="px-3 py-3 text-right text-red-600 bg-red-50">
											{formatCurrency(totalDeductions)}
										</td>
										<td className="px-3 py-3 text-right text-green-700 bg-green-100 sticky right-0 z-10">
											{formatCurrency(totalNet)}
										</td>
										<td></td>
									</tr>
								</tfoot>
							</table>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
