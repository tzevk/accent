/**
 * Salary-use rollout audit/backfill (#452) — operational CLI and pure policy.
 *
 * Dry-run is the default and performs no writes. It reviews recorded Payroll
 * Slips, frozen Payroll Run roster provenance and Payroll Slip audit evidence
 * (including deleted slips), and flags agreements that need operator review.
 * Salary Profile mutation audit rows are deliberately not payroll use.
 *
 * `--apply` may only record durable use protection through the shared
 * source-qualified store helpers. It never edits agreement terms, deletes
 * history or invents an exact legacy agreement link: evidence that cannot prove
 * one source-qualified agreement/month is recorded as explicit ambiguity.
 *
 * The CLI reads the disposable loopback target from INTEGRATION_DB_* through
 * the existing leads-integration safety resolver. No target is defaulted.
 *
 * Run (Node 24 needs the declared strip-types flag):
 *   node --experimental-strip-types scripts/payroll/salary-use-backfill.ts
 *   node --experimental-strip-types scripts/payroll/salary-use-backfill.ts --apply
 *
 * Application helpers use extensionless relative imports. The `--apply` path
 * loads the store through a small Node `registerHooks` resolver for those
 * imports, so the executable runs the real store SQL instead of a copied
 * implementation.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
} from '../../src/lib/salary-profile-timeline.ts';
import type {
	SalaryAgreementResolution,
	SalaryAgreementSource,
	SalaryProfileRow,
} from '../../src/lib/salary-profile-timeline.ts';
import { SALARY_WRITE_ISOLATION_SQL } from '../../src/lib/salary-write-isolation.ts';
import {
	isSalaryCtcPresent,
	resolveSalaryCtc,
} from '../../src/lib/salary-ctc.ts';
import { gt, isZero, R } from '../../src/lib/money.ts';
import type { Connection } from '../leads-integration/support.ts';
import type {
	SalaryStoreDb,
	SalaryUseSource,
} from '../../src/lib/salary-profile-store.ts';

export type SalaryUseAuditSource = Extract<
	SalaryUseSource,
	'legacy_slip' | 'legacy_audit' | 'legacy_roster'
>;

export interface SalaryAgreementRecord {
	id: number;
	employee_id: number;
	source: SalaryAgreementSource;
	effective_from: string;
	effective_to: string | null;
	is_active: boolean;
	cancelled_at: string | null;
	employer_cost: string | number | null;
	gross_salary: string | number | null;
	gross: string | number | null;
	salary_type: string | null;
}

export interface SalaryEmployeeRecord {
	employee_id: number;
	joining_date: string | null;
	hire_date: string | null;
	is_delete: boolean;
}

export interface SalarySlipEvidenceRow {
	id: number | string | null;
	employee_id: number | string | null;
	month: string | null;
	salary_profile_id: number | string | null;
	salary_profile_source: string | null;
	created_at: string | null;
}

export interface SalaryRosterEvidenceRow {
	run_id: number | string | null;
	month: string | null;
	version: number | string | null;
	members: unknown;
	frozen_at: string | null;
}

export interface SalaryAuditEvidenceRow {
	id: number | string | null;
	employee_id: number | string | null;
	action: string | null;
	month: number | string | null;
	year: number | string | null;
	old_values: unknown;
	new_values: unknown;
	performed_at: string | null;
}

export interface IgnoredSalaryMutationAudits {
	salary_profile: number;
	salary_structure: number;
}

export interface ExistingSalaryUseRow {
	employee_id: number;
	month: string | null;
	agreement_id: number | null;
	agreement_source: SalaryAgreementSource | null;
	is_ambiguous: boolean;
}

export interface SalaryUseAuditInput {
	agreements: readonly SalaryAgreementRecord[];
	employees?: readonly SalaryEmployeeRecord[];
	slips: readonly SalarySlipEvidenceRow[];
	rosters: readonly SalaryRosterEvidenceRow[];
	payroll_audits: readonly SalaryAuditEvidenceRow[];
	ignored_salary_mutation_audits?: IgnoredSalaryMutationAudits;
	existing_use?: readonly ExistingSalaryUseRow[];
}

export interface AgreementRef {
	employee_id: number;
	agreement_id: number;
	agreement_source: SalaryAgreementSource;
	effective_from: string;
	effective_to: string | null;
}

export interface AgreementOverlapFinding {
	employee_id: number;
	left: AgreementRef;
	right: AgreementRef;
	same_source: boolean;
}

export interface MissingCanonicalCtcFinding extends AgreementRef {
	salary_type: string | null;
	legacy_fallback: {
		source: 'gross_salary' | 'gross';
		amount: string;
	} | null;
}

export interface InvalidCanonicalCtcFinding extends AgreementRef {
	reason: 'not-finite' | 'negative' | 'out-of-range';
}

export interface ZeroCtcLegacyGrossFinding extends AgreementRef {
	employer_cost: string;
	legacy_amounts: Array<{
		field: 'gross_salary' | 'gross';
		amount: string;
	}>;
}

export interface MalformedAgreementFinding {
	employee_id: number;
	agreement_id: number;
	agreement_source: SalaryAgreementSource;
	reason: string;
}

export interface SalaryAgreementAudit {
	total: number;
	eligible: number;
	malformed: MalformedAgreementFinding[];
	overlaps: AgreementOverlapFinding[];
	missing_canonical_ctc: MissingCanonicalCtcFinding[];
	invalid_canonical_ctc: InvalidCanonicalCtcFinding[];
	zero_ctc_with_positive_legacy_gross: ZeroCtcLegacyGrossFinding[];
}

export type SalaryUsePlanUnit =
	| {
			kind: 'exact';
			employee_id: number;
			month: string;
			agreement_id: number;
			agreement_source: SalaryAgreementSource;
			evidence: SalaryUseAuditSource;
			evidence_context: Record<string, unknown>;
			first_used_at: string | null;
			already_protected: boolean;
			ambiguous_prior: boolean;
	  }
	| {
			kind: 'ambiguous';
			employee_id: number;
			month: string | null;
			evidence: SalaryUseAuditSource;
			evidence_context: Record<string, unknown>;
			first_used_at: string | null;
			already_protected: boolean;
			reason: string;
	  };

export interface SalaryUsePlanSummary {
	exact_units: number;
	ambiguous_units: number;
	unknown_month_units: number;
	already_protected_units: number;
	ambiguous_prior_units: number;
}

export interface SalaryEvidenceAudit {
	source_counts: {
		slips: number;
		rosters: number;
		payroll_slip_audits: number;
		deleted_slip_audits: number;
		unattributed_payroll_slip_audits: number;
		ignored_salary_mutation_audits: IgnoredSalaryMutationAudits;
	};
	units: SalaryUsePlanUnit[];
}

export interface SalaryUseAuditPlan {
	agreements: SalaryAgreementAudit;
	evidence: SalaryEvidenceAudit;
	summary: SalaryUsePlanSummary;
}

export interface SalaryUseRecorder {
	recordExact(input: {
		employee_id: number;
		month: string;
		agreement_id: number;
		agreement_source: SalaryAgreementSource;
		evidence: SalaryUseAuditSource;
		evidence_context: Record<string, unknown>;
	}): Promise<{
		recorded: boolean;
		ambiguous_prior: boolean;
		timeline_version: number;
	}>;
	recordAmbiguous(input: {
		employee_id: number;
		month: string | null;
		evidence: SalaryUseAuditSource;
		evidence_context: Record<string, unknown>;
	}): Promise<{ recorded: boolean; timeline_version: number }>;
}

export type SalaryUseApplyUnitResult = SalaryUsePlanUnit & {
	recorded: boolean;
	ambiguous_prior?: boolean;
	timeline_version?: number;
};

export interface SalaryUseApplyResult {
	units: SalaryUseApplyUnitResult[];
	summary: {
		exact_attempted: number;
		ambiguous_attempted: number;
		recorded: number;
		already_recorded: number;
		timeline_advances: number;
	};
}

// The store is imported only after registerHooks installs the extensionless
// TypeScript resolver, so its module type is intentionally derived dynamically.
type SalaryStoreModule = typeof import('../../src/lib/salary-profile-store.ts');

interface NormalizedAgreement extends SalaryAgreementRecord {
	effective_from: string;
	effective_to: string | null;
}

interface NormalizedAgreements {
	eligible: NormalizedAgreement[];
	malformed: MalformedAgreementFinding[];
}

interface EvidenceBucket {
	employee_id: number;
	month: string | null;
	slip_ids: Set<number>;
	slip_identities: Set<string>;
	roster_run_ids: Set<number>;
	roster_versions: Set<number>;
	roster_identities: Set<string>;
	audit_ids: Set<number>;
	audit_actions: Set<string>;
	audit_identities: Set<string>;
	first_used_at: string | null;
}

interface ExistingUseIndex {
	exact: Set<string>;
	ambiguousPrior: Map<number, Set<string | null>>;
	ambiguousProtection: Map<number, Set<string | null>>;
}

interface CandidateAgreement {
	agreement_id: number;
	agreement_source: SalaryAgreementSource;
}

const LEGACY_EVIDENCE_PRIORITY: readonly SalaryUseAuditSource[] = [
	'legacy_roster',
	'legacy_slip',
	'legacy_audit',
];

const AGREEMENT_SOURCES: readonly SalaryAgreementSource[] = [
	'employee_salary_profile',
	'salary_structures',
];

const USAGE = `Usage: node --experimental-strip-types scripts/payroll/salary-use-backfill.ts [--apply] [--employee <id> ...]

Dry-run is the default and performs no writes. --apply records only durable
salary-use protection through the shared store helpers; it never edits
agreements. --employee limits the audit to the given Employee ids.

The target is read from INTEGRATION_DB_HOST, INTEGRATION_DB_PORT,
INTEGRATION_DB_NAME, INTEGRATION_DB_USER and INTEGRATION_DB_PASSWORD. It must
be a loopback disposable database whose name contains "integration".
`;

function fail(message: string): never {
	throw new Error(`[salary-use-backfill] ${message}`);
}

function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number > 0 ? number : null;
	}
	return null;
}

function text(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function decimalField(value: unknown): string | number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const parsed = text(value);
	return parsed;
}

function isoDayParts(value: string): {
	year: number;
	month: number;
	day: number;
} | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (match === null) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const check = new Date(Date.UTC(year, month - 1, day));
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day
	) {
		return null;
	}
	return { year, month, day };
}

function isoDay(value: unknown): string | null {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		const year = value.getFullYear();
		const month = String(value.getMonth() + 1).padStart(2, '0');
		const day = String(value.getDate()).padStart(2, '0');
		return isoDayParts(`${year}-${month}-${day}`) === null
			? null
			: `${year}-${month}-${day}`;
	}
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
	if (match === null) return null;
	return isoDayParts(match[1]) === null ? null : match[1];
}

function monthStart(value: unknown): string | null {
	const day = isoDay(value);
	return day === null ? null : `${day.slice(0, 7)}-01`;
}

function timestampText(value: unknown): string | null {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		return value.toISOString().slice(0, 19).replace('T', ' ');
	}
	const parsed = text(value);
	if (parsed === null) return null;
	return parsed.replace('T', ' ').slice(0, 19);
}

function earlier(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return left <= right ? left : right;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value !== 'string' || value.trim() === '') return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed !== null &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function isAgreementSource(value: unknown): value is SalaryAgreementSource {
	return (
		typeof value === 'string' &&
		AGREEMENT_SOURCES.includes(value as SalaryAgreementSource)
	);
}

function identityFromFields(
	source: unknown,
	id: unknown
): CandidateAgreement | null {
	if (!isAgreementSource(source)) return null;
	const agreementId = positiveInteger(id);
	return agreementId === null
		? null
		: { agreement_id: agreementId, agreement_source: source };
}

function identityKey(identity: CandidateAgreement): string {
	return `${identity.agreement_source}:${identity.agreement_id}`;
}

function splitIdentity(value: string): CandidateAgreement {
	const separator = value.indexOf(':');
	return {
		agreement_source: value.slice(0, separator) as SalaryAgreementSource,
		agreement_id: Number(value.slice(separator + 1)),
	};
}

function identityFromAudit(
	row: SalaryAuditEvidenceRow
): CandidateAgreement | null {
	for (const values of [row.old_values, row.new_values]) {
		const object = jsonObject(values);
		if (object === null) continue;
		const found = identityFromFields(
			object.salary_profile_source,
			object.salary_profile_id
		);
		if (found !== null) return found;
	}
	return null;
}

function parseRosterMembers(value: unknown): Array<Record<string, unknown>> {
	let members: unknown = value;
	if (typeof members === 'string') {
		try {
			members = JSON.parse(members);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(members)) return [];
	return members.filter(
		(member): member is Record<string, unknown> =>
			member !== null && typeof member === 'object' && !Array.isArray(member)
	);
}

function moneyText(value: string | number): string {
	return R(value).toFixed(2);
}

function isEligibleAgreement(row: SalaryAgreementRecord): boolean {
	return (
		Number(row.is_active ?? 1) !== 0 &&
		(row.cancelled_at === null || row.cancelled_at.trim() === '')
	);
}

function normalizeAgreements(
	rows: readonly SalaryAgreementRecord[]
): NormalizedAgreements {
	const eligible: NormalizedAgreement[] = [];
	const malformed: MalformedAgreementFinding[] = [];
	for (const row of rows) {
		const employeeId = positiveInteger(row.employee_id);
		const agreementId = positiveInteger(row.id);
		if (employeeId === null || agreementId === null) {
			malformed.push({
				employee_id: employeeId ?? 0,
				agreement_id: agreementId ?? 0,
				agreement_source: row.source,
				reason: 'invalid_identity',
			});
			continue;
		}
		const from = isoDay(row.effective_from);
		if (from === null) {
			malformed.push({
				employee_id: employeeId,
				agreement_id: agreementId,
				agreement_source: row.source,
				reason: 'invalid_effective_from',
			});
			continue;
		}
		const rawTo = row.effective_to;
		const to = rawTo === null || rawTo.trim() === '' ? null : isoDay(rawTo);
		if (rawTo !== null && rawTo.trim() !== '' && to === null) {
			malformed.push({
				employee_id: employeeId,
				agreement_id: agreementId,
				agreement_source: row.source,
				reason: 'invalid_effective_to',
			});
			continue;
		}
		if (to !== null && to < from) {
			malformed.push({
				employee_id: employeeId,
				agreement_id: agreementId,
				agreement_source: row.source,
				reason: 'inverted_effective_range',
			});
			continue;
		}
		if (!isEligibleAgreement(row)) continue;
		eligible.push({ ...row, effective_from: from, effective_to: to });
	}
	eligible.sort(
		(left, right) =>
			left.employee_id - right.employee_id ||
			left.effective_from.localeCompare(right.effective_from) ||
			left.source.localeCompare(right.source) ||
			left.id - right.id
	);
	return { eligible, malformed };
}

function agreementRef(row: NormalizedAgreement): AgreementRef {
	return {
		employee_id: row.employee_id,
		agreement_id: row.id,
		agreement_source: row.source,
		effective_from: row.effective_from,
		effective_to: row.effective_to,
	};
}

function buildAgreementAudit(
	total: number,
	normalized: NormalizedAgreements
): SalaryAgreementAudit {
	const overlaps: AgreementOverlapFinding[] = [];
	const missing: MissingCanonicalCtcFinding[] = [];
	const invalid: InvalidCanonicalCtcFinding[] = [];
	const zeroWithLegacyGross: ZeroCtcLegacyGrossFinding[] = [];

	const byEmployee = new Map<number, NormalizedAgreement[]>();
	for (const row of normalized.eligible) {
		const rows = byEmployee.get(row.employee_id) ?? [];
		rows.push(row);
		byEmployee.set(row.employee_id, rows);
	}
	for (const rows of byEmployee.values()) {
		for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < rows.length;
				rightIndex += 1
			) {
				const left = rows[leftIndex];
				const right = rows[rightIndex];
				const leftEnd = left.effective_to ?? '9999-12-31';
				const rightEnd = right.effective_to ?? '9999-12-31';
				if (
					left.effective_from <= rightEnd &&
					right.effective_from <= leftEnd
				) {
					overlaps.push({
						employee_id: left.employee_id,
						left: agreementRef(left),
						right: agreementRef(right),
						same_source: left.source === right.source,
					});
				}
			}
		}
	}

	for (const row of normalized.eligible) {
		if (row.source !== 'employee_salary_profile') continue;
		const resolution = resolveSalaryCtc({
			employer_cost: row.employer_cost,
			gross_salary: row.gross_salary,
			gross: row.gross,
		});
		if (resolution.status === 'invalid') {
			invalid.push({
				...agreementRef(row),
				reason: resolution.reason,
			});
			continue;
		}
		if (!isSalaryCtcPresent(row.employer_cost)) {
			missing.push({
				...agreementRef(row),
				salary_type: row.salary_type,
				legacy_fallback:
					resolution.status === 'resolved' && resolution.legacyFallback
						? {
								source: resolution.source as 'gross_salary' | 'gross',
								amount: moneyText(resolution.amount.toString()),
							}
						: null,
			});
			continue;
		}
		if (resolution.status !== 'resolved' || !isZero(resolution.amount)) {
			continue;
		}
		const legacyAmounts: ZeroCtcLegacyGrossFinding['legacy_amounts'] = [];
		for (const field of ['gross_salary', 'gross'] as const) {
			const value = row[field];
			if (isSalaryCtcPresent(value) && gt(value as string | number, 0)) {
				legacyAmounts.push({
					field,
					amount: moneyText(value as string | number),
				});
			}
		}
		if (legacyAmounts.length > 0) {
			zeroWithLegacyGross.push({
				...agreementRef(row),
				employer_cost: moneyText(row.employer_cost as string | number),
				legacy_amounts: legacyAmounts,
			});
		}
	}

	return {
		total,
		eligible: normalized.eligible.length,
		malformed: normalized.malformed,
		overlaps,
		missing_canonical_ctc: missing,
		invalid_canonical_ctc: invalid,
		zero_ctc_with_positive_legacy_gross: zeroWithLegacyGross,
	};
}

function employeeJoiningById(
	employees: readonly SalaryEmployeeRecord[]
): Map<number, string | null> {
	const joining = new Map<number, string | null>();
	for (const employee of employees) {
		if (employee.is_delete) continue;
		const employeeId = positiveInteger(employee.employee_id);
		if (employeeId === null) continue;
		joining.set(
			employeeId,
			isoDay(employee.joining_date) ?? isoDay(employee.hire_date)
		);
	}
	return joining;
}

function salaryProfileRow(row: NormalizedAgreement): SalaryProfileRow {
	return {
		id: row.id,
		employee_id: row.employee_id,
		effective_from: row.effective_from,
		effective_to: row.effective_to,
		is_active: row.is_active ? 1 : 0,
		cancelled_at: row.cancelled_at,
		salary_type: row.salary_type,
		employer_cost: row.employer_cost,
		gross_salary: row.gross_salary,
		gross: row.gross,
	};
}

function candidateAgreementsFor(
	agreements: readonly NormalizedAgreement[],
	joiningByEmployee: Map<number, string | null>,
	employeeId: number,
	month: string
): CandidateAgreement[] {
	const joining = joiningByEmployee.get(employeeId) ?? null;
	let anchor: string;
	try {
		anchor = salaryMonthAnchor(month, joining);
	} catch {
		anchor = month;
	}
	const found = new Map<string, CandidateAgreement>();
	for (const source of AGREEMENT_SOURCES) {
		const rows = agreements
			.filter(
				(agreement) =>
					agreement.employee_id === employeeId && agreement.source === source
			)
			.map(salaryProfileRow);
		let resolution: SalaryAgreementResolution;
		try {
			resolution = resolveSalaryAgreementAt(rows, anchor, {
				source,
				employeeId,
			});
		} catch {
			continue;
		}
		if (resolution.state === 'selected' && resolution.agreement_id !== null) {
			const candidate = {
				agreement_id: resolution.agreement_id,
				agreement_source: source,
			};
			found.set(identityKey(candidate), candidate);
			continue;
		}
		if (resolution.state === 'ambiguous') {
			for (const agreementId of resolution.conflict_ids) {
				const candidate = {
					agreement_id: agreementId,
					agreement_source: source,
				};
				found.set(identityKey(candidate), candidate);
			}
		}
	}
	return [...found.values()].sort(
		(left, right) =>
			left.agreement_source.localeCompare(right.agreement_source) ||
			left.agreement_id - right.agreement_id
	);
}

function auditMonth(monthValue: unknown, yearValue: unknown): string | null {
	const month = positiveInteger(monthValue);
	const year = positiveInteger(yearValue);
	if (month === null || year === null || month > 12 || year < 1000) {
		return null;
	}
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

function ensureBucket(
	buckets: Map<string, EvidenceBucket>,
	employeeId: number,
	month: string | null
): EvidenceBucket {
	const key = `${employeeId}:${month ?? 'unknown'}`;
	let bucket = buckets.get(key);
	if (bucket === undefined) {
		bucket = {
			employee_id: employeeId,
			month,
			slip_ids: new Set(),
			slip_identities: new Set(),
			roster_run_ids: new Set(),
			roster_versions: new Set(),
			roster_identities: new Set(),
			audit_ids: new Set(),
			audit_actions: new Set(),
			audit_identities: new Set(),
			first_used_at: null,
		};
		buckets.set(key, bucket);
	}
	return bucket;
}

function sortedNumbers(values: Set<number>): number[] {
	return [...values].sort((left, right) => left - right);
}

function sortedStrings(values: Set<string>): string[] {
	return [...values].sort();
}

function evidenceContext(
	bucket: EvidenceBucket,
	candidates: readonly CandidateAgreement[]
): Record<string, unknown> {
	const context: Record<string, unknown> = {
		slip_ids: sortedNumbers(bucket.slip_ids),
		audit_log_ids: sortedNumbers(bucket.audit_ids),
		audit_actions: sortedStrings(bucket.audit_actions),
		roster_run_ids: sortedNumbers(bucket.roster_run_ids),
		roster_versions: sortedNumbers(bucket.roster_versions),
		candidate_agreements: candidates,
		first_used_at: bucket.first_used_at,
	};
	if (bucket.audit_ids.size > 0) context.audit_evidence = 'payroll_slip';
	return context;
}

function buildExistingUseIndex(
	rows: readonly ExistingSalaryUseRow[]
): ExistingUseIndex {
	const exact = new Set<string>();
	const ambiguousPrior = new Map<number, Set<string | null>>();
	const ambiguousProtection = new Map<number, Set<string | null>>();
	for (const row of rows) {
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) continue;
		if (row.is_ambiguous) {
			const months = ambiguousPrior.get(employeeId) ?? new Set<string | null>();
			months.add(row.month);
			ambiguousPrior.set(employeeId, months);
			if (row.agreement_id === null && row.agreement_source === null) {
				const protectedMonths =
					ambiguousProtection.get(employeeId) ?? new Set<string | null>();
				protectedMonths.add(row.month);
				ambiguousProtection.set(employeeId, protectedMonths);
			}
			continue;
		}
		if (
			row.month === null ||
			row.agreement_id === null ||
			row.agreement_source === null
		) {
			continue;
		}
		exact.add(
			`${employeeId}|${row.month}|${row.agreement_source}|${row.agreement_id}`
		);
	}
	return { exact, ambiguousPrior, ambiguousProtection };
}

function exactIsProtected(
	index: ExistingUseIndex,
	employeeId: number,
	month: string,
	source: SalaryAgreementSource,
	agreementId: number
): boolean {
	return index.exact.has(`${employeeId}|${month}|${source}|${agreementId}`);
}

function ambiguousPrior(
	index: ExistingUseIndex,
	employeeId: number,
	month: string
): boolean {
	const months = index.ambiguousPrior.get(employeeId);
	return months !== undefined && (months.has(null) || months.has(month));
}

function ambiguousIsProtected(
	index: ExistingUseIndex,
	employeeId: number,
	month: string | null
): boolean {
	return index.ambiguousProtection.get(employeeId)?.has(month) ?? false;
}

function compareMonths(left: string | null, right: string | null): number {
	if (left === right) return 0;
	if (left === null) return -1;
	if (right === null) return 1;
	return left.localeCompare(right);
}

function comparePlanUnits(
	left: SalaryUsePlanUnit,
	right: SalaryUsePlanUnit
): number {
	return (
		left.employee_id - right.employee_id ||
		compareMonths(left.month, right.month) ||
		(left.kind === right.kind ? 0 : left.kind === 'exact' ? -1 : 1) ||
		(left.kind === 'exact' && right.kind === 'exact'
			? left.agreement_source.localeCompare(right.agreement_source) ||
				left.agreement_id - right.agreement_id
			: 0)
	);
}

function buildEvidencePlan(
	input: SalaryUseAuditInput,
	agreements: readonly NormalizedAgreement[],
	joiningByEmployee: Map<number, string | null>,
	existingUse: ExistingUseIndex
): SalaryEvidenceAudit {
	const buckets = new Map<string, EvidenceBucket>();
	let deletedSlipAudits = 0;
	let unattributedPayrollSlipAudits = 0;

	for (const row of input.slips) {
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) continue;
		const month = monthStart(row.month);
		const bucket = ensureBucket(buckets, employeeId, month);
		const slipId = positiveInteger(row.id);
		if (slipId !== null) bucket.slip_ids.add(slipId);
		const identity = identityFromFields(
			row.salary_profile_source,
			row.salary_profile_id
		);
		if (identity !== null) {
			bucket.slip_identities.add(identityKey(identity));
		}
		bucket.first_used_at = earlier(
			bucket.first_used_at,
			timestampText(row.created_at)
		);
	}

	for (const row of input.rosters) {
		const month = monthStart(row.month);
		const runId = positiveInteger(row.run_id);
		const version = positiveInteger(row.version);
		for (const member of parseRosterMembers(row.members)) {
			const employeeId = positiveInteger(member.employee_id);
			if (employeeId === null) continue;
			const bucket = ensureBucket(buckets, employeeId, month);
			if (runId !== null) bucket.roster_run_ids.add(runId);
			if (version !== null) bucket.roster_versions.add(version);
			const identity = identityFromFields(
				member.profile_source,
				member.profile_id
			);
			if (identity !== null) {
				bucket.roster_identities.add(identityKey(identity));
			}
			bucket.first_used_at = earlier(
				bucket.first_used_at,
				timestampText(row.frozen_at)
			);
		}
	}

	for (const row of input.payroll_audits) {
		const action = text(row.action);
		if (action === 'delete') deletedSlipAudits += 1;
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) {
			unattributedPayrollSlipAudits += 1;
			continue;
		}
		const month = auditMonth(row.month, row.year);
		const bucket = ensureBucket(buckets, employeeId, month);
		const auditId = positiveInteger(row.id);
		if (auditId !== null) bucket.audit_ids.add(auditId);
		if (action !== null) bucket.audit_actions.add(action);
		const identity = identityFromAudit(row);
		if (identity !== null) {
			bucket.audit_identities.add(identityKey(identity));
		}
		bucket.first_used_at = earlier(
			bucket.first_used_at,
			timestampText(row.performed_at)
		);
	}

	const units: SalaryUsePlanUnit[] = [];
	for (const bucket of buckets.values()) {
		const candidates =
			bucket.month === null
				? []
				: candidateAgreementsFor(
						agreements,
						joiningByEmployee,
						bucket.employee_id,
						bucket.month
					);
		const context = evidenceContext(bucket, candidates);
		const sourceIdentities: Array<{
			evidence: SalaryUseAuditSource;
			identities: Set<string>;
		}> = LEGACY_EVIDENCE_PRIORITY.map((evidence) => ({
			evidence,
			identities:
				evidence === 'legacy_roster'
					? bucket.roster_identities
					: evidence === 'legacy_slip'
						? bucket.slip_identities
						: bucket.audit_identities,
		}));
		const conflicting = sourceIdentities.some(
			(entry) => entry.identities.size > 1
		);
		const singles = sourceIdentities.filter(
			(entry) => entry.identities.size === 1
		);
		const distinct = new Set(
			singles
				.map((entry) => [...entry.identities][0])
				.filter((value): value is string => value !== undefined)
		);

		if (!conflicting && distinct.size === 1 && bucket.month !== null) {
			const chosen = singles.find((entry) => entry.identities.size === 1);
			const identityText = chosen ? [...chosen.identities][0] : undefined;
			if (chosen !== undefined && identityText !== undefined) {
				const identity = splitIdentity(identityText);
				units.push({
					kind: 'exact',
					employee_id: bucket.employee_id,
					month: bucket.month,
					agreement_id: identity.agreement_id,
					agreement_source: identity.agreement_source,
					evidence: chosen.evidence,
					evidence_context: context,
					first_used_at: bucket.first_used_at,
					already_protected: exactIsProtected(
						existingUse,
						bucket.employee_id,
						bucket.month,
						identity.agreement_source,
						identity.agreement_id
					),
					ambiguous_prior: ambiguousPrior(
						existingUse,
						bucket.employee_id,
						bucket.month
					),
				});
				continue;
			}
		}

		const reason = conflicting
			? 'conflicting_legacy_provenance'
			: bucket.month === null
				? 'unproven_legacy_month'
				: 'unproven_legacy_provenance';
		const evidence =
			bucket.roster_identities.size > 0
				? 'legacy_roster'
				: bucket.slip_identities.size > 0 || bucket.slip_ids.size > 0
					? 'legacy_slip'
					: 'legacy_audit';
		units.push({
			kind: 'ambiguous',
			employee_id: bucket.employee_id,
			month: bucket.month,
			evidence,
			evidence_context: { ...context, reason },
			first_used_at: bucket.first_used_at,
			already_protected: ambiguousIsProtected(
				existingUse,
				bucket.employee_id,
				bucket.month
			),
			reason,
		});
	}

	units.sort(comparePlanUnits);
	return {
		source_counts: {
			slips: input.slips.length,
			rosters: input.rosters.length,
			payroll_slip_audits: input.payroll_audits.length,
			deleted_slip_audits: deletedSlipAudits,
			unattributed_payroll_slip_audits: unattributedPayrollSlipAudits,
			ignored_salary_mutation_audits: input.ignored_salary_mutation_audits ?? {
				salary_profile: 0,
				salary_structure: 0,
			},
		},
		units,
	};
}

function summarizePlan(
	units: readonly SalaryUsePlanUnit[]
): SalaryUsePlanSummary {
	return {
		exact_units: units.filter((unit) => unit.kind === 'exact').length,
		ambiguous_units: units.filter((unit) => unit.kind === 'ambiguous').length,
		unknown_month_units: units.filter(
			(unit) => unit.kind === 'ambiguous' && unit.month === null
		).length,
		already_protected_units: units.filter((unit) => unit.already_protected)
			.length,
		ambiguous_prior_units: units.filter(
			(unit) => unit.kind === 'exact' && unit.ambiguous_prior
		).length,
	};
}

/** Build the dry-run audit plan. This function performs no writes. */
export function buildSalaryUseAudit(
	input: SalaryUseAuditInput
): SalaryUseAuditPlan {
	const normalized = normalizeAgreements(input.agreements);
	const agreements = buildAgreementAudit(input.agreements.length, normalized);
	const joiningByEmployee = employeeJoiningById(input.employees ?? []);
	const existingUse = buildExistingUseIndex(input.existing_use ?? []);
	const evidence = buildEvidencePlan(
		input,
		normalized.eligible,
		joiningByEmployee,
		existingUse
	);
	return {
		agreements,
		evidence,
		summary: summarizePlan(evidence.units),
	};
}

