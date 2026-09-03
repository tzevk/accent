import PAYROLL_CONFIG, {
	calculateESIC,
	calculatePF,
	calculateProfessionalTax,
} from './payroll-config';
import { R, add, sub, pctOf, roundR, toNumber } from '@/lib/money';

const hasValue = (value) =>
	value !== undefined && value !== null && value !== '';

const decimal = (value) => {
	if (!hasValue(value)) return R(0);
	try {
		const result = R(value);
		return result.isFinite() ? result : R(0);
	} catch {
		return R(0);
	}
};

const isPositive = (value) => hasValue(value) && decimal(value).gt(0);
const money = (value) => toNumber(roundR(decimal(value)));
const number = (value) => toNumber(decimal(value));

const firstValue = (source, keys) => {
	if (!source) return undefined;
	for (const key of keys) {
		if (hasValue(source[key])) return source[key];
	}
	return undefined;
};

const firstPositive = (source, keys) => {
	for (const key of keys) {
		if (isPositive(source?.[key])) return source[key];
	}
	return undefined;
};

const enabled = (value) =>
	value === true || value === 1 || value === '1' || value === 'true';

export const SALARY_OVERRIDE_FIELDS = [
	'basic',
	'da',
	'hra',
	'conveyance',
	'call_allowance',
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
];

export const hasSalaryOverrides = (overrides) =>
	SALARY_OVERRIDE_FIELDS.some(
		(key) =>
			overrides?.[key] !== undefined &&
			overrides?.[key] !== null &&
			overrides?.[key] !== ''
	);

export const getSalaryProfileOverrides = (profile = {}) => {
	if (!enabled(profile?.is_manual_override)) return {};

	return Object.fromEntries(
		SALARY_OVERRIDE_FIELDS.filter(
			(key) => profile[key] !== undefined && profile[key] !== null
		).map((key) => [key, profile[key]])
	);
};

const monthNumber = (month) => {
	const match = String(month || '').match(/^\d{4}-(\d{2})/);
	return match ? Number(match[1]) : 0;
};

const scheduleSource = (schedule) =>
	schedule?.components || schedule?.values || schedule || {};

const matchesSalarySlab = (entry, base) => {
	const min = hasValue(entry?.min_salary) ? decimal(entry.min_salary) : null;
	const max = hasValue(entry?.max_salary) ? decimal(entry.max_salary) : null;
	return (!min || decimal(base).gte(min)) && (!max || decimal(base).lte(max));
};

/**
 * Find one effective schedule component from either the server's keyed shape
 * or the raw payroll_schedules row shape.
 */
const findScheduleEntry = (schedule, keys, base = 0) => {
	const source = scheduleSource(schedule);

	if (Array.isArray(source)) {
		const entries = source.filter((entry) =>
			keys.includes(entry?.component_type)
		);
		return entries.find((entry) => matchesSalarySlab(entry, base)) || null;
	}

	for (const key of keys) {
		if (hasValue(source?.[key])) {
			const value = source[key];
			if (Array.isArray(value)) {
				return value.find((entry) => matchesSalarySlab(entry, base)) || null;
			}
			return value;
		}
	}

	if (source?.component_type && keys.includes(source.component_type)) {
		return matchesSalarySlab(source, base) ? source : null;
	}

	return null;
};

const scheduleComponent = (schedule, keys, base = 0) => {
	const entry = findScheduleEntry(schedule, keys, base);
	if (!hasValue(entry)) return null;

	if (typeof entry !== 'object') {
		return { amount: money(entry), percentage: null, valueType: 'fixed' };
	}

	const valueType = String(
		entry.value_type ||
			entry.valueType ||
			entry.type ||
			(hasValue(entry.percentage) ? 'percentage' : 'fixed')
	).toLowerCase();
	const isPercentage = valueType === 'percentage' || valueType === 'percent';
	const rawValue = isPercentage
		? firstValue(entry, ['percentage', 'value', 'rate'])
		: firstValue(entry, ['amount', 'value', 'fixed_amount', 'fixed', 'rate']);

	if (!hasValue(rawValue)) return null;

	return {
		amount: isPercentage
			? money(pctOf(decimal(base), number(rawValue), 0))
			: money(rawValue),
		percentage: isPercentage ? number(rawValue) : null,
		valueType: isPercentage ? 'percentage' : 'fixed',
	};
};

