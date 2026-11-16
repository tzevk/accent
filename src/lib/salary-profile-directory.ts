/**
 * Payroll-authorized Salary Profile directory, batch and resolve projections.
 *
 * These readers answer "what covers the requested period?" They never select
 * the newest row: a future-only agreement cannot price an earlier date, two
 * covering agreements are reported as ambiguous, and a legacy
 * `salary_structures` row is a read-only fallback only when no canonical
 * agreement covers the period. CTC is always serialized through the shared
 * `resolveSalaryCtc` producer, so an explicit zero stays zero and a legacy
 * gross fallback discloses its source.
 *
 * The directory is a projection over the one Employee master, not a second
 * directory: `isDelete = 0` is enforced, employment status is not filtered
 * (leavers with history stay visible), and no employee or salary write exists
 * here. Bulk reads keep the list free of per-Employee queries.
 */

import { normalizeSalaryProfile } from '@/utils/payroll-calculation';
import { toNumber } from './money';
import {
	resolveSalaryCtc,
	type SalaryCtcInvalidReason,
	type SalaryCtcSource,
} from './salary-ctc';
import {
	normalizeSalaryDate,
	normalizeSalaryMonth,
	resolveSalaryAgreementAt,
	salaryPeriodBounds,
	type SalaryAgreementClassification,
	type SalaryAgreementSource,
	type SalaryAgreementState,
	type SalaryProfileRow,
} from './salary-profile-timeline';
import {
	readSalaryAgreements,
	readSalaryTimelineVersion,
	readSalaryUseEvidence,
	summarizeSalaryUseEvidence,
	type SalaryUseEvidence,
	type SalaryUseSource,
} from './salary-profile-store';

export type SalaryPayStream = 'payroll' | 'contract';
export type SalaryDirectoryFilter = 'payroll' | 'contract' | 'missing';

export type SalaryCtcStatus = 'resolved' | 'missing' | 'invalid';

export interface SalaryCtcProjection {
	status: SalaryCtcStatus;
	/** JSON number at this boundary; null for missing or invalid, never zero. */
	amount: number | null;
	source: SalaryCtcSource;
	legacy_fallback: boolean;
	invalid_reason: SalaryCtcInvalidReason | null;
}

export type SalaryPeriod =
	| {
			kind: 'date';
			date: string;
			month: null;
			start: string;
			end: string;
	  }
	| {
			kind: 'month';
			date: null;
			month: string;
			start: string;
			end: string;
	  };

export interface SalaryEmployeeIdentity {
	id: number;
	employee_id: string;
	full_name: string;
	department: string | null;
	employee_type: string | null;
	status: string | null;
	joining_date: string | null;
	hire_date: string | null;
	exit_date: string | null;
}

export interface SalaryDirectoryEmployeeRow {
	id: number | string;
	employee_id: string;
	first_name?: string | null;
	last_name?: string | null;
	department?: string | null;
	employee_type?: string | null;
	status?: string | null;
	joining_date?: string | null;
	hire_date?: string | null;
	exit_date?: string | null;
}

export interface SalaryDirectoryAgreement {
	agreement_id: number;
	source: SalaryAgreementSource;
	salary_type: string;
	pay_stream: SalaryPayStream;
	effective_from: string;
	effective_to: string | null;
	classification: SalaryAgreementClassification;
	/** Durable use evidence for this exact source-qualified agreement. */
	used: boolean;
	ctc: SalaryCtcProjection;
}

export interface SalaryDirectoryRow extends SalaryEmployeeIdentity {
	has_agreement: boolean;
	state: SalaryAgreementState;
	/** The date this row was resolved at (joining-aware in month mode). */
	anchor: string;
	agreement: SalaryDirectoryAgreement | null;
	conflict_ids: number[];
	conflict_source: SalaryAgreementSource | null;
	timeline_version: number;
	use_ambiguous: boolean;
	use_unknown_history: boolean;
	use_months: string[];
}

export interface SalaryDirectoryCounts {
	total: number;
	payroll: number;
	contract: number;
	missing: number;
	ambiguous: number;
}

export interface SalaryProfileDirectoryResult {
	period: SalaryPeriod;
	as_of: string;
	page: number;
	limit: number;
	total: number;
	counts: SalaryDirectoryCounts;
	data: SalaryDirectoryRow[];
}

export interface SalaryDirectoryQuery {
	period: SalaryPeriod;
	search: string;
	stream: SalaryDirectoryFilter | 'all';
	page: number;
	limit: number;
}

export interface SalaryBatchQuery {
	period: SalaryPeriod;
	ids: number[] | undefined;
	full: boolean;
}

export interface SalaryResolveQuery {
	period: SalaryPeriod;
}