/**
 * Record the plan through the caller's recorder. The shared store helpers are
 * idempotent, so replaying the same plan records each evidence identity once.
 */
export async function applySalaryUsePlan(
	plan: SalaryUseAuditPlan,
	recorder: SalaryUseRecorder
): Promise<SalaryUseApplyResult> {
	const results: SalaryUseApplyUnitResult[] = [];
	let recorded = 0;
	for (const unit of plan.evidence.units) {
		if (unit.kind === 'exact') {
			const result = await recorder.recordExact({
				employee_id: unit.employee_id,
				month: unit.month,
				agreement_id: unit.agreement_id,
				agreement_source: unit.agreement_source,
				evidence: unit.evidence,
				evidence_context: unit.evidence_context,
			});
			if (result.recorded) recorded += 1;
			results.push({
				...unit,
				recorded: result.recorded,
				ambiguous_prior: result.ambiguous_prior,
				timeline_version: result.timeline_version,
			});
			continue;
		}
		const result = await recorder.recordAmbiguous({
			employee_id: unit.employee_id,
			month: unit.month,
			evidence: unit.evidence,
			evidence_context: unit.evidence_context,
		});
		if (result.recorded) recorded += 1;
		results.push({
			...unit,
			recorded: result.recorded,
			timeline_version: result.timeline_version,
		});
	}
	return {
		units: results,
		summary: {
			exact_attempted: results.filter((unit) => unit.kind === 'exact').length,
			ambiguous_attempted: results.filter((unit) => unit.kind === 'ambiguous')
				.length,
			recorded,
			already_recorded: results.length - recorded,
			timeline_advances: recorded,
		},
	};
}

