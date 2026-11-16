/**
 * Public types for the salary command/read contract (#437).
 *
 * These names are consumed by the main payroll salary-profile route, the
 * Salary Profiles editor and the real-contention harness. The shapes are
 * published in C:/Files/OCDSE/Work/accent-434-notes/command-contract.md.
 */

import type { SalaryAgreementSource } from '@/lib/salary-profile-timeline';

export type SalaryCommandOperation =
	| 'create-initial'
	| 'correct'
	| 'revise'
	| 'cancel';

/** Writable supported agreement settings. Omitted fields are preserved/copied. */
export interface SalaryCommandSettingsInput {
	other_allowances?: number | string | null;
	remarks?: string | null;
	is_manual_override?: boolean | number | string | null;
	da_year?: number | string | null;
	pf_applicable?: boolean | number | string | null;
	esic_applicable?: boolean | number | string | null;
	pt_applicable?: boolean | number | string | null;
	mlwf_applicable?: boolean | number | string | null;
	retention_applicable?: boolean | number | string | null;
	bonus_applicable?: boolean | number | string | null;
	monthly_bonus?: boolean | number | string | null;
	incentive_applicable?: boolean | number | string | null;
	insurance_applicable?: boolean | number | string | null;
	basic_plus_da?: number | string | null;
	da?: number | string | null;
	basic?: number | string | null;
	hra?: number | string | null;
	conveyance?: number | string | null;
	call_allowance?: number | string | null;
	bonus?: number | string | null;
	incentive?: number | string | null;
	pf_employee?: number | string | null;
	esic_employee?: number | string | null;
	pf_employer?: number | string | null;
	esic_employer?: number | string | null;
	pt?: number | string | null;
	mlwf?: number | string | null;
	mlwf_employer?: number | string | null;
	retention?: number | string | null;
	insurance?: number | string | null;
	hourly_rate?: number | string | null;
	std_in_time?: string | null;
	std_out_time?: string | null;
	ot_multiplier?: number | string | null;
	daily_rate?: number | string | null;
	std_working_days?: number | string | null;
	contract_duration?: string | null;
	contract_end_date?: string | null;
	lumpsum_amount?: number | string | null;
	lumpsum_description?: string | null;
	tds_percentage?: number | string | null;
	pl_total?: number | string | null;
	loan_amount?: number | string | null;
	loan_amount_per_month?: number | string | null;
	loan_no_of_months?: number | string | null;
	loan_total_amount?: number | string | null;
	loan_active?: boolean | number | string | null;
	advance_amount?: number | string | null;
	advance_active?: boolean | number | string | null;
}

export interface SalaryCommandInput extends SalaryCommandSettingsInput {
	operation: SalaryCommandOperation;
	employee_id: number;
	agreement_id?: number | null;
	expected_timeline_version: number;
	effective_from?: string | null;
	salary_type?: string | null;
	/** Explicit monthly CTC; required for create/correct/revise, zero is valid. */
	employer_cost?: number | string | null;
	/** Required for create/correct/revise; finite and strictly positive. */
	std_hours_per_day?: number | string | null;
	cancellation_reason?: string | null;
}

export interface SalaryCommandContext {
	/** Authenticated session user id — never a request body field. */
	actorId: number;
	/** Trusted date seam for tests; routes never accept this from a request. */
	now?: string;
}

export type SalaryCommandFailureCode =
	| 'invalid_input'
	| 'employee_not_found'
	| 'agreement_not_found'
	| 'employee_deleted'
	| 'stale_version'
	| 'date_conflict'
	| 'earlier_month'
	| 'used'
	| 'protected'
	| 'ambiguous_history'
	| 'overlap'
	| 'invalid_lifecycle';

export interface SalaryCommandSuccess {
	ok: true;
	operation: SalaryCommandOperation;
	agreement_id: number;
	timeline_version: number;
	classification: 'current' | 'scheduled' | 'previous' | 'cancelled';
	effective_from: string;
	effective_to: string | null;
}

export interface SalaryCommandFailure {
	ok: false;
	code: SalaryCommandFailureCode;
	status: 400 | 404 | 409 | 422;
	message: string;
	details?: Record<string, unknown>;
}

export type SalaryCommandOutcome = SalaryCommandSuccess | SalaryCommandFailure;

/**
 * A caller-owned connection/task. The command core never begins, commits,
 * rolls back or releases it; direct contention tests pass two real connections
 * through this same Interface.
 */