export interface SalaryProfileBatchEntry {
	employee_id: number;
	state: SalaryAgreementState;
	anchor: string;
	source: SalaryAgreementSource | null;
	agreement_id: number | null;
	conflict_ids: number[];
	conflict_source: SalaryAgreementSource | null;
	salary_type: string | null;
	pay_stream: SalaryPayStream | null;
	effective_from: string | null;
	effective_to: string | null;
	classification: SalaryAgreementClassification | null;
	ctc: SalaryCtcProjection;
	timeline_version: number;
	used: boolean;
	use_ambiguous: boolean;
	use_unknown_history: boolean;
	use_months: string[];
	profile: Record<string, unknown> | null;
}

export interface SalaryProfileBatchResult {
	period: SalaryPeriod;
	as_of: string;
	data: Record<string, SalaryProfileBatchEntry>;
	missing_ids: number[];
}

export interface SalaryProfileResolution extends SalaryProfileBatchEntry {
	employee: SalaryEmployeeIdentity;
}

export interface SalaryDirectoryDb {
	execute(
		sql: string,
		params?: ReadonlyArray<string | number | boolean | null>
	): Promise<[unknown, unknown]>;
}

export interface SalaryDirectoryBuildInput {
	employees: readonly SalaryDirectoryEmployeeRow[];
	canonical?: readonly SalaryProfileRow[];
	legacy?: readonly SalaryProfileRow[];
	timelineVersions?: ReadonlyMap<number, number>;
	useEvidence?: readonly SalaryUseEvidence[];
	period: SalaryPeriod;
	search?: string;
	stream?: SalaryDirectoryFilter | 'all';
	page?: number;
	limit?: number;
}

export interface SalaryBatchBuildInput {
	employees: readonly SalaryDirectoryEmployeeRow[];
	canonical?: readonly SalaryProfileRow[];
	legacy?: readonly SalaryProfileRow[];
	timelineVersions?: ReadonlyMap<number, number>;
	useEvidence?: readonly SalaryUseEvidence[];
	period: SalaryPeriod;
	requestedIds?: readonly number[];
	full?: boolean;
}

/** Invalid caller input for the directory/batch/resolve readers. */
export class SalaryProfileQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SalaryProfileQueryError';
	}
}

const DIRECTORY_DEFAULT_LIMIT = 25;
const DIRECTORY_MAX_LIMIT = 100;
const EMPLOYEE_QUERY_CHUNK = 500;
const EMPLOYEE_COLUMNS = `id, employee_id, first_name, last_name, department,
	employee_type, status, joining_date, hire_date, exit_date`;
const USE_SOURCES: readonly SalaryUseSource[] = [
	'payroll_generation',
	'payroll_finalization',
	'legacy_slip',
	'legacy_audit',
	'legacy_roster',
];

function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isSafeInteger(number) && number > 0 ? number : null;
	}
	return null;
}

function nonNegativeInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value >= 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number >= 0 ? number : null;
	}
	return null;
}

function textValue(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text === '' ? null : text;
}

function dateText(value: unknown): string | null {
	if (typeof value === 'string') {
		const text = value.trim();
		return text === '' ? null : text.slice(0, 10);
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime())
			? null
			: value.toISOString().slice(0, 10);
	}
	return null;
}

function dateTimeText(value: unknown): string | null {
	if (typeof value === 'string') {
		const text = value.trim();
		return text === '' ? null : text;
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	return null;
}

function flagValue(value: unknown): boolean {
	return value === 1 || value === '1' || value === true;
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is Record<string, unknown> =>
			row !== null && typeof row === 'object' && !Array.isArray(row)
	);
}

function isAgreementSource(value: unknown): value is SalaryAgreementSource {
	return value === 'employee_salary_profile' || value === 'salary_structures';
}

