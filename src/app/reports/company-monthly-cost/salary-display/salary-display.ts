import type { PayrollExpenditure } from '@/lib/company-expenditure/types';
import type {
	CostSalaryAvailability,
	CostSalaryEvidence,
	CostSalarySummary,
} from '../types';

/**
 * Salary vocabulary shared by the live company-cost screens and workbooks.
 * The payload's evidence is authoritative; this module only turns it into the
 * distinctions the reader needs, never into payroll arithmetic.
 */

/** Salary states where no usable agreement terms exist, so money is unknown. */
export type SalaryGapAvailability =
	| 'missing'
	| 'ambiguous'
	| 'ctc_missing'
	| 'ctc_invalid'
	| 'unavailable';

interface SalaryCauseDefinition {
	availability: SalaryGapAvailability;
	/** One row's plain-language cause. */
	sentence: string;
	/** Noun phrase used in aggregate counts. */
	countLabel: string;
}

const GAP_CAUSES: readonly SalaryCauseDefinition[] = [
	{
		availability: 'missing',
		sentence: 'No Salary Profile covers this month',
		countLabel: 'No covering Salary Profile',
	},
	{
		availability: 'ambiguous',
		sentence: 'Several Salary Profiles cover this month',
		countLabel: 'Ambiguous Salary Profiles',
	},
	{
		availability: 'ctc_missing',
		sentence: 'Salary Profile has no monthly CTC',
		countLabel: 'Salary Profile without CTC',
	},
	{
		availability: 'ctc_invalid',
		sentence: 'Salary Profile CTC is invalid',
		countLabel: 'Invalid Salary Profile CTC',
	},
	{
		availability: 'unavailable',
		sentence: 'Salary evidence unavailable',
		countLabel: 'Salary evidence unavailable',
	},
];

/** Payroll coverage notices that explain one salary gap state. */
export const SALARY_COVERAGE_CODES: Readonly<
	Record<string, SalaryGapAvailability | undefined>
> = {
	payroll_pricing_missing: 'missing',
	payroll_salary_ambiguous: 'ambiguous',
	payroll_salary_ctc_missing: 'ctc_missing',
	payroll_salary_ctc_invalid: 'ctc_invalid',
	payroll_salary_unavailable: 'unavailable',
};

export interface SalaryGapCause extends SalaryCauseDefinition {
	count: number;
}

function causesFromCounts(
	counts: Partial<Record<CostSalaryAvailability, number>>
): SalaryGapCause[] {
	return GAP_CAUSES.map((cause) => ({
		...cause,
		count: counts[cause.availability] ?? 0,
	})).filter((cause) => cause.count > 0);
}

/**
 * The month summary spells each count with a `_count` suffix; Project rows
 * spell the availability states directly. Normalise the summary here so both
 * callers share one definition of a gap.
 */
function summaryCounts(
	summary: CostSalarySummary
): Record<CostSalaryAvailability, number> {
	return {
		recorded: summary.recorded_count,
		not_consulted: summary.not_consulted_count,
		available: summary.available_count,
		missing: summary.missing_count,
		ambiguous: summary.ambiguous_count,
		ctc_missing: summary.ctc_missing_count,
		ctc_invalid: summary.ctc_invalid_count,
		unavailable: summary.unavailable_count,
	};
}

/** The month's gap causes, with counts, in a stable disclosure order. */
export function salaryGapCauses(summary: CostSalarySummary): SalaryGapCause[] {
	return causesFromCounts(summaryCounts(summary));
}

/** One Project's distinct salary gaps, from its availability counts. */
export function projectSalaryCauses(
	counts: Record<CostSalaryAvailability, number>
): SalaryGapCause[] {
	return causesFromCounts(counts);
}

/**
 * A Project row's salary notes: the distinct gap counts plus the legacy-basis
 * employees derived from its detail rows (the payload counts availability, not
 * the CTC source, so the caller supplies the legacy count it can see).
 */
