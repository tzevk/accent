/**
 * Recorded/confirmed Salary Profile context for Payroll Slip readers (#441).
 *
 * A Payroll Slip must resolve to exactly one salary agreement, or to an
 * explicit unavailable/ambiguous state. New slips carry recorded provenance
 * (`salary_profile_id`, `salary_profile_source`, `salary_type`); those win even
 * when the recorded agreement no longer covers the month or has been
 * cancelled. Legacy slips without provenance may use only one covering
 * agreement at the slip's own anchor — never the latest, first or a future row.
 *
 * Administrative listing, bulk PDF and salary-sheet readers attach this
 * context and classify Salary Type streams from it. `slipFigures` in
 * `@/lib/payroll` consumes `figure_basic` as the one profile-derived Basic
 * fallback; no reader joins a current profile into a historical slip.
 *
 * See `slip-reader-contract.md` for the consumer contract and the required
 * real-database cardinality proof owned by #447/#446.
 */

import {
	normalizeSalaryDate,
	normalizeSalaryMonth,
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
	salaryPeriodBounds,
	type SalaryAgreementResolution,
	type SalaryAgreementSource,
	type SalaryProfileRow,
} from '@/lib/salary-profile-timeline';
import type { SalaryStoreDb } from '@/lib/salary-profile-store';

export type SlipSalaryStream = 'payroll' | 'contract';

export type SlipSalaryContextState =
	| 'recorded'
	| 'confirmed'
	| 'unavailable'
	| 'ambiguous';

export type SlipSalarySalaryTypeSource =
	| 'recorded_slip'
	| 'recorded_agreement'
	| 'period_agreement'
	| 'agreement_default';

export type SlipSalaryFigureSource =
	| 'canonical_basic'
	| 'canonical_basic_plus_da'
	| 'legacy_basic';

export type SlipSalaryDisclosure =
	| 'invalid_slip_month'
	| 'invalid_joining_date'
	| 'joining_after_slip_month'
	| 'incomplete_recorded_provenance'
	| 'recorded_agreement_missing'
	| 'recorded_agreement_employee_mismatch'
	| 'no_covering_agreement'
	| 'ambiguous_covering_agreements'
	| 'component_basic_unavailable';

export interface SlipSalaryIdentity {
	id: number | string;
	employee_id: number | string;
	month: string | Date;
	joining_date?: string | Date | null;
	salary_profile_id?: number | string | null;
	salary_profile_source?: string | null;
	salary_type?: string | null;
}

export interface SlipSalaryConflict {
	agreement_id: number;
	agreement_source: SalaryAgreementSource;
}

export interface SlipSalaryContext {
	slip_id: number;
	employee_id: number;
	month: string | null;
	anchor: string | null;
	state: SlipSalaryContextState;
	salary_profile_id: number | null;
	salary_profile_source: SalaryAgreementSource | null;
	agreement_id: number | null;
	agreement_source: SalaryAgreementSource | null;
	salary_type: string | null;
	salary_type_source: SlipSalarySalaryTypeSource | null;
	stream: SlipSalaryStream | null;
	profile: SalaryProfileRow | null;
	figure_basic: number | null;
	figure_basic_source: SlipSalaryFigureSource | null;
	conflicts: SlipSalaryConflict[];
	disclosures: SlipSalaryDisclosure[];
}

interface AgreementFigure {
	value: number;
	source: SlipSalaryFigureSource;
}

const AGREEMENT_SOURCES: readonly SalaryAgreementSource[] = [
	'employee_salary_profile',
	'salary_structures',
];

function rowsOf(result: unknown): SalaryProfileRow[] {
	return Array.isArray(result) ? (result as SalaryProfileRow[]) : [];
}

function positiveInteger(value: unknown): number | null {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : null;
}

function textValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function agreementSource(value: unknown): SalaryAgreementSource | null {
	const text = textValue(value);
	return text !== null &&
		AGREEMENT_SOURCES.includes(text as SalaryAgreementSource)
		? (text as SalaryAgreementSource)
		: null;
}

function nonZeroNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) && number !== 0 ? number : null;
}

function legacyType(row: SalaryProfileRow): string | null {
	return textValue(row.salary_type) ?? textValue(row.pay_type);
}

