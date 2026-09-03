import { formatCurrency } from '@/lib/format';

const earnings = [
	['basic', 'Basic'],
	['da', 'DA'],
	['hra', 'HRA'],
	['conveyance', 'Conveyance'],
	['call_allowance', 'Call Allowance'],
	['incentive', 'Incentive'],
	['other_allowances', 'Other Allowances'],
];

const deductions = [
	['pf_employee', 'Employee PF'],
	['esic_employee', 'Employee ESIC'],
	['pt', 'Professional Tax'],
	['mlwf', 'MLWF'],
	['retention', 'Retention'],
	['tds_percentage', 'TDS'],
];

const calculatedDeductions = [
	['lwf', 'LWF'],
	['loan_recovery', 'Loan Recovery'],
	['advance_deduction', 'Advance'],
];

const employerContributions = [
	['pf_employer', 'Employer PF'],
	['esic_employer', 'Employer ESIC'],
	['mlwf_employer', 'Employer MLWF'],
	['bonus', 'Bonus'],
	['insurance', 'Insurance'],
];

const calculatedEmployerContributions = [
	['gratuity', 'Gratuity'],
	['pf_admin', 'PF Admin'],
	['edli', 'EDLI'],
];

const hasOverride = (overrides, key) =>
	overrides && overrides[key] !== undefined && overrides[key] !== null;

function AmountRow({ label, value, emphasis = false }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-sm text-gray-600">{label}</span>
			<output
				className={emphasis ? 'font-semibold text-gray-900' : 'text-gray-900'}
			>
				{formatCurrency(value)}
			</output>
		</div>
	);
}

