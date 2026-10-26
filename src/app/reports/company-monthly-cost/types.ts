import type { PayrollExpenditure } from '@/lib/company-expenditure/types';

export interface FinancialYearOption {
	year: number;
	label: string;
}

export interface CompanyCostMeta {
	financial_years: FinancialYearOption[];
	current_fy: number;
	months: string[];
	latest_month: string | null;
	current_month: string;
	/** Months with direct cost recorded, newest first (expenditure view). */
	expenditure_months?: string[];
	employees?: unknown[];
}

export interface MonthlyRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hourly_rate: number;
	hours: number;
	cost: number;
	missing_salary_profile: boolean;
}

export interface MonthlyEmployeeRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	hourly_rate: number;
	hours: number;
	cost: number;
	project_count: number;
	missing_salary_profile: boolean;
}

export interface MonthlyProjectRow {
	sr_no: number;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hours: number;
	cost: number;
	employee_count: number;
	missing_salary_profile_count: number;
}

export interface MonthlyCompanyCostData {
	month: string;
	month_label: string;
	fy_label: string;
	fy_year: number;
	rows: MonthlyRow[];
	employee_rows: MonthlyEmployeeRow[];
	project_rows: MonthlyProjectRow[];
	payroll: PayrollExpenditure;
	totals: {
		total_hours: number;
		total_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
}

export interface FYCompanyRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hourly_rate: number;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
}

export interface FYEmployeeRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	hourly_rate: number;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	project_count: number;
}

export interface FYProjectRow {
	sr_no: number;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	employee_count: number;
}

export interface FYCompanyCostData {
	fy_label: string;
	fy_year: number;
	months: string[];
	month_keys: string[];
	rows: FYCompanyRow[];
	employee_rows: FYEmployeeRow[];
	project_rows: FYProjectRow[];
	totals: {
		monthly_hours: Record<string, number>;
		monthly_cost: Record<string, number>;
		total_hours: number;
		total_cost: number;
		blended_rate: number;
	};
	summary: {
		total_hours: number;
		total_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
}

export interface MetaResponse {
	success: boolean;
	meta?: CompanyCostMeta;
	error?: string;
}

export interface MonthlyResponse {
	success: boolean;
	data?: MonthlyCompanyCostData;
	view?: string;
	error?: string;
}

export interface FYResponse {
	success: boolean;
	data?: FYCompanyCostData;
	view?: string;
	error?: string;
}

export type ViewMode = 'expenditure' | 'monthly' | 'fy';
export type BreakdownTab = 'detailed' | 'byEmployee' | 'byProject';
export type Metric = 'hours' | 'cost';

export interface ProjectWiseMonthlySection {
	project: MonthlyProjectRow;
	rows: MonthlyRow[];
}