const valueFrom = (source, keys, fallback = null) => {
	const value = firstValue(source, keys);
	return hasValue(value) ? value : fallback;
};

const overrideValue = (overrides, keys) => {
	const source = overrides?.components || overrides || {};
	const value = firstValue(source, keys);
	if (!hasValue(value)) return null;
	if (typeof value === 'object') {
		const nestedValue = hasValue(value.amount) ? value.amount : value.value;
		return hasValue(nestedValue) ? nestedValue : null;
	}
	return value;
};

const integerValue = (value, fallback) => {
	if (!hasValue(value) || !Number.isFinite(Number(value))) return fallback;
	return Math.trunc(Number(value));
};

/**
 * Normalize the two persisted pay-agreement shapes without allowing the
 * read-only legacy Salary Structure to overwrite a canonical Salary Profile.
 * CTC is intentionally not considered when selecting Gross.
 */
export function normalizeSalaryProfile(
	canonicalProfile = null,
	legacyProfile = null
) {
	const canonical = canonicalProfile || {};
	const legacy = legacyProfile || {};
	const legacyValues = { ...legacy };

	if (!hasValue(legacyValues.gross_salary) && hasValue(legacy.gross)) {
		legacyValues.gross_salary = legacy.gross;
	}
	if (!hasValue(legacyValues.gross) && hasValue(legacy.gross_salary)) {
		legacyValues.gross = legacy.gross_salary;
	}
	if (!hasValue(legacyValues.basic_plus_da) && hasValue(legacy.basic_salary)) {
		// salary_structures.basic_salary is the historical combined Basic + DA.
		legacyValues.basic_plus_da = legacy.basic_salary;
	}
	if (!hasValue(legacyValues.salary_type) && hasValue(legacy.pay_type)) {
		legacyValues.salary_type = legacy.pay_type;
	}
	if (
		!hasValue(legacyValues.std_working_days) &&
		hasValue(legacy.standard_working_days)
	) {
		legacyValues.std_working_days = legacy.standard_working_days;
	}
	if (
		!hasValue(legacyValues.standard_working_days) &&
		hasValue(legacy.standard_working_days)
	) {
		legacyValues.standard_working_days = legacy.standard_working_days;
	}
	if (
		!hasValue(legacyValues.std_hours_per_day) &&
		hasValue(legacy.standard_hours_per_day)
	) {
		legacyValues.std_hours_per_day = legacy.standard_hours_per_day;
	}
	if (
		!hasValue(legacyValues.pf_wage_ceiling) &&
		hasValue(legacy.pf_wage_ceiling)
	) {
		legacyValues.pf_wage_ceiling = legacy.pf_wage_ceiling;
	}

	const result = { ...legacyValues };
	for (const [key, value] of Object.entries(canonical)) {
		if (hasValue(value)) result[key] = value;
	}

	const gross =
		firstPositive(canonical, ['gross_salary', 'gross']) ||
		firstPositive(legacy, ['gross_salary', 'gross']);
	result.gross_salary = hasValue(gross) ? gross : 0;
	result.gross = result.gross_salary;

	return result;
}

const normalizeInput = (
	input,
	payrollSchedule,
	attendance,
	month,
	overrides
) => {
	const isObjectInput =
		input &&
		typeof input === 'object' &&
		('salaryProfile' in input ||
			'salary_profile' in input ||
			'profile' in input ||
			'payrollSchedule' in input ||
			'effectivePayrollSchedule' in input ||
			'schedule' in input ||
			'attendance' in input ||
			'payrollMonth' in input);

	if (isObjectInput) {
		return {
			employeeId: input.employeeId ?? input.employee_id,
			month: input.month || input.payrollMonth || input.payroll_month,
			salaryProfile:
				input.salaryProfile || input.salary_profile || input.profile || {},
			payrollSchedule:
				input.payrollSchedule ||
				input.effectivePayrollSchedule ||
				input.effectiveSchedule ||
				input.schedule ||
				{},
			attendance:
				input.attendance ||
				input.attendanceSnapshot ||
				input.attendance_snapshot ||
				{},
			overrides: input.overrides || input.manualOverrides || {},
			includeBonus: input.includeBonus ?? input.include_bonus ?? false,
		};
	}

	return {
		employeeId: undefined,
		month,
		salaryProfile: input || {},
		payrollSchedule: payrollSchedule || {},
		attendance: attendance || {},
		overrides: overrides || {},
		includeBonus: false,
	};
};