function isUseSource(value: unknown): value is SalaryUseSource {
	return (
		typeof value === 'string' && USE_SOURCES.includes(value as SalaryUseSource)
	);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

function uniqueSorted(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

/**
 * Server calendar date used only when the caller omits a period. UTC keeps the
 * default identical in every host timezone; callers reading a historical
 * period must pass `date`/`month` explicitly.
 */
export function serverSalaryDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

function parsePeriod(
	params: URLSearchParams,
	now: Date,
	defaultKind: 'date' | 'month'
): SalaryPeriod {
	const today = serverSalaryDate(now);
	const dateParam = textValue(params.get('date'));
	const monthParam = textValue(params.get('month'));
	if (dateParam !== null && monthParam !== null) {
		throw new SalaryProfileQueryError('Supply either date or month, not both');
	}

	if (monthParam !== null) {
		let month: string;
		try {
			month = normalizeSalaryMonth(monthParam);
		} catch {
			throw new SalaryProfileQueryError(
				`Invalid month "${monthParam}" (expected YYYY-MM)`
			);
		}
		const bounds = salaryPeriodBounds(month);
		return {
			kind: 'month',
			date: null,
			month,
			start: bounds.start,
			end: bounds.end,
		};
	}

	if (dateParam !== null || defaultKind === 'date') {
		const date = dateParam ?? today;
		const normalized = normalizeSalaryDate(date);
		if (normalized === null) {
			throw new SalaryProfileQueryError(
				`Invalid date "${date}" (expected YYYY-MM-DD)`
			);
		}
		return {
			kind: 'date',
			date: normalized,
			month: null,
			start: normalized,
			end: normalized,
		};
	}

	const bounds = salaryPeriodBounds(`${today.slice(0, 7)}-01`);
	return {
		kind: 'month',
		date: null,
		month: bounds.start,
		start: bounds.start,
		end: bounds.end,
	};
}

function parsePositiveIntegerParam(
	raw: string | null,
	name: string,
	fallback: number,
	max?: number
): number {
	if (raw === null || raw.trim() === '') return fallback;
	if (!/^\d+$/.test(raw.trim())) {
		throw new SalaryProfileQueryError(`Invalid ${name} "${raw}"`);
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new SalaryProfileQueryError(`Invalid ${name} "${raw}"`);
	}
	if (max !== undefined && value > max) {
		throw new SalaryProfileQueryError(
			`Invalid ${name} "${raw}" (maximum ${max})`
		);
	}
	return value;
}

function parseStream(raw: string | null): SalaryDirectoryFilter | 'all' {
	const value = textValue(raw);
	if (value === null || value === 'all') return 'all';
	if (value === 'payroll' || value === 'contract' || value === 'missing') {
		return value;
	}
	throw new SalaryProfileQueryError(
		'Invalid stream (expected payroll, contract, missing or all)'
	);
}

/** Parse the directory route's query string; throws SalaryProfileQueryError. */
export function parseSalaryDirectoryQuery(
	params: URLSearchParams,
	now: Date = new Date()
): SalaryDirectoryQuery {
	return {
		period: parsePeriod(params, now, 'date'),
		search: (params.get('search') ?? '').trim(),
		stream: parseStream(params.get('stream')),
		page: parsePositiveIntegerParam(params.get('page'), 'page', 1),
		limit: parsePositiveIntegerParam(
			params.get('limit'),
			'limit',
			DIRECTORY_DEFAULT_LIMIT,
			DIRECTORY_MAX_LIMIT
		),
	};
}

function parseEmployeeIds(raw: string | null): number[] | undefined {
	if (raw === null) return undefined;
	if (raw.trim() === '') return [];
	const ids: number[] = [];
	for (const token of raw.split(',')) {
		const text = token.trim();
		if (text === '') continue;
		if (!/^\d+$/.test(text)) {
			throw new SalaryProfileQueryError(`Invalid Employee id "${token}"`);
		}
		const id = Number(text);
		if (!Number.isSafeInteger(id) || id < 1) {
			throw new SalaryProfileQueryError(`Invalid Employee id "${token}"`);
		}
		ids.push(id);
	}
	return uniqueSorted(ids);
}

/** Parse the batch route's query string; throws SalaryProfileQueryError. */
export function parseSalaryBatchQuery(
	params: URLSearchParams,
	now: Date = new Date()
): SalaryBatchQuery {
	return {
		period: parsePeriod(params, now, 'month'),
		ids: parseEmployeeIds(params.get('ids')),
		full: params.get('full') === '1',
	};
}

/** Parse a required positive Employee id; throws SalaryProfileQueryError. */
export function parseSalaryEmployeeId(raw: string | null): number {
	const text = textValue(raw);
	if (text === null) {
		throw new SalaryProfileQueryError('Missing employee_id parameter');
	}
	if (!/^\d+$/.test(text)) {
		throw new SalaryProfileQueryError(`Invalid employee_id "${raw}"`);
	}
	const id = Number(text);
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new SalaryProfileQueryError(`Invalid employee_id "${raw}"`);
	}
	return id;
}

/** Parse the resolve route's period; throws SalaryProfileQueryError. */
export function parseSalaryResolveQuery(
	params: URLSearchParams,
	now: Date = new Date()
): SalaryResolveQuery {
	return { period: parsePeriod(params, now, 'date') };
}

/** Salary Type selects the pay stream; Employee Type never does. */
export function salaryPayStream(salaryType: unknown): SalaryPayStream {
	return textValue(salaryType)?.toLowerCase() === 'contract'
		? 'contract'
		: 'payroll';
}

/** Serialize the shared CTC resolver at a read boundary. */
export function projectSalaryCtc(
	profile: Record<string, unknown> | null | undefined
): SalaryCtcProjection {
	const resolution = resolveSalaryCtc(profile);
	if (resolution.status === 'resolved') {
		return {
			status: 'resolved',
			amount: toNumber(resolution.amount),
			source: resolution.source,
			legacy_fallback: resolution.legacyFallback,
			invalid_reason: null,
		};
	}
	if (resolution.status === 'invalid') {
		return {
			status: 'invalid',
			amount: null,
			source: resolution.source,
			legacy_fallback: false,
			invalid_reason: resolution.reason,
		};
	}
	return {
		status: 'missing',
		amount: null,
		source: 'none',
		legacy_fallback: false,
		invalid_reason: null,
	};
}

interface NormalizedEmployee extends SalaryEmployeeIdentity {
	first_name: string | null;
	last_name: string | null;
	employment_start: string | null;
}

function normalizeEmployees(
	rows: readonly SalaryDirectoryEmployeeRow[]
): NormalizedEmployee[] {
	const seen = new Set<number>();
	const employees: NormalizedEmployee[] = [];
	for (const row of rows) {
		const id = positiveInteger(row.id);
		if (id === null || seen.has(id)) continue;
		const code = textValue(row.employee_id);
		if (code === null) continue;
		seen.add(id);
		const first = textValue(row.first_name);
		const last = textValue(row.last_name);
		const fullName = [first, last].filter((part) => part !== null).join(' ');
		const joining = dateText(row.joining_date);
		const hire = dateText(row.hire_date);
		employees.push({
			id,
			employee_id: code,
			full_name: fullName === '' ? code : fullName,
			department: textValue(row.department),
			employee_type: textValue(row.employee_type),
			status: textValue(row.status),
			joining_date: joining,
			hire_date: hire,
			exit_date: dateText(row.exit_date),
			first_name: first,
			last_name: last,
			employment_start: joining ?? hire,
		});
	}
	return employees;
}

function matchesSearch(employee: NormalizedEmployee, needle: string): boolean {
	if (needle === '') return true;
	return [
		employee.employee_id,
		employee.full_name,
		employee.department ?? '',
	].some((value) => value.toLowerCase().includes(needle));
}

function anchorFor(
	period: SalaryPeriod,
	employmentStart: string | null
): { anchor: string; employed: boolean } {
	if (period.kind === 'date') {
		if (employmentStart !== null && employmentStart > period.date) {
			return { anchor: period.date, employed: false };
		}
		return { anchor: period.date, employed: true };
	}
	if (employmentStart !== null && employmentStart > period.end) {
		return { anchor: period.start, employed: false };
	}
	return {
		anchor:
			employmentStart !== null && employmentStart > period.start
				? employmentStart
				: period.start,
		employed: true,
	};
}

interface ResolvedAgreement {
	state: SalaryAgreementState;
	source: SalaryAgreementSource | null;
	agreement_id: number | null;
	profile: Record<string, unknown> | null;
	salary_type: string | null;
	effective_from: string | null;
	effective_to: string | null;
	classification: SalaryAgreementClassification | null;
	conflict_ids: number[];
	conflict_source: SalaryAgreementSource | null;
}

const UNAVAILABLE: ResolvedAgreement = {
	state: 'unavailable',
	source: null,
	agreement_id: null,
	profile: null,
	salary_type: null,
	effective_from: null,
	effective_to: null,
	classification: null,
	conflict_ids: [],
	conflict_source: null,
};

function ambiguousResolution(
	ids: readonly number[],
	source: SalaryAgreementSource
): ResolvedAgreement {
	return {
		...UNAVAILABLE,
		state: 'ambiguous',
		conflict_ids: [...ids],
		conflict_source: source,
	};
}

function selectedResolution(
	resolution: {
		agreement_id: number | null;
		profile: SalaryProfileRow | null;
		salary_type: string | null;
		effective_from: string | null;
		effective_to: string | null;
		classification: SalaryAgreementClassification | null;
	},
	source: SalaryAgreementSource,
	profile: Record<string, unknown>
): ResolvedAgreement {
	return {
		state: 'selected',
		source,
		agreement_id: resolution.agreement_id,
		profile,
		salary_type:
			textValue(profile.salary_type) ?? resolution.salary_type ?? 'monthly',
		effective_from: resolution.effective_from,
		effective_to: resolution.effective_to,
		classification: resolution.classification,
		conflict_ids: [],
		conflict_source: null,
	};
}

/**
 * Canonical first; a legacy row may fill only an uncovered period. Canonical
 * ambiguity is returned before the legacy fallback is consulted.
 */
function resolveEmployeeAgreement(
	canonicalRows: readonly SalaryProfileRow[],
	legacyRows: readonly SalaryProfileRow[],
	employeeId: number,
	anchor: string
): ResolvedAgreement {
	const canonical = resolveSalaryAgreementAt(canonicalRows, anchor, {
		source: 'employee_salary_profile',
		employeeId,
	});
	if (canonical.state === 'ambiguous') {
		return ambiguousResolution(
			canonical.conflict_ids,
			'employee_salary_profile'
		);
	}

	const legacy = resolveSalaryAgreementAt(legacyRows, anchor, {
		source: 'salary_structures',
		employeeId,
	});

	if (canonical.state === 'selected' && canonical.profile !== null) {
		const legacyProfile = legacy.state === 'selected' ? legacy.profile : null;
		const merged = normalizeSalaryProfile(
			canonical.profile,
			legacyProfile
		) as Record<string, unknown>;
		return selectedResolution(canonical, 'employee_salary_profile', merged);
	}

	if (legacy.state === 'ambiguous') {
		return ambiguousResolution(legacy.conflict_ids, 'salary_structures');
	}

	if (legacy.state === 'selected' && legacy.profile !== null) {
		const merged = normalizeSalaryProfile(null, legacy.profile) as Record<
			string,
			unknown
		>;
		return selectedResolution(legacy, 'salary_structures', merged);
	}

	return UNAVAILABLE;
}

interface UseSummary {
	used: boolean;
	ambiguous: boolean;
	unknown_history: boolean;
	months: string[];
}

function summarizeUse(
	evidence: readonly SalaryUseEvidence[],
	source: SalaryAgreementSource | null,
	agreementId: number | null
): UseSummary {
	const status = summarizeSalaryUseEvidence(evidence);
	return {
		used:
			source !== null &&
			agreementId !== null &&
			status.agreements.some(
				(agreement) =>
					agreement.agreement_id === agreementId &&
					agreement.agreement_source === source
			),
		ambiguous: status.ambiguous,
		unknown_history: status.unknown_history,
		months: status.months,
	};
}

function groupProfiles(
	rows: readonly SalaryProfileRow[]
): Map<number, SalaryProfileRow[]> {
	const grouped = new Map<number, SalaryProfileRow[]>();
	for (const row of rows) {
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) continue;
		const existing = grouped.get(employeeId);
		if (existing === undefined) grouped.set(employeeId, [row]);
		else existing.push(row);
	}
	return grouped;
}

