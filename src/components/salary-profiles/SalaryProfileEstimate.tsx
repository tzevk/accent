'use client';

import MonthlySalaryPreview from '@/components/MonthlySalaryPreview';
import { usePayrollPreview } from '@/hooks/usePayrollPreview';
import { useSalaryComponentRates } from '@/hooks/useSalaryProfiles';
import { resolveSalaryCtc } from '@/lib/salary-ctc';
import { formatCurrency, formatNumber } from '@/lib/format';
import { toNumber } from '@/lib/money';
import type { SalaryTimelineDto } from '@/lib/salary-profile-commands';
import {
	APPLICABILITY_FIELDS,
	basisHoursFor,
	displayMonth,
	type ApplicabilityKey,
} from '@/components/salary-profiles/salary-profile-form';

export interface SalaryProfileEstimateProps {
	employeeId: number;
	month: string;
	basis: SalaryTimelineDto['basis'];
	stdHoursPerDay: string;
	scheduleDate: string;
	profile: Record<string, unknown>;
	editing: boolean;
	canOverride: boolean;
	overrideMode: boolean;
	overrides: Record<string, string>;
	onOverrideModeChange: (next: boolean) => void;
	onOverrideChange: (key: string, value: string) => void;
	onOverrideReset: (key: string) => void;
	onResetOverrides: () => void;
	onApplicabilityChange: (key: ApplicabilityKey, value: boolean) => void;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<dt className="text-sm text-gray-600">{label}</dt>
			<dd className="text-sm font-semibold text-gray-900">{value}</dd>
		</div>
	);
}

/**
 * The agreed CTC, Basis Hours and Logged Hours explanation plus the shared
 * payroll estimate. It never invents a gross or a component amount: the
 * calculation input is the draft/profile, and the deduction and employer
 * figures come from calculatePayroll through usePayrollPreview.
 */