let resolverInstalled = false;
let storeModulePromise: Promise<SalaryStoreModule> | undefined;

function installTypeScriptResolver(): void {
	if (resolverInstalled) return;
	resolverInstalled = true;
	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (
				specifier.startsWith('.') &&
				path.extname(specifier) === '' &&
				typeof context.parentURL === 'string'
			) {
				for (const extension of ['.ts', '.tsx']) {
					const candidate = new URL(specifier + extension, context.parentURL);
					if (existsSync(fileURLToPath(candidate))) {
						return nextResolve(specifier + extension, context);
					}
				}
			}
			return nextResolve(specifier, context);
		},
	});
}

async function loadSalaryStoreModule(): Promise<SalaryStoreModule> {
	installTypeScriptResolver();
	// A static import cannot work: the store's extensionless application
	// imports must be resolved only after registerHooks is active.
	storeModulePromise ??= import('../../src/lib/salary-profile-store.ts');
	return storeModulePromise;
}

function createStoreDb(connection: Connection): SalaryStoreDb {
	return {
		async execute(sql, params = []) {
			const values = params.map((value) =>
				value === true ? 1 : value === false ? 0 : value
			);
			const result = await connection.execute(sql, [...values]);
			return result as [unknown, unknown];
		},
	};
}

function createRecorder(
	store: SalaryStoreModule,
	db: SalaryStoreDb
): SalaryUseRecorder {
	return {
		recordExact: (input) =>
			store.recordSalaryAgreementUse(db, {
				employeeId: input.employee_id,
				agreementId: input.agreement_id,
				agreementSource: input.agreement_source,
				month: input.month,
				evidence: input.evidence,
				evidenceContext: input.evidence_context,
				actorId: null,
			}),
		recordAmbiguous: (input) =>
			store.recordSalaryUseAmbiguity(db, {
				employeeId: input.employee_id,
				month: input.month,
				evidence: input.evidence,
				evidenceContext: input.evidence_context,
				actorId: null,
			}),
	};
}