export interface SalaryCommandDb {
	/**
	 * Mutable parameter array: mysql2 `execute` takes `ExecuteValues[]`, so a
	 * `readonly` array would make a real `PoolConnection` unassignable.
	 */
	execute(
		sql: string,
		params?: Array<string | number | boolean | null>
	): Promise<[unknown, unknown]>;
}

export interface SalaryReadPermissions {
	update?: boolean;
	delete?: boolean;
}

export interface SalaryTimelineReadOptions {
	/** Timeline as-of date (YYYY-MM-DD); defaults to the server payroll date. */
	asOf?: string;
	/** Basis/leave month (YYYY-MM or YYYY-MM-01); defaults to the as-of month. */
	month?: string;
	permissions?: SalaryReadPermissions;
	/** Trusted date seam for tests; routes never accept this from a request. */
	serverDate?: string;
}

export type SalaryPayStream = 'payroll' | 'contract';

export type SalaryAction = 'correct' | 'revise' | 'cancel';

export type SalaryActionBlocker =
	| 'permission'
	| 'legacy_read_only'
	| 'inactive'
	| 'cancelled'
	| 'previous'
	| 'used'
	| 'ambiguous_use';

export interface SalaryTimelineUseDto {
	used: boolean;
	ambiguous: boolean;
	unknown_history: boolean;
	months: string[];
	ambiguous_months: string[];
	agreements: Array<{
		agreement_id: number;
		agreement_source: SalaryAgreementSource;
	}>;
}

export interface SalaryTimelineSelectionDto {
	state: 'selected' | 'unavailable' | 'ambiguous';
	agreement_source: SalaryAgreementSource | null;
	agreement_id: number | null;
	agreement_ids: number[];
}

export interface SalaryCtcDto {
	status: 'resolved' | 'missing' | 'invalid';
	amount: number | null;
	source: 'employer_cost' | 'gross_salary' | 'gross' | 'none';
	legacy_fallback: boolean;
	reason: string | null;
}

export interface SalaryLegacyAmountsDto {
	gross_salary: number | null;
	gross: number | null;
	contract_amount: number | null;
	contract_duration: string | null;
	contract_end_date: string | null;
}

export interface SalaryTimelineAgreementDto {
	agreement_id: number;
	agreement_source: SalaryAgreementSource;
	read_only: boolean;
	salary_type: string | null;
	pay_stream: SalaryPayStream;
	effective_from: string;
	effective_to: string | null;
	classification: 'current' | 'scheduled' | 'previous' | 'cancelled';
	is_active: boolean;
	cancelled_at: string | null;
	cancelled_by: number | null;
	cancelled_reason: string | null;
	used: boolean;
	use_months: string[];
	use_ambiguous: boolean;
	editable: boolean;
	actions: SalaryAction[];
	action_blockers: SalaryActionBlocker[];
	ctc: SalaryCtcDto;
	settings: Record<string, unknown>;
	legacy_amounts: SalaryLegacyAmountsDto;
}

export interface SalaryTimelineDto {
	employee: {
		id: number;
		employee_code: string;
		full_name: string;
		department: string | null;
		position: string | null;
		employee_type: string | null;
		status: string | null;
		joining_date: string | null;
		hire_date: string | null;
		employment_start: string | null;
	};
	server_date: string;
	as_of: string;
	month: string;
	timeline_version: number;
	permissions: { can_read: boolean; can_update: boolean; can_delete: boolean };
	use: SalaryTimelineUseDto;
	basis: {
		month: string;
		working_days: number;
		std_hours_per_day: number | null;
		basis_hours: number | null;
		std_hours_source: 'agreement' | 'unavailable';
	};
	leave_usage: {
		as_of: string;
		year: number;
		month: string;
		pl_total: number | null;
		used: number;
		month_used: number;
		balance: number | null;
		months_recorded: number;
		source: 'employee_attendance_summary';
	};
	agreements: SalaryTimelineAgreementDto[];
	current: SalaryTimelineSelectionDto;
	legacy_current: SalaryTimelineSelectionDto;
}

export type SalaryTimelineReadResult =
	| { ok: true; timeline: SalaryTimelineDto }
	| {
			ok: false;
			code: 'employee_not_found' | 'invalid_input';
			status: 400 | 404;
			message: string;
	  };
