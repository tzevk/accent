'use client';

import SalaryProfileSection, {
	enabled,
	num,
	type SalaryProfileRecord,
} from '@/components/employees/SalaryProfileSection';
import { formatCurrency } from '@/lib/format';
import { add, sub, toNumber } from '@/lib/money';
import type { EmployeeRecord } from '@/hooks/useEmployeeDirectory';

const parseJson = (value: unknown): Record<string, unknown> => {
	if (typeof value !== 'string' || !value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
};

/** The optional persisted total on a profile row, or null when absent. */
const storedTotal = (
	profile: SalaryProfileRecord,
	key: string
): number | null => {
	const value = profile[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = num(value);
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Inline salary summary: display-only view of persisted boundary values.
 * Totals come from the shared calculation boundary at save time; the local
 * sums below only cover legacy rows that lack persisted totals and must not
 * be mistaken for a second payroll truth.
 */
export function summarizeProfile(profile: SalaryProfileRecord) {
	const customData = parseJson(profile.lumpsum_description);
	const customComponents = Array.isArray(customData.custom_components)
		? (customData.custom_components as {
				name?: unknown;
				amount?: unknown;
				type?: unknown;
			}[])
		: [];
	const customComponentsTotal = toNumber(
		add(...customComponents.map((component) => num(component.amount)))
	);
	const loan =
		enabled(profile.loan_active) && num(profile.loan_amount_per_month) > 0
			? num(profile.loan_amount_per_month)
			: 0;
	const advance =
		enabled(profile.advance_active) && num(profile.advance_amount) > 0
			? num(profile.advance_amount)
			: 0;

	const basicDaTotal =
		num(profile.basic_da_total) ||
		toNumber(add(num(profile.basic), num(profile.da)));
	const totalEarnings =
		storedTotal(profile, 'total_earnings') ??
		toNumber(
			add(
				basicDaTotal,
				num(profile.hra),
				num(profile.conveyance),
				num(profile.call_allowance),
				num(profile.incentive),
				num(profile.other_allowances),
				num(profile.bonus),
				customComponentsTotal
			)
		);
	const totalDeductions =
		storedTotal(profile, 'total_deductions') ??
		toNumber(
			add(
				num(profile.pf_employee),
				num(profile.esic_employee),
				num(profile.pt),
				num(profile.mlwf),
				num(profile.retention),
				num(profile.tds),
				loan,
				advance
			)
		);
	const totalEmployerContributions =
		storedTotal(profile, 'employer_cost') !== null
			? null
			: toNumber(
					add(
						num(profile.pf_employer),
						num(profile.esic_employer),
						num(profile.mlwf_employer),
						num(profile.insurance)
					)
				);
	const netPay =
		storedTotal(profile, 'net_pay') ??
		toNumber(sub(totalEarnings, totalDeductions));

	const storedEmployerCost = storedTotal(profile, 'employer_cost');
	return {
		gross: num(profile.gross_salary),
		hourlyRate: num(profile.hourly_rate),
		ctc: num(customData.ctc) || storedEmployerCost || 0,
		employerContributions:
			storedEmployerCost !== null
				? toNumber(sub(storedEmployerCost, totalEarnings))
				: totalEmployerContributions!,
		basicDaTotal,
		totalEarnings,
		totalDeductions,
		netPay,
		loan,
		advance,
		hasLoan: loan > 0,
		hasAdvance: advance > 0,
		customComponents,
		loanTotalAmount: num(profile.loan_total_amount),
		loanNoOfMonths: num(profile.loan_no_of_months),
	};
}

/**
 * Inline salary panel: the expanded employee row's display-only view of a
 * persisted salary profile. Extracted from the old salary-profiles page so
 * the employee hub can offer it beside the master data list.
 */
export default function InlineSalaryPanel({
	employee,
	profile,
	loading,
	error,
	onOpenEditor,
}: {
	employee: EmployeeRecord;
	profile: SalaryProfileRecord | null | undefined;
	loading: boolean;
	error: string;
	onOpenEditor: (employee: EmployeeRecord) => void;
}) {
	if (loading) {
		return (
			<div className="py-6 text-center text-sm text-gray-500">
				Loading salary profile...
			</div>
		);
	}
	if (error) {
		return (
			<p role="alert" className="py-3 text-center text-sm text-red-700">
				{error}
			</p>
		);
	}
	if (!profile) {
		return (
			<div className="py-4 text-center">
				<p className="mb-2 text-sm text-gray-500">
					No salary profile found for this employee.
				</p>
				<button
					type="button"
					onClick={() => onOpenEditor(employee)}
					className="text-sm font-medium text-purple-600 hover:text-purple-800"
				>
					+ Add Salary Profile
				</button>
			</div>
		);
	}

	const summary = summarizeProfile(profile);
	const tile = (label: string, value: number, tone: string) => (
		<div className={`rounded-lg border p-3 text-center ${tone}`}>
			<p className="text-[10px] font-medium uppercase">{label}</p>
			<p className="text-lg font-bold">{formatCurrency(value)}</p>
		</div>
	);
	const row = (label: string, value: number) => (
		<div className="flex items-center justify-between text-sm" key={label}>
			<span className="text-gray-600">{label}</span>
			<span className="font-medium text-gray-900">{formatCurrency(value)}</span>
		</div>
	);

	return (
		<div className="space-y-3" data-testid={`inline-salary-${employee.id}`}>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
				{tile(
					'Hourly Rate',
					summary.hourlyRate,
					'border-yellow-200 bg-yellow-50 text-yellow-800'
				)}
				{tile('CTC', summary.ctc, 'border-blue-200 bg-blue-50 text-blue-800')}
				{tile(
					'Total Earnings',
					summary.totalEarnings,
					'border-green-200 bg-green-50 text-green-800'
				)}
				{tile(
					'Total Deductions',
					summary.totalDeductions,
					'border-red-200 bg-red-50 text-red-800'
				)}
				{tile(
					'Net Pay',
					summary.netPay,
					'border-purple-200 bg-purple-50 text-purple-800'
				)}
			</div>
			<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
				<div className="rounded-lg border border-green-200 bg-green-50/50 p-3">
					<p className="mb-2 text-xs font-semibold uppercase text-green-700">
						Earnings
					</p>
					<div className="space-y-1">
						{row('Basic + DA', summary.basicDaTotal)}
						{row('HRA', num(profile.hra))}
						{row('Conveyance', num(profile.conveyance))}
						{row('Call Allowance', num(profile.call_allowance))}
						{row('Incentive', num(profile.incentive))}
						{row('Other Allowances', num(profile.other_allowances))}
						{row('Bonus', num(profile.bonus))}
						{summary.customComponents.map((component, index) =>
							row(
								String(component.name || `Component ${index + 1}`),
								num(component.amount)
							)
						)}
					</div>
				</div>
				<div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
					<p className="mb-2 text-xs font-semibold uppercase text-red-700">
						Deductions
					</p>
					<div className="space-y-1">
						{row('PF (Employee)', num(profile.pf_employee))}
						{row('ESIC (Employee)', num(profile.esic_employee))}
						{row('Professional Tax', num(profile.pt))}
						{row('MLWF', num(profile.mlwf))}
						{row('Retention', num(profile.retention))}
						{row('TDS', num(profile.tds))}
						{summary.hasLoan && row('Loan EMI', summary.loan)}
						{summary.hasAdvance && row('Advance', summary.advance)}
					</div>
				</div>
				<div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
					<p className="mb-2 text-xs font-semibold uppercase text-blue-700">
						Employer / CTC
					</p>
					<div className="space-y-1">
						{row('PF (Employer)', num(profile.pf_employer))}
						{row('ESIC (Employer)', num(profile.esic_employer))}
						{row('MLWF (Employer)', num(profile.mlwf_employer))}
						{row('Insurance', num(profile.insurance))}
						{row('Total Employer Contributions', summary.employerContributions)}
						{row('CTC', summary.ctc)}
					</div>
				</div>
			</div>
			{profile.pl_total != null && (
				<div className="flex items-center gap-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-gray-600">
					<span className="font-medium text-indigo-800">Privilege Leave:</span>
					<span>Total: {String(num(profile.pl_total) || 21)}</span>
				</div>
			)}
			{(summary.hasLoan || summary.hasAdvance) && (
				<div className="flex flex-wrap gap-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
					{summary.hasLoan && (
						<span className="text-amber-800">
							Loan: {formatCurrency(summary.loan)}/month ×{' '}
							{summary.loanNoOfMonths} months (
							{formatCurrency(summary.loanTotalAmount)} total)
						</span>
					)}
					{summary.hasAdvance && (
						<span className="text-orange-800">
							Advance: {formatCurrency(summary.advance)}
						</span>
					)}
				</div>
			)}
			<div className="flex items-center justify-between text-xs text-gray-500">
				<span>
					Effective:{' '}
					{profile.effective_from
						? new Date(profile.effective_from).toLocaleDateString('en-IN')
						: 'N/A'}
					{profile.effective_to
						? ` → ${new Date(profile.effective_to).toLocaleDateString('en-IN')}`
						: ' → Ongoing'}
				</span>
				<button
					type="button"
					onClick={() => onOpenEditor(employee)}
					className="font-medium text-purple-600 hover:text-purple-800"
				>
					Edit Salary Profile →
				</button>
			</div>
		</div>
	);
}