async function selectRows(
	connection: Connection,
	sql: string,
	params: Array<string | number | null> = []
): Promise<Array<Record<string, unknown>>> {
	const [rows] = await connection.execute(sql, params);
	return rows;
}

function scopeFor(
	column: string,
	employeeIds: readonly number[]
): { sql: string; params: number[] } {
	if (employeeIds.length === 0) return { sql: '', params: [] };
	return {
		sql: ` AND ${column} IN (${employeeIds.map(() => '?').join(', ')})`,
		params: [...employeeIds],
	};
}

async function tableExists(
	connection: Connection,
	table: string
): Promise<boolean> {
	const [rows] = await connection.execute(
		`SELECT 1
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
      LIMIT 1`,
		[table]
	);
	return rows.length > 0;
}

function mapAgreement(
	row: Record<string, unknown>,
	source: SalaryAgreementSource
): SalaryAgreementRecord {
	return {
		id: positiveInteger(row.id) ?? 0,
		employee_id: positiveInteger(row.employee_id) ?? 0,
		source,
		effective_from: text(row.effective_from) ?? '',
		effective_to: text(row.effective_to),
		is_active: Number(row.is_active ?? 1) !== 0,
		cancelled_at: text(row.cancelled_at),
		employer_cost: decimalField(row.employer_cost),
		gross_salary: decimalField(row.gross_salary),
		gross: decimalField(row.gross),
		salary_type: text(row.salary_type),
	};
}

