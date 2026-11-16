'use client';

import {
	SALARY_COVERAGE_CODES,
	salaryCauseSentence,
	salaryGapCauses,
} from '../salary-display/salary-display';
import type { MonthlyCompanyCostData } from '../types';

interface SalaryDisclosureProps {
	data: MonthlyCompanyCostData;
}

/**
 * The month's salary evidence, stated once: which rows have no usable salary
 * terms and why, which amounts rest on a legacy gross basis, and which rows are
 * recorded without consulting today's salary. Amounts stay the payload's;
 * this component never prices anything.
 */
export function SalaryDisclosure({ data }: SalaryDisclosureProps) {
	const causes = salaryGapCauses(data.salary);
	const gapTotal = causes.reduce((sum, cause) => sum + cause.count, 0);
	const notices = data.coverage.filter(
		(notice) => SALARY_COVERAGE_CODES[notice.code] !== undefined
	);
	const affected = data.employee_rows.filter(
		(row) =>
			salaryCauseSentence(row.salary.availability, row.salary.conflict_ids) !==
			null
	);
	const legacy = data.salary.legacy_fallback_count;
	const recorded = data.salary.recorded_count;
	const notConsulted = data.salary.not_consulted_count;
	if (
		gapTotal === 0 &&
		legacy === 0 &&
		recorded === 0 &&
		notConsulted === 0 &&
		notices.length === 0
	) {
		return null;
	}

	const populationNotes = (
		<>
			{recorded > 0 && (
				<p className="mt-2">
					{recorded} employee(s) are recorded from frozen Payroll Finalize
					allocations; live salary was not consulted.
				</p>
			)}
			{notConsulted > 0 && (
				<p className="mt-2">
					{notConsulted} employee(s) are in locked months priced from other
					evidence; live salary was not consulted.
				</p>
			)}
		</>
	);

	if (gapTotal === 0 && legacy === 0 && notices.length === 0) {
		return (
			<p className="mx-auto mb-3 max-w-[1600px] text-xs text-gray-600">
				{recorded > 0 &&
					`${recorded} employee(s) are recorded from frozen Payroll Finalize allocations; live salary was not consulted.`}
				{notConsulted > 0 &&
					` ${notConsulted} employee(s) are in locked months priced from other evidence; live salary was not consulted.`}
			</p>
		);
	}

	return (
		<section
			aria-label={`Salary disclosure for ${data.month_label}`}
			role="status"
			className="mx-auto mb-3 max-w-[1600px] rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
		>
			<p className="font-semibold">
				{gapTotal > 0
					? `Partial employee cost for ${data.month_label}`
					: `Salary basis for ${data.month_label}`}
			</p>
			{gapTotal > 0 && (
				<p className="mt-1">
					{gapTotal} employee(s) have no usable Salary Profile terms for this
					month. Their cost is shown as unavailable (—), not confirmed zero.
					Totals exclude them and are partial.
				</p>
			)}
			{notices.length > 0 ? (
				<ul className="mt-2 list-inside list-disc">
					{notices.map((notice) => (
						<li key={notice.code}>
							<span className="font-medium">{notice.label}</span>
							<span className="block">{notice.detail}</span>
						</li>
					))}
				</ul>
			) : (
				causes.length > 0 && (
					<ul className="mt-2 list-inside list-disc">
						{causes.map((cause) => (
							<li key={cause.availability}>
								{cause.countLabel}: {cause.count}
							</li>
						))}
					</ul>
				)
			)}
			{legacy > 0 && (
				<p className="mt-2">
					Legacy gross basis: {legacy} employee(s) are priced from recorded
					gross salary, not agreed CTC.
				</p>
			)}
			{populationNotes}
			{gapTotal > 0 && affected.length > 0 && (
				<details className="mt-2">
					<summary className="cursor-pointer font-medium underline underline-offset-2">
						Employees without usable salary terms
					</summary>
					<ul className="mt-2 list-inside list-disc">
						{affected.map((row) => (
							<li key={row.employee_id}>
								{row.employee_name} ({row.employee_code}) —{' '}
								{salaryCauseSentence(
									row.salary.availability,
									row.salary.conflict_ids
								)}
							</li>
						))}
					</ul>
				</details>
			)}
		</section>
	);
}
