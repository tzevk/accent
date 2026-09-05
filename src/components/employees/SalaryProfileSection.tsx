'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	DocumentArrowDownIcon,
	PencilSquareIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';
import MonthlySalaryPreview from '@/components/MonthlySalaryPreview';
import { formatCurrency } from '@/lib/format';
import { mul, toNumber } from '@/lib/money';
import type { EmployeeRecord } from '@/hooks/useEmployeeDirectory';
import { usePayrollPreview } from '@/hooks/usePayrollPreview';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import {
	getSalaryProfileOverrides,
	hasSalaryOverrides,
} from '@/utils/payroll-calculation';

export type SalaryType =
	| 'monthly'
	| 'hourly'
	| 'daily'
	| 'contract'
	| 'lumpsum'
	| 'custom';

export interface SalaryProfileRecord {
	id: number | string;
	employee_id?: number | string;
	salary_type?: string;
	effective_from?: string | null;
	effective_to?: string | null;
	gross_salary?: unknown;
	net_pay?: unknown;
	employer_cost?: unknown;
	lumpsum_amount?: unknown;
	lumpsum_description?: string | null;
	hourly_rate?: unknown;
	daily_rate?: unknown;
	contract_amount?: unknown;
	tds_percentage?: unknown;
	contract_duration?: string;
	loan_active?: unknown;
	loan_amount_per_month?: unknown;
	advance_active?: unknown;
	advance_amount?: unknown;
	is_manual_override?: unknown;
	[key: string]: unknown;
}

interface SalaryFormState {
	salary_type: SalaryType;
	gross: string;
	other_allowances: string;
	hourly_rate: string;
	std_hours_per_day: string;
	daily_rate: string;
	std_working_days: string;
	ot_multiplier: string;
	lumpsum_amount: string;
	lumpsum_description: string;
	effective_from: string;
	effective_to: string;
	std_in_time: string;
	std_out_time: string;
	pf_applicable: boolean;
	esic_applicable: boolean;
	pt_applicable: boolean;
	mlwf_applicable: boolean;
	retention_applicable: boolean;
	bonus_applicable: boolean;
	monthly_bonus: boolean;
	incentive_applicable: boolean;
	insurance_applicable: boolean;
	pl_total: string;
	pl_used: string;
	pl_balance: string;
	loan_amount: string;
	loan_amount_per_month: string;
	loan_no_of_months: string;
	loan_total_amount: string;
	loan_active: boolean;
	advance_amount: string;
	advance_active: boolean;
	[key: string]: unknown;
}

interface SalaryProfileSectionProps {
	employee: EmployeeRecord;
	canOverride: boolean;
}

export const today = () => new Date().toISOString().split('T')[0];

/** Coerce an unknown API/DB scalar to a finite number (0 when unusable). */
export const num = (value: unknown): number => {
	const parsed =
		typeof value === 'number' ? value : parseFloat(String(value ?? ''));
	return Number.isFinite(parsed) ? parsed : 0;
};

/** Truthiness for DB/statutory flags stored as 1/'1'/true/'true'. */
export const enabled = (value: unknown): boolean =>
	value === true || value === 1 || value === '1' || value === 'true';

export const timePart = (value: unknown, fallback: string): string => {
	const text = typeof value === 'string' ? value : '';
	return text ? text.substring(0, 5) : fallback;
};

export const datePart = (value: unknown): string => {
	const text = typeof value === 'string' ? value : '';
	return text ? text.split('T')[0] : '';
};

const createEmptySalaryForm = (): SalaryFormState => ({
	salary_type: 'monthly',
	gross: '',
	other_allowances: '',
	hourly_rate: '',
	std_hours_per_day: '8',
	daily_rate: '',
	std_working_days: '26',
	ot_multiplier: '1.5',
	lumpsum_amount: '',
	lumpsum_description: '',
	effective_from: today(),
	effective_to: '',
	std_in_time: '09:00',
	std_out_time: '17:30',
	pf_applicable: true,
	esic_applicable: false,
	pt_applicable: false,
	mlwf_applicable: false,
	retention_applicable: false,
	bonus_applicable: false,
	monthly_bonus: false,
	incentive_applicable: false,
	insurance_applicable: false,
	pl_total: '21',
	pl_used: '0',
	pl_balance: '21',
	loan_amount: '',
	loan_amount_per_month: '',
	loan_no_of_months: '',
	loan_total_amount: '',
	loan_active: false,
	advance_amount: '',
	advance_active: false,
});

const EDITABLE_TYPES: SalaryType[] = ['monthly', 'hourly', 'daily', 'lumpsum'];

/**
 * Route-owned Payroll Salary Profile workflow: profile history and exports,
 * the Salary Profile editor with the shared derived preview, explicit
 * overrides, and duplicate-safe monthly persistence.
 */
