/**
 * Payroll-authorized Salary Profile timeline read (#437).
 *
 * Composes the produced timeline/store/CTC contracts with the existing
 * working-day and attendance-summary sources. Nothing here writes, and no
 * employees:* permission is required or implied.
 */

import { getWorkingDaysForMonth } from '@/utils/payroll-calculator';
import { mul, toNumber } from '@/lib/money';
import { resolveSalaryCtc, validateDailyHours } from '@/lib/salary-ctc';
import {
	buildSalaryAgreementTimeline,
	normalizeSalaryDate,
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
	salaryPeriodBounds,
	type SalaryAgreementClassification,
	type SalaryAgreementSource,
	type SalaryProfileRow,
} from '@/lib/salary-profile-timeline';
import {
	readSalaryAgreements,
	readSalaryTimelineVersion,
	readSalaryUseEvidence,
	summarizeSalaryUseEvidence,
	type SalaryUseEvidence,
} from '@/lib/salary-profile-store';
import {
	agreementIdOf,
	agreementStart,
	ambiguousCandidates,
	asRows,
	formatDate,
	isEligibleAgreement,
	legacyTimelineRow,
	monthOf,
	numberValue,
	parseMonth,
	positiveInteger,
	selectingIds,
	serverPayrollDate,
	textValue,
	SETTING_COLUMNS,
} from './internal';
import type {
	SalaryAction,
	SalaryActionBlocker,
	SalaryCommandDb,
	SalaryLegacyAmountsDto,
	SalaryPayStream,
	SalaryTimelineAgreementDto,
	SalaryTimelineDto,
	SalaryTimelineReadOptions,
	SalaryTimelineReadResult,
	SalaryTimelineSelectionDto,
	SalaryTimelineUseDto,
} from './types';

function streamOf(salaryType: string | null): SalaryPayStream {
	return salaryType === 'contract' ? 'contract' : 'payroll';
}

function selectionDto(resolution: {
	state: 'selected' | 'unavailable' | 'ambiguous';
	source: SalaryAgreementSource | null;
	agreement_id: number | null;
	conflict_ids: number[];
}): SalaryTimelineSelectionDto {
	return {
		state: resolution.state,
		agreement_source: resolution.source,
		agreement_id: resolution.agreement_id,
		agreement_ids: [...resolution.conflict_ids],
	};
}

function exactUse(
	evidence: readonly SalaryUseEvidence[],
	source: SalaryAgreementSource,
	agreementId: number
): { months: string[]; used: boolean } {
	const months = evidence
		.filter(
			(row) =>
				!row.is_ambiguous &&
				row.month !== null &&
				row.agreement_source === source &&
				row.agreement_id === agreementId
		)
		.map((row) => row.month as string);
	return { months: [...new Set(months)].sort(), used: months.length > 0 };
}

function isAmbiguousCandidate(
	evidence: readonly SalaryUseEvidence[],
	canonical: readonly SalaryProfileRow[],
	legacy: readonly SalaryProfileRow[],
	employeeStart: string | null,
	source: SalaryAgreementSource,
	agreementId: number
): boolean {
	for (const row of evidence) {
		if (!row.is_ambiguous || row.month === null) continue;
		const anchor = salaryMonthAnchor(row.month, employeeStart);
		const candidates = ambiguousCandidates(row);
		if (candidates.length > 0) {
			if (
				candidates.some(
					(candidate) =>
						candidate.agreement_source === source &&
						candidate.agreement_id === agreementId
				)
			) {
				return true;
			}
			continue;
		}
		const ids =
			source === 'employee_salary_profile'
				? selectingIds(canonical, anchor)
				: selectingIds(legacy, anchor);
		if (ids.includes(agreementId)) return true;
	}
	return false;
}

function settingsOf(row: SalaryProfileRow): Record<string, unknown> {
	const settings: Record<string, unknown> = {};
	for (const column of [
		'employer_cost',
		'std_hours_per_day',
		'salary_type',
		...SETTING_COLUMNS,
	]) {
		if (row[column] !== undefined) settings[column] = row[column];
	}
	if (settings.salary_type === undefined && row.pay_type !== undefined) {
		settings.salary_type = row.pay_type;
	}
	if (
		settings.std_hours_per_day === undefined &&
		row.standard_hours_per_day !== undefined
	) {
		settings.std_hours_per_day = row.standard_hours_per_day;
	}
	return settings;
}

function legacyAmountsOf(row: SalaryProfileRow): SalaryLegacyAmountsDto {
	return {
		gross_salary: numberValue(row.gross_salary),
		gross: numberValue(row.gross),
		contract_amount: numberValue(row.contract_amount),
		contract_duration: textValue(row.contract_duration),
		contract_end_date: formatDate(row.contract_end_date),
	};
}

