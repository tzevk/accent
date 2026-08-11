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
import { formatCurrency } from '@/lib/format';
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
	monthly_salary_ctc: number;
	hourly_rate_ctc: number;
	total_manhours: number;
	amount: number;
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
	totals: { total_manhours: number; total_amount: number };
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

/** "2.5" → "2.50"; keeps amounts aligned in the grid. */
function fmtHours(hours: number): string {
	return hours.toFixed(2);
}

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
		<div className="min-h-screen bg-white text-black">
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
					<div className="mx-auto max-w-[1550px] overflow-x-auto">
						<section className="min-w-[900px] bg-white font-[Arial,sans-serif] text-[10px] leading-none text-black">
							{/* Header block: client / project / month, mirroring the template. */}
							<div className="grid grid-cols-[150px_minmax(0,1fr)] border border-black">
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
									<col style={{ width: '7%' }} />
									<col style={{ width: '24%' }} />
									<col style={{ width: '18%' }} />
									<col style={{ width: '15%' }} />
									<col style={{ width: '12%' }} />
									<col style={{ width: '12%' }} />
									<col style={{ width: '12%' }} />
								</colgroup>
								<thead>
									<tr className="h-[24px]">
										<th className="border border-black bg-gray-100 px-1 py-1 text-center font-semibold">
											Sr. No.
										</th>
										<th className="border border-black bg-gray-100 px-1 py-1 text-left font-semibold">
											Employee Name
										</th>
										<th className="border border-black bg-gray-100 px-1 py-1 text-left font-semibold">
											Designation
										</th>
										<th className="border border-black bg-gray-100 px-1 py-1 text-right font-semibold">
											Monthly Salary CTC
										</th>
										<th className="border border-black bg-gray-100 px-1 py-1 text-right font-semibold">
											Hourly Rate CTC
										</th>
										<th className="border border-black bg-gray-100 px-1 py-1 text-right font-semibold">
											Total Manhours
										</th>
										<th className="border border-black bg-gray-100 px-1 py-1 text-right font-semibold">
											Amount
										</th>
									</tr>
								</thead>
								<tbody>
									{data.rows.length === 0 ? (
										<tr style={{ height: '32px' }}>
											<td
												colSpan={7}
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
												<td className="border border-black px-1 py-1 text-center tabular-nums">
													{row.sr_no}
												</td>
												<td className="border border-black px-1 py-1">
													{row.employee_name}
												</td>
												<td className="border border-black px-1 py-1">
													{row.designation || '—'}
												</td>
												<td className="border border-black px-1 py-1 text-right tabular-nums">
													{formatCurrency(row.monthly_salary_ctc)}
												</td>
												<td className="border border-black px-1 py-1 text-right tabular-nums">
													{formatCurrency(row.hourly_rate_ctc)}
												</td>
												<td className="border border-black px-1 py-1 text-right tabular-nums">
													{fmtHours(row.total_manhours)}
												</td>
												<td className="border border-black px-1 py-1 text-right font-semibold tabular-nums">
													{formatCurrency(row.amount)}
												</td>
											</tr>
										))
									)}
									<tr style={{ height: '24px' }}>
										<td
											colSpan={5}
											className="border border-black px-2 py-1 text-right font-semibold"
										>
											Total
										</td>
										<td className="border border-black px-1 py-1 text-right font-semibold tabular-nums">
											{fmtHours(data.totals.total_manhours)}
										</td>
										<td className="border border-black px-1 py-1 text-right font-semibold tabular-nums">
											{formatCurrency(data.totals.total_amount)}
										</td>
									</tr>
								</tbody>
							</table>
						</section>
					</div>
				)}
			</main>
		</div>
	);
}