function groupUseEvidence(
	rows: readonly SalaryUseEvidence[]
): Map<number, SalaryUseEvidence[]> {
	const grouped = new Map<number, SalaryUseEvidence[]>();
	for (const row of rows) {
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) continue;
		const existing = grouped.get(employeeId);
		if (existing === undefined) grouped.set(employeeId, [row]);
		else existing.push(row);
	}
	return grouped;
}

function batchProfile(
	profile: Record<string, unknown> | null,
	full: boolean
): Record<string, unknown> | null {
	if (profile === null) return null;
	if (full) return { ...profile };
	const lightweight: Record<string, unknown> = {};
	for (const key of [
		'pl_total',
		'gross_salary',
		'salary_type',
		'effective_from',
		'effective_to',
	]) {
		if (key in profile) lightweight[key] = profile[key];
	}
	return lightweight;
}

function batchEntry(
	employee: NormalizedEmployee,
	period: SalaryPeriod,
	canonical: readonly SalaryProfileRow[],
	legacy: readonly SalaryProfileRow[],
	useEvidence: readonly SalaryUseEvidence[],
	timelineVersion: number,
	full: boolean
): SalaryProfileBatchEntry {
	const { anchor, employed } = anchorFor(period, employee.employment_start);
	const resolution = employed
		? resolveEmployeeAgreement(canonical, legacy, employee.id, anchor)
		: UNAVAILABLE;
	const use = summarizeUse(
		useEvidence,
		resolution.source,
		resolution.agreement_id
	);
	const profile = resolution.state === 'selected' ? resolution.profile : null;

	return {
		employee_id: employee.id,
		state: resolution.state,
		anchor,
		source: resolution.source,
		agreement_id: resolution.agreement_id,
		conflict_ids: [...resolution.conflict_ids],
		conflict_source: resolution.conflict_source,
		salary_type: resolution.salary_type,
		pay_stream:
			resolution.salary_type === null
				? null
				: salaryPayStream(resolution.salary_type),
		effective_from: resolution.effective_from,
		effective_to: resolution.effective_to,
		classification: resolution.classification,
		ctc: projectSalaryCtc(profile),
		timeline_version: timelineVersion,
		used: use.used,
		use_ambiguous: use.ambiguous,
		use_unknown_history: use.unknown_history,
		use_months: use.months,
		profile: batchProfile(profile, full),
	};
}

