'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { R, add, sub, toNumber } from '@/lib/money';
import { formatCurrency, formatMonth } from '@/lib/format';
import { downloadFile } from '@/lib/download';
import { InlineSpinner } from '@/components/LoadingSpinner';
import {
	ArrowDownTrayIcon,
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
/** payroll_slips.payment_status, in display order, with one badge/text style each. */
const PAYMENT_STATUSES = {
	paid: {
		label: 'paid',
		badge: 'bg-green-100 text-green-700',
		text: 'text-green-600',
	},
	processed: {
		label: 'processed',
		badge: 'bg-gray-100 text-gray-700',
		text: 'text-gray-600',
	},
	pending: {
		label: 'pending',
		badge: 'bg-yellow-100 text-yellow-700',
		text: 'text-yellow-600',
	},
	hold: {
		label: 'hold',
		badge: 'bg-red-100 text-red-700',
		text: 'text-red-600',
	},
};

const paymentStatus = (slip) =>
	PAYMENT_STATUSES[slip.payment_status] || PAYMENT_STATUSES.pending;

const STREAMS = [
	{ value: 'payroll', label: 'Payroll' },
	{ value: 'contract', label: 'Contract' },
];

export default function PayrollRunDashboard() {
	const [month, setMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
	});
	const [stream, setStream] = useState('payroll');
	const [slips, setSlips] = useState([]);
	const [loading, setLoading] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [scheduledDA, setScheduledDA] = useState(0);

	const currentStream = STREAMS.find((s) => s.value === stream) || STREAMS[0];
	const streamLabel = currentStream.label;
	const monthSlug = month.substring(0, 7);

	useEffect(() => {
		fetchSlips();
		fetchScheduledDA();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [month, stream]);

	const fetchScheduledDA = async () => {
		try {
			const [yr, mn] = month.split('-');
			const monthDate = `${yr}-${mn}-01`;
			const res = await fetch(
				`/api/payroll/schedules?component_type=da&active_only=true&date=${monthDate}`
			);
			const data = await res.json();
			if (data.success && data.data && data.data.length > 0) {
				setScheduledDA(parseFloat(data.data[0].value) || 0);
			} else {
				setScheduledDA(0);
			}
		} catch {
			setScheduledDA(0);
		}
	};

	const fetchSlips = async () => {
		try {
			setLoading(true);
			setError('');
			const res = await fetch(
				`/api/payroll/slips?month=${month}&salary_type=${stream}`
			);
			const data = await res.json();
			if (data.success) {
				setSlips(data.data || []);
			} else {
				setError(data.error);
			}
		} catch {
			setError('Failed to fetch payroll data');
		} finally {
			setLoading(false);
		}
	};

	const generateSlips = async () => {
		if (
			!confirm(
				`Generate Payroll Slips for all ${streamLabel} employees for ${formatMonth(month)}?`
			)
		)
			return;

		try {
			setGenerating(true);
			setError('');
			setSuccess('');

			const res = await fetch('/api/payroll/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					month,
					all: true,
					salary_type: stream,
				}),
			});

			const data = await res.json();
			if (data.success) {
				const results = data.results || {};
				setSuccess(
					`Payroll Slips generated for ${streamLabel} employees: ${results.success || 0} created, ${results.skipped || 0} skipped, ${results.failed || 0} failed`
				);
				fetchSlips();
			} else {
				setError(data.error);
			}
		} catch {
			setError('Failed to generate payroll');
		} finally {
			setGenerating(false);
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

	// Calculate summary stats
	const isFeb = month.split('-')[1] === '02';
	const calcBasicPlusDa = (s) =>
		Math.max(
			0,
			Number(s.structure_basic_salary) ||
				0 ||
				Number(s.profile_basic) ||
				0 ||
				Number(s.profile_basic_plus_da) ||
				0 ||
				Number(s.basic) ||
				0
		);
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
	const totalGross = toNumber(
		slips.reduce((sum, s) => add(sum, calcGross(s)), R(0))
	);
	const totalNet = toNumber(
		slips.reduce(
			(sum, s) =>
				add(
					sum,
					sub(
						calcGross(s),
						(Number(s.total_deductions) || 0) +
							(isFeb ? 300 - (Number(s.pt) || 0) : 0)
					)
				),
			R(0)
		)
	);
	const totalDeductions = toNumber(
		slips.reduce((sum, s) => {
			const ptDiff = isFeb ? 300 - (Number(s.pt) || 0) : 0;
			return add(sum, (Number(s.total_deductions) || 0) + ptDiff);
		}, R(0))
	);
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
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Review the month&apos;s Payroll Slips, generate and export
							</p>
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<button
								onClick={generateSlips}
								disabled={generating}
								className="inline-flex items-center px-4 py-2 bg-[#64126D] text-white rounded-lg hover:bg-[#52105a] disabled:opacity-50 transition-colors text-sm font-medium"
							>
								{generating ? (
									<InlineSpinner className="w-4 h-4 mr-2" />
								) : (
									<CurrencyRupeeIcon className="w-4 h-4 mr-2" />
								)}
								Generate Payroll Slips
							</button>

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
				{error && (
					<div
						role="alert"
						className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700"
					>
						<ExclamationCircleIcon className="w-5 h-5 flex-shrink-0" />
						<span className="text-sm">{error}</span>
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
								Object.entries(PAYMENT_STATUSES)
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
												{formatCurrency(calcBasicPlusDa(slip) - scheduledDA)}
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
												{formatCurrency(isFeb ? 300 : slip.pt)}
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
												{formatCurrency(
													(Number(slip.total_deductions) || 0) +
														(isFeb ? 300 - (Number(slip.pt) || 0) : 0)
												)}
											</td>
											<td className="px-3 py-3 text-right font-bold text-green-700 bg-green-100 sticky right-0 z-10">
												{formatCurrency(
													calcGross(slip) -
														((Number(slip.total_deductions) || 0) +
															(isFeb ? 300 - (Number(slip.pt) || 0) : 0))
												)}
											</td>
											<td className="px-3 py-3 text-center">
												<span
													className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatus(slip).badge}`}
												>
													{paymentStatus(slip).label}
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
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (calcBasicPlusDa(r) - scheduledDA),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(
												slips.reduce((s, r) => s + (Number(r.hra) || 0), 0)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(scheduledDA * slips.length)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.conveyance) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.call_allowance) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.other_allowances) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(
												slips.reduce((s, r) => s + (Number(r.bonus) || 0), 0)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.incentive) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-gray-900 bg-green-50">
											{formatCurrency(totalGross)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.pf_employee) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.esic_employee) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												isFeb
													? 300 * slips.length
													: slips.reduce((s, r) => s + (Number(r.pt) || 0), 0)
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												slips.reduce((s, r) => s + (Number(r.mlwf) || 0), 0)
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												slips.reduce((s, r) => s + (Number(r.tds) || 0), 0)
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.retention) || 0),
													0
												)
											)}
										</td>
										<td className="px-3 py-3 text-right text-red-600">
											{formatCurrency(
												slips.reduce(
													(s, r) => s + (Number(r.lop_deduction) || 0),
													0
												)
											)}
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
