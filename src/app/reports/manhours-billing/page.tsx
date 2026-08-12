'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	DocumentArrowDownIcon,
	PrinterIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ─── Client-safe API types ──────────────────────────────────────────

interface BillingProject {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string;
}

interface BillingMeta {
	clients: string[];
	projects: BillingProject[];
	months: string[];
	latest_month: string | null;
}

interface BillingRow {
	sr_no: number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	employee_charges: number;
	total_manhours: number;
	amount: number;
	tds_rate: number;
	tds: number;
	net_payable: number;
	accent_charges: number;
	accent_amount: number;
	pnl_after_deductions: number;
	pnl_tds: number;
}

interface BillingData {
	client_name: string;
	project: {
		project_id: number;
		project_code: string;
		project_name: string;
	};
	month: string;
	month_label: string;
	year: number;
	rows: BillingRow[];
	totals: {
		total_manhours: number;
		total_amount: number;
		total_tds: number;
		total_net_payable: number;
		total_accent_amount: number;
		total_pnl_after_deductions: number;
		total_pnl_tds: number;
	};
}

interface ApiResponse {
	success: boolean;
	data?: BillingData | null;
	meta?: BillingMeta;
	error?: string;
}

function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const names = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December',
	];
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${names[monthNumber - 1]} ${year}`;
}

/** "176" stays "176"; "8.50" → "8.5"; aligns with the template's plain-hour cells. */
function fmtHours(hours: number): string {
	return String(Number(hours.toFixed(2)));
}

// ─── Print layout (A4 landscape letterhead) ─────────────────────────
// Mirrors the ActivityStatusMatrix print pattern: @page landscape +
// print-color-adjust, plus a print-only letterhead header, repeating
// table header on page breaks, and a fixed footer (Chrome repeats
// position:fixed elements on every printed page).
const mhbPrintStyles = `
@media print {
	@page {
		size: A4 landscape;
		margin: 10mm 9mm 14mm 9mm;
		@bottom-center {
			content: "Accent CRM — Manhours Billing Report — Page " counter(page) " of " counter(pages);
			font-size: 7pt;
			color: #6b7280;
		}
	}
	.mhb-print-page {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	/* Hide the app chrome: the page's top nav and the root-layout sidebar,
	   and undo the content offset the fixed sidebar reserves on screen. */
	.mhb-print-page nav {
		display: none !important;
	}
	body > aside {
		display: none !important;
	}
	.content-with-sidebar {
		padding-left: 0 !important;
		padding-top: 0 !important;
	}
	.mhb-print-page main {
		padding: 0 !important;
	}
	.mhb-print-page .mhb-scroll {
		overflow: visible !important;
		max-width: none !important;
		margin: 0 !important;
	}
	.mhb-sheet {
		min-width: 0 !important;
		font-size: 8pt;
	}
	.mhb-sheet table {
		font-size: 8pt;
	}
	.mhb-sheet th,
	.mhb-sheet td {
		padding: 1.5px 3px !important;
	}
	.mhb-sheet thead {
		display: table-header-group;
	}
	.mhb-sheet tbody tr {
		break-inside: avoid;
	}

	/* Print-only letterhead header */
	.mhb-print-header {
		border-bottom: 2px solid #64126d;
		padding-bottom: 3mm;
		margin-bottom: 3mm;
	}
	.mhb-print-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6mm;
	}
	.mhb-print-brand-name {
		font-size: 14pt;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: #4d025b;
	}
	.mhb-print-brand-sub {
		display: block;
		font-size: 6.5pt;
		letter-spacing: 0.2em;
		color: #6b7280;
		text-transform: uppercase;
	}
	.mhb-print-title {
		flex: 1;
		text-align: center;
		font-size: 12pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #111827;
	}
	.mhb-print-period {
		min-width: 52mm;
		text-align: right;
		font-size: 8pt;
		color: #374151;
	}
	.mhb-print-period b {
		color: #111827;
	}
	.mhb-print-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 3mm 8mm;
		font-size: 8pt;
		color: #374151;
		margin-top: 2mm;
	}
	.mhb-print-meta b {
		color: #111827;
	}
	.mhb-print-meta .mhb-print-generated {
		margin-left: auto;
		color: #6b7280;
	}

	/* Print-only footer (repeats on every page in Chrome) */
	.mhb-print-footer {
		position: fixed;
		bottom: 0;
		left: 9mm;
		right: 9mm;
		display: flex;
		justify-content: space-between;
		font-size: 7pt;
		color: #6b7280;
		border-top: 1px solid #64126d;
		padding-top: 1.5mm;
	}
}
`;

// ─── Page ───────────────────────────────────────────────────────────

export default function ManhoursBillingReportPage() {
	const {
		loading: authLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC() as {
		loading: boolean;
		user: {
			is_super_admin?: boolean | number | null;
			field_permissions?: unknown;
		} | null;
		can: (resource: string, permission: string) => boolean;
		RESOURCES: { REPORTS: string };
		PERMISSIONS: { READ: string };
	};

	const [client, setClient] = useState('');
	const [projectId, setProjectId] = useState('');
	const [month, setMonth] = useState('');
	const [exporting, setExporting] = useState(false);

	const metaQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'manhours-billing', 'meta'],
		queryFn: () => apiGet('/api/reports/manhours-billing'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const clients = useMemo(() => meta?.clients ?? [], [meta]);
	const projects = useMemo(() => meta?.projects ?? [], [meta]);
	const months = useMemo(() => meta?.months ?? [], [meta]);

	useEffect(() => {
		if (!meta) return;
		// Defaults are applied once when metadata arrives: first client, its
		// first project, and the latest month with data.
		const initialClient = clients.find((c) => c === client) ?? clients[0] ?? '';
		const clientProjects = projects.filter(
			(p) => p.client_name === initialClient
		);
		setClient(initialClient);
		setProjectId((previous) => {
			if (
				previous &&
				clientProjects.some((p) => String(p.project_id) === previous)
			) {
				return previous;
			}
			return String(clientProjects[0]?.project_id ?? '');
		});
		setMonth((previous) => previous || meta.latest_month || '');
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [meta]);

	const dataQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'manhours-billing', 'data', projectId, month],
		queryFn: () =>
			apiGet(
				`/api/reports/manhours-billing?project_id=${projectId}&month=${month}`
			),
		enabled: !!projectId && !!month,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const data = dataQuery.data?.data ?? null;

	// Print letterhead timestamp — recomputed on render, stable for a print.
	const generatedAt = new Date().toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	const error =
		dataQuery.error?.message || dataQuery.data?.error || metaQuery.data?.error;
	const isLoading =
		dataQuery.isLoading || (dataQuery.isFetching && !dataQuery.data);

	const clientOptions = useMemo(
		() => clients.map((c) => ({ value: c, label: c })),
		[clients]
	);
	const projectOptions = useMemo(
		() =>
			projects
				.filter((p) => p.client_name === client)
				.map((p) => ({
					value: String(p.project_id),
					label: [p.project_code, p.project_name].filter(Boolean).join(' - '),
				})),
		[projects, client]
	);
	const monthOptions = useMemo(
		() => months.map((m) => ({ value: m, label: monthLabel(m) })),
		[months]
	);

	const handleClientChange = (value: string) => {
		setClient(value);
		const firstProject = projects.find((p) => p.client_name === value);
		setProjectId(String(firstProject?.project_id ?? ''));
	};

	const handlePrint = () => {
		window.print();
	};

	const handleExport = async () => {
		if (!projectId || !month) return;
		setExporting(true);
		try {
			const response = await fetch(
				`/api/reports/manhours-billing/download?project_id=${projectId}&month=${month}`,
				{ credentials: 'include' }
			);
			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(
					`Export failed (${response.status})${message ? `: ${message}` : ''}`
				);
			}
			const blob = await response.blob();
			const disposition = response.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^";]+)"?/i);
			const filename =
				match?.[1] ||
				`Manhours_Billing_${data?.client_name ?? ''}_${month}.xlsx`;
			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
		} catch (exportError) {
			console.error('Export failed:', exportError);
		} finally {
			setExporting(false);
		}
	};

	if (authLoading) {
		return (
			<div className="min-h-screen bg-white">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
					Loading…
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-screen bg-white">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center">
					<div className="text-center">
						<XMarkIcon className="mx-auto mb-2 h-8 w-8 text-red-500" />
						<h2 className="text-lg font-bold text-gray-800">Access Denied</h2>
						<p className="text-sm text-gray-500">
							You don&apos;t have permission to view this report.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="mhb-print-page min-h-screen bg-white text-black">
			<style>{mhbPrintStyles}</style>
			<Navbar />
			<main className="px-1 pb-8 pt-1 sm:px-2">
				{/* Filter bar — hidden when printing the sheet. */}
				<form
					onSubmit={(e) => {
						e.preventDefault();
						dataQuery.refetch();
					}}
					aria-label="Manhours billing filters"
					className="mx-auto mb-3 flex max-w-[1550px] flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:hidden"
				>
					<label className="block min-w-[200px] flex-1">
						<span className="mb-1 block text-[11px] font-semibold text-gray-600">
							Client Name
						</span>
						<SearchableSelect
							options={clientOptions}
							value={client}
							onChange={handleClientChange}
							placeholder="Select a client…"
							disabled={metaQuery.isLoading}
						/>
					</label>

					<label className="block min-w-[240px] flex-[2]">
						<span className="mb-1 block text-[11px] font-semibold text-gray-600">
							Project Name/Number
						</span>
						<SearchableSelect
							options={projectOptions}
							value={projectId}
							onChange={(val) => setProjectId(String(val))}
							placeholder="Select a project…"
							disabled={!client || metaQuery.isLoading}
						/>
					</label>

					<label className="block min-w-[160px] flex-1">
						<span className="mb-1 block text-[11px] font-semibold text-gray-600">
							Month/Year
						</span>
						<SearchableSelect
							options={monthOptions}
							value={month}
							onChange={(val) => setMonth(String(val))}
							placeholder="Select a month…"
							disabled={metaQuery.isLoading}
						/>
					</label>

					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => dataQuery.refetch()}
							disabled={!projectId || !month || isLoading}
							className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[11px] font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<ArrowPathIcon
								className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
							/>
							Refresh
						</button>
						<button
							type="button"
							onClick={handlePrint}
							disabled={!data}
							className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[11px] font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<PrinterIcon className="h-3.5 w-3.5" />
							Print
						</button>
						<button
							type="button"
							onClick={handleExport}
							disabled={!data || exporting}
							className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#64126D] bg-[#64126D] px-3 text-[11px] font-semibold text-white hover:bg-[#7F2487] active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<DocumentArrowDownIcon className="h-3.5 w-3.5" />
							{exporting ? 'Exporting…' : 'Export Excel'}
						</button>
					</div>
				</form>

				{error ? (
					<div className="mx-auto max-w-[1550px] border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700">
						<p className="font-semibold">Couldn&apos;t load the report</p>
						<p className="mt-1">{error}</p>
						<button
							type="button"
							onClick={() => dataQuery.refetch()}
							className="mt-3 border border-red-600 bg-red-600 px-3 py-1 text-xs text-white"
						>
							Retry
						</button>
					</div>
				) : isLoading ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1550px] items-center justify-center text-sm text-gray-500">
						Loading billing report…
					</div>
				) : !data ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1550px] items-center justify-center border border-gray-300 text-sm text-gray-500">
						Select a client, project, and month to view the billing report.
					</div>
				) : (
					<div className="mhb-scroll mx-auto max-w-[1550px] overflow-x-auto print:overflow-visible">
						<section
							className="mhb-sheet min-w-[900px] bg-white font-[Arial,sans-serif] text-[10px] leading-none text-black"
							style={{
								WebkitPrintColorAdjust: 'exact',
								printColorAdjust: 'exact',
							}}
						>
							{/* Print-only letterhead header (hidden on screen). */}
							<header className="mhb-print-header hidden print:block">
								<div className="mhb-print-header-row">
									<div className="mhb-print-brand">
										<span className="mhb-print-brand-name">ACCENT</span>
										<span className="mhb-print-brand-sub">
											Techno Solutions Pvt. Ltd.
										</span>
									</div>
									<h1 className="mhb-print-title">Manhours Billing Report</h1>
									<div className="mhb-print-period">
										<b>Period:</b> {data.month_label}
									</div>
								</div>
								<div className="mhb-print-meta">
									<span>
										<b>Client:</b> {data.client_name}
									</span>
									<span>
										<b>Project:</b>{' '}
										{[data.project.project_code, data.project.project_name]
											.filter(Boolean)
											.join(' - ')}
									</span>
									<span>
										<b>Month/Year:</b> {data.month_label}
									</span>
									<span className="mhb-print-generated">
										<b>Generated:</b> {generatedAt}
									</span>
								</div>
							</header>

							{/* Header block: client / project / month, mirroring the template. */}
							<div className="grid grid-cols-[150px_minmax(0,1fr)] border border-black print:hidden">
								<div className="border-b border-black px-2 py-1.5 font-semibold">
									Client Name :
								</div>
								<div className="border-b border-black border-l border-l-black px-2 py-1.5">
									{data.client_name}
								</div>
								<div className="border-b border-black px-2 py-1.5 font-semibold">
									Project Name/Number :
								</div>
								<div className="border-b border-black border-l border-l-black px-2 py-1.5">
									{[data.project.project_code, data.project.project_name]
										.filter(Boolean)
										.join(' - ')}
								</div>
								<div className="px-2 py-1.5 font-semibold">Month/Year :</div>
								<div className="border-l border-l-black px-2 py-1.5">
									{data.month_label}
								</div>
							</div>

							<table className="mt-0 w-full table-fixed border-collapse border border-black">
								<caption className="sr-only">
									Manhours billing for {data.client_name} on{' '}
									{data.project.project_name} in {data.month_label}
								</caption>
								<colgroup>
									<col style={{ width: '5%' }} />
									<col style={{ width: '14%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '9%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
									<col style={{ width: '8%' }} />
								</colgroup>
								<thead>
									<tr>
										<th
											rowSpan={2}
											className="border border-black bg-yellow-100 px-1 py-1 text-center font-semibold"
										>
											Sr. No.
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-yellow-100 px-1 py-1 text-left font-semibold"
										>
											Employee Name
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-yellow-100 px-1 py-1 text-left font-semibold"
										>
											Designation
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
										>
											Total Manhours
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
										>
											Employee Charges
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
										>
											Amount
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
										>
											TDS
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
										>
											Net Payable
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-green-100 px-1 py-1 text-right font-semibold"
										>
											Accent Charges
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-green-100 px-1 py-1 text-right font-semibold"
										>
											Amount
										</th>
										<th
											colSpan={2}
											className="border border-black bg-yellow-300 px-1 py-1 text-center font-semibold"
										>
											P&amp;L
										</th>
									</tr>
									<tr>
										<th className="border border-black bg-orange-200 px-1 py-1 text-right font-semibold">
											After Deductions
										</th>
										<th className="border border-black bg-yellow-300 px-1 py-1 text-right font-semibold">
											TDS
										</th>
									</tr>
								</thead>
								<tbody>
									{data.rows.length === 0 ? (
										<tr style={{ height: '32px' }}>
											<td
												colSpan={12}
												className="border border-black px-2 py-2 text-center text-gray-500"
											>
												No manhours logged on this project in {data.month_label}
												.
											</td>
										</tr>
									) : (
										data.rows.map((row) => (
											<tr
												key={row.employee_id ?? row.sr_no}
												style={{ height: '22px' }}
											>
												<td className="border border-black bg-yellow-100 px-1 py-1 text-center tabular-nums">
													{row.sr_no}
												</td>
												<td className="border border-black bg-yellow-100 px-1 py-1">
													{row.employee_name}
												</td>
												<td className="border border-black bg-yellow-100 px-1 py-1">
													{row.designation || '—'}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
													{fmtHours(row.total_manhours)}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.employee_charges)}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
													{formatNumber(row.amount)}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.tds)}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.net_payable)}
												</td>
												<td className="border border-black bg-green-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.accent_charges)}
												</td>
												<td className="border border-black bg-green-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.accent_amount)}
												</td>
												<td className="border border-black bg-orange-200 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.pnl_after_deductions)}
												</td>
												<td className="border border-black bg-yellow-300 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.pnl_tds)}
												</td>
											</tr>
										))
									)}
									<tr style={{ height: '24px' }}>
										<td
											colSpan={3}
											className="border border-black bg-yellow-100 px-2 py-1 text-right font-semibold"
										>
											Total
										</td>
										<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
											{fmtHours(data.totals.total_manhours)}
										</td>
										<td className="border border-black bg-blue-100 px-1 py-1" />
										<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
											{formatNumber(data.totals.total_amount)}
										</td>
										<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
											{formatNumber(data.totals.total_tds)}
										</td>
										<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
											{formatNumber(data.totals.total_net_payable)}
										</td>
										<td className="border border-black bg-green-100 px-1 py-1" />
										<td className="border border-black bg-green-100 px-1 py-1 text-right font-semibold tabular-nums">
											{formatNumber(data.totals.total_accent_amount)}
										</td>
										<td className="border border-black bg-orange-200 px-1 py-1 text-right font-semibold tabular-nums">
											{formatNumber(data.totals.total_pnl_after_deductions)}
										</td>
										<td className="border border-black bg-yellow-300 px-1 py-1 text-right font-semibold tabular-nums">
											{formatNumber(data.totals.total_pnl_tds)}
										</td>
									</tr>
								</tbody>
							</table>

							{/* Print-only footer (hidden on screen). */}
							<footer className="mhb-print-footer hidden print:flex">
								<span>
									Accent CRM — Manhours Billing Report — {data.client_name}
								</span>
								<span>Generated {generatedAt}</span>
							</footer>
						</section>
					</div>
				)}
			</main>
		</div>
	);
}