async function loadAuditInput(
	connection: Connection,
	employeeIds: readonly number[]
): Promise<SalaryUseAuditInput> {
	for (const table of [
		'employee_salary_profile',
		'employee_salary_payroll_use',
		'employee_salary_timelines',
		'payroll_slips',
		'payroll_audit_logs',
	]) {
		if (!(await tableExists(connection, table))) {
			fail(
				`missing required table ${table}; apply the #434 foundation migration before this audit.`
			);
		}
	}

	const employeeScope = scopeFor('id', employeeIds);
	const employeeRows = await selectRows(
		connection,
		`SELECT id, joining_date, hire_date, isDelete
       FROM employees
      WHERE 1 = 1${employeeScope.sql}
      ORDER BY id ASC`,
		employeeScope.params
	);
	const employees: SalaryEmployeeRecord[] = employeeRows
		.map((row) => {
			const employeeId = positiveInteger(row.id);
			if (employeeId === null) return null;
			return {
				employee_id: employeeId,
				joining_date: text(row.joining_date),
				hire_date: text(row.hire_date),
				is_delete: Number(row.isDelete ?? 0) !== 0,
			};
		})
		.filter((employee): employee is SalaryEmployeeRecord => employee !== null);

	const agreementScope = scopeFor('employee_id', employeeIds);
	const canonicalRows = await selectRows(
		connection,
		`SELECT id, employee_id, effective_from, effective_to, is_active,
              cancelled_at, employer_cost, gross_salary, gross, salary_type
         FROM employee_salary_profile
        WHERE 1 = 1${agreementScope.sql}
        ORDER BY employee_id ASC, effective_from ASC, id ASC`,
		agreementScope.params
	);
	const agreements: SalaryAgreementRecord[] = canonicalRows.map((row) =>
		mapAgreement(row, 'employee_salary_profile')
	);
	if (await tableExists(connection, 'salary_structures')) {
		const legacyRows = await selectRows(
			connection,
			`SELECT id, employee_id, effective_from, effective_to, is_active,
                NULL AS cancelled_at, NULL AS employer_cost, gross_salary,
                NULL AS gross, pay_type AS salary_type
           FROM salary_structures
          WHERE 1 = 1${agreementScope.sql}
          ORDER BY employee_id ASC, effective_from ASC, id ASC`,
			agreementScope.params
		);
		agreements.push(
			...legacyRows.map((row) => mapAgreement(row, 'salary_structures'))
		);
	}

	const slipScope = scopeFor('employee_id', employeeIds);
	const slipRows = await selectRows(
		connection,
		`SELECT id, employee_id, month, salary_profile_id,
              salary_profile_source, created_at
         FROM payroll_slips
        WHERE 1 = 1${slipScope.sql}
        ORDER BY employee_id ASC, month ASC, id ASC`,
		slipScope.params
	);
	const slips: SalarySlipEvidenceRow[] = slipRows.map((row) => ({
		id: positiveInteger(row.id),
		employee_id: positiveInteger(row.employee_id),
		month: text(row.month),
		salary_profile_id:
			row.salary_profile_id === null || row.salary_profile_id === undefined
				? null
				: String(row.salary_profile_id),
		salary_profile_source: text(row.salary_profile_source),
		created_at: text(row.created_at),
	}));

	const rosters: SalaryRosterEvidenceRow[] = [];
	if (await tableExists(connection, 'payroll_run_rosters')) {
		const rosterRows = await selectRows(
			connection,
			`SELECT run_id, month, version, members, frozen_at
         FROM payroll_run_rosters
        WHERE isDelete = 0
        ORDER BY month ASC, run_id ASC, version ASC`
		);
		const scope =
			employeeIds.length === 0 ? null : new Set<number>(employeeIds);
		for (const row of rosterRows) {
			const members = parseRosterMembers(row.members);
			rosters.push({
				run_id: positiveInteger(row.run_id),
				month: text(row.month),
				version: positiveInteger(row.version),
				members:
					scope === null
						? members
						: members.filter((member) => {
								const employeeId = positiveInteger(member.employee_id);
								return (
									scope !== null && employeeId !== null && scope.has(employeeId)
								);
							}),
				frozen_at: text(row.frozen_at),
			});
		}
	}

	const auditScope = scopeFor('employee_id', employeeIds);
	const payrollAuditRows = await selectRows(
		connection,
		`SELECT id, employee_id, action, month, year, old_values, new_values,
              performed_at
         FROM payroll_audit_logs
        WHERE entity_type = 'payroll_slip'${auditScope.sql}
        ORDER BY employee_id ASC, year ASC, month ASC, id ASC`,
		auditScope.params
	);
	const payrollAudits: SalaryAuditEvidenceRow[] = payrollAuditRows.map(
		(row) => ({
			id: positiveInteger(row.id),
			employee_id: positiveInteger(row.employee_id),
			action: text(row.action),
			month:
				row.month === null || row.month === undefined
					? null
					: Number(row.month),
			year:
				row.year === null || row.year === undefined ? null : Number(row.year),
			old_values: row.old_values,
			new_values: row.new_values,
			performed_at: text(row.performed_at),
		})
	);

	const ignoredRows = await selectRows(
		connection,
		`SELECT entity_type, COUNT(*) AS row_count
       FROM payroll_audit_logs
      WHERE entity_type IN ('salary_profile', 'salary_structure')${auditScope.sql}
      GROUP BY entity_type`,
		auditScope.params
	);
	const ignored: IgnoredSalaryMutationAudits = {
		salary_profile: 0,
		salary_structure: 0,
	};
	for (const row of ignoredRows) {
		const count = positiveInteger(row.row_count) ?? 0;
		if (row.entity_type === 'salary_profile') ignored.salary_profile = count;
		if (row.entity_type === 'salary_structure')
			ignored.salary_structure = count;
	}

	const useScope = scopeFor('employee_id', employeeIds);
	const useRows = await selectRows(
		connection,
		`SELECT employee_id, month, agreement_id, agreement_source, is_ambiguous
       FROM employee_salary_payroll_use
      WHERE 1 = 1${useScope.sql}
      ORDER BY employee_id ASC, month ASC, id ASC`,
		useScope.params
	);
	const existingUse: ExistingSalaryUseRow[] = [];
	for (const row of useRows) {
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) continue;
		const source = isAgreementSource(row.agreement_source)
			? row.agreement_source
			: null;
		existingUse.push({
			employee_id: employeeId,
			month: monthStart(row.month),
			agreement_id: source === null ? null : positiveInteger(row.agreement_id),
			agreement_source: source,
			is_ambiguous:
				row.is_ambiguous === 1 ||
				row.is_ambiguous === '1' ||
				row.is_ambiguous === true,
		});
	}

	return {
		agreements,
		employees,
		slips,
		rosters,
		payroll_audits: payrollAudits,
		ignored_salary_mutation_audits: ignored,
		existing_use: existingUse,
	};
}