/** Pure directory projection; also used by the bulk loader. */
export function buildSalaryDirectory(
	input: SalaryDirectoryBuildInput
): SalaryProfileDirectoryResult {
	const page = input.page ?? 1;
	const limit = input.limit ?? DIRECTORY_DEFAULT_LIMIT;
	const needle = (input.search ?? '').trim().toLowerCase();
	const employees = normalizeEmployees(input.employees).filter((employee) =>
		matchesSearch(employee, needle)
	);
	const canonical = groupProfiles(input.canonical ?? []);
	const legacy = groupProfiles(input.legacy ?? []);
	const useEvidence = groupUseEvidence(input.useEvidence ?? []);
	const versions = input.timelineVersions ?? new Map<number, number>();

	const allRows = employees.map((employee): SalaryDirectoryRow => {
		const entry = batchEntry(
			employee,
			input.period,
			canonical.get(employee.id) ?? [],
			legacy.get(employee.id) ?? [],
			useEvidence.get(employee.id) ?? [],
			versions.get(employee.id) ?? 0,
			true
		);
		const agreement =
			entry.state === 'selected' &&
			entry.agreement_id !== null &&
			entry.source !== null &&
			entry.salary_type !== null &&
			entry.effective_from !== null &&
			entry.classification !== null
				? {
						agreement_id: entry.agreement_id,
						source: entry.source,
						salary_type: entry.salary_type,
						pay_stream: salaryPayStream(entry.salary_type),
						effective_from: entry.effective_from,
						effective_to: entry.effective_to,
						classification: entry.classification,
						used: entry.used,
						ctc: entry.ctc,
					}
				: null;
		return {
			id: employee.id,
			employee_id: employee.employee_id,
			full_name: employee.full_name,
			department: employee.department,
			employee_type: employee.employee_type,
			status: employee.status,
			joining_date: employee.joining_date,
			hire_date: employee.hire_date,
			exit_date: employee.exit_date,
			has_agreement: entry.state !== 'unavailable',
			state: entry.state,
			anchor: entry.anchor,
			agreement,
			conflict_ids: entry.conflict_ids,
			conflict_source: entry.conflict_source,
			timeline_version: entry.timeline_version,
			use_ambiguous: entry.use_ambiguous,
			use_unknown_history: entry.use_unknown_history,
			use_months: entry.use_months,
		};
	});

	const counts: SalaryDirectoryCounts = {
		total: allRows.length,
		payroll: 0,
		contract: 0,
		missing: 0,
		ambiguous: 0,
	};
	for (const row of allRows) {
		if (row.state === 'unavailable') counts.missing += 1;
		else if (row.state === 'ambiguous') counts.ambiguous += 1;
		else if (row.agreement?.pay_stream === 'contract') counts.contract += 1;
		else counts.payroll += 1;
	}

	const stream = input.stream ?? 'all';
	const filtered =
		stream === 'all'
			? allRows
			: allRows.filter((row) => {
					if (stream === 'missing') return row.state === 'unavailable';
					return row.agreement?.pay_stream === stream;
				});

	filtered.sort((left, right) => {
		const leftName = left.full_name.toLowerCase();
		const rightName = right.full_name.toLowerCase();
		if (leftName < rightName) return -1;
		if (leftName > rightName) return 1;
		return left.id - right.id;
	});

	const start = (page - 1) * limit;
	return {
		period: input.period,
		as_of: input.period.date ?? input.period.start,
		page,
		limit,
		total: filtered.length,
		counts,
		data: filtered.slice(start, start + limit),
	};
}