function ctcOf(row: SalaryProfileRow) {
	const resolution = resolveSalaryCtc(row);
	if (resolution.status === 'resolved') {
		return {
			status: 'resolved' as const,
			amount: toNumber(resolution.amount),
			source: resolution.source,
			legacy_fallback: resolution.legacyFallback,
			reason: null,
		};
	}
	if (resolution.status === 'invalid') {
		return {
			status: 'invalid' as const,
			amount: null,
			source: resolution.source,
			legacy_fallback: false,
			reason: resolution.reason,
		};
	}
	return {
		status: 'missing' as const,
		amount: null,
		source: 'none' as const,
		legacy_fallback: false,
		reason: null,
	};
}

function actionsFor(input: {
	source: SalaryAgreementSource;
	agreementId: number;
	classification: SalaryAgreementClassification;
	isActive: boolean;
	cancelled: boolean;
	used: boolean;
	useAmbiguous: boolean;
	unknownHistory: boolean;
	latestId: number | null;
	canUpdate: boolean;
	canDelete: boolean;
}): { actions: SalaryAction[]; blockers: SalaryActionBlocker[] } {
	const blockers = new Set<SalaryActionBlocker>();
	const actions: SalaryAction[] = [];
	if (input.source === 'salary_structures') {
		blockers.add('legacy_read_only');
		return { actions, blockers: [...blockers] };
	}
	if (!input.isActive) blockers.add('inactive');
	if (input.cancelled) blockers.add('cancelled');
	if (input.classification === 'previous') blockers.add('previous');
	if (input.used) blockers.add('used');
	if (input.useAmbiguous) blockers.add('ambiguous_use');
	if (input.unknownHistory) blockers.add('ambiguous_use');

	const editable =
		input.isActive &&
		!input.cancelled &&
		!input.used &&
		!input.useAmbiguous &&
		!input.unknownHistory &&
		(input.classification === 'current' ||
			input.classification === 'scheduled');
	const revisable =
		input.isActive &&
		!input.cancelled &&
		!input.unknownHistory &&
		input.latestId === input.agreementId;
	const cancellable =
		input.isActive &&
		!input.cancelled &&
		!input.used &&
		!input.useAmbiguous &&
		!input.unknownHistory &&
		input.classification === 'scheduled';

	if (editable) {
		if (input.canUpdate) actions.push('correct');
		else blockers.add('permission');
	}
	if (revisable) {
		if (input.canUpdate) actions.push('revise');
		else blockers.add('permission');
	}
	if (cancellable) {
		if (input.canDelete) actions.push('cancel');
		else blockers.add('permission');
	}
	return { actions, blockers: [...blockers] };
}

/**
 * Read one Employee's salary timeline and selected-month assumptions.
 * Returns a business failure for a missing/soft-deleted Employee; database
 * errors reject to the route.
 */
