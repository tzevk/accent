import { z } from 'zod';
import {
	SALARY_CTC_MAX,
	validateDailyHours,
	validateSalaryCtc,
} from '@/lib/salary-ctc';
import { R, toNumber } from '@/lib/money';
import {
	formatCurrency,
	formatDate,
	formatMonth,
	formatNumber,
} from '@/lib/format';
import {
	SALARY_OVERRIDE_FIELDS,
	getSalaryProfileOverrides,
} from '@/utils/payroll-calculation';
import type {
	SalaryCommandInput,
	SalaryCommandSettingsInput,
	SalaryTimelineAgreementDto,
	SalaryTimelineDto,
} from '@/lib/salary-profile-commands';

/**
 * Pure form state for the Salary Profiles editor (#444).
 *
 * The draft keeps text exactly as entered so a blank monthly CTC stays
 * missing and a typed zero stays a real zero. Money arithmetic is not done
 * here: validation uses the shared CTC/daily-hours validators, display uses
 * src/lib/format, and the estimate is the existing payroll calculator through
 * usePayrollPreview.
 */

export const UNSAVED_SALARY_MESSAGE =
	'You have unsaved salary changes. Leave this page and discard them?';

export type SalaryOperation = 'create-initial' | 'correct' | 'revise';

export const SALARY_TYPE_OPTIONS = [
	{ value: 'monthly', label: 'Monthly' },
	{ value: 'hourly', label: 'Hourly' },
	{ value: 'daily', label: 'Daily' },
	{ value: 'contract', label: 'Contract' },
	{ value: 'lumpsum', label: 'Lumpsum' },
	{ value: 'custom', label: 'Custom (legacy)' },
] as const;

export const DURATION_OPTIONS = [
	{ value: 'monthly', label: 'Monthly' },
	{ value: 'quarterly', label: 'Quarterly' },
	{ value: 'half_yearly', label: '6 Months' },
	{ value: 'yearly', label: 'Yearly' },
	{ value: 'project', label: 'Project' },
] as const;

export const APPLICABILITY_FIELDS = [
	{ key: 'pf_applicable', label: 'PF' },
	{ key: 'esic_applicable', label: 'ESIC' },
	{ key: 'pt_applicable', label: 'Professional Tax' },
	{ key: 'mlwf_applicable', label: 'MLWF' },
	{ key: 'retention_applicable', label: 'Retention' },
	{ key: 'bonus_applicable', label: 'Bonus' },
	{ key: 'monthly_bonus', label: 'Monthly Bonus' },
	{ key: 'incentive_applicable', label: 'Incentive' },
	{ key: 'insurance_applicable', label: 'Insurance' },
] as const;

export const OVERRIDE_LABELS: Record<string, string> = {
	basic: 'Basic',
	da: 'DA',
	hra: 'HRA',
	conveyance: 'Conveyance',
	call_allowance: 'Call allowance',
	incentive: 'Incentive',
	pf_employee: 'Employee PF',
	esic_employee: 'Employee ESIC',
	pt: 'Professional Tax',
	mlwf: 'MLWF',
	retention: 'Retention',
	pf_employer: 'Employer PF',
	esic_employer: 'Employer ESIC',
	mlwf_employer: 'Employer MLWF',
	bonus: 'Bonus',
	insurance: 'Insurance',
	tds_percentage: 'TDS percentage',
};

/**
 * Settings the Salary Profiles component editor can submit by name. The
 * estimate offers Other Allowances as a component override even though it is
 * also a first-class draft field, so the whitelist includes it. Keep the list
 * checked against the command interface so an arbitrary draft override key
 * can never become a command field.
 */
const SALARY_OVERRIDE_KEYS = [
	'basic',
	'da',
	'hra',
	'conveyance',
	'call_allowance',
	'other_allowances',
	'incentive',
	'pf_employee',
	'esic_employee',
	'pt',
	'mlwf',
	'retention',
	'pf_employer',
	'esic_employer',
	'mlwf_employer',
	'bonus',
	'insurance',
	'tds_percentage',
] as const satisfies readonly (keyof SalaryCommandSettingsInput)[];

type SalaryOverrideKey = (typeof SALARY_OVERRIDE_KEYS)[number];

const SALARY_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(
	SALARY_OVERRIDE_KEYS
);