/** Pure batch projection; also used by the bulk loader and resolve read. */
export function buildSalaryProfileBatch(
	input: SalaryBatchBuildInput
): SalaryProfileBatchResult {
	const employees = normalizeEmployees(input.employees);
	const canonical = groupProfiles(input.canonical ?? []);
	const legacy = groupProfiles(input.legacy ?? []);
	const useEvidence = groupUseEvidence(input.useEvidence ?? []);
	const versions = input.timelineVersions ?? new Map<number, number>();
	const requested =
		input.requestedIds === undefined ? null : uniqueSorted(input.requestedIds);
	const requestedSet = requested === null ? null : new Set(requested);
	const present = new Set(employees.map((employee) => employee.id));

	const data: Record<string, SalaryProfileBatchEntry> = {};
	for (const employee of employees) {
		if (requestedSet !== null && !requestedSet.has(employee.id)) continue;
		data[String(employee.id)] = batchEntry(
			employee,
			input.period,
			canonical.get(employee.id) ?? [],
			legacy.get(employee.id) ?? [],
			useEvidence.get(employee.id) ?? [],
			versions.get(employee.id) ?? 0,
			input.full === true
		);
	}

	return {
		period: input.period,
		as_of: input.period.date ?? input.period.start,
		data,
		missing_ids:
			requested === null
				? []
				: requested.filter((employeeId) => !present.has(employeeId)),
	};
}

function payrollUseEvidenceFromRow(
	row: Record<string, unknown>
): SalaryUseEvidence | null {
	const id = positiveInteger(row.id);
	const employeeId = positiveInteger(row.employee_id);
	if (id === null || employeeId === null) return null;
	const source = isAgreementSource(row.agreement_source)
		? row.agreement_source
		: null;
	// A missing/malformed id stays null so the summary keeps it ambiguous
	// instead of silently dropping prior-use evidence.
	const agreementId =
		source === null ? null : positiveInteger(row.agreement_id);
	const evidence = row.evidence;
	if (!isUseSource(evidence)) return null;
	let evidenceContext: Record<string, unknown> | null = null;
	if (typeof row.evidence_context === 'string' && row.evidence_context.trim()) {
		try {
			const parsed: unknown = JSON.parse(row.evidence_context);
			if (
				parsed !== null &&
				typeof parsed === 'object' &&
				!Array.isArray(parsed)
			) {
				evidenceContext = parsed as Record<string, unknown>;
			}
		} catch {
			evidenceContext = null;
		}
	}
	return {
		id,
		employee_id: employeeId,
		month: dateText(row.month),
		agreement_id: agreementId,
		agreement_source: source,
		evidence,
		is_ambiguous: flagValue(row.is_ambiguous),
		evidence_context: evidenceContext,
		first_used_by: positiveInteger(row.first_used_by),
		first_used_at: dateTimeText(row.first_used_at),
	};
}

