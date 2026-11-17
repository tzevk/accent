'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
	DURATION_OPTIONS,
	SALARY_TYPE_OPTIONS,
	monthInputOf,
	type SalaryDraft,
} from '@/components/salary-profiles/salary-profile-form';

const INPUT_CLASS =
	'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600';
const CHECK_CLASS =
	'h-4 w-4 rounded border-gray-300 text-[#64126D] focus:ring-2 focus:ring-[#64126D] disabled:cursor-not-allowed';

function describedBy(id: string, error?: string, help?: string) {
	if (error) return `${id}-error`;
	if (help) return `${id}-help`;
	return undefined;
}

interface FieldShellProps {
	id: string;
	label: string;
	error?: string;
	help?: string;
	children: ReactNode;
	className?: string;
}

function FieldShell({
	id,
	label,
	error,
	help,
	children,
	className,
}: FieldShellProps) {
	return (
		<div className={cn('min-w-0', className)}>
			<label
				htmlFor={id}
				className="mb-1 block text-sm font-medium text-gray-700"
			>
				{label}
			</label>
			{children}
			{help && !error && (
				<p id={`${id}-help`} className="mt-1 text-xs text-gray-500">
					{help}
				</p>
			)}
			{error && (
				<p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">
					{error}
				</p>
			)}
		</div>
	);
}

export interface SalaryProfileFieldsProps {
	draft: SalaryDraft;
	errors: Record<string, string>;
	disabled: boolean;
	effectiveKind: 'date' | 'month';
	effectiveLabel: string;
	onChange: (patch: Partial<SalaryDraft>) => void;
}

/**
 * The full supported agreement field set, grouped for reading order. Every
 * stored setting the command accepts is present; recorded reference amounts
 * that payroll never prices from are shown in the editor's references panel
 * instead of here.
 */