export default function SalaryProfileSection({
	employee,
	canOverride,
}: SalaryProfileSectionProps) {
	const employeeId = employee.id;

	const [form, setForm] = useState<SalaryFormState>(createEmptySalaryForm);
	const [overrides, setOverrides] = useState<Record<string, unknown>>({});
	const [overrideMode, setOverrideMode] = useState(false);
	const [editingId, setEditingId] = useState<number | string | null>(null);
	const [saving, setSaving] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const autoLoadedForRef = useRef<number | string | null>(null);

	const update = useCallback((patch: Partial<SalaryFormState>) => {
		setForm((previous) => ({ ...previous, ...patch }));
	}, []);

	const profilesQuery = useQuery({
		queryKey: ['salary-profiles', employeeId],
		queryFn: async () => {
			const data = (await apiGet('/api/payroll/salary-profile', {
				employee_id: employeeId,
			})) as { success?: boolean; data?: SalaryProfileRecord[] };
			return data.data || [];
		},
		enabled: Boolean(employeeId),
	});
	const profiles = profilesQuery.data || [];

	const loadProfile = useCallback(
		(profile: SalaryProfileRecord, asEdit: boolean) => {
			const salaryType = (profile.salary_type ||
				'monthly') as SalaryFormState['salary_type'];
			const profileOverrides = getSalaryProfileOverrides(profile);
			setOverrides(profileOverrides);
			setOverrideMode(hasSalaryOverrides(profileOverrides));
			setEditingId(asEdit ? profile.id : null);
			setForm({
				...createEmptySalaryForm(),
				salary_type: salaryType,
				gross: String(profile.gross_salary ?? profile.gross ?? ''),
				other_allowances: String(profile.other_allowances ?? ''),
				hourly_rate: String(profile.hourly_rate ?? ''),
				std_hours_per_day: String(num(profile.std_hours_per_day) || 8),
				std_in_time: timePart(profile.std_in_time, '09:00'),
				std_out_time: timePart(profile.std_out_time, '17:30'),
				ot_multiplier: String(num(profile.ot_multiplier) || 1.5),
				daily_rate: String(profile.daily_rate ?? ''),
				std_working_days: String(num(profile.std_working_days) || 26),
				lumpsum_amount: String(profile.lumpsum_amount ?? ''),
				lumpsum_description:
					salaryType === 'custom'
						? ''
						: String(profile.lumpsum_description ?? ''),
				effective_from: datePart(profile.effective_from) || today(),
				effective_to: datePart(profile.effective_to),
				pf_applicable: enabled(profile.pf_applicable),
				esic_applicable: enabled(profile.esic_applicable),
				pt_applicable: enabled(profile.pt_applicable),
				mlwf_applicable: enabled(profile.mlwf_applicable),
				retention_applicable: enabled(profile.retention_applicable),
				bonus_applicable: enabled(profile.bonus_applicable),
				monthly_bonus: enabled(profile.monthly_bonus),
				incentive_applicable: enabled(profile.incentive_applicable),
				insurance_applicable: enabled(profile.insurance_applicable),
				pl_total: String(num(profile.pl_total) || 21),
				pl_used: '0',
				pl_balance: String(num(profile.pl_total) || 21),
				loan_amount: String(profile.loan_amount ?? ''),
				loan_amount_per_month: String(profile.loan_amount_per_month ?? ''),
				loan_no_of_months: String(profile.loan_no_of_months ?? ''),
				loan_total_amount: String(profile.loan_total_amount ?? ''),
				loan_active: enabled(profile.loan_active),
				advance_amount: String(profile.advance_amount ?? ''),
				advance_active: enabled(profile.advance_active),
			});

			// Privilege Leave usage comes from the attendance records.
			void (async () => {
				try {
					const year = new Date().getFullYear();
					const data = (await apiGet('/api/attendance/summary', {
						year,
						employee_id: profile.employee_id ?? employeeId,
					})) as {
						success?: boolean;
						data?: { total_privilege_leave?: unknown }[];
					};
					if (!data.success || !data.data) return;
					const used = data.data.reduce(
						(sum, row) =>
							sum + (parseInt(String(row.total_privilege_leave)) || 0),
						0
					);
					const total = parseInt(String(profile.pl_total)) || 21;
					setForm((previous) => ({
						...previous,
						pl_used: String(used),
						pl_balance: String(Math.max(0, total - used)),
					}));
				} catch {
					// PL usage stays at the stored value when attendance is unavailable.
				}
			})();
		},
		[employeeId]
	);

	// Entering the workflow loads the current agreement into the editor, the
	// same way the previous employee page did when the salary tab opened.
	useEffect(() => {
		const list = profilesQuery.data || [];
		if (!list.length || autoLoadedForRef.current === employeeId) return;
		autoLoadedForRef.current = employeeId;
		loadProfile(list[0], false);
	}, [employeeId, loadProfile, profilesQuery.data]);

	const resetForm = useCallback(() => {
		setEditingId(null);
		setOverrides({});
		setOverrideMode(false);
		setForm(createEmptySalaryForm());
		setErrorMessage('');
	}, []);

	const isMonthly = form.salary_type === 'monthly';
	const scheduleDate = form.effective_from || today();
	const grossNumber = num(form.gross);

	const scheduleQuery = useQuery({
		queryKey: ['payroll-schedule', scheduleDate, grossNumber],
		queryFn: async () => {
			const data = (await apiGet('/api/payroll/schedules/current', {
				date: scheduleDate,
				gross: grossNumber,
			})) as { success?: boolean; data?: Record<string, unknown> };
			return data.data || {};
		},
		enabled: Boolean(employeeId) && isMonthly && grossNumber > 0,
		staleTime: 0,
	});
	const schedule = useMemo(
		() => (scheduleQuery.isSuccess ? scheduleQuery.data : {}),
		[scheduleQuery.data, scheduleQuery.isSuccess]
	);

	const payrollPreviewProfile = useMemo(
		() => ({ ...form, gross_salary: form.gross }),
		[form]
	);
	const { preview: derivedPreview } = usePayrollPreview({
		employeeId,
		month: form.effective_from,
		salaryProfile: payrollPreviewProfile,
		payrollSchedule: schedule,
		attendance: { standardWorkingDays: num(form.std_working_days) || 26 },
		overrides,
		includeBonus: true,
	});

	// Estimated monthly gross for the rate-based pay types. The editor
	// summary and the persisted payload share this one computation.
	const estimatedMonthly = useMemo(() => {
		if (form.salary_type === 'hourly') {
			return toNumber(
				mul(num(form.hourly_rate), mul(num(form.std_hours_per_day) || 8, 26))
			);
		}
		if (form.salary_type === 'daily') {
			return toNumber(
				mul(num(form.daily_rate), num(form.std_working_days) || 26)
			);
		}
		return null;
	}, [
		form.salary_type,
		form.hourly_rate,
		form.std_hours_per_day,
		form.daily_rate,
		form.std_working_days,
	]);

	const saveProfile = async () => {
		if (!employeeId) {
			setErrorMessage('No employee selected');
			return;
		}
		const salaryType = form.salary_type;
		const breakdown = salaryType === 'monthly' ? derivedPreview : null;
		const profileHasOverrides =
			salaryType === 'monthly' && hasSalaryOverrides(overrides);
		const persisted = (key: string): number | null => {
			const value = overrides[key];
			if (value === undefined || value === null || value === '') return null;
			return breakdown
				? (((breakdown as Record<string, unknown>)[key] as number) ?? null)
				: null;
		};

		if (salaryType === 'monthly') {
			if (!form.gross) {
				setErrorMessage('Please enter gross salary');
				return;
			}
			if (!breakdown) {
				setErrorMessage(
					'Please enter a gross salary first to calculate breakdown'
				);
				return;
			}
		} else if (salaryType === 'hourly' && !form.hourly_rate) {
			setErrorMessage('Please enter hourly rate');
			return;
		} else if (salaryType === 'daily' && !form.daily_rate) {
			setErrorMessage('Please enter daily rate');
			return;
		} else if (salaryType === 'lumpsum' && !form.lumpsum_amount) {
			setErrorMessage('Please enter lumpsum amount');
			return;
		}

		setSaving(true);
		setErrorMessage('');
		setSuccessMessage('');
		try {
			let payload: Record<string, unknown> = {
				...(editingId ? { id: editingId } : {}),
				employee_id: employeeId,
				salary_type: salaryType,
				effective_from: form.effective_from || today(),
				effective_to: form.effective_to || null,
				da_year: new Date().getFullYear(),
				is_manual_override: profileHasOverrides,
				std_in_time: form.std_in_time || '09:00',
				std_out_time: form.std_out_time || '17:30',
				pl_total: parseInt(form.pl_total) || 0,
				pl_used: parseInt(form.pl_used) || 0,
				pl_balance: parseInt(form.pl_balance) || 0,
				loan_amount: num(form.loan_amount),
				loan_amount_per_month: num(form.loan_amount_per_month),
				loan_no_of_months: parseInt(form.loan_no_of_months) || 0,
				loan_total_amount: num(form.loan_total_amount),
				loan_active: form.loan_active,
				advance_amount: num(form.advance_amount),
				advance_active: form.advance_active,
			};

			if (salaryType === 'monthly') {
				payload = {
					...payload,
					gross_salary: num(form.gross),
					other_allowances: num(form.other_allowances),
					pf_applicable: form.pf_applicable,
					esic_applicable: form.esic_applicable,
					pt_applicable: form.pt_applicable,
					mlwf_applicable: form.mlwf_applicable,
					retention_applicable: form.retention_applicable,
					bonus_applicable: form.bonus_applicable,
					monthly_bonus: form.monthly_bonus,
					incentive_applicable: form.incentive_applicable,
					insurance_applicable: form.insurance_applicable,
					// Persist only deliberate component exceptions; the calculation
					// boundary derives null components from the current schedule.
					basic: persisted('basic'),
					basic_plus_da: null,
					da: persisted('da'),
					basic_da_total: null,
					hra: persisted('hra'),
					conveyance: persisted('conveyance'),
					call_allowance: persisted('call_allowance'),
					bonus: persisted('bonus'),
					incentive: persisted('incentive'),
					pf_employee: persisted('pf_employee'),
					esic_employee: persisted('esic_employee'),
					pt: persisted('pt'),
					mlwf: persisted('mlwf'),
					mlwf_employer: persisted('mlwf_employer'),
					retention: persisted('retention'),
					insurance: persisted('insurance'),
					pf_employer: persisted('pf_employer'),
					esic_employer: persisted('esic_employer'),
					tds_percentage: persisted('tds_percentage'),
					total_earnings: breakdown?.total_earnings,
					total_deductions: breakdown?.total_deductions,
					net_pay: breakdown?.net_pay,
					employer_cost: breakdown?.employer_cost,
				};
			} else if (salaryType === 'hourly') {
				payload = {
					...payload,
					hourly_rate: num(form.hourly_rate),
					std_hours_per_day: num(form.std_hours_per_day) || 8,
					ot_multiplier: num(form.ot_multiplier) || 1.5,
					gross_salary: estimatedMonthly,
					net_pay: estimatedMonthly,
					employer_cost: estimatedMonthly,
				};
			} else if (salaryType === 'daily') {
				payload = {
					...payload,
					daily_rate: num(form.daily_rate),
					std_working_days: num(form.std_working_days) || 26,
					gross_salary: estimatedMonthly,
					net_pay: estimatedMonthly,
					employer_cost: estimatedMonthly,
				};
			} else if (salaryType === 'lumpsum') {
				const amount = num(form.lumpsum_amount);
				payload = {
					...payload,
					lumpsum_amount: amount,
					lumpsum_description: form.lumpsum_description || '',
					gross_salary: amount,
					net_pay: amount,
					employer_cost: amount,
				};
			}

			await apiPost('/api/payroll/salary-profile', payload);

			setSuccessMessage(
				editingId
					? '✓ Salary profile updated!'
					: '✓ New salary profile created!'
			);
			await profilesQuery.refetch();
			resetForm();
			setTimeout(() => setSuccessMessage(''), 4000);
		} catch (error) {
			setErrorMessage(
				`Failed to save: ${(error as Error).message || 'unknown error'}`
			);
		} finally {
			setSaving(false);
		}
	};

	const deleteProfile = async (profileId: number | string) => {
		if (
			!window.confirm(
				'Are you sure you want to delete this salary profile? This action cannot be undone.'
			)
		) {
			return;
		}
		try {
			await apiDelete(`/api/payroll/salary-profile?id=${profileId}`);
			if (editingId === profileId) resetForm();
			await profilesQuery.refetch();
			setSuccessMessage('Salary profile deleted successfully');
			setTimeout(() => setSuccessMessage(''), 3000);
		} catch (error) {
			setErrorMessage(
				`Failed to delete: ${(error as Error).message || 'unknown error'}`
			);
		}
	};

	const downloadBlob = async (url: string, fallbackName: string) => {
		const res = await fetch(url);
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			throw new Error(
				(data as { error?: string; details?: string }).error ||
					(data as { details?: string }).details ||
					'Export failed'
			);
		}
		const blob = await res.blob();
		const disposition = res.headers.get('content-disposition') || '';
		const match = disposition.match(/filename="?([^"]+)"?/i);
		const filename = match?.[1] || fallbackName;
		const objectUrl = window.URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(objectUrl);
	};

	const [exportingSelected, setExportingSelected] = useState(false);
	const [exportingAll, setExportingAll] = useState(false);

	const exportSelected = async () => {
		if (!employeeId) {
			setErrorMessage('Please select an employee first.');
			return;
		}
		setExportingSelected(true);
		setErrorMessage('');
		try {
			await downloadBlob(
				`/api/employees/${employeeId}/salary-structure/export`,
				`Salary_Structure_${employee.employee_id || employeeId}.xlsx`
			);
		} catch (error) {
			setErrorMessage(
				(error as Error).message || 'Failed to export salary structure'
			);
		} finally {
			setExportingSelected(false);
		}
	};

	const exportAll = async () => {
		setExportingAll(true);
		setErrorMessage('');
		try {
			await downloadBlob(
				'/api/employees/salary-structure/export',
				'Salary_Structure_All_Users.xlsx'
			);
		} catch (error) {
			setErrorMessage(
				(error as Error).message || 'Failed to export all salary structures'
			);
		} finally {
			setExportingAll(false);
		}
	};

	const setLoanField = (patch: Partial<SalaryFormState>) => {
		const next = { ...form, ...patch };
		const emi = num(next.loan_amount_per_month);
		const months = parseInt(next.loan_no_of_months) || 0;
		update({
			...patch,
			loan_total_amount: String(toNumber(mul(emi, months))),
		});
	};

	const canSave = isMonthly
		? Boolean(derivedPreview)
		: Boolean(form.hourly_rate || form.daily_rate || form.lumpsum_amount);

	return (
		<div className="space-y-6" data-testid="salary-profile-section">
			{/* Salary Profile history */}
			{profiles.length > 0 && (
				<div className="rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-4">
					<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
						<h4 className="flex items-center gap-2 text-lg font-semibold text-purple-900">
							Salary Profile History
							<span className="rounded-full bg-purple-200 px-2 py-0.5 text-xs font-medium text-purple-800">
								{profiles.length} {profiles.length === 1 ? 'record' : 'records'}
							</span>
						</h4>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void exportSelected()}
								disabled={exportingSelected || !employeeId}
								className="flex items-center gap-2 rounded-lg border border-green-700 bg-green-600 px-3 py-2 text-xs text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentArrowDownIcon className="h-4 w-4" />
								{exportingSelected ? 'Exporting...' : 'Export Selected (Excel)'}
							</button>
							<button
								type="button"
								onClick={() => void exportAll()}
								disabled={exportingAll}
								className="flex items-center gap-2 rounded-lg border border-indigo-700 bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentArrowDownIcon className="h-4 w-4" />
								{exportingAll ? 'Exporting...' : 'Export All Users (Excel)'}
							</button>
						</div>
					</div>
					<div className="max-h-[400px] space-y-3 overflow-y-auto">
						{profiles.map((profile, index) => {
							const active =
								!profile.effective_to ||
								new Date(profile.effective_to) >= new Date();
							const beingEdited = editingId === profile.id;
							const editable = EDITABLE_TYPES.includes(
								(profile.salary_type || 'monthly') as SalaryType
							);
							const amount = num(profile.gross_salary);
							return (
								<div
									key={String(profile.id)}
									className={`rounded-xl border-2 bg-white p-4 shadow-sm ${
										beingEdited
											? 'border-purple-500 ring-2 ring-purple-200'
											: active && index === 0
												? 'border-green-300'
												: 'border-gray-100'
									}`}
								>
									<div className="flex items-start justify-between gap-4">
										<div className="min-w-0 flex-1">
											<div className="mb-2 flex flex-wrap items-center gap-2">
												{active && index === 0 && (
													<span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
														✓ Active
													</span>
												)}
												{beingEdited && (
													<span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
														Editing...
													</span>
												)}
												<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
													{(profile.salary_type || 'monthly')
														.charAt(0)
														.toUpperCase() +
														(profile.salary_type || 'monthly').slice(1)}
												</span>
											</div>
											<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
												{profile.salary_type === 'hourly' ? (
													<>
														<span className="text-lg font-bold text-gray-900">
															{formatCurrency(num(profile.hourly_rate))}/hr
														</span>
														<span className="text-sm text-gray-500">
															{num(profile.std_hours_per_day) || 8} hrs/day
														</span>
													</>
												) : profile.salary_type === 'daily' ? (
													<>
														<span className="text-lg font-bold text-gray-900">
															{formatCurrency(num(profile.daily_rate))}/day
														</span>
														<span className="text-sm text-gray-500">
															{num(profile.std_working_days) || 26} days/month
														</span>
													</>
												) : profile.salary_type === 'contract' ? (
													<span className="text-lg font-bold text-gray-900">
														{formatCurrency(
															num(
																profile.contract_amount || profile.gross_salary
															)
														)}
														<span className="ml-2 text-sm font-normal text-gray-500">
															{(profile.contract_duration || 'monthly').replace(
																'_',
																' '
															)}{' '}
															— managed on the Contract route
														</span>
													</span>
												) : profile.salary_type === 'lumpsum' ? (
													<span className="text-lg font-bold text-gray-900">
														{formatCurrency(
															num(
																profile.lumpsum_amount || profile.gross_salary
															)
														)}
														<span className="ml-2 text-sm font-normal text-gray-500">
															Lumpsum
														</span>
													</span>
												) : (
													<>
														<span className="text-lg font-bold text-gray-900">
															{formatCurrency(amount)}
														</span>
														<span className="text-sm text-gray-500">
															{profile.salary_type === 'custom'
																? 'Earnings'
																: 'Gross/month'}
														</span>
														<span className="text-sm font-medium text-green-600">
															• Net: {formatCurrency(num(profile.net_pay))}
														</span>
														<span className="text-sm font-medium text-blue-600">
															• CTC:{' '}
															{formatCurrency(num(profile.employer_cost))}
														</span>
													</>
												)}
												{enabled(profile.loan_active) &&
													num(profile.loan_amount_per_month) > 0 && (
														<span className="text-sm font-medium text-amber-600">
															• Loan:{' '}
															{formatCurrency(
																num(profile.loan_amount_per_month)
															)}
															/mo
														</span>
													)}
												{enabled(profile.advance_active) &&
													num(profile.advance_amount) > 0 && (
														<span className="text-sm font-medium text-orange-600">
															• Adv:{' '}
															{formatCurrency(num(profile.advance_amount))}
														</span>
													)}
											</div>
											<p className="mt-2 text-xs text-gray-500">
												<span className="font-medium">Effective:</span>{' '}
												{profile.effective_from
													? new Date(profile.effective_from).toLocaleDateString(
															'en-IN'
														)
													: '—'}
												{profile.effective_to ? (
													<>
														{' '}
														→{' '}
														{new Date(profile.effective_to).toLocaleDateString(
															'en-IN'
														)}
													</>
												) : (
													<span className="font-medium text-green-600">
														{' '}
														→ Ongoing
													</span>
												)}
											</p>
										</div>
										<div className="flex flex-shrink-0 items-center gap-2">
											{editable ? (
												<button
													type="button"
													onClick={() => loadProfile(profile, true)}
													disabled={beingEdited}
													className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
														beingEdited
															? 'cursor-default bg-purple-100 text-purple-700'
															: 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
													}`}
												>
													<PencilSquareIcon className="h-3.5 w-3.5" />
													{beingEdited ? 'Editing' : 'Edit'}
												</button>
											) : (
												<span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
													{profile.salary_type === 'contract'
														? 'Contract pay is managed on the Contract route'
														: 'Legacy custom agreement — values shown as stored'}
												</span>
											)}
											<button
												type="button"
												onClick={() => void deleteProfile(profile.id)}
												className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
											>
												<TrashIcon className="h-3.5 w-3.5" />
												Delete
											</button>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{successMessage && (
				<div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
					<p className="font-semibold text-green-800" role="status">
						{successMessage}
					</p>
				</div>
			)}
			{errorMessage && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-3">
					<p className="text-sm text-red-800" role="alert">
						{errorMessage}
					</p>
				</div>
			)}

			{/* Editor */}
			<div
				className={`rounded-xl border-2 bg-white p-4 ${
					editingId ? 'border-purple-300' : 'border-gray-200'
				}`}
			>
				<div className="mb-4 flex items-center justify-between gap-3">
					<div className="flex items-center gap-4">
						<h4 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
							{editingId ? 'Edit Salary Profile' : 'Add Salary Profile'}
						</h4>
						{editingId && (
							<button
								type="button"
								onClick={resetForm}
								className="flex items-center gap-1 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
							>
								Cancel Edit
							</button>
						)}
					</div>
					<a
						href="/admin/payroll-schedules"
						target="_blank"
						rel="noreferrer"
						className="flex items-center gap-1 text-xs text-purple-600 underline hover:text-purple-700"
					>
						Manage Schedules
					</a>
				</div>

				{/* Effective dates and standard times */}
				<div className="mb-4 rounded-lg bg-gray-50 p-4">
					<div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Effective From *
							</span>
							<input
								type="date"
								value={form.effective_from}
								onChange={(event) =>
									update({ effective_from: event.target.value })
								}
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Effective To{' '}
								<span className="text-xs text-gray-400">
									(Optional - leave blank for ongoing)
								</span>
							</span>
							<input
								type="date"
								value={form.effective_to}
								min={form.effective_from}
								onChange={(event) =>
									update({ effective_to: event.target.value })
								}
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
					</div>
					<div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Standard In Time
							</span>
							<input
								type="time"
								value={form.std_in_time || '09:00'}
								onChange={(event) =>
									update({ std_in_time: event.target.value })
								}
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Standard Out Time
							</span>
							<input
								type="time"
								value={form.std_out_time || '17:30'}
								onChange={(event) =>
									update({ std_out_time: event.target.value })
								}
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
					</div>

					{/* Privilege Leave */}
					<div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
						<h5 className="mb-3 text-sm font-semibold text-blue-800">
							Privilege Leave (PL)
						</h5>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
							<label className="block text-xs">
								<span className="mb-1 block font-medium text-gray-600">
									Total Leaves
								</span>
								<input
									type="number"
									min="0"
									value={form.pl_total || ''}
									onChange={(event) => {
										const total = parseInt(event.target.value) || 0;
										const used = parseInt(form.pl_used) || 0;
										update({
											pl_total: event.target.value,
											pl_balance: String(Math.max(0, total - used)),
										});
									}}
									placeholder="e.g. 21"
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
							</label>
							<label className="block text-xs">
								<span className="mb-1 block font-medium text-gray-600">
									Used Leaves
								</span>
								<input
									type="number"
									value={form.pl_used || '0'}
									readOnly
									title="Fetched from attendance records"
									className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800"
								/>
								<span className="mt-0.5 block text-[10px] text-blue-500">
									Auto-fetched from attendance
								</span>
							</label>
							<label className="block text-xs">
								<span className="mb-1 block font-medium text-gray-600">
									Balance
								</span>
								<input
									type="number"
									value={form.pl_balance || ''}
									readOnly
									className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800"
								/>
							</label>
						</div>
					</div>

					{/* Loan & Advance */}
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div
							className={`rounded-lg border p-4 ${
								form.loan_active
									? 'border-amber-300 bg-amber-50'
									: 'border-gray-200 bg-gray-50'
							}`}
						>
							<div className="mb-3 flex items-center justify-between">
								<h5 className="text-sm font-semibold text-amber-800">
									Loan Deduction
								</h5>
								<label className="inline-flex cursor-pointer items-center">
									<input
										type="checkbox"
										checked={form.loan_active}
										onChange={(event) =>
											setLoanField({ loan_active: event.target.checked })
										}
										className="peer sr-only"
									/>
									<span className="peer h-5 w-9 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-amber-300 relative after:content-['']"></span>
								</label>
							</div>
							{form.loan_active ? (
								<div className="grid grid-cols-3 gap-3">
									<label className="block text-[11px]">
										<span className="mb-1 block font-medium text-gray-600">
											Loan Amount (₹)
										</span>
										<input
											type="number"
											min="0"
											value={form.loan_amount || ''}
											onChange={(event) =>
												setLoanField({ loan_amount: event.target.value })
											}
											placeholder="e.g. 50000"
											className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
										/>
									</label>
									<label className="block text-[11px]">
										<span className="mb-1 block font-medium text-gray-600">
											EMI / Month (₹)
										</span>
										<input
											type="number"
											min="0"
											value={form.loan_amount_per_month || ''}
											onChange={(event) =>
												setLoanField({
													loan_amount_per_month: event.target.value,
												})
											}
											placeholder="e.g. 5000"
											className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
										/>
									</label>
									<label className="block text-[11px]">
										<span className="mb-1 block font-medium text-gray-600">
											No. of Months
										</span>
										<input
											type="number"
											min="1"
											value={form.loan_no_of_months || ''}
											onChange={(event) =>
												setLoanField({ loan_no_of_months: event.target.value })
											}
											placeholder="e.g. 12"
											className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
										/>
									</label>
									<label className="col-span-3 block text-[11px]">
										<span className="mb-1 block font-medium text-gray-600">
											Total Amount (₹)
										</span>
										<input
											type="number"
											value={form.loan_total_amount || ''}
											readOnly
											className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-amber-100 px-2 py-1.5 text-sm font-semibold text-amber-800"
										/>
									</label>
								</div>
							) : (
								<p className="text-xs italic text-gray-400">
									Toggle to enable loan deduction from salary
								</p>
							)}
						</div>

						<div
							className={`rounded-lg border p-4 ${
								form.advance_active
									? 'border-green-300 bg-green-50'
									: 'border-gray-200 bg-gray-50'
							}`}
						>
							<div className="mb-3 flex items-center justify-between">
								<h5 className="text-sm font-semibold text-green-800">
									Monthly Advance
								</h5>
								<label className="inline-flex cursor-pointer items-center">
									<input
										type="checkbox"
										checked={form.advance_active}
										onChange={(event) =>
											update({ advance_active: event.target.checked })
										}
										className="peer sr-only"
									/>
									<span className="peer h-5 w-9 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-green-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-green-300 relative after:content-['']"></span>
								</label>
							</div>
							{form.advance_active ? (
								<label className="block text-[11px]">
									<span className="mb-1 block font-medium text-gray-600">
										Advance Amount (₹)
									</span>
									<input
										type="number"
										min="0"
										value={form.advance_amount || ''}
										onChange={(event) =>
											update({ advance_amount: event.target.value })
										}
										placeholder="e.g. 10000"
										className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
									/>
									<span className="mt-0.5 block text-[10px] text-green-600">
										This amount will be subtracted from gross in the payroll
										export
									</span>
								</label>
							) : (
								<p className="text-xs italic text-gray-400">
									Toggle to enable advance deduction for this month
								</p>
							)}
						</div>
					</div>
				</div>

				{/* Monthly inputs */}
				{isMonthly && (
					<div className="mb-3 grid grid-cols-1 gap-4 md:grid-cols-4">
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Gross Salary *
							</span>
							<input
								id="salary-gross"
								type="number"
								min="0"
								value={form.gross}
								onChange={(event) => update({ gross: event.target.value })}
								placeholder="Enter gross salary"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Retention
							</span>
							<output className="block w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700">
								{derivedPreview
									? formatCurrency(derivedPreview.retention)
									: '—'}
							</output>
						</label>
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Insurance
							</span>
							<output className="block w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700">
								{derivedPreview
									? formatCurrency(derivedPreview.insurance)
									: '—'}
							</output>
						</label>
						<label className="block text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Other Allowances
							</span>
							<input
								id="salary-other-allowances"
								type="number"
								min="0"
								value={form.other_allowances || ''}
								onChange={(event) =>
									update({ other_allowances: event.target.value })
								}
								placeholder="0"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
					</div>
				)}

				{/* Hourly inputs */}
				{form.salary_type === 'hourly' && (
					<div className="mb-3 grid grid-cols-2 gap-3">
						<label className="block text-xs">
							<span className="mb-1 block font-medium text-gray-600">
								Hourly Rate (₹) *
							</span>
							<input
								type="number"
								value={form.hourly_rate}
								onChange={(event) =>
									update({ hourly_rate: event.target.value })
								}
								placeholder="0"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
							/>
						</label>
						<label className="block text-xs">
							<span className="mb-1 block font-medium text-gray-600">
								Hours/Day
							</span>
							<input
								type="number"
								value={form.std_hours_per_day || '8'}
								onChange={(event) =>
									update({ std_hours_per_day: event.target.value })
								}
								placeholder="8"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
							/>
						</label>
					</div>
				)}

				{/* Daily inputs */}
				{form.salary_type === 'daily' && (
					<div className="mb-3 grid grid-cols-2 gap-3">
						<label className="block text-xs">
							<span className="mb-1 block font-medium text-gray-600">
								Daily Rate (₹) *
							</span>
							<input
								type="number"
								value={form.daily_rate}
								onChange={(event) => update({ daily_rate: event.target.value })}
								placeholder="0"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
							/>
						</label>
						<label className="block text-xs">
							<span className="mb-1 block font-medium text-gray-600">
								Days/Month
							</span>
							<input
								type="number"
								value={form.std_working_days || '26'}
								onChange={(event) =>
									update({ std_working_days: event.target.value })
								}
								placeholder="26"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
							/>
						</label>
					</div>
				)}

				{/* Lumpsum inputs */}
				{form.salary_type === 'lumpsum' && (
					<div className="mb-3 grid grid-cols-2 gap-3">
						<label className="block text-xs">
							<span className="mb-1 block font-medium text-gray-600">
								Lumpsum Amount (₹) *
							</span>
							<input
								type="number"
								value={form.lumpsum_amount}
								onChange={(event) =>
									update({ lumpsum_amount: event.target.value })
								}
								placeholder="0"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
						<label className="block text-xs">
							<span className="mb-1 block font-medium text-gray-600">
								Description
							</span>
							<input
								type="text"
								value={form.lumpsum_description || ''}
								onChange={(event) =>
									update({ lumpsum_description: event.target.value })
								}
								placeholder="e.g., Bonus"
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							/>
						</label>
					</div>
				)}

				{/* Derived monthly preview with override controls */}
				{isMonthly && (
					<MonthlySalaryPreview
						profile={form}
						canOverride={canOverride}
						overrideMode={overrideMode}
						overrides={overrides}
						onOverrideModeChange={(next) => {
							setOverrideMode(next);
							if (!next) setOverrides({});
						}}
						onOverrideChange={(name, value) =>
							setOverrides((previous) => ({ ...previous, [name]: value }))
						}
						onOverrideReset={(name) =>
							setOverrides((previous) => {
								const next = { ...previous };
								delete next[name];
								return next;
							})
						}
						onResetOverrides={() => setOverrides({})}
						breakdown={derivedPreview}
						scheduleLoading={scheduleQuery.isFetching}
						scheduleError={
							scheduleQuery.error instanceof Error
								? scheduleQuery.error.message
								: ''
						}
						onApplicabilityChange={(name, value) =>
							update({ [name]: value } as Partial<SalaryFormState>)
						}
					/>
				)}

				{/* Non-monthly summary */}
				{!isMonthly && estimatedMonthly !== null && (
					<div className="mb-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-5">
						<h5 className="mb-4 text-lg font-semibold text-indigo-900">
							{form.salary_type.charAt(0).toUpperCase() +
								form.salary_type.slice(1)}{' '}
							Payment Summary
						</h5>
						<div className="grid grid-cols-2 gap-4 md:grid-cols-2">
							<div className="rounded-xl bg-white p-4 text-center shadow-sm">
								<p className="mb-1 text-xs uppercase tracking-wide text-gray-500">
									{form.salary_type === 'hourly' ? 'Hourly Rate' : 'Daily Rate'}
								</p>
								<p className="text-xl font-bold text-indigo-700">
									₹{formatCurrency(form.hourly_rate || form.daily_rate || 0)}
								</p>
							</div>
							<div className="rounded-xl bg-white p-4 text-center shadow-sm">
								<p className="mb-1 text-xs uppercase tracking-wide text-gray-500">
									Est. Monthly
								</p>
								<p className="text-xl font-bold text-green-600">
									{formatCurrency(estimatedMonthly)}
								</p>
							</div>
						</div>
					</div>
				)}

				{!isMonthly &&
					form.salary_type === 'lumpsum' &&
					form.lumpsum_amount && (
						<div className="mb-4 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-5">
							<h5 className="mb-4 text-lg font-semibold text-indigo-900">
								Lumpsum Payment Summary
							</h5>
							<div className="rounded-xl bg-white p-4 text-center shadow-sm">
								<p className="mb-1 text-xs uppercase tracking-wide text-gray-500">
									Lumpsum Amount
								</p>
								<p className="text-xl font-bold text-indigo-700">
									{formatCurrency(form.lumpsum_amount)}
								</p>
							</div>
						</div>
					)}

				{/* Footer actions */}
				{canSave && (
					<div className="mt-4 flex justify-end gap-3">
						<button
							type="button"
							onClick={resetForm}
							className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
						>
							Clear
						</button>
						<button
							type="button"
							onClick={() => void saveProfile()}
							disabled={saving}
							className={`flex items-center gap-2 rounded-lg px-6 py-2 text-sm text-white disabled:opacity-50 ${
								editingId
									? 'bg-blue-600 hover:bg-blue-700'
									: 'bg-green-600 hover:bg-green-700'
							}`}
						>
							{editingId ? 'Update Salary Profile' : '+ Add New Salary Profile'}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