function figureFromCanonical(
	row: SalaryProfileRow,
	legacyFallback: SalaryProfileRow | null
): AgreementFigure | null {
	const basic = nonZeroNumber(row.basic);
	if (basic !== null) {
		return { value: Math.max(0, basic), source: 'canonical_basic' };
	}
	const basicPlusDa = nonZeroNumber(row.basic_plus_da);
	if (basicPlusDa !== null) {
		return {
			value: Math.max(0, basicPlusDa),
			source: 'canonical_basic_plus_da',
		};
	}
	const legacyBasic = legacyFallback
		? nonZeroNumber(legacyFallback.basic_salary)
		: null;
	return legacyBasic === null
		? null
		: { value: Math.max(0, legacyBasic), source: 'legacy_basic' };
}

function figureFromLegacy(row: SalaryProfileRow): AgreementFigure | null {
	const basic = nonZeroNumber(row.basic_salary);
	return basic === null
		? null
		: { value: Math.max(0, basic), source: 'legacy_basic' };
}

function conflictsOf(
	resolution: SalaryAgreementResolution,
	source: SalaryAgreementSource
): SlipSalaryConflict[] {
	return resolution.conflict_ids.map((agreement_id) => ({
		agreement_id,
		agreement_source: source,
	}));
}

function salaryTypeOfRow(
	row: SalaryProfileRow,
	source: SalaryAgreementSource
): { type: string; source: SlipSalarySalaryTypeSource } {
	const type =
		source === 'salary_structures'
			? legacyType(row)
			: textValue(row.salary_type);
	return type === null
		? { type: 'monthly', source: 'agreement_default' }
		: { type, source: 'period_agreement' };
}

function streamOf(salaryType: string | null): SlipSalaryStream | null {
	if (salaryType === null) return null;
	return salaryType.toLowerCase() === 'contract' ? 'contract' : 'payroll';
}

function uniqueDisclosures(
	disclosures: SlipSalaryDisclosure[]
): SlipSalaryDisclosure[] {
	return [...new Set(disclosures)];
}

interface AgreementRows {
	canonical: SalaryProfileRow[];
	legacy: SalaryProfileRow[];
}

/**
 * One slot per input slip. `canonicalById`/`legacyById` hold every row fetched
 * for the batch, including inactive/cancelled rows, because a recorded
 * identity remains evidence even after later lifecycle changes. Period
 * fallback resolves only active canonical rows first, then active legacy rows.
 */