function groupUnitsByEmployee(
	units: readonly SalaryUsePlanUnit[]
): Map<number, SalaryUsePlanUnit[]> {
	const groups = new Map<number, SalaryUsePlanUnit[]>();
	for (const unit of [...units].sort(comparePlanUnits)) {
		const group = groups.get(unit.employee_id) ?? [];
		group.push(unit);
		groups.set(unit.employee_id, group);
	}
	return groups;
}

async function applyWithConnection(
	connection: Connection,
	plan: SalaryUseAuditPlan
): Promise<SalaryUseApplyResult> {
	const store = await loadSalaryStoreModule();
	const recorder = createRecorder(store, createStoreDb(connection));
	const units: SalaryUseApplyUnitResult[] = [];
	const summary: SalaryUseApplyResult['summary'] = {
		exact_attempted: 0,
		ambiguous_attempted: 0,
		recorded: 0,
		already_recorded: 0,
		timeline_advances: 0,
	};

	const employeeGroups = [
		...groupUnitsByEmployee(plan.evidence.units).values(),
	];
	employeeGroups.sort(
		(left, right) => left[0].employee_id - right[0].employee_id
	);
	for (const employeeUnits of employeeGroups) {
		// Use evidence/timeline writes must run at READ COMMITTED for the same
		// reason the application salary writers do: REPEATABLE READ `FOR UPDATE`
		// gap locks on absent rows deadlock independent Employees.
		await connection.query(SALARY_WRITE_ISOLATION_SQL);
		await connection.execute('START TRANSACTION');
		try {
			const result = await applySalaryUsePlan(
				{
					...plan,
					evidence: { ...plan.evidence, units: employeeUnits },
				},
				recorder
			);
			await connection.execute('COMMIT');
			units.push(...result.units);
			summary.exact_attempted += result.summary.exact_attempted;
			summary.ambiguous_attempted += result.summary.ambiguous_attempted;
			summary.recorded += result.summary.recorded;
			summary.already_recorded += result.summary.already_recorded;
			summary.timeline_advances += result.summary.timeline_advances;
		} catch (error) {
			try {
				await connection.execute('ROLLBACK');
			} catch {
				// Keep the original failure; the connection is closed by `main`.
			}
			throw error;
		}
	}
	return { units, summary };
}

