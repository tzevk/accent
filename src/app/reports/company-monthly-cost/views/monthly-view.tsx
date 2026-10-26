'use client';

import Link from 'next/link';
import { formatNumber, formatCurrency } from '@/lib/format';
import { ProjectWiseMonthlyReport } from './project-wise-monthly-report';
import type {
	BreakdownTab,
	MonthlyCompanyCostData,
	MonthlyEmployeeRow,
	MonthlyProjectRow,
	ProjectWiseMonthlySection,
} from '../types';

interface MonthlyViewProps {
	data: MonthlyCompanyCostData | null;
	totals: MonthlyCompanyCostData['totals'] | undefined;
	breakdown: BreakdownTab;
	employeeRows: MonthlyEmployeeRow[];
	projectRows: MonthlyProjectRow[];
	sections: ProjectWiseMonthlySection[];
}

export function MonthlyView({
	data,
	totals,
	breakdown,
	employeeRows,
	projectRows,
	sections,
}: MonthlyViewProps) {
	if (!data) {
		return (
			<div className="px-4 py-12 text-center text-sm text-gray-500">
				Select a month to view company cost.
			</div>
		);
	}
	if (breakdown === 'detailed') {
		return (
			<ProjectWiseMonthlyReport
				sections={sections}
				month={data.month}
				monthLabel={data.month_label}
				totalCost={data.totals.total_cost}
				partial={data.payroll.missing_pricing_count > 0}
			/>
		);
	}
	if (breakdown === 'byEmployee') {
		if (employeeRows.length === 0) {
			return (
				<div className="px-4 py-12 text-center text-sm text-gray-500">
					No data for {data.month_label}
				</div>
			);
		}
		return (
			<table className="w-full min-w-[800px] border-collapse text-sm leading-relaxed">
				<thead>
					<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
						<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Sr
						</th>
						<th className="min-w-[200px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Employee
						</th>
						<th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Department
						</th>
						<th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Designation
						</th>
						<th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Rate/Hr
						</th>
						<th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Hours
						</th>
						<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
							Cost
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
							<td className="px-3 py-2.5 text-gray-700">
								{r.designation || '—'}
							</td>
							<td className="px-3 py-2.5 text-right font-mono tabular-nums">
								{r.hourly_rate > 0 ? formatCurrency(r.hourly_rate) : '—'}
							</td>
							<td className="px-3 py-2.5 text-right font-mono tabular-nums">
								{formatNumber(r.hours).replace(/\.00$/, '')}
							</td>
							<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[#64126D]">
								{formatCurrency(r.cost)}
								{r.missing_salary_profile && (
									<span className="mt-1 block font-sans text-xs font-medium text-amber-900">
										Unpriced · Salary Profile missing
									</span>
								)}
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
							colSpan={5}
							className="px-3 py-2.5 text-right text-sm uppercase text-[#4A1254]"
						>
							{data.payroll.missing_pricing_count > 0
								? 'Employee cost — partial · full-period total'
								: 'Full-period grand total'}
						</td>
						<td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
							{formatNumber(totals?.total_hours ?? 0).replace(/\.00$/, '')}
						</td>
						<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
							{formatCurrency(totals?.total_cost ?? 0)}
						</td>
						<td className="px-3 py-2.5 text-center tabular-nums text-[#4A1254]">
							{totals?.project_count ?? 0}
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
				No project data for {data.month_label}
			</div>
		);
	}
	return (
		<table className="w-full min-w-[700px] border-collapse text-sm leading-relaxed">
			<thead>
				<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
					<th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Sr
					</th>
					<th className="min-w-[220px] px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Project
					</th>
					<th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Client
					</th>
					<th className="px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Hours
					</th>
					<th className="bg-[#64126D]/20 px-3 py-2.5 text-right text-xs font-bold uppercase tracking-wide text-[#64126D]">
						Cost
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
						<td className="px-3 py-2.5 text-gray-700">
							{r.client_name || '—'}
						</td>
						<td className="px-3 py-2.5 text-right font-mono tabular-nums">
							{formatNumber(r.hours).replace(/\.00$/, '')}
						</td>
						<td className="bg-purple-50/60 px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[#64126D]">
							{formatCurrency(r.cost)}
							{r.missing_salary_profile_count > 0 && (
								<span className="mt-1 block font-sans text-xs font-medium text-amber-900">
									Partial · {r.missing_salary_profile_count} missing Salary
									Profile(s)
								</span>
							)}
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
						{data.payroll.missing_pricing_count > 0
							? 'Employee cost — partial · full-period total'
							: 'Full-period grand total'}
					</td>
					<td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
						{formatNumber(totals?.total_hours ?? 0).replace(/\.00$/, '')}
					</td>
					<td className="bg-[#64126D]/20 px-3 py-2.5 text-right font-mono tabular-nums text-[#4A1254]">
						{formatCurrency(totals?.total_cost ?? 0)}
					</td>
					<td className="px-3 py-2.5 text-center tabular-nums text-[#4A1254]">
						{totals?.employee_count ?? 0}
					</td>
				</tr>
			</tfoot>
		</table>
	);
}