/**
 * Pure payroll calculation boundary. It has no database or runtime-specific
 * dependencies, so the same function can be used by server orchestration and
 * a client Salary Profile preview.
 *
 * Object form:
 *   calculatePayroll({ employeeId, month, salaryProfile, payrollSchedule,
 *     attendance, overrides, includeBonus })
 * Positional form is retained for small server-side compatibility callers.
 */
export function calculatePayroll(
	input,
	payrollSchedule,
	attendance,
	month,
	overrides
) {
	const args = normalizeInput(
		input,
		payrollSchedule,
		attendance,
		month,
		overrides
	);
	const profile = args.salaryProfile || {};
	const schedule = args.payrollSchedule || {};
	const snapshot = args.attendance || {};
	const manual = args.overrides || {};
	const employeeId = args.employeeId;
	const payrollMonth = args.month;

	const grossInput = firstPositive(profile, ['gross_salary', 'gross']);
	const fullGross = decimal(grossInput);
	const fullOtherAllowances = decimal(
		valueFrom(profile, ['other_allowances'], 0)
	);

	const pfApplicable = enabled(profile.pf_applicable);
	const esicApplicable = enabled(profile.esic_applicable);
	const ptApplicable = enabled(profile.pt_applicable);
	const mlwfApplicable = enabled(profile.mlwf_applicable);
	const retentionApplicable = enabled(profile.retention_applicable);
	const bonusApplicable = enabled(profile.bonus_applicable);
	const monthlyBonus = enabled(profile.monthly_bonus);
	const incentiveApplicable = enabled(profile.incentive_applicable);
	const insuranceApplicable = enabled(profile.insurance_applicable);
	const salaryType = String(
		profile.salary_type || profile.pay_type || 'monthly'
	).toLowerCase();
	// Persisted component columns are exceptions only when the profile explicitly
	// opts into override mode. Otherwise they are historical snapshots and the
	// effective schedule remains the source of truth.
	const savedOverrides = enabled(profile.is_manual_override)
		? getSalaryProfileOverrides(profile)
		: profile.is_manual_override === undefined
			? profile // Legacy callers without the flag stored component values directly.
			: {};

	const scheduledDA = scheduleComponent(
		schedule,
		['da', 'da_amount'],
		fullGross
	);
	const scheduleDA = scheduledDA?.amount;
	const profileDA = valueFrom(savedOverrides, ['da']);
	const overriddenDA = overrideValue(manual, ['da', 'da_amount']);
	const da = money(
		overriddenDA ?? profileDA ?? scheduleDA ?? PAYROLL_CONFIG.DA_FIXED_AMOUNT
	);

	const overriddenBasic = overrideValue(manual, ['basic']);
	const overriddenBasicPlusDa = overrideValue(manual, [
		'basic_plus_da',
		'basic_da_total',
	]);
	const profileBasic = valueFrom(savedOverrides, ['basic']);
	const profileBasicPlusDa = valueFrom(savedOverrides, [
		'basic_plus_da',
		'basic_da_total',
	]);

	let basic;
	if (overriddenBasic !== null) {
		basic = money(overriddenBasic);
	} else if (hasValue(profileBasic)) {
		basic = money(profileBasic);
	} else {
		const basicPlusDa =
			overriddenBasicPlusDa ??
			profileBasicPlusDa ??
			money(pctOf(fullGross, PAYROLL_CONFIG.BASIC_DA_PERCENT, 0));
		basic = money(
			sub(decimal(basicPlusDa), decimal(da)).lt(0)
				? 0
				: sub(decimal(basicPlusDa), decimal(da))
		);
	}
	const basicPlusDaTotal = money(add(basic, da));

	const salaryHead = (name, fallback, scheduled) =>
		money(
			overrideValue(manual, [name]) ??
				valueFrom(savedOverrides, [name]) ??
				scheduled?.amount ??
				fallback
		);
	const scheduledHra = scheduleComponent(
		schedule,
		['hra', 'hra_percent'],
		fullGross
	);
	const scheduledConveyance = scheduleComponent(
		schedule,
		['conveyance', 'conveyance_percent'],
		fullGross
	);
	const scheduledCallAllowance = scheduleComponent(
		schedule,
		['call_allowance', 'call_allowance_percent'],
		fullGross
	);
	const hra = salaryHead(
		'hra',
		pctOf(fullGross, PAYROLL_CONFIG.HRA_PERCENT, 0),
		scheduledHra
	);
	const conveyance = salaryHead(
		'conveyance',
		pctOf(fullGross, PAYROLL_CONFIG.CONVEYANCE_PERCENT, 0),
		scheduledConveyance
	);
	const callAllowance = salaryHead(
		'call_allowance',
		pctOf(fullGross, PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT, 0),
		scheduledCallAllowance
	);
	const otherAllowances = money(
		overrideValue(manual, ['other_allowances']) ?? fullOtherAllowances
	);

	const bonusSchedule = scheduleComponent(
		schedule,
		['bonus'],
		basicPlusDaTotal
	);
	const overriddenBonus = overrideValue(manual, ['bonus']);
	const savedBonus = valueFrom(savedOverrides, ['bonus']);
	const bonusValue =
		overriddenBonus ?? savedBonus ?? bonusSchedule?.amount ?? 0;
	const bonus =
		monthlyBonus ||
		(args.includeBonus === true && bonusApplicable) ||
		overriddenBonus !== null ||
		savedBonus !== null
			? money(bonusValue)
			: 0;

	const incentiveSchedule = scheduleComponent(
		schedule,
		['incentive'],
		fullGross
	);
	const incentive = incentiveApplicable
		? money(
				overrideValue(manual, ['incentive']) ??
					valueFrom(savedOverrides, ['incentive']) ??
					incentiveSchedule?.amount ??
					0
			)
		: 0;

	const overtimeHours = number(
		valueFrom(snapshot, ['totalOvertimeHours', 'overtime_hours'], 0)
	);
	const standardHours =
		number(
			valueFrom(profile, ['std_hours_per_day', 'standard_hours_per_day'], 8)
		) || 8;
	const otRate =
		overtimeHours > 0
			? toNumber(
					add(basic, da)
						.div(standardHours)
						.times(overtimeHours)
						.toDecimalPlaces(2)
				)
			: 0;
	const totalEarnings = money(
		add(
			basic,
			da,
			hra,
			conveyance,
			callAllowance,
			otherAllowances,
			bonus,
			incentive,
			otRate
		)
	);

	const pf = calculatePF(
		toNumber(fullGross),
		pfApplicable,
		profile.pf_wage_ceiling || '15000'
	);
	const scheduledPfEmployee = scheduleComponent(
		schedule,
		['pf_employee', 'pf'],
		fullGross
	);
	const scheduledPfEmployer = scheduleComponent(
		schedule,
		['pf_employer'],
		fullGross
	);
	const pfEmployee = pfApplicable
		? money(
				overrideValue(manual, ['pf_employee']) ??
					valueFrom(savedOverrides, ['pf_employee']) ??
					scheduledPfEmployee?.amount ??
					pf.employeeContribution
			)
		: 0;
	const pfEmployer = pfApplicable
		? money(
				overrideValue(manual, ['pf_employer']) ??
					valueFrom(savedOverrides, ['pf_employer']) ??
					scheduledPfEmployer?.amount ??
					pf.employerTotal
			)
		: 0;
	const pfAdmin = pfApplicable
		? money(
				overrideValue(manual, ['pf_admin']) ??
					scheduleComponent(schedule, ['pf_admin'], fullGross)?.amount ??
					pf.pfAdmin
			)
		: 0;
	const edli = pfApplicable
		? money(
				overrideValue(manual, ['edli']) ??
					scheduleComponent(schedule, ['edli'], fullGross)?.amount ??
					pctOf(pf.wageBase, PAYROLL_CONFIG.EDLI_PERCENT, 0)
			)
		: 0;

	const esic = calculateESIC(toNumber(fullGross), esicApplicable);
	const scheduledEsicEmployee = scheduleComponent(
		schedule,
		['esic_employee', 'esic'],
		fullGross
	);
	const scheduledEsicEmployer = scheduleComponent(
		schedule,
		['esic_employer'],
		fullGross
	);
	const esicEmployee = esic.eligible
		? money(
				overrideValue(manual, ['esic_employee']) ??
					valueFrom(savedOverrides, ['esic_employee']) ??
					scheduledEsicEmployee?.amount ??
					esic.employeeContribution
			)
		: 0;
	const esicEmployer = esic.eligible
		? money(
				overrideValue(manual, ['esic_employer']) ??
					valueFrom(savedOverrides, ['esic_employer']) ??
					scheduledEsicEmployer?.amount ??
					esic.employerContribution
			)
		: 0;

	const scheduledPT = scheduleComponent(schedule, ['pt'], fullGross);
	const pt = ptApplicable
		? money(
				overrideValue(manual, ['pt']) ??
					valueFrom(savedOverrides, ['pt']) ??
					scheduledPT?.amount ??
					calculateProfessionalTax(toNumber(fullGross))
			)
		: 0;

	const mlwfMonth = monthNumber(payrollMonth);
	const isMLWFMonth = mlwfMonth === 6 || mlwfMonth === 12;
	const scheduledMLWF = scheduleComponent(
		schedule,
		['mlwf', 'mlwf_employee'],
		fullGross
	);
	const scheduledMLWFEmployer = scheduleComponent(
		schedule,
		['mlwf_employer'],
		fullGross
	);
	const mlwf =
		mlwfApplicable && isMLWFMonth
			? money(
					overrideValue(manual, ['mlwf']) ??
						valueFrom(savedOverrides, ['mlwf']) ??
						scheduledMLWF?.amount ??
						0
				)
			: 0;
	const mlwfEmployer =
		mlwfApplicable && isMLWFMonth
			? money(
					overrideValue(manual, ['mlwf_employer']) ??
						valueFrom(savedOverrides, ['mlwf_employer']) ??
						scheduledMLWFEmployer?.amount ??
						0
				)
			: 0;

	const scheduledRetention = scheduleComponent(
		schedule,
		['retention'],
		fullGross
	);
	const retention = retentionApplicable
		? money(
				overrideValue(manual, ['retention']) ??
					valueFrom(savedOverrides, ['retention']) ??
					scheduledRetention?.amount ??
					0
			)
		: 0;

	const scheduledInsurance = scheduleComponent(
		schedule,
		['insurance'],
		fullGross
	);
	const insurance = insuranceApplicable
		? money(
				overrideValue(manual, ['insurance']) ??
					valueFrom(savedOverrides, ['insurance']) ??
					scheduledInsurance?.amount ??
					0
			)
		: 0;

	const scheduledLWF = scheduleComponent(schedule, ['lwf'], fullGross);
	const lwf = money(
		overrideValue(manual, ['lwf']) ??
			valueFrom(savedOverrides, ['lwf']) ??
			scheduledLWF?.amount ??
			0
	);

	const tdsAmountOverride = overrideValue(manual, ['tds']);
	const tdsRateOverride = overrideValue(manual, ['tds_percentage', 'tds_rate']);
	const profileTdsRate = valueFrom(profile, ['tds_percentage', 'tds_rate']);
	const scheduledTDS = scheduleComponent(schedule, ['tds'], fullGross);
	let tdsRate = null;
	let tds;
	if (tdsAmountOverride !== null) {
		tds = money(tdsAmountOverride);
		tdsRate = tdsRateOverride !== null ? number(tdsRateOverride) : null;
	} else if (tdsRateOverride !== null) {
		tdsRate = number(tdsRateOverride);
		tds = money(pctOf(fullGross, tdsRate, 0));
	} else if (profileTdsRate !== null && hasValue(profileTdsRate)) {
		tdsRate = number(profileTdsRate);
		tds = money(pctOf(fullGross, tdsRate, 0));
	} else if (scheduledTDS) {
		tdsRate = scheduledTDS.percentage;
		tds = scheduledTDS.amount;
	} else if (salaryType === 'contract') {
		// Existing Contract UI behavior; monthly payroll has no invented default.
		tdsRate = 10;
		tds = money(pctOf(fullGross, tdsRate, 0));
	} else {
		tds = 0;
	}

	const loan = enabled(profile.loan_active)
		? money(
				overrideValue(manual, ['loan_recovery', 'loan']) ??
					valueFrom(profile, ['loan_amount_per_month'], 0)
			)
		: 0;
	const advance = enabled(profile.advance_active)
		? money(
				overrideValue(manual, ['advance_deduction', 'advance']) ??
					valueFrom(profile, ['advance_amount'], 0)
			)
		: 0;
	const otherDeductions = money(
		add(
			overrideValue(manual, ['other_deductions']) ??
				valueFrom(profile, ['other_deductions'], 0),
			loan,
			advance
		)
	);
	const lopDeduction = money(
		overrideValue(manual, ['lop_deduction']) ??
			valueFrom(profile, ['lop_deduction'], 0)
	);
	const totalDeductions = money(
		add(
			pfEmployee,
			esicEmployee,
			pt,
			mlwf,
			retention,
			lwf,
			tds,
			otherDeductions,
			lopDeduction
		)
	);
	const netPay = money(sub(totalEarnings, totalDeductions));

	const gratuity = money(
		pctOf(decimal(basic), PAYROLL_CONFIG.GRATUITY_PERCENT, 0)
	);
	const totalEmployerContributions = money(
		add(
			pfEmployer,
			esicEmployer,
			mlwfEmployer,
			bonus,
			insurance,
			gratuity,
			pfAdmin,
			edli
		)
	);
	const employerCost = money(add(totalEarnings, totalEmployerContributions));

	const standardWorkingDays = number(
		valueFrom(
			snapshot,
			['standardWorkingDays', 'standard_working_days'],
			valueFrom(
				profile,
				['std_working_days', 'standard_working_days'],
				PAYROLL_CONFIG.STANDARD_WORKING_DAYS
			)
		)
	);
	const daysPresent = number(
		valueFrom(snapshot, ['daysPresent', 'days_present'], standardWorkingDays)
	);
	const daysAbsent = number(
		valueFrom(snapshot, ['daysAbsent', 'days_absent'], 0)
	);
	const daysLeave = number(valueFrom(snapshot, ['daysLeave', 'days_leave'], 0));
	const weeklyOff = number(valueFrom(snapshot, ['weeklyOff', 'weekly_off'], 0));
	const holidays = number(valueFrom(snapshot, ['holidays'], 0));
	const halfDays = number(valueFrom(snapshot, ['halfDays', 'half_days'], 0));
	const payableDays = number(
		valueFrom(snapshot, ['payableDays', 'payable_days'], standardWorkingDays)
	);
	const lopDays = number(valueFrom(snapshot, ['lopDays', 'lop_days'], 0));
	const attendanceDataFlag = valueFrom(snapshot, [
		'hasAttendanceData',
		'has_attendance_data',
	]);
	const hasAttendanceData = hasValue(attendanceDataFlag)
		? enabled(attendanceDataFlag)
		: false;
	const plTotal = integerValue(profile.pl_total, 21);
	const plUsed = integerValue(profile.pl_used, 0);
	const plBalance = integerValue(profile.pl_balance, plTotal - plUsed);

	return {
		month: payrollMonth,
		employee_id: employeeId,
		gross: toNumber(fullGross),
		da_used: money(scheduleDA ?? da),
		da,
		basic,
		basic_plus_da: basicPlusDaTotal,
		basic_da_total: basicPlusDaTotal,
		hra,
		conveyance,
		call_allowance: callAllowance,
		other_allowances: otherAllowances,
		bonus,
		incentive,
		ot_rate: otRate,
		total_earnings: totalEarnings,
		pf_employee: pfEmployee,
		esic_employee: esicEmployee,
		pt,
		mlwf,
		retention,
		lwf,
		tds,
		tds_percentage: tdsRate,
		other_deductions: otherDeductions,
		loan_recovery: loan,
		advance_deduction: advance,
		total_deductions: totalDeductions,
		net_pay: netPay,
		pf_employer: pfEmployer,
		esic_employer: esicEmployer,
		mlwf_employer: mlwfEmployer,
		insurance,
		gratuity,
		pf_admin: pfAdmin,
		edli,
		total_employer_contributions: totalEmployerContributions,
		employer_cost: employerCost,
		attendance: {
			standard_working_days: standardWorkingDays,
			days_present: daysPresent,
			days_absent: daysAbsent,
			days_leave: daysLeave,
			weekly_off: weeklyOff,
			holidays,
			half_days: halfDays,
			payable_days: payableDays,
			lop_days: lopDays,
			overtime_hours: overtimeHours,
			has_attendance_data: hasAttendanceData,
		},
		full_month: {
			gross: toNumber(fullGross),
			other_allowances: fullOtherAllowances.toNumber(),
		},
		lop_deduction: lopDeduction,
		pl_total: plTotal,
		pl_used: plUsed,
		pl_balance: plBalance,
		payment_status: 'pending',
		remarks: null,
	};
}

export const calculatePayrollBreakdown = calculatePayroll;
export const calculatePayrollBoundary = calculatePayroll;