function isSalaryOverrideKey(key: string): key is SalaryOverrideKey {
	return SALARY_OVERRIDE_KEY_SET.has(key);
}

type DraftSalaryCommandInput = SalaryCommandInput & {
	operation: SalaryOperation;
};

export interface SalaryDraft {
	salary_type: string;
	effective_from: string;
	employer_cost: string;
	std_hours_per_day: string;
	std_in_time: string;
	std_out_time: string;
	ot_multiplier: string;
	std_working_days: string;
	da_year: string;
	other_allowances: string;
	remarks: string;
	pl_total: string;
	loan_active: boolean;
	loan_amount: string;
	loan_amount_per_month: string;
	loan_no_of_months: string;
	loan_total_amount: string;
	advance_active: boolean;
	advance_amount: string;
	contract_duration: string;
	contract_end_date: string;
	pf_applicable: boolean;
	esic_applicable: boolean;
	pt_applicable: boolean;
	mlwf_applicable: boolean;
	retention_applicable: boolean;
	bonus_applicable: boolean;
	monthly_bonus: boolean;
	incentive_applicable: boolean;
	insurance_applicable: boolean;
	overrides: Record<string, string>;
}

export type ApplicabilityKey = (typeof APPLICABILITY_FIELDS)[number]['key'];

/* ---------------------------------------------------------------- primitives */

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const INTEGER_PATTERN = /^\d+$/;

