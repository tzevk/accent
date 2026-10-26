'use client';

import { formatNumber } from '@/lib/format';
import { compactMonthLabel, projectKey, projectLabel } from './helpers';
import type { ProjectWiseMonthlySection } from '../types';

interface ProjectWiseMonthlyReportProps {
	sections: ProjectWiseMonthlySection[];
	month: string;
	monthLabel: string;
	totalCost: number;
	partial: boolean;
}

export function ProjectWiseMonthlyReport({
	sections,
	month,
	monthLabel: selectedMonthLabel,
	totalCost,
	partial,
}: ProjectWiseMonthlyReportProps) {
	if (sections.length === 0) {
		return (
			<div className="px-4 py-12 text-center">
				<p className="text-sm font-medium text-gray-700">
					No logged manhours for {selectedMonthLabel}
				</p>
				<p className="mt-1 text-xs text-gray-500">
					Hours come from daily activity logs.
				</p>
			</div>
		);
	}

	const columnWidths = ['12%', '45%', '14%', '14%', '15%'];

	return (
		<div className="cmc-project-wise-sheet min-w-[680px] bg-white font-[Arial,sans-serif] text-[13px] leading-tight text-black">
			{sections.map(({ project, rows }) => (
				<section
					key={`${projectKey(project.project_id, project.project_code, project.project_name)}-${project.sr_no}`}
					className="cmc-project-section mb-6"
				>
					<div className="cmc-project-meta grid grid-cols-[12%_minmax(0,1fr)] border border-black border-b-0">
						<div className="border-b border-black px-2 py-2 font-bold">
							Project No.:
						</div>
						<div className="border-b border-l border-black px-2 py-2 font-semibold">
							{projectLabel(project)}
						</div>
						<div className="border-b border-black px-2 py-2 font-bold">
							Project Name:
						</div>
						<div className="border-b border-l border-black px-2 py-2 font-semibold">
							{project.project_name || '—'}
						</div>
						<div className="border-b border-black px-2 py-2 font-bold">
							Client Name:
						</div>
						<div className="border-b border-l border-black px-2 py-2 font-semibold">
							{project.client_name || '—'}
						</div>
						<div className="px-2 py-2 font-bold">Month:</div>
						<div className="border-l border-black px-2 py-2 font-semibold">
							{compactMonthLabel(month)}
						</div>
					</div>

					<table className="w-full table-fixed border-collapse border border-black">
						<caption className="sr-only">
							Employee cost for {projectLabel(project)} in {selectedMonthLabel}
						</caption>
						<colgroup>
							{columnWidths.map((width, index) => (
								<col key={`project-column-${index}`} style={{ width }} />
							))}
						</colgroup>
						<thead>
							<tr>
								<th className="border border-black px-2 py-3 text-center font-bold text-[#64126D]">
									Sr. No.
								</th>
								<th className="border border-black px-2 py-3 text-left font-bold text-[#64126D]">
									Employee Name
								</th>
								<th className="border border-black px-2 py-3 text-right font-bold text-[#64126D]">
									Hourly Cost
								</th>
								<th className="border border-black px-2 py-3 text-right font-bold text-[#64126D]">
									Working Hours
								</th>
								<th className="border border-black px-2 py-3 text-right font-bold text-[#64126D]">
									Amount
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, rowIndex) => (
								<tr key={`${row.employee_id}-${row.sr_no}`}>
									<td className="border border-black px-2 py-1.5 text-center tabular-nums">
										{rowIndex + 1}
									</td>
									<td className="border border-black px-2 py-1.5 font-medium text-[#4A1254]">
										{row.employee_name}
										{row.missing_salary_profile && (
											<span className="mt-1 block text-[11px] font-normal text-amber-800">
												Salary Profile missing
											</span>
										)}
									</td>
									<td className="border border-black px-2 py-1.5 text-right tabular-nums">
										{row.hourly_rate > 0 ? formatNumber(row.hourly_rate) : '-'}
									</td>
									<td className="border border-black px-2 py-1.5 text-right tabular-nums">
										{formatNumber(row.hours).replace(/\.00$/, '')}
									</td>
									<td className="border border-black px-2 py-1.5 text-right font-semibold tabular-nums">
										{formatNumber(row.cost)}
										{row.missing_salary_profile && (
											<span className="mt-1 block text-[11px] font-normal text-amber-800">
												Unpriced placeholder
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr className="bg-[#8FD3ED]">
								<td
									colSpan={3}
									className="border border-black px-2 py-2 text-right text-base font-bold"
								>
									Total &gt;&gt;&gt;
								</td>
								<td className="border border-black px-2 py-2 text-right text-base font-bold tabular-nums">
									{formatNumber(project.hours).replace(/\.00$/, '')}
								</td>
								<td className="border border-black px-2 py-2 text-right text-base font-bold tabular-nums">
									{formatNumber(project.cost)}
									{project.missing_salary_profile_count > 0 && (
										<span className="mt-1 block text-[11px] font-normal text-amber-800">
											Partial cost
										</span>
									)}
								</td>
							</tr>
						</tfoot>
					</table>
				</section>
			))}

			<table className="w-full table-fixed border-collapse border border-black">
				<caption className="sr-only">Total amount for all projects</caption>
				<colgroup>
					{columnWidths.map((width, index) => (
						<col key={`total-column-${index}`} style={{ width }} />
					))}
				</colgroup>
				<tfoot>
					<tr className="bg-[#B5E5A2]">
						<td
							colSpan={4}
							className="border border-black px-2 py-3 text-right text-base font-bold"
						>
							{partial
								? 'Available cost — partial'
								: 'Total Amount for All projects >>>'}
						</td>
						<td className="border border-black px-2 py-3 text-right text-base font-bold tabular-nums">
							{formatNumber(totalCost)}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	);
}