function employeesFromRows(value: unknown): SalaryDirectoryEmployeeRow[] {
	return rowsOf(value)
		.map((row) => {
			const id = positiveInteger(row.id);
			const employeeId = textValue(row.employee_id);
			if (id === null || employeeId === null) return null;
			return {
				id,
				employee_id: employeeId,
				first_name: textValue(row.first_name),
				last_name: textValue(row.last_name),
				department: textValue(row.department),
				employee_type: textValue(row.employee_type),
				status: textValue(row.status),
				joining_date: dateText(row.joining_date),
				hire_date: dateText(row.hire_date),
				exit_date: dateText(row.exit_date),
			} satisfies SalaryDirectoryEmployeeRow;
		})
		.filter((row): row is SalaryDirectoryEmployeeRow => row !== null);
}

interface LoadedProjection {
	canonical: SalaryProfileRow[];
	legacy: SalaryProfileRow[];
	timelineVersions: Map<number, number>;
	useEvidence: SalaryUseEvidence[];
}

async function loadProjection(
	db: SalaryDirectoryDb,
	employeeIds: readonly number[],
	period: SalaryPeriod
): Promise<LoadedProjection> {
	const ids = uniqueSorted(employeeIds);
	const canonical: SalaryProfileRow[] = [];
	const legacy: SalaryProfileRow[] = [];
	const timelineVersions = new Map<number, number>();
	const useEvidence: SalaryUseEvidence[] = [];
	if (ids.length === 0) {
		return { canonical, legacy, timelineVersions, useEvidence };
	}

	for (const chunk of chunks(ids, EMPLOYEE_QUERY_CHUNK)) {
		const inClause = placeholders(chunk.length);
		const [canonicalResult] = await db.execute(
			`SELECT *
         FROM employee_salary_profile
        WHERE employee_id IN (${inClause})
          AND is_active = 1
          AND cancelled_at IS NULL
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY employee_id ASC, effective_from ASC, id ASC`,
			[...chunk, period.end, period.start]
		);
		canonical.push(...(rowsOf(canonicalResult) as SalaryProfileRow[]));

		const [legacyResult] = await db.execute(
			`SELECT *
         FROM salary_structures
        WHERE employee_id IN (${inClause})
          AND is_active = 1
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY employee_id ASC, effective_from ASC, id ASC`,
			[...chunk, period.end, period.start]
		);
		legacy.push(...(rowsOf(legacyResult) as SalaryProfileRow[]));

		const [timelineResult] = await db.execute(
			`SELECT employee_id, version
         FROM employee_salary_timelines
        WHERE employee_id IN (${inClause})
        ORDER BY employee_id ASC`,
			chunk
		);
		for (const row of rowsOf(timelineResult)) {
			const employeeId = positiveInteger(row.employee_id);
			const version = nonNegativeInteger(row.version);
			if (employeeId !== null && version !== null) {
				timelineVersions.set(employeeId, version);
			}
		}

		const [useResult] = await db.execute(
			`SELECT id, employee_id, month, agreement_id, agreement_source,
              evidence, is_ambiguous, evidence_context, first_used_by,
              first_used_at
         FROM employee_salary_payroll_use
        WHERE employee_id IN (${inClause})
        ORDER BY employee_id ASC, first_used_at ASC, id ASC`,
			chunk
		);
		for (const row of rowsOf(useResult)) {
			const evidence = payrollUseEvidenceFromRow(row);
			if (evidence !== null) useEvidence.push(evidence);
		}
	}

	return { canonical, legacy, timelineVersions, useEvidence };
}

async function loadLiveEmployees(
	db: SalaryDirectoryDb,
	ids?: readonly number[]
): Promise<SalaryDirectoryEmployeeRow[]> {
	if (ids === undefined) {
		const [result] = await db.execute(
			`SELECT ${EMPLOYEE_COLUMNS}
         FROM employees
        WHERE isDelete = 0
        ORDER BY id ASC`
		);
		return employeesFromRows(result);
	}

	const sorted = uniqueSorted(ids);
	const employees: SalaryDirectoryEmployeeRow[] = [];
	for (const chunk of chunks(sorted, EMPLOYEE_QUERY_CHUNK)) {
		const [result] = await db.execute(
			`SELECT ${EMPLOYEE_COLUMNS}
         FROM employees
        WHERE isDelete = 0
          AND id IN (${placeholders(chunk.length)})
        ORDER BY id ASC`,
			chunk
		);
		employees.push(...employeesFromRows(result));
	}
	return employees;
}