async function withReadOnlyTransaction<T>(
	connection: Connection,
	work: () => Promise<T>
): Promise<T> {
	await connection.execute('START TRANSACTION READ ONLY');
	try {
		return await work();
	} finally {
		await connection.execute('ROLLBACK');
	}
}

interface CliOptions {
	apply: boolean;
	employeeIds: number[];
	help: boolean;
}

function parseEmployeeId(value: string | undefined): number {
	const employeeId = positiveInteger(value);
	if (employeeId === null) {
		fail(
			`--employee requires a positive integer, got ${JSON.stringify(value)}.`
		);
	}
	return employeeId;
}

function parseArguments(args: readonly string[]): CliOptions {
	let apply = false;
	const employeeIds: number[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--help' || argument === '-h') {
			return { apply: false, employeeIds: [], help: true };
		}
		if (argument === '--apply') {
			if (apply) fail('--apply may be supplied once.');
			apply = true;
			continue;
		}
		if (argument === '--employee') {
			employeeIds.push(parseEmployeeId(args[index + 1]));
			index += 1;
			continue;
		}
		if (argument.startsWith('--employee=')) {
			employeeIds.push(parseEmployeeId(argument.slice('--employee='.length)));
			continue;
		}
		fail(`unknown argument ${JSON.stringify(argument)}.`);
	}
	return {
		apply,
		employeeIds: [...new Set(employeeIds)].sort((left, right) => left - right),
		help: false,
	};
}