export function hasValue(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

export function textValue(value: unknown): string {
	return hasValue(value) ? String(value) : '';
}

export function enabledFlag(value: unknown): boolean {
	return value === true || value === 1 || value === '1' || value === 'true';
}

function datePart(value: unknown): string {
	return textValue(value).slice(0, 10);
}

/**
 * Date-only strings from the salary APIs are calendar dates, not instants.
 * Parse them in local time before formatting so the displayed day/month is
 * stable across host timezones.
 */
function localCalendarDate(value: string, monthOnly = false): Date | null {
	const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
	if (!match) return null;
	const day = monthOnly ? 1 : Number(match[3] ?? 1);
	const date = new Date(Number(match[1]), Number(match[2]) - 1, day);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function displayDate(value: string | null | undefined): string {
	if (!value) return '—';
	const local = localCalendarDate(value);
	return formatDate(local ?? value);
}

export function displayMonth(value: string | null | undefined): string {
	if (!value) return '—';
	const local = localCalendarDate(value, true);
	return formatMonth(local ?? value);
}

function timePart(value: unknown): string {
	return textValue(value).slice(0, 5);
}

function isCalendarDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return (
		!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
	);
}

function isMoneyText(value: string): boolean {
	const text = value.trim();
	if (text === '') return true;
	if (!MONEY_PATTERN.test(text)) return false;
	const amount = R(text);
	return amount.isFinite() && !amount.isNegative() && amount.lte(99_999_999.99);
}

function isIntegerText(value: string, min: number, max: number): boolean {
	const text = value.trim();
	if (text === '') return true;
	if (!INTEGER_PATTERN.test(text)) return false;
	const parsed = Number(text);
	return parsed >= min && parsed <= max;
}

export function todayInput(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
		2,
		'0'
	)}-${String(now.getDate()).padStart(2, '0')}`;
}

export function monthInputOf(date: string): string {
	return DATE_PATTERN.test(date) ? date.slice(0, 7) : '';
}

export function monthStartOf(date: string): string {
	const month = monthInputOf(date);
	return month ? `${month}-01` : '';
}

export function nextMonthStart(monthStart: string): string {
	const match = /^(\d{4})-(\d{2})-01$/.exec(monthStart);
	if (!match) return '';
	const year = Number(match[1]);
	const month = Number(match[2]);
	const nextYear = month === 12 ? year + 1 : year;
	const nextMonth = month === 12 ? 1 : month + 1;
	return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

export function salaryTypeLabel(value: string | null | undefined): string {
	const raw = value ?? 'monthly';
	const option = SALARY_TYPE_OPTIONS.find((item) => item.value === raw);
	return option?.label ?? raw;
}

export function durationLabel(value: string | null | undefined): string {
	const option = DURATION_OPTIONS.find((item) => item.value === value);
	return option?.label ?? (value || 'Not recorded');
}

export function statusLabel(value: string | null | undefined): string {
	if (!value) return 'Status not set';
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatPeriod(
	from: string,
	to: string | null | undefined
): string {
	return `${displayDate(from)} – ${to ? displayDate(to) : 'Open-ended'}`;
}

export function agreementKey(agreement: SalaryTimelineAgreementDto): string {
	return `${agreement.agreement_source}:${agreement.agreement_id}`;
}

export function findAgreement(
	timeline: SalaryTimelineDto,
	key: string | null
): SalaryTimelineAgreementDto | null {
	if (!key) return null;
	return timeline.agreements.find((item) => agreementKey(item) === key) ?? null;
}

export function selectionAgreement(
	timeline: SalaryTimelineDto,
	selection: SalaryTimelineDto['current']
): SalaryTimelineAgreementDto | null {
	if (selection.state !== 'selected' || selection.agreement_id === null) {
		return null;
	}
	return (
		timeline.agreements.find(
			(item) =>
				item.agreement_id === selection.agreement_id &&
				item.agreement_source === selection.agreement_source
		) ?? null
	);
}

export function defaultViewedKey(timeline: SalaryTimelineDto): string | null {
	const current =
		selectionAgreement(timeline, timeline.current) ??
		selectionAgreement(timeline, timeline.legacy_current);
	if (current) return agreementKey(current);
	return timeline.agreements.length
		? agreementKey(timeline.agreements[timeline.agreements.length - 1])
		: null;
}

export function canCreateInitial(timeline: SalaryTimelineDto): boolean {
	return !timeline.agreements.some(
		(agreement) =>
			agreement.agreement_source === 'employee_salary_profile' &&
			agreement.classification !== 'cancelled'
	);
}

export function createStartFor(timeline: SalaryTimelineDto): string {
	const hasCanonicalHistory = timeline.agreements.some(
		(agreement) => agreement.agreement_source === 'employee_salary_profile'
	);
	const hasLegacy = timeline.agreements.some(
		(agreement) => agreement.agreement_source === 'salary_structures'
	);
	const protectedUse =
		timeline.use.used || timeline.use.ambiguous || timeline.use.unknown_history;
	const start = datePart(timeline.employee.employment_start);
	if (!hasCanonicalHistory && !hasLegacy && !protectedUse && start) {
		return start;
	}
	return monthStartOf(timeline.server_date) || todayInput();
}

export function revisionStartFor(
	agreement: SalaryTimelineAgreementDto,
	serverDate: string
): string {
	const serverMonth = monthStartOf(serverDate);
	const targetMonth = monthStartOf(agreement.effective_from);
	const later =
		targetMonth && serverMonth && targetMonth > serverMonth
			? targetMonth
			: serverMonth;
	return nextMonthStart(later) || serverMonth;
}

export function blockerExplanations(
	blockers: SalaryTimelineAgreementDto['action_blockers']
): string[] {
	return blockers
		.map((blocker) => {
			switch (blocker) {
				case 'permission':
					return 'You do not have payroll:update for salary changes.';
				case 'legacy_read_only':
					return 'Legacy salary structure — read-only.';
				case 'inactive':
					return 'Inactive agreement.';
				case 'cancelled':
					return 'Cancelled agreement — retained for history.';
				case 'previous':
					return 'Previous agreement — read-only.';
				case 'used':
					return 'Used by payroll. Editing is blocked so recorded payroll keeps its terms.';
				case 'ambiguous_use':
					return 'Payroll use for this agreement is ambiguous. Editing is blocked for review.';
				default:
					return '';
			}
		})
		.filter(Boolean);
}

/* -------------------------------------------------------------- draft mapping */

function overridesFromSettings(settings: Record<string, unknown>) {
	const stored = getSalaryProfileOverrides(settings) as Record<string, unknown>;
	const overrides: Record<string, string> = {};
	for (const key of SALARY_OVERRIDE_FIELDS) {
		const value = stored[key];
		if (hasValue(value)) overrides[key] = String(value);
	}
	return overrides;
}

export function createEmptyDraft(startDate: string): SalaryDraft {
	return {
		salary_type: 'monthly',
		effective_from: startDate,
		employer_cost: '',
		std_hours_per_day: '8',
		std_in_time: '09:00',
		std_out_time: '17:30',
		ot_multiplier: '',
		std_working_days: '',
		da_year: '',
		other_allowances: '',
		remarks: '',
		pl_total: '',
		loan_active: false,
		loan_amount: '',
		loan_amount_per_month: '',
		loan_no_of_months: '',
		loan_total_amount: '',
		advance_active: false,
		advance_amount: '',
		contract_duration: 'monthly',
		contract_end_date: '',
		pf_applicable: true,
		esic_applicable: false,
		pt_applicable: false,
		mlwf_applicable: false,
		retention_applicable: false,
		bonus_applicable: false,
		monthly_bonus: false,
		incentive_applicable: false,
		insurance_applicable: false,
		overrides: {},
	};
}

export function draftFromAgreement(
	agreement: SalaryTimelineAgreementDto
): SalaryDraft {
	const settings = agreement.settings ?? {};
	const storedType = textValue(settings.salary_type) || agreement.salary_type;
	return {
		salary_type: storedType || 'monthly',
		effective_from: datePart(agreement.effective_from),
		employer_cost: textValue(settings.employer_cost),
		std_hours_per_day: textValue(settings.std_hours_per_day),
		std_in_time: timePart(settings.std_in_time),
		std_out_time: timePart(settings.std_out_time),
		ot_multiplier: textValue(settings.ot_multiplier),
		std_working_days: textValue(settings.std_working_days),
		da_year: textValue(settings.da_year),
		other_allowances: textValue(settings.other_allowances),
		remarks: textValue(settings.remarks),
		pl_total: textValue(settings.pl_total),
		loan_active: enabledFlag(settings.loan_active),
		loan_amount: textValue(settings.loan_amount),
		loan_amount_per_month: textValue(settings.loan_amount_per_month),
		loan_no_of_months: textValue(settings.loan_no_of_months),
		loan_total_amount: textValue(settings.loan_total_amount),
		advance_active: enabledFlag(settings.advance_active),
		advance_amount: textValue(settings.advance_amount),
		contract_duration: textValue(settings.contract_duration) || 'monthly',
		contract_end_date: datePart(settings.contract_end_date),
		pf_applicable: enabledFlag(settings.pf_applicable),
		esic_applicable: enabledFlag(settings.esic_applicable),
		pt_applicable: enabledFlag(settings.pt_applicable),
		mlwf_applicable: enabledFlag(settings.mlwf_applicable),
		retention_applicable: enabledFlag(settings.retention_applicable),
		bonus_applicable: enabledFlag(settings.bonus_applicable),
		monthly_bonus: enabledFlag(settings.monthly_bonus),
		incentive_applicable: enabledFlag(settings.incentive_applicable),
		insurance_applicable: enabledFlag(settings.insurance_applicable),
		overrides: overridesFromSettings(settings),
	};
}

function sortedOverrides(overrides: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(overrides)
			.filter(([, value]) => value.trim() !== '')
			.sort(([left], [right]) => left.localeCompare(right))
	);
}

export function draftFingerprint(draft: SalaryDraft): string {
	return JSON.stringify({
		...draft,
		overrides: sortedOverrides(draft.overrides),
	});
}

export function draftIsDirty(draft: SalaryDraft, base: SalaryDraft): boolean {
	return draftFingerprint(draft) !== draftFingerprint(base);
}

/* --------------------------------------------------------------- calculation */

function assignIfPresent(
	target: Record<string, unknown>,
	key: string,
	value: string
) {
	const text = value.trim();
	if (text !== '') target[key] = text;
}

export function previewProfileFromDraft(
	draft: SalaryDraft
): Record<string, unknown> {
	const profile: Record<string, unknown> = {
		salary_type: draft.salary_type,
	};
	assignIfPresent(profile, 'employer_cost', draft.employer_cost);
	assignIfPresent(profile, 'std_hours_per_day', draft.std_hours_per_day);
	assignIfPresent(profile, 'std_working_days', draft.std_working_days);
	assignIfPresent(profile, 'other_allowances', draft.other_allowances);
	assignIfPresent(profile, 'std_in_time', draft.std_in_time);
	assignIfPresent(profile, 'std_out_time', draft.std_out_time);
	assignIfPresent(profile, 'ot_multiplier', draft.ot_multiplier);
	assignIfPresent(profile, 'da_year', draft.da_year);
	assignIfPresent(profile, 'pl_total', draft.pl_total);
	assignIfPresent(profile, 'loan_amount', draft.loan_amount);
	assignIfPresent(
		profile,
		'loan_amount_per_month',
		draft.loan_amount_per_month
	);
	assignIfPresent(profile, 'advance_amount', draft.advance_amount);
	profile.loan_active = draft.loan_active;
	profile.advance_active = draft.advance_active;
	for (const { key } of APPLICABILITY_FIELDS) {
		profile[key] = draft[key];
	}
	return profile;
}

export function previewProfileFromAgreement(
	agreement: SalaryTimelineAgreementDto
): Record<string, unknown> {
	const profile: Record<string, unknown> = { ...agreement.settings };
	if (agreement.ctc.legacy_fallback) {
		delete profile.employer_cost;
		if (
			agreement.ctc.source === 'gross' &&
			agreement.legacy_amounts.gross !== null
		) {
			profile.gross = agreement.legacy_amounts.gross;
		} else if (agreement.legacy_amounts.gross_salary !== null) {
			profile.gross_salary = agreement.legacy_amounts.gross_salary;
		}
	}
	return profile;
}

export function basisHoursFor(
	workingDays: number,
	hoursPerDay: string
): number | null {
	const hours = validateDailyHours(hoursPerDay.trim());
	if (!hours.valid) return null;
	return toNumber(R(workingDays).times(hours.hours).toDecimalPlaces(2));
}

/* ----------------------------------------------------------------- validation */

function optionalTextField(check: (value: string) => string | null) {
	return z.string().superRefine((value, ctx) => {
		const message = check(value);
		if (message) ctx.addIssue({ code: 'custom', message });
	});
}

const optionalMoney = optionalTextField((value) =>
	isMoneyText(value) ? null : 'Enter a valid non-negative amount'
);

const optionalInteger = (min: number, max: number, message: string) =>
	optionalTextField((value) =>
		isIntegerText(value, min, max) ? null : message
	);

const salaryDraftSchema = z.object({
	salary_type: optionalTextField((value) =>
		SALARY_TYPE_OPTIONS.some((option) => option.value === value)
			? null
			: 'Choose a supported Salary Type'
	),
	effective_from: optionalTextField((value) =>
		isCalendarDate(value) ? null : 'Choose the effective date'
	),
	employer_cost: optionalTextField((value) => {
		const text = value.trim();
		if (text === '') return 'Enter the monthly CTC';
		const resolution = validateSalaryCtc(text);
		if (resolution.valid) {
			return resolution.amount.decimalPlaces() > 2
				? 'Monthly CTC supports at most 2 decimal places'
				: null;
		}
		switch (resolution.reason) {
			case 'negative':
				return 'Monthly CTC cannot be negative';
			case 'out-of-range':
				return `Monthly CTC cannot exceed ${formatCurrency(SALARY_CTC_MAX)}`;
			default:
				return 'Enter a valid monthly CTC';
		}
	}),
	std_hours_per_day: optionalTextField((value) => {
		const text = value.trim();
		if (text === '') return 'Enter the standard daily hours';
		const resolution = validateDailyHours(text);
		if (resolution.valid) return null;
		return resolution.reason === 'nonpositive'
			? 'Standard daily hours must be greater than zero'
			: 'Enter a valid number of standard daily hours';
	}),
	std_in_time: optionalTextField((value) =>
		value.trim() === '' || TIME_PATTERN.test(value.trim())
			? null
			: 'Enter a time as HH:MM'
	),
	std_out_time: optionalTextField((value) =>
		value.trim() === '' || TIME_PATTERN.test(value.trim())
			? null
			: 'Enter a time as HH:MM'
	),
	ot_multiplier: optionalTextField((value) =>
		value.trim() === '' ||
		(/^\d+(\.\d{1,2})?$/.test(value.trim()) &&
			Number(value) >= 0.01 &&
			Number(value) <= 99.99)
			? null
			: 'Enter a multiplier between 0.01 and 99.99'
	),
	std_working_days: optionalInteger(
		1,
		31,
		'Enter whole working days between 1 and 31'
	),
	da_year: optionalInteger(1900, 2100, 'Enter a DA year between 1900 and 2100'),
	other_allowances: optionalMoney,
	remarks: z.string().max(2000, 'Remarks must be 2000 characters or fewer'),
	pl_total: optionalInteger(0, 365, 'Enter PL days between 0 and 365'),
	loan_amount: optionalMoney,
	loan_amount_per_month: optionalMoney,
	loan_no_of_months: optionalInteger(
		0,
		600,
		'Enter loan months between 0 and 600'
	),
	loan_total_amount: optionalMoney,
	advance_amount: optionalMoney,
	contract_duration: optionalTextField((value) =>
		value.trim() === '' ||
		DURATION_OPTIONS.some((option) => option.value === value.trim())
			? null
			: 'Choose a Contract duration'
	),
	contract_end_date: optionalTextField((value) =>
		value.trim() === '' || isCalendarDate(value.trim())
			? null
			: 'Choose a valid contract end date'
	),
	overrides: z.record(z.string(), z.string()),
});

export interface SalaryDraftValidation {
	ok: boolean;
	errors: Record<string, string>;
}

export function validateSalaryDraft(
	draft: SalaryDraft,
	operation: SalaryOperation | 'view'
): SalaryDraftValidation {
	const errors: Record<string, string> = {};
	const parsed = salaryDraftSchema.safeParse(draft);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const key = String(issue.path[0] ?? 'form');
			if (!errors[key]) errors[key] = issue.message;
		}
	}
	if (
		operation === 'revise' &&
		isCalendarDate(draft.effective_from) &&
		!draft.effective_from.endsWith('-01')
	) {
		errors.effective_from =
			'Choose the first day of a month for a salary revision';
	}
	for (const [key, value] of Object.entries(draft.overrides)) {
		const text = String(value).trim();
		if (text === '') continue;
		if (key === 'tds_percentage') {
			if (!MONEY_PATTERN.test(text) || Number(text) < 0 || Number(text) > 100) {
				errors[`override_${key}`] = 'Enter TDS between 0 and 100';
			}
		} else if (!isMoneyText(text)) {
			errors[`override_${key}`] = 'Enter a valid non-negative amount';
		}
	}
	const overrideMessages = Object.entries(errors)
		.filter(([key]) => key.startsWith('override_'))
		.map(
			([key, message]) =>
				`${OVERRIDE_LABELS[key.slice('override_'.length)] ?? key}: ${message}`
		);
	if (overrideMessages.length > 0) {
		errors.overrides = overrideMessages.join(' ');
	}
	return { ok: Object.keys(errors).length === 0, errors };
}

/* ------------------------------------------------------------- command input */

export interface SalaryCommandBuildInput {
	operation: SalaryOperation;
	employeeId: number;
	agreementId: number | null;
	expectedVersion: number;
	draft: SalaryDraft;
	baseDraft: SalaryDraft | null;
}

function nonEmpty(value: string): boolean {
	return value.trim() !== '';
}

/**
 * A blank optional field means "not supplied" only when nothing was stored.
 * When the operator clears a stored value, the command must receive `null` so
 * the correction or successor actually removes it instead of preserving it.
 */
function clearedOptional(
	draftValue: string,
	baseValue: string | undefined,
	operation: SalaryOperation
): string | null | undefined {
	const text = draftValue.trim();
	if (text !== '') return text;
	if (operation !== 'create-initial' && baseValue && baseValue.trim() !== '') {
		return null;
	}
	return undefined;
}

export function buildSalaryCommandInput({
	operation,
	employeeId,
	agreementId,
	expectedVersion,
	draft,
	baseDraft,
}: SalaryCommandBuildInput): DraftSalaryCommandInput {
	const input: DraftSalaryCommandInput = {
		operation,
		employee_id: employeeId,
		expected_timeline_version: expectedVersion,
		employer_cost: draft.employer_cost.trim(),
		std_hours_per_day: draft.std_hours_per_day.trim(),
		salary_type: draft.salary_type,
	};

	if (operation === 'create-initial' || operation === 'revise') {
		input.effective_from = draft.effective_from;
	} else if (
		draft.effective_from !== (baseDraft?.effective_from ?? draft.effective_from)
	) {
		input.effective_from = draft.effective_from;
	}

	if (agreementId !== null) input.agreement_id = agreementId;

	const otherAllowances = clearedOptional(
		draft.other_allowances,
		baseDraft?.other_allowances,
		operation
	);
	if (otherAllowances !== undefined) input.other_allowances = otherAllowances;

	input.remarks = draft.remarks;

	const daYear = clearedOptional(draft.da_year, baseDraft?.da_year, operation);
	if (daYear !== undefined) input.da_year = daYear;

	input.pf_applicable = draft.pf_applicable;
	input.esic_applicable = draft.esic_applicable;
	input.pt_applicable = draft.pt_applicable;
	input.mlwf_applicable = draft.mlwf_applicable;
	input.retention_applicable = draft.retention_applicable;
	input.bonus_applicable = draft.bonus_applicable;
	input.monthly_bonus = draft.monthly_bonus;
	input.incentive_applicable = draft.incentive_applicable;
	input.insurance_applicable = draft.insurance_applicable;

	const inTime = clearedOptional(
		draft.std_in_time,
		baseDraft?.std_in_time,
		operation
	);
	if (inTime !== undefined) input.std_in_time = inTime;
	const outTime = clearedOptional(
		draft.std_out_time,
		baseDraft?.std_out_time,
		operation
	);
	if (outTime !== undefined) input.std_out_time = outTime;
	const otMultiplier = clearedOptional(
		draft.ot_multiplier,
		baseDraft?.ot_multiplier,
		operation
	);
	if (otMultiplier !== undefined) input.ot_multiplier = otMultiplier;
	const workingDays = clearedOptional(
		draft.std_working_days,
		baseDraft?.std_working_days,
		operation
	);
	if (workingDays !== undefined) input.std_working_days = workingDays;
	const plTotal = clearedOptional(
		draft.pl_total,
		baseDraft?.pl_total,
		operation
	);
	if (plTotal !== undefined) input.pl_total = plTotal;

	input.loan_active = draft.loan_active;
	const loanAmount = clearedOptional(
		draft.loan_amount,
		baseDraft?.loan_amount,
		operation
	);
	if (loanAmount !== undefined) input.loan_amount = loanAmount;
	const loanEmi = clearedOptional(
		draft.loan_amount_per_month,
		baseDraft?.loan_amount_per_month,
		operation
	);
	if (loanEmi !== undefined) input.loan_amount_per_month = loanEmi;
	const loanMonths = clearedOptional(
		draft.loan_no_of_months,
		baseDraft?.loan_no_of_months,
		operation
	);
	if (loanMonths !== undefined) input.loan_no_of_months = loanMonths;
	const loanTotal = clearedOptional(
		draft.loan_total_amount,
		baseDraft?.loan_total_amount,
		operation
	);
	if (loanTotal !== undefined) input.loan_total_amount = loanTotal;

	input.advance_active = draft.advance_active;
	const advanceAmount = clearedOptional(
		draft.advance_amount,
		baseDraft?.advance_amount,
		operation
	);
	if (advanceAmount !== undefined) input.advance_amount = advanceAmount;

	const isContract = draft.salary_type === 'contract';
	if (isContract || baseDraft?.salary_type === 'contract') {
		input.contract_duration = draft.contract_duration || 'monthly';
		if (isContract) {
			input.contract_end_date = nonEmpty(draft.contract_end_date)
				? draft.contract_end_date.trim()
				: null;
		}
	}

	// Component overrides: send the entered exception, and explicitly clear a
	// predecessor's override the operator removed.
	const draftOverrides = sortedOverrides(draft.overrides);
	const baseOverrides = sortedOverrides(baseDraft?.overrides ?? {});
	const overrideKeys = Object.keys({ ...baseOverrides, ...draftOverrides });
	const overrideSettings: Partial<Record<SalaryOverrideKey, string | null>> =
		{};
	for (const key of overrideKeys) {
		if (!isSalaryOverrideKey(key)) continue;
		const value = draftOverrides[key];
		if (value !== undefined) {
			overrideSettings[key] = value;
		} else if (
			operation !== 'create-initial' &&
			baseOverrides[key] !== undefined
		) {
			overrideSettings[key] = null;
		}
	}
	input.is_manual_override = Object.keys(draftOverrides).length > 0;
	Object.assign(input, overrideSettings);

	return input;
}

export function buildCancelCommandInput(args: {
	employeeId: number;
	agreementId: number;
	expectedVersion: number;
	reason: string;
}): SalaryCommandInput {
	return {
		operation: 'cancel',
		employee_id: args.employeeId,
		agreement_id: args.agreementId,
		expected_timeline_version: args.expectedVersion,
		cancellation_reason: args.reason.trim(),
	};
}

export function hasDraftOverrides(overrides: Record<string, string>): boolean {
	return Object.values(overrides).some((value) => value.trim() !== '');
}

/* -------------------------------------------------------------------- review */

export interface SalaryReviewRow {
	label: string;
	before: string;
	after: string;
	changed: boolean;
}

type ReviewKind = 'money' | 'number' | 'date' | 'boolean' | 'text' | 'type';

const REVIEW_FIELDS: ReadonlyArray<{
	key: keyof SalaryDraft;
	label: string;
	kind: ReviewKind;
}> = [
	{ key: 'effective_from', label: 'Effective from', kind: 'date' },
	{ key: 'salary_type', label: 'Salary Type', kind: 'type' },
	{ key: 'employer_cost', label: 'Monthly CTC', kind: 'money' },
	{ key: 'std_hours_per_day', label: 'Standard daily hours', kind: 'number' },
	{ key: 'std_working_days', label: 'Standard working days', kind: 'number' },
	{ key: 'other_allowances', label: 'Other allowances', kind: 'money' },
	{ key: 'std_in_time', label: 'Standard in time', kind: 'text' },
	{ key: 'std_out_time', label: 'Standard out time', kind: 'text' },
	{ key: 'ot_multiplier', label: 'OT multiplier', kind: 'number' },
	{ key: 'da_year', label: 'DA year', kind: 'number' },
	{ key: 'pl_total', label: 'PL entitlement (days)', kind: 'number' },
	{ key: 'loan_active', label: 'Loan deduction', kind: 'boolean' },
	{ key: 'loan_amount', label: 'Loan amount', kind: 'money' },
	{ key: 'loan_amount_per_month', label: 'Loan EMI per month', kind: 'money' },
	{ key: 'loan_no_of_months', label: 'Loan months', kind: 'number' },
	{ key: 'loan_total_amount', label: 'Loan total', kind: 'money' },
	{ key: 'advance_active', label: 'Advance deduction', kind: 'boolean' },
	{ key: 'advance_amount', label: 'Advance amount', kind: 'money' },
	{ key: 'contract_duration', label: 'Contract duration', kind: 'text' },
	{ key: 'contract_end_date', label: 'Contract end date', kind: 'date' },
	{ key: 'remarks', label: 'Remarks', kind: 'text' },
	...APPLICABILITY_FIELDS.map(({ key, label }) => ({
		key,
		label: `${label} applicable`,
		kind: 'boolean' as const,
	})),
];

function reviewValue(kind: ReviewKind, value: string | boolean): string {
	if (kind === 'boolean') return value ? 'Enabled' : 'Not enabled';
	const text = String(value ?? '').trim();
	switch (kind) {
		case 'money':
			return text === '' ? 'Not recorded' : formatCurrency(text);
		case 'number':
			return text === '' ? 'Not recorded' : formatNumber(text);
		case 'date':
			return text === '' ? 'Not recorded' : displayDate(text);
		case 'type':
			return text === '' ? 'Not recorded' : salaryTypeLabel(text);
		default:
			return text === '' ? 'Not recorded' : text;
	}
}

export function reviewRows(
	base: SalaryDraft | null,
	draft: SalaryDraft
): SalaryReviewRow[] {
	const rows: SalaryReviewRow[] = [];
	const push = (
		label: string,
		beforeRaw: string | boolean,
		afterRaw: string | boolean,
		kind: ReviewKind
	) => {
		const before = reviewValue(kind, beforeRaw);
		const after = reviewValue(kind, afterRaw);
		if (base && before === after) return;
		rows.push({ label, before, after, changed: before !== after });
	};

	for (const field of REVIEW_FIELDS) {
		push(
			field.label,
			base ? (base[field.key] as string | boolean) : '',
			draft[field.key] as string | boolean,
			field.kind
		);
	}

	const overrideKeys = Object.keys({
		...sortedOverrides(base?.overrides ?? {}),
		...sortedOverrides(draft.overrides),
	}).sort((left, right) => left.localeCompare(right));
	for (const key of overrideKeys) {
		const label = `${OVERRIDE_LABELS[key] ?? key} (override)`;
		push(
			label,
			base?.overrides[key] ?? '',
			draft.overrides[key] ?? '',
			'money'
		);
	}

	return rows;
}