function OverrideRow({
	label,
	keyName,
	value,
	overrides,
	onChange,
	onReset,
	percentage = false,
}) {
	const overridden =
		hasOverride(overrides, keyName) && overrides[keyName] !== '';
	const inputId = `salary-override-${keyName}`;
	const inputValue = hasOverride(overrides, keyName)
		? overrides[keyName]
		: (value ?? '');

	return (
		<div
			className={`rounded-lg border px-2.5 py-2 ${
				overridden ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
			}`}
		>
			<div className="mb-1 flex items-center justify-between gap-2">
				<label htmlFor={inputId} className="text-sm text-gray-700">
					{label}
				</label>
				<span
					className={`text-[10px] font-semibold uppercase tracking-wide ${
						overridden ? 'text-amber-700' : 'text-gray-500'
					}`}
				>
					{overridden ? 'Overridden' : 'Derived'}
				</span>
			</div>
			<div className="flex items-center gap-2">
				<div className="relative min-w-0 flex-1">
					<input
						id={inputId}
						type="number"
						min="0"
						step="0.01"
						value={inputValue}
						onChange={(event) => onChange(keyName, event.target.value)}
						aria-label={`${label} override value`}
						className="min-h-10 w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 pr-10 text-right text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
					/>
					{percentage && (
						<span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-gray-500">
							%
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={() => onReset(keyName)}
					disabled={!overridden}
					className="min-h-10 rounded-md px-2 text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-2 hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
					aria-label={`Reset ${label} to derived value`}
				>
					Reset
				</button>
			</div>
			<p className="mt-1 text-right text-xs text-gray-500">
				{percentage
					? `Calculated amount: ${formatCurrency(value)}`
					: `Calculated: ${formatCurrency(value)}`}
			</p>
		</div>
	);
}

function AmountList({
	items,
	breakdown,
	overrideMode,
	overrides,
	onOverrideChange,
	onOverrideReset,
}) {
	return (
		<div className="space-y-2">
			{items.map(([key, label]) =>
				overrideMode ? (
					<OverrideRow
						key={key}
						keyName={key}
						label={label}
						value={breakdown[key]}
						overrides={overrides}
						onChange={onOverrideChange}
						onReset={onOverrideReset}
					/>
				) : (
					<AmountRow key={key} label={label} value={breakdown[key]} />
				)
			)}
		</div>
	);
}

function ApplicabilityControl({ label, name, checked, onChange }) {
	return (
		<label className="flex min-h-10 items-center gap-2 text-sm text-gray-700">
			<input
				type="checkbox"
				name={name}
				checked={Boolean(checked)}
				onChange={(event) => onChange(name, event.target.checked)}
				className="h-4 w-4 rounded text-purple-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
			/>
			{label}
		</label>
	);
}

export default function MonthlySalaryPreview({
	profile = {},
	breakdown,
	scheduleLoading = false,
	scheduleError = '',
	onApplicabilityChange = () => {},
	canOverride = false,
	overrideMode = false,
	overrides = {},
	onOverrideModeChange = () => {},
	onOverrideChange = () => {},
	onOverrideReset = () => {},
	onResetOverrides = () => {},
}) {
	if (!breakdown) {
		return (
			<div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
				Enter a gross salary to preview the calculated breakdown.
			</div>
		);
	}

	return (
		<div className="space-y-4" aria-live="polite">
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-800">
				<span>Derived from the effective payroll schedule</span>
				{scheduleLoading && <span role="status">Loading schedule…</span>}
				{scheduleError && (
					<span className="text-red-700" role="status">
						{scheduleError}
					</span>
				)}
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
				<div>
					<p className="text-sm font-semibold text-gray-900">
						Salary component values
					</p>
					<p className="text-xs text-gray-500">
						{overrideMode
							? 'Edit only the components that need an exception. Reset any component to return it to the schedule.'
							: 'Values are calculated. Enable overrides only for an approved exception.'}
					</p>
				</div>
				{canOverride ? (
					<div className="flex flex-wrap items-center gap-3">
						<label className="flex min-h-10 items-center gap-2 text-sm font-medium text-gray-800">
							<input
								type="checkbox"
								checked={overrideMode}
								onChange={(event) => onOverrideModeChange(event.target.checked)}
								className="h-4 w-4 rounded text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
							/>
							Enable overrides
						</label>
						{overrideMode && (
							<button
								type="button"
								onClick={onResetOverrides}
								disabled={!Object.keys(overrides).length}
								className="min-h-10 rounded-md border border-amber-300 px-3 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
							>
								Reset all to derived
							</button>
						)}
					</div>
				) : (
					<span className="text-xs text-gray-500">
						Override access is restricted to payroll operators.
					</span>
				)}
			</div>

			<div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-gray-200 bg-white p-3">
				{[
					['pf_applicable', 'PF'],
					['esic_applicable', 'ESIC'],
					['pt_applicable', 'Professional Tax'],
					['mlwf_applicable', 'MLWF'],
					['retention_applicable', 'Retention'],
					['bonus_applicable', 'Bonus'],
					['monthly_bonus', 'Monthly Bonus'],
					['incentive_applicable', 'Incentive'],
					['insurance_applicable', 'Insurance'],
				].map(([name, label]) => (
					<ApplicabilityControl
						key={name}
						name={name}
						label={label}
						checked={profile[name]}
						onChange={onApplicabilityChange}
					/>
				))}
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<section
					className="rounded-xl border border-green-200 bg-green-50 p-4"
					aria-labelledby="salary-earnings-heading"
				>
					<h5
						id="salary-earnings-heading"
						className="mb-3 text-sm font-semibold text-green-800"
					>
						Earnings
					</h5>
					<AmountList
						items={earnings}
						breakdown={breakdown}
						overrideMode={overrideMode}
						overrides={overrides}
						onOverrideChange={onOverrideChange}
						onOverrideReset={onOverrideReset}
					/>
					<div className="mt-3 border-t border-green-300 pt-2">
						<AmountRow
							label="Total Earnings"
							value={breakdown.total_earnings}
							emphasis
						/>
					</div>
				</section>

				<section
					className="rounded-xl border border-red-200 bg-red-50 p-4"
					aria-labelledby="salary-deductions-heading"
				>
					<h5
						id="salary-deductions-heading"
						className="mb-3 text-sm font-semibold text-red-800"
					>
						Deductions
					</h5>
					<div className="space-y-2">
						{deductions.map(([key, label]) =>
							overrideMode ? (
								<OverrideRow
									key={key}
									keyName={key}
									label={label}
									value={
										key === 'tds_percentage'
											? breakdown.tds_percentage
											: breakdown[key]
									}
									overrides={overrides}
									onChange={onOverrideChange}
									onReset={onOverrideReset}
									percentage={key === 'tds_percentage'}
								/>
							) : (
								<AmountRow
									key={key}
									label={label}
									value={
										key === 'tds_percentage' ? breakdown.tds : breakdown[key]
									}
								/>
							)
						)}
						{calculatedDeductions.map(([key, label]) => (
							<AmountRow key={key} label={label} value={breakdown[key]} />
						))}
					</div>
					<div className="mt-3 border-t border-red-300 pt-2">
						<AmountRow
							label="Total Deductions"
							value={breakdown.total_deductions}
							emphasis
						/>
					</div>
					<div className="mt-3 border-t-2 border-green-400 pt-2">
						<AmountRow label="Net Pay" value={breakdown.net_pay} emphasis />
					</div>
				</section>

				<section
					className="rounded-xl border border-blue-200 bg-blue-50 p-4"
					aria-labelledby="salary-employer-heading"
				>
					<h5
						id="salary-employer-heading"
						className="mb-3 text-sm font-semibold text-blue-800"
					>
						Employer Cost / CTC
					</h5>
					<AmountList
						items={employerContributions}
						breakdown={breakdown}
						overrideMode={overrideMode}
						overrides={overrides}
						onOverrideChange={onOverrideChange}
						onOverrideReset={onOverrideReset}
					/>
					<div className="mt-2 space-y-2">
						{calculatedEmployerContributions.map(([key, label]) => (
							<AmountRow key={key} label={label} value={breakdown[key]} />
						))}
					</div>
					<div className="mt-3 border-t border-blue-300 pt-2">
						<AmountRow
							label="Total Employer Contributions"
							value={breakdown.total_employer_contributions}
							emphasis
						/>
					</div>
					<div className="mt-3 border-t-2 border-blue-400 pt-2">
						<AmountRow
							label="Total CTC"
							value={breakdown.employer_cost}
							emphasis
						/>
					</div>
				</section>
			</div>
		</div>
	);
}