function buildContext(
	slip: SlipSalaryIdentity,
	rows: AgreementRows,
	canonicalById: ReadonlyMap<number, SalaryProfileRow>,
	legacyById: ReadonlyMap<number, SalaryProfileRow>
): SlipSalaryContext {
	const slipId = positiveInteger(slip.id);
	const employeeId = positiveInteger(slip.employee_id);
	const disclosures: SlipSalaryDisclosure[] = [];

	const recordedType = textValue(slip.salary_type);
	const recordedId = positiveInteger(slip.salary_profile_id);
	const recordedSource = agreementSource(slip.salary_profile_source);
	const hasProvenanceField =
		textValue(slip.salary_profile_id) !== null ||
		textValue(slip.salary_profile_source) !== null;

	let month: string | null = null;
	const rawMonth =
		slip.month instanceof Date
			? slip.month.toISOString().slice(0, 10)
			: slip.month;
	try {
		month = normalizeSalaryMonth(String(rawMonth));
	} catch {
		disclosures.push('invalid_slip_month');
	}

	let joining: string | null = null;
	const rawJoining =
		slip.joining_date instanceof Date
			? slip.joining_date.toISOString().slice(0, 10)
			: slip.joining_date;
	if (
		rawJoining !== null &&
		rawJoining !== undefined &&
		String(rawJoining).trim()
	) {
		joining = normalizeSalaryDate(rawJoining);
		if (joining === null) disclosures.push('invalid_joining_date');
	}

	let anchor: string | null = null;
	let periodBlocked = month === null;
	if (month !== null) {
		if (joining === null) {
			anchor = month;
		} else if (joining > salaryPeriodBounds(month).end) {
			disclosures.push('joining_after_slip_month');
			periodBlocked = true;
		} else {
			anchor = salaryMonthAnchor(month, joining);
		}
	}

	let salaryType = recordedType;
	let salaryTypeSource: SlipSalarySalaryTypeSource | null =
		recordedType === null ? null : 'recorded_slip';
	let state: SlipSalaryContextState = 'unavailable';
	let agreementId: number | null = null;
	let resolvedAgreementSource: SalaryAgreementSource | null = null;
	let profile: SalaryProfileRow | null = null;
	let figure: AgreementFigure | null = null;
	let conflicts: SlipSalaryConflict[] = [];

	const applyConfirmed = (
		source: SalaryAgreementSource,
		row: SalaryProfileRow,
		resolutionFigure: AgreementFigure | null
	): void => {
		const rowType = salaryTypeOfRow(row, source);
		if (salaryType === null) {
			salaryType = rowType.type;
			salaryTypeSource = rowType.source;
		}
		agreementId = positiveInteger(row.id);
		resolvedAgreementSource = source;
		profile = row;
		figure = resolutionFigure;
	};

	const confirmedLegacyAtAnchor = (): SalaryProfileRow | null => {
		if (anchor === null) return null;
		const resolution = resolveSalaryAgreementAt(rows.legacy, anchor, {
			source: 'salary_structures',
			employeeId: employeeId ?? undefined,
		});
		return resolution.state === 'selected' ? resolution.profile : null;
	};

	if (recordedId !== null && recordedSource !== null) {
		const recordedRow =
			recordedSource === 'employee_salary_profile'
				? canonicalById.get(recordedId)
				: legacyById.get(recordedId);
		if (recordedRow === undefined) {
			disclosures.push('recorded_agreement_missing');
		} else if (
			employeeId === null ||
			positiveInteger(recordedRow.employee_id) !== employeeId
		) {
			disclosures.push('recorded_agreement_employee_mismatch');
		} else {
			state = 'recorded';
			const rowType = salaryTypeOfRow(recordedRow, recordedSource);
			if (salaryType === null) {
				salaryType = rowType.type;
				salaryTypeSource =
					rowType.source === 'agreement_default'
						? 'agreement_default'
						: 'recorded_agreement';
			}
			agreementId = recordedId;
			resolvedAgreementSource = recordedSource;
			profile = recordedRow;
			figure =
				recordedSource === 'employee_salary_profile'
					? figureFromCanonical(recordedRow, confirmedLegacyAtAnchor())
					: figureFromLegacy(recordedRow);
		}
	} else if (hasProvenanceField) {
		// A half-written identity is not permission to pick another agreement.
		disclosures.push('incomplete_recorded_provenance');
	} else if (periodBlocked || anchor === null) {
		disclosures.push('no_covering_agreement');
	} else {
		const canonical = resolveSalaryAgreementAt(rows.canonical, anchor, {
			source: 'employee_salary_profile',
			employeeId: employeeId ?? undefined,
		});
		if (canonical.state === 'ambiguous') {
			state = 'ambiguous';
			conflicts = conflictsOf(canonical, 'employee_salary_profile');
			disclosures.push('ambiguous_covering_agreements');
		} else if (canonical.state === 'selected' && canonical.profile !== null) {
			state = 'confirmed';
			applyConfirmed(
				'employee_salary_profile',
				canonical.profile,
				figureFromCanonical(canonical.profile, confirmedLegacyAtAnchor())
			);
		} else {
			const legacy = resolveSalaryAgreementAt(rows.legacy, anchor, {
				source: 'salary_structures',
				employeeId: employeeId ?? undefined,
			});
			if (legacy.state === 'ambiguous') {
				state = 'ambiguous';
				conflicts = conflictsOf(legacy, 'salary_structures');
				disclosures.push('ambiguous_covering_agreements');
			} else if (legacy.state === 'selected' && legacy.profile !== null) {
				state = 'confirmed';
				applyConfirmed(
					'salary_structures',
					legacy.profile,
					figureFromLegacy(legacy.profile)
				);
			} else {
				disclosures.push('no_covering_agreement');
			}
		}
	}

	if ((state === 'recorded' || state === 'confirmed') && figure === null) {
		disclosures.push('component_basic_unavailable');
	}

	return {
		slip_id: slipId ?? 0,
		employee_id: employeeId ?? 0,
		month,
		anchor,
		state,
		salary_profile_id: recordedId,
		salary_profile_source: recordedSource,
		agreement_id: agreementId,
		agreement_source: resolvedAgreementSource,
		salary_type: salaryType,
		salary_type_source: salaryTypeSource,
		stream: streamOf(salaryType),
		profile,
		figure_basic: figure?.value ?? null,
		figure_basic_source: figure?.source ?? null,
		conflicts,
		disclosures: uniqueDisclosures(disclosures),
	};
}

