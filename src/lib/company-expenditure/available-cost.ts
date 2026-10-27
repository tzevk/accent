import { add } from '@/lib/money';
import { rounded } from './totals';
import type {
	CompanyConversion,
	PayrollExpenditure,
	ReconciliationProjectRow,
} from './types';

type CompanyCost = {
	reporting_currency: string;
	currency: string | null;
	conversion: Pick<CompanyConversion, 'status'>;
	incurred_cost: number | null;
	groups: readonly { key: string; amount: number | null }[];
};

/** A presentation total, not recognized cost or a financial-close balance. */
export function availableMonthlyCost(
	company: CompanyCost,
	payroll: PayrollExpenditure
) {
	const currency = company.currency ?? company.reporting_currency;
	const confirmedSupported = company.conversion.status !== 'unsupported';
	const estimateCurrencySupported = payroll.currency === currency;
	const combine = (
		confirmed: number | null,
		estimate: number
	): number | null => {
		if (confirmed === null && !confirmedSupported) return null;
		if (estimate !== 0 && !estimateCurrencySupported) return null;
		return rounded(add(confirmed ?? 0, estimate));
	};
	const group = (key: string) =>
		company.groups.find((row) => row.key === key)?.amount ?? null;
	return {
		currency,
		amount: combine(company.incurred_cost, payroll.estimated_total),
		project: combine(
			group('incurred_project_cost'),
			payroll.estimated_allocated_total
		),
		overhead: combine(group('company_overhead'), 0),
		unallocated: combine(
			group('unallocated_cost'),
			payroll.estimated_unallocated_total
		),
		estimated: payroll.estimated_count > 0,
		partial: payroll.unpriced_count > 0,
		estimate_currency_supported:
			payroll.estimated_total === 0 || estimateCurrencySupported,
	};
}

/** Estimates replace missing recorded payroll; they never replace confirmed expenses. */
export function availableProjectCost(
	project: Pick<
		ReconciliationProjectRow,
		'incurred_cost' | 'estimated_employee_cost'
	>
): number {
	return rounded(add(project.incurred_cost, project.estimated_employee_cost));
}

export function availableEmployeeCost(
	project: Pick<
		ReconciliationProjectRow,
		'employee_cost' | 'estimated_employee_cost'
	>
): number {
	return rounded(add(project.employee_cost, project.estimated_employee_cost));
}

/** Payroll estimates have no foreign-exchange evidence. Never invent a conversion. */
export function availableReportingProjectCost(
	project: Pick<
		ReconciliationProjectRow,
		'currency' | 'converted_incurred_cost' | 'estimated_employee_cost'
	>,
	reportingCurrency: string
): number | null {
	if (
		project.converted_incurred_cost === null ||
		(project.estimated_employee_cost !== 0 &&
			project.currency !== reportingCurrency)
	)
		return null;
	return rounded(
		add(project.converted_incurred_cost, project.estimated_employee_cost)
	);
}
