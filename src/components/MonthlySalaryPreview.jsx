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
	['tds', 'TDS'],
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
	['gratuity', 'Gratuity'],
	['pf_admin', 'PF Admin'],
	['edli', 'EDLI'],
];

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

function AmountList({ items, breakdown }) {
	return (
		<div className="space-y-2">
			{items.map(([key, label]) => (
				<AmountRow key={key} label={label} value={breakdown[key]} />
			))}
		</div>
	);
}

function ApplicabilityControl({ label, name, checked, onChange }) {
	return (
		<label className="flex min-h-6 items-center gap-2 text-sm text-gray-700">
			<input
				type="checkbox"
				name={name}
				checked={Boolean(checked)}
				onChange={(event) => onChange(name, event.target.checked)}
				className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500"
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
					<AmountList items={earnings} breakdown={breakdown} />
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
					<AmountList items={deductions} breakdown={breakdown} />
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
					<AmountList items={employerContributions} breakdown={breakdown} />
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
