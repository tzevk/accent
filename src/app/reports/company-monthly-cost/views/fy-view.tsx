'use client';

import Link from 'next/link';
import { formatNumber, formatCurrency } from '@/lib/format';
import type {
	BreakdownTab,
	FYCompanyCostData,
	FYCompanyRow,
	FYEmployeeRow,
	FYProjectRow,
	Metric,
} from '../types';

interface FyViewProps {
	data: FYCompanyCostData | null;
	totals: FYCompanyCostData['totals'] | undefined;
	breakdown: BreakdownTab;
	metric: Metric;
	rows: FYCompanyRow[];
	employeeRows: FYEmployeeRow[];
	projectRows: FYProjectRow[];
}

export function FyView({
	data,
	totals,
	breakdown,
	metric,
	rows,
	employeeRows,
	projectRows,
}: FyViewProps) {
	// fy view
	if (!data) {
		return (
			<div className="px-4 py-12 text-center text-sm text-gray-500">
				Select a financial year to view the company cost matrix.
			</div>
		);
	}
	if (breakdown === 'detailed') {
		if (rows.length === 0) {
			return (
				<div className="px-4 py-12 text-center">
					<p className="text-sm font-medium text-gray-700">
						No logged manhours in {data.fy_label}
					</p>
				</div>
			);
		}
		return (
			<table className="w-full min-w-[1300px] border-collapse text-sm leading-relaxed">
				<thead>
					<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
						<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Sr
						</th>
						<th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Employee
						</th>
						<th className="min-w-[180px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Project
						</th>
						<th className="min-w-[100px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Client
						</th>
						<th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Rate/Hr
						</th>
						{data.months.map((m) => (
							<th
								key={m}
								className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]"
							>
								{m}
							</th>
						))}
						<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Total Hrs
						</th>
						<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Total Cost
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200">
					{rows.map((r) => (
						<tr
							key={`${r.employee_id}-${r.project_id ?? r.project_code}-${r.sr_no}`}
							className="hover:bg-purple-50/40"
						>
							<td className="px-3 py-2.5 text-center tabular-nums text-gray-600">
								{r.sr_no}
							</td>
							<td className="px-3 py-2.5">
								<div className="font-medium text-[#4A1254]">
									{r.employee_name}
								</div>
								<div className="text-xs text-gray-600">
									{r.employee_code} {r.department ? `· ${r.department}` : ''}
								</div>
							</td>
							<td className="px-3 py-2.5">
								{r.project_id ? (
									<Link
										href={`/projects/${r.project_id}`}
										className="font-medium text-[#4A1254] hover:underline"
									>
										{r.project_code
											? `${r.project_code} – ${r.project_name}`
											: r.project_name}
									</Link>
								) : (
									<span className="font-medium text-[#4A1254]">
										{r.project_name}
									</span>
								)}
							</td>
							<td className="min-w-[180px] whitespace-normal break-words px-3 py-2.5 text-gray-700">
								{r.client_name || '—'}
							</td>
							<td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-700">
								{r.hourly_rate > 0 ? formatCurrency(r.hourly_rate) : '—'}
							</td>
							{data.month_keys.map((mKey) => {
								const v =
									(metric === 'cost'
										? r.monthly_cost[mKey]
										: r.monthly_hours[mKey]) || 0;
								return (
									<td
										key={mKey}
										className={`px-3 py-2.5 text-right font-mono tabular-nums ${v > 0 ? 'text-gray-900' : 'text-gray-500'}`}
									>
										{v > 0
											? metric === 'hours'
												? formatNumber(v).replace(/\.00$/, '')
												: formatCurrency(v)
											: '—'}
									</td>
								);
							})}
							<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-gray-900">
								{formatNumber(r.total_hours).replace(/\.00$/, '')}
							</td>
							<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[#64126D]">
								{formatCurrency(r.total_cost)}
							</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
						<td
							colSpan={5}
							className="px-3 py-2.5 text-right text-sm uppercase text-[#4A1254]"
						>
							Full-year company total ({metric})
						</td>
						{data.month_keys.map((mKey) => {
							const v =
								(metric === 'cost'
									? totals?.monthly_cost[mKey]
									: totals?.monthly_hours[mKey]) || 0;
							return (
								<td
									key={mKey}
									className="px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]"
								>
									{v > 0
										? metric === 'hours'
											? formatNumber(v).replace(/\.00$/, '')
											: formatCurrency(v)
										: '—'}
								</td>
							);
						})}
						<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
							{formatNumber(totals?.total_hours ?? 0).replace(/\.00$/, '')}
						</td>
						<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
							{formatCurrency(totals?.total_cost ?? 0)}
						</td>
					</tr>
				</tfoot>
			</table>
		);
	}
	if (breakdown === 'byEmployee') {
		if (employeeRows.length === 0) {
			return (
				<div className="px-4 py-12 text-center text-sm text-gray-500">
					No employee data for {data.fy_label}
				</div>
			);
		}
		return (
			<table className="w-full min-w-[1200px] border-collapse text-sm leading-relaxed">
				<thead>
					<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
						<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Sr
						</th>
						<th className="min-w-[180px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Employee
						</th>
						<th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Dept
						</th>
						<th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Rate/Hr
						</th>
						{data.months.map((m) => (
							<th
								key={m}
								className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]"
							>
								{m}
							</th>
						))}
						<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Total Hrs
						</th>
						<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Total Cost
						</th>
						<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Projects
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200">
					{employeeRows.map((r) => (
						<tr key={r.employee_id} className="hover:bg-purple-50/40">
							<td className="px-3 py-2.5 text-center tabular-nums text-gray-600">
								{r.sr_no}
							</td>
							<td className="px-3 py-2.5">
								<div className="font-medium text-[#4A1254]">
									{r.employee_name}
								</div>
								<div className="text-xs text-gray-600">{r.employee_code}</div>
							</td>
							<td className="px-3 py-2.5 text-gray-700">
								{r.department || '—'}
							</td>
							<td className="px-3 py-2.5 text-right font-mono tabular-nums">
								{r.hourly_rate > 0 ? formatCurrency(r.hourly_rate) : '—'}
							</td>
							{data.month_keys.map((mKey) => {
								const v =
									(metric === 'cost'
										? r.monthly_cost[mKey]
										: r.monthly_hours[mKey]) || 0;
								return (
									<td
										key={mKey}
										className={`px-3 py-2.5 text-right font-mono tabular-nums ${v > 0 ? 'text-gray-900' : 'text-gray-500'}`}
									>
										{v > 0
											? metric === 'hours'
												? formatNumber(v).replace(/\.00$/, '')
												: formatCurrency(v)
											: '—'}
									</td>
								);
							})}
							<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
								{formatNumber(r.total_hours).replace(/\.00$/, '')}
							</td>
							<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[#64126D]">
								{formatCurrency(r.total_cost)}
							</td>
							<td className="px-3 py-2.5 text-center tabular-nums">
								{r.project_count}
							</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
						<td
							colSpan={4}
							className="px-3 py-2.5 text-right text-sm uppercase text-[#4A1254]"
						>
							Full-year company total ({metric})
						</td>
						{data.month_keys.map((mKey) => {
							const v =
								(metric === 'cost'
									? totals?.monthly_cost[mKey]
									: totals?.monthly_hours[mKey]) || 0;
							return (
								<td
									key={mKey}
									className="px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]"
								>
									{v > 0
										? metric === 'hours'
											? formatNumber(v).replace(/\.00$/, '')
											: formatCurrency(v)
										: '—'}
								</td>
							);
						})}
						<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
							{formatNumber(totals?.total_hours ?? 0).replace(/\.00$/, '')}
						</td>
						<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
							{formatCurrency(totals?.total_cost ?? 0)}
						</td>
						<td className="px-3 py-2.5 text-center tabular-nums text-[#4A1254]">
							{data.summary.employee_count}
						</td>
					</tr>
				</tfoot>
			</table>
		);
	}
	// byProject
	if (projectRows.length === 0) {
		return (
			<div className="px-4 py-12 text-center text-sm text-gray-500">
				No project data for {data.fy_label}
			</div>
		);
	}
	return (
		<table className="w-full min-w-[1200px] border-collapse text-sm leading-relaxed">
			<thead>
				<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
					<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Sr
					</th>
					<th className="min-w-[200px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Project
					</th>
					<th className="min-w-[180px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Client
					</th>
					{data.months.map((m) => (
						<th
							key={m}
							className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]"
						>
							{m}
						</th>
					))}
					<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Total Hrs
					</th>
					<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Total Cost
					</th>
					<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Employees
					</th>
				</tr>
			</thead>
			<tbody className="divide-y divide-gray-200">
				{projectRows.map((r) => (
					<tr
						key={`${r.project_id ?? r.project_code}-${r.sr_no}`}
						className="hover:bg-purple-50/40"
					>
						<td className="px-3 py-2.5 text-center tabular-nums text-gray-600">
							{r.sr_no}
						</td>
						<td className="px-3 py-2.5">
							{r.project_id ? (
								<Link
									href={`/projects/${r.project_id}`}
									className="font-medium text-[#4A1254] hover:underline"
								>
									{r.project_code
										? `${r.project_code} – ${r.project_name}`
										: r.project_name}
								</Link>
							) : (
								<span className="font-medium text-[#4A1254]">
									{r.project_name}
								</span>
							)}
						</td>
						<td className="min-w-[180px] whitespace-normal break-words px-3 py-2.5 text-gray-700">
							{r.client_name || '—'}
						</td>
						{data.month_keys.map((mKey) => {
							const v =
								(metric === 'cost'
									? r.monthly_cost[mKey]
									: r.monthly_hours[mKey]) || 0;
							return (
								<td
									key={mKey}
									className={`px-3 py-2.5 text-right font-mono tabular-nums ${v > 0 ? 'text-gray-900' : 'text-gray-500'}`}
								>
									{v > 0
										? metric === 'hours'
											? formatNumber(v).replace(/\.00$/, '')
											: formatCurrency(v)
										: '—'}
								</td>
							);
						})}
						<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
							{formatNumber(r.total_hours).replace(/\.00$/, '')}
						</td>
						<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[#64126D]">
							{formatCurrency(r.total_cost)}
						</td>
						<td className="px-3 py-2.5 text-center tabular-nums">
							{r.employee_count}
						</td>
					</tr>
				))}
			</tbody>
			<tfoot>
				<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
					<td
						colSpan={3}
						className="px-3 py-2.5 text-right text-sm uppercase text-[#4A1254]"
					>
						Full-year company total ({metric})
					</td>
					{data.month_keys.map((mKey) => {
						const v =
							(metric === 'cost'
								? totals?.monthly_cost[mKey]
								: totals?.monthly_hours[mKey]) || 0;
						return (
							<td
								key={mKey}
								className="px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]"
							>
								{v > 0
									? metric === 'hours'
										? formatNumber(v).replace(/\.00$/, '')
										: formatCurrency(v)
									: '—'}
							</td>
						);
					})}
					<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
						{formatNumber(totals?.total_hours ?? 0).replace(/\.00$/, '')}
					</td>
					<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
						{formatCurrency(totals?.total_cost ?? 0)}
					</td>
					<td className="px-3 py-2.5 text-center tabular-nums text-[#4A1254]">
						{data.summary.employee_count}
					</td>
				</tr>
			</tfoot>
		</table>
	);
}