export function SalaryProfileFields({
	draft,
	errors,
	disabled,
	effectiveKind,
	effectiveLabel,
	onChange,
}: SalaryProfileFieldsProps) {
	const isContract = draft.salary_type === 'contract';
	return (
		<div className="space-y-6">
			<fieldset className="rounded-xl border border-gray-200 bg-white p-4">
				<legend className="px-1 text-sm font-semibold text-gray-900">
					Agreement
				</legend>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					<FieldShell
						id="salary-type"
						label="Salary Type"
						error={errors.salary_type}
						help="Salary Type decides the pay stream: Contract is the Contract stream; every other supported type is Payroll."
					>
						<select
							id="salary-type"
							value={draft.salary_type}
							disabled={disabled}
							onChange={(event) =>
								onChange({ salary_type: event.target.value })
							}
							aria-invalid={Boolean(errors.salary_type)}
							aria-describedby={describedBy(
								'salary-type',
								errors.salary_type,
								'Salary Type decides the pay stream: Contract is the Contract stream; every other supported type is Payroll.'
							)}
							className={INPUT_CLASS}
						>
							{SALARY_TYPE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
							{!SALARY_TYPE_OPTIONS.some(
								(option) => option.value === draft.salary_type
							) && (
								<option value={draft.salary_type}>
									Stored type: {draft.salary_type} (unsupported)
								</option>
							)}
						</select>
					</FieldShell>

					<FieldShell
						id="salary-effective-from"
						label={effectiveLabel}
						error={errors.effective_from}
						help={
							effectiveKind === 'month'
								? 'Salary revisions start on the first day of a month.'
								: 'A first agreement may start on the verified joining date. Corrections keep the recorded start unless you deliberately move it.'
						}
					>
						<input
							id="salary-effective-from"
							type={effectiveKind === 'month' ? 'month' : 'date'}
							value={
								effectiveKind === 'month'
									? monthInputOf(draft.effective_from)
									: draft.effective_from
							}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									effective_from:
										effectiveKind === 'month'
											? event.target.value
												? `${event.target.value}-01`
												: ''
											: event.target.value,
								})
							}
							aria-invalid={Boolean(errors.effective_from)}
							aria-describedby={describedBy(
								'salary-effective-from',
								errors.effective_from
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-ctc"
						label="Monthly CTC"
						error={errors.employer_cost}
						help="The agreed monthly cost to company. Zero is a real agreed amount; leave it blank only when the CTC is genuinely not recorded."
					>
						<input
							id="salary-ctc"
							type="number"
							min="0"
							step="0.01"
							inputMode="decimal"
							value={draft.employer_cost}
							disabled={disabled}
							onWheel={(event) => event.currentTarget.blur()}
							onChange={(event) =>
								onChange({ employer_cost: event.target.value })
							}
							aria-invalid={Boolean(errors.employer_cost)}
							aria-describedby={describedBy(
								'salary-ctc',
								errors.employer_cost,
								'The agreed monthly cost to company. Zero is a real agreed amount; leave it blank only when the CTC is genuinely not recorded.'
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-std-hours"
						label="Standard daily hours"
						error={errors.std_hours_per_day}
						help="Multiplied by the selected month's working days to give Basis Hours."
					>
						<input
							id="salary-std-hours"
							type="number"
							min="0"
							step="0.01"
							value={draft.std_hours_per_day}
							disabled={disabled}
							onChange={(event) =>
								onChange({ std_hours_per_day: event.target.value })
							}
							aria-invalid={Boolean(errors.std_hours_per_day)}
							aria-describedby={describedBy(
								'salary-std-hours',
								errors.std_hours_per_day,
								"Multiplied by the selected month's working days to give Basis Hours."
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-std-working-days"
						label="Standard working days"
						error={errors.std_working_days}
						help="A stored assumption. Basis Hours use the payroll calendar's working days."
					>
						<input
							id="salary-std-working-days"
							type="number"
							min="1"
							max="31"
							step="1"
							value={draft.std_working_days}
							disabled={disabled}
							onChange={(event) =>
								onChange({ std_working_days: event.target.value })
							}
							aria-invalid={Boolean(errors.std_working_days)}
							aria-describedby={describedBy(
								'salary-std-working-days',
								errors.std_working_days
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-ot-multiplier"
						label="OT multiplier"
						error={errors.ot_multiplier}
					>
						<input
							id="salary-ot-multiplier"
							type="number"
							min="0.01"
							max="99.99"
							step="0.01"
							value={draft.ot_multiplier}
							disabled={disabled}
							onChange={(event) =>
								onChange({ ot_multiplier: event.target.value })
							}
							aria-invalid={Boolean(errors.ot_multiplier)}
							aria-describedby={describedBy(
								'salary-ot-multiplier',
								errors.ot_multiplier
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-da-year"
						label="DA year"
						error={errors.da_year}
						help="Optional. A new agreement defaults the DA policy year to the current year."
					>
						<input
							id="salary-da-year"
							type="number"
							min="1900"
							max="2100"
							step="1"
							value={draft.da_year}
							disabled={disabled}
							onChange={(event) => onChange({ da_year: event.target.value })}
							aria-invalid={Boolean(errors.da_year)}
							aria-describedby={describedBy('salary-da-year', errors.da_year)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-in-time"
						label="Standard in time"
						error={errors.std_in_time}
					>
						<input
							id="salary-in-time"
							type="time"
							value={draft.std_in_time}
							disabled={disabled}
							onChange={(event) =>
								onChange({ std_in_time: event.target.value })
							}
							aria-invalid={Boolean(errors.std_in_time)}
							aria-describedby={describedBy(
								'salary-in-time',
								errors.std_in_time
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>

					<FieldShell
						id="salary-out-time"
						label="Standard out time"
						error={errors.std_out_time}
					>
						<input
							id="salary-out-time"
							type="time"
							value={draft.std_out_time}
							disabled={disabled}
							onChange={(event) =>
								onChange({ std_out_time: event.target.value })
							}
							aria-invalid={Boolean(errors.std_out_time)}
							aria-describedby={describedBy(
								'salary-out-time',
								errors.std_out_time
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>
				</div>
			</fieldset>

			<fieldset className="rounded-xl border border-gray-200 bg-white p-4">
				<legend className="px-1 text-sm font-semibold text-gray-900">
					Allowances, deductions and applicability
				</legend>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					<FieldShell
						id="salary-other-allowances"
						label="Other allowances"
						error={errors.other_allowances}
						help="A stored agreed amount. Basic, DA, HRA, statutory deductions and applicability are set in the estimate section below."
					>
						<input
							id="salary-other-allowances"
							type="number"
							min="0"
							step="0.01"
							value={draft.other_allowances}
							disabled={disabled}
							onChange={(event) =>
								onChange({ other_allowances: event.target.value })
							}
							aria-invalid={Boolean(errors.other_allowances)}
							aria-describedby={describedBy(
								'salary-other-allowances',
								errors.other_allowances
							)}
							className={INPUT_CLASS}
						/>
					</FieldShell>
				</div>
				<p className="mt-3 text-xs text-gray-500">
					Component amounts and applicability flags live in the estimate
					section, where the shared payroll calculation derives them from the
					date-effective Component Rates. Only deliberate exceptions are stored
					on the agreement.
				</p>
				{errors.overrides && (
					<p className="mt-2 text-xs font-medium text-red-700">
						{errors.overrides}
					</p>
				)}
			</fieldset>

			<fieldset className="rounded-xl border border-gray-200 bg-white p-4">
				<legend className="px-1 text-sm font-semibold text-gray-900">
					Leave, loan and advance
				</legend>
				<p className="mb-3 text-xs text-gray-500">
					Privilege Leave usage and balance are attendance-derived and shown
					read-only below. Saving salary terms never writes that usage.
				</p>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					<FieldShell
						id="salary-pl-total"
						label="PL entitlement (days)"
						error={errors.pl_total}
						help="The contractual entitlement stored on the agreement."
					>
						<input
							id="salary-pl-total"
							type="number"
							min="0"
							max="365"
							step="1"
							value={draft.pl_total}
							disabled={disabled}
							onChange={(event) => onChange({ pl_total: event.target.value })}
							aria-invalid={Boolean(errors.pl_total)}
							aria-describedby={describedBy('salary-pl-total', errors.pl_total)}
							className={INPUT_CLASS}
						/>
					</FieldShell>
				</div>

				<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
						<label
							htmlFor="salary-loan-active"
							className="flex min-h-10 items-center gap-2 text-sm font-medium text-amber-900"
						>
							<input
								id="salary-loan-active"
								type="checkbox"
								checked={draft.loan_active}
								disabled={disabled}
								onChange={(event) =>
									onChange({ loan_active: event.target.checked })
								}
								className={CHECK_CLASS}
							/>
							Loan deduction
						</label>
						{draft.loan_active && (
							<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
								<FieldShell
									id="salary-loan-amount"
									label="Loan amount"
									error={errors.loan_amount}
								>
									<input
										id="salary-loan-amount"
										type="number"
										min="0"
										step="0.01"
										value={draft.loan_amount}
										disabled={disabled}
										onChange={(event) =>
											onChange({ loan_amount: event.target.value })
										}
										className={INPUT_CLASS}
									/>
								</FieldShell>
								<FieldShell
									id="salary-loan-emi"
									label="Loan EMI per month"
									error={errors.loan_amount_per_month}
								>
									<input
										id="salary-loan-emi"
										type="number"
										min="0"
										step="0.01"
										value={draft.loan_amount_per_month}
										disabled={disabled}
										onChange={(event) =>
											onChange({ loan_amount_per_month: event.target.value })
										}
										className={INPUT_CLASS}
									/>
								</FieldShell>
								<FieldShell
									id="salary-loan-months"
									label="Loan months"
									error={errors.loan_no_of_months}
								>
									<input
										id="salary-loan-months"
										type="number"
										min="0"
										step="1"
										value={draft.loan_no_of_months}
										disabled={disabled}
										onChange={(event) =>
											onChange({ loan_no_of_months: event.target.value })
										}
										className={INPUT_CLASS}
									/>
								</FieldShell>
								<FieldShell
									id="salary-loan-total"
									label="Loan total"
									error={errors.loan_total_amount}
									help="Calculated from EMI × months."
								>
									<input
										id="salary-loan-total"
										type="number"
										value={draft.loan_total_amount}
										readOnly
										className={cn(INPUT_CLASS, 'bg-gray-50')}
									/>
								</FieldShell>
							</div>
						)}
					</div>

					<div className="rounded-lg border border-green-200 bg-green-50/60 p-3">
						<label
							htmlFor="salary-advance-active"
							className="flex min-h-10 items-center gap-2 text-sm font-medium text-green-900"
						>
							<input
								id="salary-advance-active"
								type="checkbox"
								checked={draft.advance_active}
								disabled={disabled}
								onChange={(event) =>
									onChange({ advance_active: event.target.checked })
								}
								className={CHECK_CLASS}
							/>
							Advance deduction
						</label>
						{draft.advance_active && (
							<div className="mt-3">
								<FieldShell
									id="salary-advance-amount"
									label="Advance amount"
									error={errors.advance_amount}
								>
									<input
										id="salary-advance-amount"
										type="number"
										min="0"
										step="0.01"
										value={draft.advance_amount}
										disabled={disabled}
										onChange={(event) =>
											onChange({ advance_amount: event.target.value })
										}
										className={INPUT_CLASS}
									/>
								</FieldShell>
							</div>
						)}
					</div>
				</div>
			</fieldset>

			{isContract && (
				<fieldset className="rounded-xl border border-gray-200 bg-white p-4">
					<legend className="px-1 text-sm font-semibold text-gray-900">
						Contract terms
					</legend>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<FieldShell
							id="salary-contract-duration"
							label="Contract duration"
							error={errors.contract_duration}
						>
							<select
								id="salary-contract-duration"
								value={draft.contract_duration}
								disabled={disabled}
								onChange={(event) =>
									onChange({ contract_duration: event.target.value })
								}
								className={INPUT_CLASS}
							>
								{DURATION_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</FieldShell>
						<FieldShell
							id="salary-contract-end"
							label="Contract end date"
							error={errors.contract_end_date}
						>
							<input
								id="salary-contract-end"
								type="date"
								value={draft.contract_end_date}
								disabled={disabled}
								onChange={(event) =>
									onChange({ contract_end_date: event.target.value })
								}
								className={INPUT_CLASS}
							/>
						</FieldShell>
					</div>
					<p className="mt-3 text-xs text-gray-500">
						Contract pay still uses the agreed monthly CTC ÷ Basis Hours ×
						Logged Hours. A stored Contract amount is a reference only and is
						never an alternative pay base.
					</p>
				</fieldset>
			)}

			<fieldset className="rounded-xl border border-gray-200 bg-white p-4">
				<legend className="px-1 text-sm font-semibold text-gray-900">
					Remarks
				</legend>
				<div>
					<label
						htmlFor="salary-remarks"
						className="mb-1 block text-sm font-medium text-gray-700"
					>
						Remarks
					</label>
					<textarea
						id="salary-remarks"
						rows={3}
						maxLength={2000}
						value={draft.remarks}
						disabled={disabled}
						onChange={(event) => onChange({ remarks: event.target.value })}
						aria-invalid={Boolean(errors.remarks)}
						aria-describedby={
							errors.remarks ? 'salary-remarks-error' : undefined
						}
						className={cn(INPUT_CLASS, 'min-h-20')}
					/>
					{errors.remarks && (
						<p
							id="salary-remarks-error"
							className="mt-1 text-xs font-medium text-red-700"
						>
							{errors.remarks}
						</p>
					)}
				</div>
			</fieldset>
		</div>
	);
}