async function loadEmployeesWithAgreements(
	db: SalaryDirectoryDb
): Promise<SalaryDirectoryEmployeeRow[]> {
	const [result] = await db.execute(
		`SELECT ${EMPLOYEE_COLUMNS}
       FROM employees e
      WHERE e.isDelete = 0
        AND (
          EXISTS (
            SELECT 1
              FROM employee_salary_profile sp
             WHERE sp.employee_id = e.id
               AND sp.is_active = 1
               AND sp.cancelled_at IS NULL
          )
          OR EXISTS (
            SELECT 1
              FROM salary_structures ss
             WHERE ss.employee_id = e.id
               AND ss.is_active = 1
          )
        )
      ORDER BY e.id ASC`
	);
	return employeesFromRows(result);
}

/**
 * Bulk directory read. Fetching the live Employee projection first keeps the
 * subsequent agreement/timeline/use reads batched by Employee ids; there is no
 * per-Employee directory query.
 */
export async function loadSalaryProfileDirectory(
	db: SalaryDirectoryDb,
	query: SalaryDirectoryQuery
): Promise<SalaryProfileDirectoryResult> {
	const employees = await loadLiveEmployees(db);
	const needle = query.search.trim().toLowerCase();
	const matching = normalizeEmployees(employees).filter((employee) =>
		matchesSearch(employee, needle)
	);
	if (matching.length === 0) {
		return buildSalaryDirectory({
			employees: [],
			period: query.period,
			search: query.search,
			stream: query.stream,
			page: query.page,
			limit: query.limit,
		});
	}
	const projection = await loadProjection(
		db,
		matching.map((employee) => employee.id),
		query.period
	);
	return buildSalaryDirectory({
		employees: matching,
		...projection,
		period: query.period,
		search: query.search,
		stream: query.stream,
		page: query.page,
		limit: query.limit,
	});
}

/**
 * Bulk period read. Requested ids receive explicit `unavailable`/`ambiguous`
 * entries; unknown or soft-deleted ids are reported through `missing_ids`.
 */
export async function loadSalaryProfileBatch(
	db: SalaryDirectoryDb,
	query: SalaryBatchQuery
): Promise<SalaryProfileBatchResult> {
	const employees =
		query.ids === undefined
			? await loadEmployeesWithAgreements(db)
			: await loadLiveEmployees(db, query.ids);
	const projection = await loadProjection(
		db,
		employees.map((employee) => employee.id),
		query.period
	);
	return buildSalaryProfileBatch({
		employees,
		...projection,
		period: query.period,
		requestedIds: query.ids,
		full: query.full,
	});
}

/**
 * One-Employee requested-period read for callers that need the full normalized
 * profile and disclosed CTC. Returns null when the Employee is not live.
 */
export async function loadSalaryProfileResolution(
	db: SalaryDirectoryDb,
	employeeId: number,
	query: SalaryResolveQuery
): Promise<SalaryProfileResolution | null> {
	const id = positiveInteger(employeeId);
	if (id === null) {
		throw new SalaryProfileQueryError(`Invalid employee_id "${employeeId}"`);
	}
	const [result] = await db.execute(
		`SELECT ${EMPLOYEE_COLUMNS}
       FROM employees
      WHERE id = ?
        AND isDelete = 0
      LIMIT 1`,
		[id]
	);
	const employeeRow = employeesFromRows(result)[0];
	if (employeeRow === undefined) return null;
	const employee = normalizeEmployees([employeeRow])[0];
	if (employee === undefined) return null;

	const canonical = await readSalaryAgreements(db, id, {
		source: 'employee_salary_profile',
	});
	const legacy = await readSalaryAgreements(db, id, {
		source: 'salary_structures',
	});
	const timelineVersion = await readSalaryTimelineVersion(db, id);
	const useEvidence = await readSalaryUseEvidence(db, id);

	const batch = buildSalaryProfileBatch({
		employees: [employeeRow],
		canonical,
		legacy,
		timelineVersions: new Map([[id, timelineVersion]]),
		useEvidence,
		period: query.period,
		requestedIds: [id],
		full: true,
	});
	const entry = batch.data[String(id)];
	if (entry === undefined) return null;
	return {
		...entry,
		employee: {
			id: employee.id,
			employee_id: employee.employee_id,
			full_name: employee.full_name,
			department: employee.department,
			employee_type: employee.employee_type,
			status: employee.status,
			joining_date: employee.joining_date,
			hire_date: employee.hire_date,
			exit_date: employee.exit_date,
		},
	};
}