function isMainModule(): boolean {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	try {
		return pathToFileURL(path.resolve(entry)).href === import.meta.url;
	} catch {
		return false;
	}
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(USAGE);
		return;
	}
	// Keep CLI-only dependencies (dotenv and the DB safety resolver) out of the
	// pure policy import graph used by the DB-free regression tests.
	await import('dotenv/config');
	const { connectReader, resolveSafetyTarget } =
		await import('../leads-integration/support.ts');
	const target = resolveSafetyTarget(process.env);
	const connection = await connectReader(target);
	try {
		const input = await withReadOnlyTransaction(connection, () =>
			loadAuditInput(connection, options.employeeIds)
		);
		const plan = buildSalaryUseAudit(input);
		const applied = options.apply
			? await applyWithConnection(connection, plan)
			: null;
		const report = {
			command: 'salary-use-backfill',
			mode: options.apply ? 'apply' : 'dry-run',
			target: { database: target.name, loopback: true },
			employee_scope:
				options.employeeIds.length === 0 ? null : options.employeeIds,
			audit: plan,
			apply: applied,
		};
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} finally {
		await connection.end();
	}
}

if (isMainModule() && process.env.VITEST !== 'true') {
	void main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : '';
		const safe =
			message.startsWith('[salary-use-backfill]') ||
			message.startsWith('[leads-integration]');
		console.error(
			`Salary-use backfill failed: ${
				safe
					? message
					: 'Database operation failed; driver details are suppressed to protect connection information.'
			}`
		);
		process.exitCode = 1;
	});
}
