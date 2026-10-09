import type { SupplierSplitInput } from '@/lib/company-expenditure';

/** Map a supplier service-period slice from the HTTP field names. */
export function splitInput(split: Record<string, unknown>): SupplierSplitInput {
	return {
		servicePeriodStart:
			split.service_period_start === undefined
				? undefined
				: (split.service_period_start as string | null),
		servicePeriodEnd:
			split.service_period_end === undefined
				? undefined
				: (split.service_period_end as string | null),
		amount:
			split.amount === undefined
				? undefined
				: (split.amount as number | string | null),
		taxAmount:
			split.tax_amount === undefined
				? undefined
				: (split.tax_amount as number | string | null),
		note: split.note === undefined ? undefined : (split.note as string | null),
	};
}