export function SalaryProfileEstimate({
	employeeId,
	month,
	basis,
	stdHoursPerDay,
	scheduleDate,
	profile,
	editing,
	canOverride,
	overrideMode,
	overrides,
	onOverrideModeChange,
	onOverrideChange,
	onOverrideReset,
	onResetOverrides,
	onApplicabilityChange,
}: SalaryProfileEstimateProps) {
	const ctcResolution = resolveSalaryCtc(profile);
	const ctcAmount =
		ctcResolution.status === 'resolved' ? toNumber(ctcResolution.amount) : 0;
	const ratesQuery = useSalaryComponentRates(
		scheduleDate,
		ctcAmount,
		Boolean(scheduleDate)
	);
	const scheduleComponents = ratesQuery.data?.components ?? {};
	const { preview } = usePayrollPreview({
		employeeId,
		month,
		salaryProfile: profile,
		payrollSchedule: scheduleComponents,
		attendance: { standardWorkingDays: basis.working_days },
		overrides,
		includeBonus: true,
	});

	const basisHours = basisHoursFor(basis.working_days, stdHoursPerDay);
	const hoursPerDay = stdHoursPerDay.trim() || '—';
	const legacyFallback =
		ctcResolution.status === 'resolved' && ctcResolution.legacyFallback;
	const enabledApplicability = APPLICABILITY_FIELDS.filter(
		({ key }) => profile[key] === true || profile[key] === 1
	).map(({ label }) => label);

	const summaryRows = [
		{
			label: 'Monthly CTC used',
			value: preview ? formatCurrency(preview.ctc_used) : '—',
		},
		{
			label: 'Basis Hours',
			value: preview ? formatNumber(preview.basis_hours) : '—',
		},
		{
			label: 'Hourly Rate',
			value: preview ? formatCurrency(preview.hourly_rate) : '—',
		},
		{
			label: 'Logged Hours used',
			value: preview ? formatNumber(preview.logged_hours) : '—',
		},
		{
			label: 'Estimated gross',
			value: preview ? formatCurrency(preview.gross) : '—',
		},
		{
			label: 'Estimated deductions',
			value: preview ? formatCurrency(preview.total_deductions) : '—',
		},
		{
			label: 'Estimated net pay',
			value: preview ? formatCurrency(preview.net_pay) : '—',
		},
		{
			label: 'Computed employer cost',
			value: preview ? formatCurrency(preview.employer_cost) : '—',
		},
	];

	return (
		<section
			aria-labelledby="salary-estimate-heading"
			className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<h2
				id="salary-estimate-heading"
				className="text-lg font-semibold text-gray-900"
			>
				Estimated pay breakdown
			</h2>
			<p className="mt-1 text-sm text-gray-700">
				Basis Hours = {basis.working_days} working days × {hoursPerDay} hours
				per day = {basisHours ?? '—'} hours for {displayMonth(basis.month)}.
			</p>
			<p className="mt-1 text-xs text-gray-500">
				Basis Hours come from the selected month&apos;s payroll calendar
				(working days excluding Sundays and holidays) and the agreement&apos;s
				standard daily hours.
			</p>
			<p className="mt-2 text-sm text-gray-700">
				Hourly Rate = Monthly CTC ÷ Basis Hours. Estimated gross = Hourly Rate ×
				Logged Hours. Logged Hours come from Project Activity Assignments; this
				estimate assumes a full month of {basisHours ?? '—'} payable hours when
				no timesheet is recorded. Payroll uses the month&apos;s actual Logged
				Hours.
			</p>
			<p className="mt-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">
				Estimate only — not a generated Payroll Slip. Saving salary terms never
				regenerates a Payroll Slip and never rewrites recorded pay.
			</p>
			{legacyFallback && (
				<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
					No stored CTC. This estimate uses the legacy gross salary field as the
					CTC basis. Confirm an explicit monthly CTC before treating it as the
					agreed amount.
				</p>
			)}
			{ctcResolution.status === 'invalid' && (
				<p
					role="alert"
					className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
				>
					The stored monthly CTC cannot be used ({ctcResolution.reason}). No
					estimate is possible until an operator corrects it.
				</p>
			)}
			{ratesQuery.isError && (
				<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
					Component Rates could not be loaded for this date, so the estimate may
					not reflect every derived component: {ratesQuery.error?.message}
				</p>
			)}

			{editing ? (
				<div className="mt-4">
					<p className="mb-2 text-xs text-gray-500">
						Enable overrides only for an approved exception. The flags and
						component amounts below are stored on this agreement.
					</p>
					<MonthlySalaryPreview
						profile={profile}
						breakdown={preview}
						canOverride={canOverride}
						overrideMode={overrideMode}
						overrides={overrides}
						onOverrideModeChange={onOverrideModeChange}
						onOverrideChange={(name, value) => {
							if (typeof value === 'string') onOverrideChange(name, value);
						}}
						onOverrideReset={onOverrideReset}
						onResetOverrides={onResetOverrides}
						onApplicabilityChange={(name, value) => {
							const field = APPLICABILITY_FIELDS.find(
								({ key }) => key === name
							);
							if (field) onApplicabilityChange(field.key, value);
						}}
						scheduleLoading={ratesQuery.isFetching}
						scheduleError={
							ratesQuery.error instanceof Error ? ratesQuery.error?.message : ''
						}
					/>
				</div>
			) : (
				<div className="mt-4">
					{preview ? (
						<dl className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
							{summaryRows.map((row) => (
								<SummaryRow
									key={row.label}
									label={row.label}
									value={row.value}
								/>
							))}
						</dl>
					) : (
						<p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
							No monthly CTC is recorded on this agreement, so no estimate can
							be calculated. A zero CTC would show a zero estimate.
						</p>
					)}
					<p className="mt-2 text-xs text-gray-600">
						Applicability:{' '}
						{enabledApplicability.length
							? enabledApplicability.join(', ')
							: 'none enabled.'}
					</p>
				</div>
			)}
			<p className="mt-2 text-xs text-gray-500">
				The calculated employer cost adds statutory employer contributions; it
				is not the agreed monthly CTC.
			</p>
		</section>
	);
}