export function projectSalaryNotes(
	counts: Record<CostSalaryAvailability, number>,
	legacyFallbackEmployees: number
): string[] {
	const notes = projectSalaryCauses(counts).map(
		(cause) => `${cause.countLabel}: ${cause.count}`
	);
	if (legacyFallbackEmployees > 0) {
		notes.push(
			`Legacy gross basis (not agreed CTC): ${legacyFallbackEmployees}`
		);
	}
	return notes;
}

/**
 * The cause of an unavailable employee cost. Ambiguity names the competing
 * profile ids the payload supplies. A priced row returns `null`.
 */
export function salaryCauseSentence(
	availability: CostSalaryAvailability,
	conflictIds: readonly number[] = []
): string | null {
	const cause = GAP_CAUSES.find(
		(candidate) => candidate.availability === availability
	);
	if (!cause) return null;
	if (availability === 'ambiguous' && conflictIds.length > 0) {
		return `${cause.sentence} (#${conflictIds.join(', #')})`;
	}
	return cause.sentence;
}

export interface CostRowDisclosureInput {
	salary: CostSalaryEvidence;
	cost_known: boolean;
	cost: number;
	worked_outside_finalized_run: boolean;
}

export interface CostRowDisclosure {
	/** Why the row states no amount. Null when an amount is stated. */
	unavailableReason: string | null;
	/** How a stated amount was priced. Null for ordinary agreed CTC. */
	basisNote: string | null;
}

/** One employee-project row's honest money statement. */
export function costRowDisclosure(
	input: CostRowDisclosureInput
): CostRowDisclosure {
	if (!input.cost_known) {
		if (input.worked_outside_finalized_run) {
			return {
				unavailableReason:
					'Worked in month — not included in finalized payroll',
				basisNote: null,
			};
		}
		const cause = salaryCauseSentence(
			input.salary.availability,
			input.salary.conflict_ids
		);
		return {
			unavailableReason: cause
				? `Unpriced · ${cause}`
				: 'Cost unavailable for this month — unknown, not zero',
			basisNote: null,
		};
	}
	if (input.salary.availability === 'recorded') {
		return {
			unavailableReason: null,
			basisNote: 'Recorded · frozen allocation',
		};
	}
	if (input.salary.availability === 'not_consulted') {
		return {
			unavailableReason: null,
			basisNote: 'Locked month · live salary not consulted',
		};
	}
	if (input.salary.legacy_fallback) {
		return {
			unavailableReason: null,
			basisNote: 'Legacy gross basis — not agreed CTC',
		};
	}
	if (
		input.cost === 0 &&
		input.salary.availability === 'available' &&
		input.salary.ctc_source === 'employer_cost'
	) {
		return {
			unavailableReason: null,
			basisNote: 'Confirmed zero · explicit employer-cost CTC',
		};
	}
	return { unavailableReason: null, basisNote: null };
}

/** The workbook subtitle's salary population and basis disclosure. */
export function salaryWorkbookSummary(summary: CostSalarySummary): string {
	const parts: string[] = [];
	if (summary.available_count > 0) {
		parts.push(`Agreed CTC: ${summary.available_count}`);
	}
	for (const cause of salaryGapCauses(summary)) {
		parts.push(`${cause.countLabel}: ${cause.count}`);
	}
	if (summary.legacy_fallback_count > 0) {
		parts.push(
			`Legacy gross basis (not agreed CTC): ${summary.legacy_fallback_count}`
		);
	}
	if (summary.recorded_count > 0) {
		parts.push(`Recorded from frozen allocations: ${summary.recorded_count}`);
	}
	if (summary.not_consulted_count > 0) {
		parts.push(
			`Locked months without a live salary read: ${summary.not_consulted_count}`
		);
	}
	return parts.join(' · ');
}

/**
 * Whether the company total is a partial population. Salary completeness is
 * one reason; the existing payroll gaps remain reasons even when every salary
 * row resolved.
 */
export function monthlyTotalIsPartial(
	payroll: Pick<
		PayrollExpenditure,
		'unpriced_count' | 'missing_slip_count' | 'allocation_missing_count'
	>,
	salary: CostSalarySummary
): boolean {
	return (
		!salary.complete ||
		payroll.unpriced_count > 0 ||
		payroll.missing_slip_count > 0 ||
		payroll.allocation_missing_count > 0
	);
}