export async function readSalaryTimeline(
	db: SalaryCommandDb,
	employeeId: number,
	options: SalaryTimelineReadOptions = {}
): Promise<SalaryTimelineReadResult> {
	const id = positiveInteger(employeeId);
	if (id === null) {
		return {
			ok: false,
			code: 'invalid_input',
			status: 400,
			message: 'employee_id must be a positive integer',
		};
	}
	const serverDate =
		options.serverDate === undefined
			? serverPayrollDate()
			: normalizeSalaryDate(options.serverDate);
	if (serverDate === null) {
		return {
			ok: false,
			code: 'invalid_input',
			status: 400,
			message: 'server date is invalid',
		};
	}
	const asOf =
		options.asOf === undefined ? serverDate : normalizeSalaryDate(options.asOf);
	if (asOf === null) {
		return {
			ok: false,
			code: 'invalid_input',
			status: 400,
			message: 'date must be YYYY-MM-DD',
		};
	}
	const monthStart =
		options.month === undefined
			? `${asOf.slice(0, 7)}-01`
			: parseMonth(options.month);
	if (monthStart === null) {
		return {
			ok: false,
			code: 'invalid_input',
			status: 400,
			message: 'month must be YYYY-MM or YYYY-MM-01',
		};
	}

	const [employeeResult] = await db.execute(
		`SELECT id, employee_id, first_name, last_name, department, position,
            employee_type, status, joining_date, hire_date, isDelete
       FROM employees
      WHERE id = ?
      LIMIT 1`,
		[id]
	);
	const employee = asRows(employeeResult)[0];
	if (employee === undefined || Number(employee.isDelete ?? 0) !== 0) {
		return {
			ok: false,
			code: 'employee_not_found',
			status: 404,
			message: `Employee ${id} does not exist`,
		};
	}
	const employeeStart =
		formatDate(employee.joining_date) ?? formatDate(employee.hire_date);
	const timelineVersion = await readSalaryTimelineVersion(db, id);
	const canonical = await readSalaryAgreements(db, id);
	const legacy = await readSalaryAgreements(db, id, {
		source: 'salary_structures',
	});
	const legacyTimeline = legacy.map(legacyTimelineRow);
	const evidence = await readSalaryUseEvidence(db, id);
	const useSummary = summarizeSalaryUseEvidence(evidence);
	const canonicalTimeline = buildSalaryAgreementTimeline(canonical, {
		asOf,
		source: 'employee_salary_profile',
		employeeId: id,
	});
	const legacyAgreementTimeline = buildSalaryAgreementTimeline(legacyTimeline, {
		asOf,
		source: 'salary_structures',
		employeeId: id,
	});
	const canonicalRaw = new Map<number, SalaryProfileRow>();
	for (const row of canonical) {
		const rowId = agreementIdOf(row);
		if (rowId !== null) canonicalRaw.set(rowId, row);
	}
	const legacyRaw = new Map<number, SalaryProfileRow>();
	for (const row of legacy) {
		const rowId = agreementIdOf(row);
		if (rowId !== null) legacyRaw.set(rowId, row);
	}
	const eligibleCanonical = canonical
		.filter(isEligibleAgreement)
		.sort((left, right) => {
			const leftStart = agreementStart(left) ?? '';
			const rightStart = agreementStart(right) ?? '';
			return (
				leftStart.localeCompare(rightStart) ||
				(agreementIdOf(left) ?? 0) - (agreementIdOf(right) ?? 0)
			);
		});
	const latestId =
		eligibleCanonical.length === 0
			? null
			: agreementIdOf(eligibleCanonical[eligibleCanonical.length - 1]);
	const canUpdate = options.permissions?.update === true;
	const canDelete = options.permissions?.delete === true;
	const unknownHistory =
		useSummary.unknown_history || evidence.some((row) => row.month === null);
	const ambiguousMonths = [
		...new Set(
			evidence
				.filter((row) => row.is_ambiguous && row.month !== null)
				.map((row) => row.month as string)
		),
	].sort();
	const exactUseMonths = new Set(
		evidence
			.filter((row) => !row.is_ambiguous && row.month !== null)
			.map((row) => row.month as string)
	);

	const agreements: SalaryTimelineAgreementDto[] = [];
	for (const timeline of [
		{
			entries: canonicalTimeline.agreements,
			source: 'employee_salary_profile' as const,
		},
		{
			entries: legacyAgreementTimeline.agreements,
			source: 'salary_structures' as const,
		},
	]) {
		for (const entry of timeline.entries) {
			const source = timeline.source;
			const raw = (
				source === 'employee_salary_profile' ? canonicalRaw : legacyRaw
			).get(entry.agreement.agreement_id);
			if (raw === undefined) continue;
			const exact = exactUse(evidence, source, entry.agreement.agreement_id);
			const useAmbiguous = isAmbiguousCandidate(
				evidence,
				canonical,
				legacyTimeline,
				employeeStart,
				source,
				entry.agreement.agreement_id
			);
			const cancelled = entry.agreement.cancelled_at !== null;
			const monthUsed =
				source === 'employee_salary_profile' &&
				exactUseMonths.has(monthOf(entry.agreement.effective_from));
			const { actions, blockers } = actionsFor({
				source,
				agreementId: entry.agreement.agreement_id,
				classification: entry.classification,
				isActive: entry.agreement.is_active,
				cancelled,
				used: exact.used || monthUsed,
				useAmbiguous,
				unknownHistory,
				latestId,
				canUpdate,
				canDelete,
			});
			const readOnly =
				source === 'salary_structures' ||
				!entry.agreement.is_active ||
				cancelled ||
				entry.classification === 'previous' ||
				exact.used ||
				monthUsed ||
				useAmbiguous ||
				unknownHistory;
			agreements.push({
				agreement_id: entry.agreement.agreement_id,
				agreement_source: source,
				read_only: readOnly,
				salary_type: entry.agreement.salary_type,
				pay_stream: streamOf(entry.agreement.salary_type),
				effective_from: entry.agreement.effective_from,
				effective_to: entry.agreement.effective_to,
				classification: entry.classification,
				is_active: entry.agreement.is_active,
				cancelled_at: entry.agreement.cancelled_at,
				cancelled_by: positiveInteger(raw.cancelled_by),
				cancelled_reason: textValue(raw.cancelled_reason),
				used: exact.used,
				use_months: exact.months,
				use_ambiguous: useAmbiguous,
				editable: actions.includes('correct'),
				actions,
				action_blockers: blockers,
				ctc: ctcOf(raw),
				settings: settingsOf(raw),
				legacy_amounts: legacyAmountsOf(raw),
			});
		}
	}
	agreements.sort(
		(left, right) =>
			left.effective_from.localeCompare(right.effective_from) ||
			left.agreement_source.localeCompare(right.agreement_source) ||
			left.agreement_id - right.agreement_id
	);

	const monthEnd = salaryPeriodBounds(monthStart).end;
	const employedInMonth = employeeStart === null || employeeStart <= monthEnd;
	const anchor = employedInMonth
		? salaryMonthAnchor(monthStart, employeeStart)
		: null;
	let selectedRow: SalaryProfileRow | null = null;
	if (anchor !== null) {
		const canonicalSelection = resolveSalaryAgreementAt(canonical, anchor, {
			source: 'employee_salary_profile',
			employeeId: id,
			asOf,
		});
		if (canonicalSelection.state === 'selected') {
			selectedRow = canonicalSelection.profile;
		} else if (canonicalSelection.state === 'unavailable') {
			const legacySelection = resolveSalaryAgreementAt(legacyTimeline, anchor, {
				source: 'salary_structures',
				employeeId: id,
				asOf,
			});
			if (legacySelection.state === 'selected') {
				selectedRow = legacySelection.profile;
			}
		}
	}
	const working = await getWorkingDaysForMonth(monthStart, db);
	const workingDays = Number(working.workingDays) || 0;
	const hoursValue =
		selectedRow?.std_hours_per_day ?? selectedRow?.standard_hours_per_day;
	const hoursValidation = validateDailyHours(hoursValue);
	const basisHours = hoursValidation.valid
		? toNumber(mul(workingDays, hoursValidation.hours).toDecimalPlaces(2))
		: null;

	const year = Number(asOf.slice(0, 4));
	const [leaveRows] = await db.execute(
		`SELECT month, total_privilege_leave
       FROM employee_attendance_summary
      WHERE employee_id = ? AND month LIKE ?
      ORDER BY month ASC`,
		[id, `${year}-%`]
	);
	const leave = asRows(leaveRows);
	const used = leave.reduce(
		(sum, row) => sum + (numberValue(row.total_privilege_leave) ?? 0),
		0
	);
	const monthKey = monthStart.slice(0, 7);
	const monthUsed =
		leave
			.filter((row) => row.month === monthKey)
			.reduce(
				(sum, row) => sum + (numberValue(row.total_privilege_leave) ?? 0),
				0
			) ?? 0;
	const plTotal = numberValue(selectedRow?.pl_total);
	const balance = plTotal === null ? null : Math.max(0, plTotal - used);

	const use: SalaryTimelineUseDto = {
		used: useSummary.used,
		ambiguous: useSummary.ambiguous,
		unknown_history: unknownHistory,
		months: useSummary.months,
		ambiguous_months: ambiguousMonths,
		agreements: useSummary.agreements,
	};

	const timeline: SalaryTimelineDto = {
		employee: {
			id,
			employee_code: String(employee.employee_id ?? ''),
			full_name:
				`${String(employee.first_name ?? '')} ${String(employee.last_name ?? '')}`.trim(),
			department: textValue(employee.department),
			position: textValue(employee.position),
			employee_type: textValue(employee.employee_type),
			status: textValue(employee.status),
			joining_date: formatDate(employee.joining_date),
			hire_date: formatDate(employee.hire_date),
			employment_start: employeeStart,
		},
		server_date: serverDate,
		as_of: asOf,
		month: monthStart,
		timeline_version: timelineVersion,
		permissions: {
			can_read: true,
			can_update: canUpdate,
			can_delete: canDelete,
		},
		use,
		basis: {
			month: monthStart,
			working_days: workingDays,
			std_hours_per_day: hoursValidation.valid
				? toNumber(hoursValidation.hours)
				: null,
			basis_hours: basisHours,
			std_hours_source: hoursValidation.valid ? 'agreement' : 'unavailable',
		},
		leave_usage: {
			as_of: serverDate,
			year,
			month: monthStart,
			pl_total: plTotal,
			used,
			month_used: monthUsed,
			balance,
			months_recorded: leave.length,
			source: 'employee_attendance_summary',
		},
		agreements,
		current: selectionDto(canonicalTimeline.current),
		legacy_current: selectionDto(legacyAgreementTimeline.current),
	};
	return { ok: true, timeline };
}