/**
 * Read one recorded/confirmed context per input slip in input order. Two
 * batched agreement reads serve the whole call; the reader never starts,
 * commits or rolls back a transaction and never writes.
 */
export async function readSlipSalaryContexts(
	db: SalaryStoreDb,
	slips: readonly SlipSalaryIdentity[]
): Promise<SlipSalaryContext[]> {
	if (slips.length === 0) return [];

	const employeeIds = new Set<number>();
	const recordedCanonicalIds = new Set<number>();
	const recordedLegacyIds = new Set<number>();

	for (const slip of slips) {
		const employeeId = positiveInteger(slip.employee_id);
		if (employeeId !== null) employeeIds.add(employeeId);
		const recordedId = positiveInteger(slip.salary_profile_id);
		const recordedSource = agreementSource(slip.salary_profile_source);
		if (recordedId !== null && recordedSource === 'employee_salary_profile') {
			recordedCanonicalIds.add(recordedId);
		}
		if (recordedId !== null && recordedSource === 'salary_structures') {
			recordedLegacyIds.add(recordedId);
		}
	}

	const readAgreements = async (
		table: 'employee_salary_profile' | 'salary_structures',
		recordedIds: ReadonlySet<number>
	): Promise<SalaryProfileRow[]> => {
		const clauses: string[] = [];
		const params: number[] = [];
		if (employeeIds.size > 0) {
			clauses.push(
				`employee_id IN (${[...employeeIds].map(() => '?').join(', ')})`
			);
			params.push(...employeeIds);
		}
		if (recordedIds.size > 0) {
			clauses.push(`id IN (${[...recordedIds].map(() => '?').join(', ')})`);
			params.push(...recordedIds);
		}
		if (clauses.length === 0) return [];
		const [result] = await db.execute(
			`SELECT *
         FROM ${table}
        WHERE ${clauses.join(' OR ')}`,
			params
		);
		return rowsOf(result);
	};

	// Sequential on the caller's single connection: mysql2 commands queue, and
	// this read must stay safe inside a caller-owned transaction as well.
	const canonicalRows = await readAgreements(
		'employee_salary_profile',
		recordedCanonicalIds
	);
	const legacyRows = await readAgreements(
		'salary_structures',
		recordedLegacyIds
	);

	const canonicalById = new Map<number, SalaryProfileRow>();
	const legacyById = new Map<number, SalaryProfileRow>();
	const byEmployee = new Map<number, AgreementRows>();

	const employeeRows = (employeeId: number | null): AgreementRows => {
		if (employeeId === null) return { canonical: [], legacy: [] };
		let entry = byEmployee.get(employeeId);
		if (entry === undefined) {
			entry = { canonical: [], legacy: [] };
			byEmployee.set(employeeId, entry);
		}
		return entry;
	};

	for (const row of canonicalRows) {
		const id = positiveInteger(row.id);
		if (id !== null) canonicalById.set(id, row);
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId !== null) employeeRows(employeeId).canonical.push(row);
	}
	for (const row of legacyRows) {
		const id = positiveInteger(row.id);
		if (id !== null) legacyById.set(id, row);
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId !== null) employeeRows(employeeId).legacy.push(row);
	}

	return slips.map((slip) =>
		buildContext(
			slip,
			employeeRows(positiveInteger(slip.employee_id)),
			canonicalById,
			legacyById
		)
	);
}

/**
 * Whether a slip belongs in the requested Salary Type stream.
 *
 * `payroll` is the established default stream: a legacy slip whose context
 * cannot prove Contract stays visible there, with its disclosure, rather than
 * disappearing. `contract` and exact type filters require positive evidence.
 */
export function slipMatchesSalaryTypeFilter(
	context: SlipSalaryContext,
	salaryType: string | null | undefined
): boolean {
	const requested = textValue(salaryType);
	if (requested === null) return true;
	const normalized = requested.toLowerCase();
	if (normalized === 'payroll') return context.stream !== 'contract';
	if (normalized === 'contract') return context.stream === 'contract';
	return context.salary_type?.toLowerCase() === normalized;
}
