'use client';

import { Fragment, useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	CalendarDaysIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CurrencyRupeeIcon,
	DocumentArrowDownIcon,
	DocumentTextIcon,
	EyeIcon,
	FunnelIcon,
	MagnifyingGlassIcon,
	PencilIcon,
	TableCellsIcon,
	TrashIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import EmployeeEditor from '@/components/employees/EmployeeEditor';
import AccessGuard from '@/components/AccessGuard';
import Navbar from '@/components/Navbar';
import EmployeeAvatar from '@/components/employees/EmployeeAvatar';
import { apiGet, apiPost } from '@/lib/api-client';
import SalaryProfileSection, {
	enabled,
	type SalaryProfileRecord,
	num,
} from '@/components/employees/SalaryProfileSection';
import { formatCurrency, formatDate } from '@/lib/format';
import { add, sub, toNumber } from '@/lib/money';
import {
	useEmployeeDirectory,
	type EmployeeRecord,
} from '@/hooks/useEmployeeDirectory';
import { useEmployeeForm } from '@/hooks/useEmployeeForm';
import { useSessionRBAC } from '@/utils/client-rbac';

const currentMonth = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const parseJson = (value: unknown): Record<string, unknown> => {
	if (typeof value !== 'string' || !value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
};

/** The optional persisted total on a profile row, or null when absent. */
const storedTotal = (
	profile: SalaryProfileRecord,
	key: string
): number | null => {
	const value = profile[key];
	if (value === null || value === undefined || value === '') return null;
	const parsed = num(value);
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Inline salary summary: display-only view of persisted boundary values.
 * Totals come from the shared calculation boundary at save time; the local
 * sums below only cover legacy rows that lack persisted totals and must not
 * be mistaken for a second payroll truth.
 */
export function summarizeProfile(profile: SalaryProfileRecord) {
	const customData = parseJson(profile.lumpsum_description);
	const customComponents = Array.isArray(customData.custom_components)
		? (customData.custom_components as {
				name?: unknown;
				amount?: unknown;
				type?: unknown;
			}[])
		: [];
	const customComponentsTotal = toNumber(
		add(...customComponents.map((component) => num(component.amount)))
	);
	const loan =
		enabled(profile.loan_active) && num(profile.loan_amount_per_month) > 0
			? num(profile.loan_amount_per_month)
			: 0;
	const advance =
		enabled(profile.advance_active) && num(profile.advance_amount) > 0
			? num(profile.advance_amount)
			: 0;

	const basicDaTotal =
		num(profile.basic_da_total) ||
		toNumber(add(num(profile.basic), num(profile.da)));
	const totalEarnings =
		storedTotal(profile, 'total_earnings') ??
		toNumber(
			add(
				basicDaTotal,
				num(profile.hra),
				num(profile.conveyance),
				num(profile.call_allowance),
				num(profile.incentive),
				num(profile.other_allowances),
				num(profile.bonus),
				customComponentsTotal
			)
		);
	const totalDeductions =
		storedTotal(profile, 'total_deductions') ??
		toNumber(
			add(
				num(profile.pf_employee),
				num(profile.esic_employee),
				num(profile.pt),
				num(profile.mlwf),
				num(profile.retention),
				num(profile.tds),
				loan,
				advance
			)
		);
	const totalEmployerContributions =
		storedTotal(profile, 'employer_cost') !== null
			? null
			: toNumber(
					add(
						num(profile.pf_employer),
						num(profile.esic_employer),
						num(profile.mlwf_employer),
						num(profile.insurance)
					)
				);
	const netPay =
		storedTotal(profile, 'net_pay') ??
		toNumber(sub(totalEarnings, totalDeductions));

	const storedEmployerCost = storedTotal(profile, 'employer_cost');
	return {
		gross: num(profile.gross_salary),
		hourlyRate: num(profile.hourly_rate),
		ctc: num(customData.ctc) || storedEmployerCost || 0,
		employerContributions:
			storedEmployerCost !== null
				? toNumber(sub(storedEmployerCost, totalEarnings))
				: totalEmployerContributions!,
		basicDaTotal,
		totalEarnings,
		totalDeductions,
		netPay,
		loan,
		advance,
		hasLoan: loan > 0,
		hasAdvance: advance > 0,
		customComponents,
		loanTotalAmount: num(profile.loan_total_amount),
		loanNoOfMonths: num(profile.loan_no_of_months),
	};
}

function InlineSalaryPanel({
	employee,
	profile,
	loading,
	error,
	onOpenEditor,
}: {
	employee: EmployeeRecord;
	profile: SalaryProfileRecord | null | undefined;
	loading: boolean;
	error: string;
	onOpenEditor: (employee: EmployeeRecord) => void;
}) {
	if (loading) {
		return (
			<div className="py-6 text-center text-sm text-gray-500">
				Loading salary profile...
			</div>
		);
	}
	if (error) {
		return (
			<p role="alert" className="py-3 text-center text-sm text-red-700">
				{error}
			</p>
		);
	}
	if (!profile) {
		return (
			<div className="py-4 text-center">
				<p className="mb-2 text-sm text-gray-500">
					No salary profile found for this employee.
				</p>
				<button
					type="button"
					onClick={() => onOpenEditor(employee)}
					className="text-sm font-medium text-purple-600 hover:text-purple-800"
				>
					+ Add Salary Profile
				</button>
			</div>
		);
	}

	const summary = summarizeProfile(profile);
	const tile = (label: string, value: number, tone: string) => (
		<div className={`rounded-lg border p-3 text-center ${tone}`}>
			<p className="text-[10px] font-medium uppercase">{label}</p>
			<p className="text-lg font-bold">{formatCurrency(value)}</p>
		</div>
	);
	const row = (label: string, value: number) => (
		<div className="flex items-center justify-between text-sm" key={label}>
			<span className="text-gray-600">{label}</span>
			<span className="font-medium text-gray-900">{formatCurrency(value)}</span>
		</div>
	);

	return (
		<div className="space-y-3" data-testid={`inline-salary-${employee.id}`}>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
				{tile(
					'Hourly Rate',
					summary.hourlyRate,
					'border-yellow-200 bg-yellow-50 text-yellow-800'
				)}
				{tile('CTC', summary.ctc, 'border-blue-200 bg-blue-50 text-blue-800')}
				{tile(
					'Total Earnings',
					summary.totalEarnings,
					'border-green-200 bg-green-50 text-green-800'
				)}
				{tile(
					'Total Deductions',
					summary.totalDeductions,
					'border-red-200 bg-red-50 text-red-800'
				)}
				{tile(
					'Net Pay',
					summary.netPay,
					'border-purple-200 bg-purple-50 text-purple-800'
				)}
			</div>
			<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
				<div className="rounded-lg border border-green-200 bg-green-50/50 p-3">
					<p className="mb-2 text-xs font-semibold uppercase text-green-700">
						Earnings
					</p>
					<div className="space-y-1">
						{row('Basic + DA', summary.basicDaTotal)}
						{row('HRA', num(profile.hra))}
						{row('Conveyance', num(profile.conveyance))}
						{row('Call Allowance', num(profile.call_allowance))}
						{row('Incentive', num(profile.incentive))}
						{row('Other Allowances', num(profile.other_allowances))}
						{row('Bonus', num(profile.bonus))}
						{summary.customComponents.map((component, index) =>
							row(
								String(component.name || `Component ${index + 1}`),
								num(component.amount)
							)
						)}
					</div>
				</div>
				<div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
					<p className="mb-2 text-xs font-semibold uppercase text-red-700">
						Deductions
					</p>
					<div className="space-y-1">
						{row('PF (Employee)', num(profile.pf_employee))}
						{row('ESIC (Employee)', num(profile.esic_employee))}
						{row('Professional Tax', num(profile.pt))}
						{row('MLWF', num(profile.mlwf))}
						{row('Retention', num(profile.retention))}
						{row('TDS', num(profile.tds))}
						{summary.hasLoan && row('Loan EMI', summary.loan)}
						{summary.hasAdvance && row('Advance', summary.advance)}
					</div>
				</div>
				<div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
					<p className="mb-2 text-xs font-semibold uppercase text-blue-700">
						Employer / CTC
					</p>
					<div className="space-y-1">
						{row('PF (Employer)', num(profile.pf_employer))}
						{row('ESIC (Employer)', num(profile.esic_employer))}
						{row('MLWF (Employer)', num(profile.mlwf_employer))}
						{row('Insurance', num(profile.insurance))}
						{row('Total Employer Contributions', summary.employerContributions)}
						{row('CTC', summary.ctc)}
					</div>
				</div>
			</div>
			{profile.pl_total != null && (
				<div className="flex items-center gap-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-gray-600">
					<span className="font-medium text-indigo-800">Privilege Leave:</span>
					<span>Total: {String(num(profile.pl_total) || 21)}</span>
				</div>
			)}
			{(summary.hasLoan || summary.hasAdvance) && (
				<div className="flex flex-wrap gap-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
					{summary.hasLoan && (
						<span className="text-amber-800">
							Loan: {formatCurrency(summary.loan)}/month ×{' '}
							{summary.loanNoOfMonths} months (
							{formatCurrency(summary.loanTotalAmount)} total)
						</span>
					)}
					{summary.hasAdvance && (
						<span className="text-orange-800">
							Advance: {formatCurrency(summary.advance)}
						</span>
					)}
				</div>
			)}
			<div className="flex items-center justify-between text-xs text-gray-500">
				<span>
					Effective:{' '}
					{profile.effective_from
						? new Date(profile.effective_from).toLocaleDateString('en-IN')
						: 'N/A'}
					{profile.effective_to
						? ` → ${new Date(profile.effective_to).toLocaleDateString('en-IN')}`
						: ' → Ongoing'}
				</span>
				<button
					type="button"
					onClick={() => onOpenEditor(employee)}
					className="font-medium text-purple-600 hover:text-purple-800"
				>
					Edit Salary Profile →
				</button>
			</div>
		</div>
	);
}

interface PayrollMessage {
	type: '' | 'success' | 'error';
	text: string;
}

export default function PayrollPage() {
	const directory = useEmployeeDirectory('Payroll');
	const { user, can, RESOURCES, PERMISSIONS } = useSessionRBAC();
	const canOverrideSalary = Boolean(
		user?.is_super_admin ||
		can(RESOURCES.PAYROLL, PERMISSIONS.UPDATE) ||
		can(RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE)
	);
	const [mode, setMode] = useState<'list' | 'edit' | 'view'>('list');
	const [actionMessage, setActionMessage] = useState('');
	const [actionError, setActionError] = useState('');
	const [expandedSalaryId, setExpandedSalaryId] = useState<
		number | string | null
	>(null);
	const [payrollMonth, setPayrollMonth] = useState(currentMonth);
	const [generatingPayroll, setGeneratingPayroll] = useState(false);
	const [exportingSlipPdf, setExportingSlipPdf] = useState(false);
	const [exportingSheetExcel, setExportingSheetExcel] = useState(false);
	const [exportingAllStructures, setExportingAllStructures] = useState(false);
	const [payrollMessage, setPayrollMessage] = useState<PayrollMessage>({
		type: '',
		text: '',
	});

	const payrollMonthForApi = `${payrollMonth}-01`;

	const form = useEmployeeForm({
		employeeType: 'Payroll',
		onSaved: async () => {
			await Promise.all([directory.refresh(), directory.refreshAll()]);
			setMode('list');
			setActionMessage('Employee updated successfully!');
		},
	});

	const inlineQuery = useQuery({
		queryKey: ['salary-profile', expandedSalaryId],
		queryFn: async () => {
			const data = (await apiGet('/api/payroll/salary-profile', {
				employee_id: expandedSalaryId,
			})) as { success?: boolean; data?: SalaryProfileRecord[] };
			return data.data?.[0] ?? null;
		},
		enabled: expandedSalaryId !== null,
		staleTime: 0,
	});

	const downloadFile = useCallback(
		async (
			url: string,
			filename: string,
			successText: string,
			failureText: string
		) => {
			try {
				const res = await fetch(url);
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(
						(data as { error?: string }).error || 'Export failed'
					);
				}
				const blob = await res.blob();
				const objectUrl = window.URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = objectUrl;
				link.download = filename;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				window.URL.revokeObjectURL(objectUrl);
				setPayrollMessage({ type: 'success', text: successText });
			} catch (error) {
				setPayrollMessage({
					type: 'error',
					text: (error as Error).message || failureText,
				});
			}
		},
		[]
	);

	const generatePayroll = async () => {
		const monthLabel = new Date(
			`${payrollMonthForApi}T00:00:00`
		).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
		if (
			!window.confirm(
				`Generate payroll for all Payroll employees for ${monthLabel}?`
			)
		)
			return;
		setGeneratingPayroll(true);
		setPayrollMessage({ type: '', text: '' });
		try {
			const data = (await apiPost('/api/payroll/generate', {
				month: payrollMonthForApi,
				all: true,
				salary_type: 'payroll',
			})) as {
				success?: boolean;
				error?: string;
				results?: { generated?: number; skipped?: number };
			};
			if (data.success) {
				setPayrollMessage({
					type: 'success',
					text: `Payroll generated: ${data.results?.generated || 0} slips created, ${data.results?.skipped || 0} skipped`,
				});
			} else {
				setPayrollMessage({
					type: 'error',
					text: data.error || 'Generation failed',
				});
			}
		} catch {
			setPayrollMessage({ type: 'error', text: 'Failed to generate payroll' });
		} finally {
			setGeneratingPayroll(false);
			setTimeout(() => setPayrollMessage({ type: '', text: '' }), 5000);
		}
	};

	const exportSalarySlipPdf = async () => {
		setExportingSlipPdf(true);
		setPayrollMessage({ type: '', text: '' });
		await downloadFile(
			`/api/payroll/bulk-pdf?month=${payrollMonthForApi}&salary_type=payroll`,
			`Salary_Slips_Payroll_${payrollMonth}.pdf`,
			'Salary slips PDF downloaded',
			'Failed to export PDF'
		);
		setExportingSlipPdf(false);
		setTimeout(() => setPayrollMessage({ type: '', text: '' }), 5000);
	};

	const exportSalarySheetExcel = async () => {
		setExportingSheetExcel(true);
		setPayrollMessage({ type: '', text: '' });
		await downloadFile(
			`/api/payroll/export-sheet?month=${payrollMonthForApi}&salary_type=payroll`,
			`Salary_Sheet_Payroll_${payrollMonth}.xlsx`,
			'Salary sheet Excel downloaded',
			'Failed to export Excel'
		);
		setExportingSheetExcel(false);
		setTimeout(() => setPayrollMessage({ type: '', text: '' }), 5000);
	};

	const exportAllSalaryStructures = async () => {
		setExportingAllStructures(true);
		setPayrollMessage({ type: '', text: '' });
		await downloadFile(
			'/api/employees/salary-structure/export',
			'Salary_Structure_All_Users.xlsx',
			'All-users salary structure Excel downloaded',
			'Failed to export salary structures'
		);
		setExportingAllStructures(false);
		setTimeout(() => setPayrollMessage({ type: '', text: '' }), 5000);
	};

	const showList = () => {
		setMode('list');
		setActionMessage('');
		setActionError('');
	};

	const openEdit = (employee: EmployeeRecord) => {
		form.openEmployee(employee);
		setActionMessage('');
		setActionError('');
		setMode('edit');
	};

	const openView = (employee: EmployeeRecord) => {
		form.openEmployee(employee);
		setActionMessage('');
		setActionError('');
		setMode('view');
	};

	const selectFromEditor = (employee: EmployeeRecord) => {
		form.openEmployee(employee);
		setMode('edit');
	};

	const deleteEmployee = async (employee: EmployeeRecord) => {
		const name =
			`${employee.first_name || ''} ${employee.last_name || ''}`.trim() ||
			'this employee';
		if (
			!window.confirm(
				`Are you sure you want to delete ${name}? This action cannot be undone.`
			)
		)
			return;
		setActionMessage('');
		setActionError('');
		try {
			await directory.deleteEmployee(employee.id);
			setActionMessage('Employee deleted successfully!');
		} catch (deleteError) {
			setActionError(
				(deleteError as Error).message || 'Failed to delete employee'
			);
		}
	};

	const statusBadgeClass = (value: unknown): string => {
		const status = String(value || 'active');
		if (status === 'active') return 'bg-green-100 text-green-800';
		if (status === 'inactive') return 'bg-amber-100 text-amber-800';
		return 'bg-red-100 text-red-800';
	};

	const selected = form.selectedEmployee;
	const editorMode = mode === 'view' ? 'view' : 'edit';

	return (
		<AccessGuard
			resource="employees"
			permission="read"
			fallback={null}
			showNavbar={false}
		>
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<main className="mx-auto max-w-[1920px] px-6 pb-8 pt-24 lg:px-8 xl:px-12">
					<div className="mb-8 flex items-start justify-between gap-4">
						<div>
							<h1 className="mb-2 flex items-center text-3xl font-bold text-gray-900">
								<UserGroupIcon className="mr-3 h-8 w-8 text-purple-600" />
								Payroll Employees
							</h1>
							<p className="text-gray-600">
								Salary Profiles, monthly Payroll Slip generation, and payroll
								exports for Payroll employees. Add employees from the{' '}
								<Link href="/employees" className="text-purple-700 underline">
									employee hub
								</Link>
								.
							</p>
							{actionMessage && (
								<p role="status" className="mt-2 text-sm text-green-600">
									{actionMessage}
								</p>
							)}
							{actionError && (
								<p role="alert" className="mt-2 text-sm text-red-600">
									{actionError}
								</p>
							)}
						</div>
					</div>

					{mode !== 'list' && selected ? (
						<EmployeeEditor
							mode={editorMode}
							form={form}
							employees={directory.filteredAllEmployees}
							sidebarSearch={directory.sidebarSearch}
							onSidebarSearchChange={directory.setSidebarSearch}
							onSelectEmployee={selectFromEditor}
							onBack={showList}
							onEdit={() => setMode('edit')}
							workplaces={directory.workplaces}
							extraSection={{
								key: 'salary',
								label: 'Salary Profile',
								render: () => (
									<SalaryProfileSection
										employee={selected}
										canOverride={canOverrideSalary}
									/>
								),
							}}
						/>
					) : (
						<>
							{/* Monthly payroll actions */}
							<div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
								<div className="flex flex-wrap items-center gap-3">
									<div className="flex items-center gap-2">
										<CalendarDaysIcon className="h-5 w-5 text-gray-500" />
										<input
											aria-label="Payroll month"
											type="month"
											value={payrollMonth}
											onChange={(event) => setPayrollMonth(event.target.value)}
											className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
										/>
									</div>
									<div className="h-8 w-px bg-gray-200" />
									<button
										type="button"
										onClick={() => void generatePayroll()}
										disabled={generatingPayroll}
										className="flex items-center gap-2 rounded-lg bg-[#64126D] px-4 py-2 text-sm font-medium text-white hover:bg-[#86288F] disabled:cursor-not-allowed disabled:opacity-50"
									>
										<ArrowPathIcon
											className={`h-4 w-4 ${generatingPayroll ? 'animate-spin' : ''}`}
										/>
										{generatingPayroll ? 'Generating...' : 'Generate Payroll'}
									</button>
									<button
										type="button"
										onClick={() => void exportSalarySlipPdf()}
										disabled={exportingSlipPdf}
										className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<DocumentTextIcon
											className={`h-4 w-4 ${exportingSlipPdf ? 'animate-pulse' : ''}`}
										/>
										{exportingSlipPdf ? 'Exporting...' : 'Salary Slip (PDF)'}
									</button>
									<button
										type="button"
										onClick={() => void exportSalarySheetExcel()}
										disabled={exportingSheetExcel}
										className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<TableCellsIcon
											className={`h-4 w-4 ${exportingSheetExcel ? 'animate-pulse' : ''}`}
										/>
										{exportingSheetExcel
											? 'Exporting...'
											: 'Salary Sheet (Excel)'}
									</button>
									<button
										type="button"
										onClick={() => void exportAllSalaryStructures()}
										disabled={exportingAllStructures}
										className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<DocumentArrowDownIcon
											className={`h-4 w-4 ${exportingAllStructures ? 'animate-pulse' : ''}`}
										/>
										{exportingAllStructures
											? 'Exporting...'
											: 'Salary Structure (All Users)'}
									</button>
								</div>
								{payrollMessage.text && (
									<p
										role={payrollMessage.type === 'error' ? 'alert' : 'status'}
										className={`mt-3 text-sm ${
											payrollMessage.type === 'error'
												? 'text-red-700'
												: 'text-green-700'
										}`}
									>
										{payrollMessage.text}
									</p>
								)}
							</div>

							{/* Filters */}
							<div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
								<div className="grid grid-cols-1 gap-4 lg:grid-cols-5 md:grid-cols-2">
									<label className="relative lg:col-span-2">
										<span className="sr-only">Search employees</span>
										<MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
										<input
											value={directory.filters.search}
											onChange={(event) =>
												directory.setFilter('search', event.target.value)
											}
											placeholder="Search employees..."
											className="w-full rounded-xl border border-gray-300 py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
										/>
									</label>
									<select
										aria-label="Department filter"
										value={directory.filters.department}
										onChange={(event) =>
											directory.setFilter('department', event.target.value)
										}
										className="rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
									>
										<option value="">All Departments</option>
										{directory.departments.map((department) => (
											<option key={department} value={department}>
												{department}
											</option>
										))}
									</select>
									<select
										aria-label="Status filter"
										value={directory.filters.status}
										onChange={(event) =>
											directory.setFilter('status', event.target.value)
										}
										className="rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
									>
										<option value="">All Status</option>
										<option value="active">Active</option>
										<option value="inactive">Inactive</option>
										<option value="terminated">Terminated</option>
									</select>
									<select
										aria-label="Employment status filter"
										value={directory.filters.employmentStatus}
										onChange={(event) =>
											directory.setFilter(
												'employmentStatus',
												event.target.value
											)
										}
										className="rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
									>
										<option value="">All Employees</option>
										<option value="employed">Employed</option>
										<option value="resigned">Resigned</option>
									</select>
								</div>
								<button
									type="button"
									onClick={() => {
										directory.clearFilters();
										setActionMessage('');
									}}
									className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
								>
									<FunnelIcon className="h-5 w-5" />
									Clear Filters
								</button>
							</div>

							{/* Payroll employee list */}
							<div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
								{directory.loading ? (
									<div className="p-10 text-center text-gray-500">
										Loading employees...
									</div>
								) : directory.error ? (
									<div className="p-10 text-center">
										<p role="alert" className="mb-3 text-red-700">
											{directory.error}
										</p>
										<button
											type="button"
											onClick={() => void directory.refresh()}
											className="rounded-lg bg-[#64126D] px-4 py-2 text-white"
										>
											Retry
										</button>
									</div>
								) : directory.employees.length === 0 ? (
									<div className="p-10 text-center">
										<UserGroupIcon className="mx-auto mb-3 h-12 w-12 text-gray-300" />
										<p className="mb-4 text-gray-500">
											No Payroll employees yet. Add them from the employee hub.
										</p>
										<Link
											href="/employees"
											className="rounded-lg bg-[#64126D] px-4 py-2 font-medium text-white"
										>
											Go to Employee Hub
										</Link>
									</div>
								) : (
									<div className="overflow-x-auto">
										<table className="min-w-full divide-y divide-gray-200">
											<thead className="bg-gray-50">
												<tr>
													{[
														'Employee ID',
														'Employee',
														'Department',
														'Position',
														'Branch',
														'Hire Date',
														'Status',
														'Actions',
													].map((heading) => (
														<th
															key={heading}
															className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600"
														>
															{heading}
														</th>
													))}
												</tr>
											</thead>
											<tbody className="divide-y divide-gray-200 bg-white">
												{directory.employees.map((employee) => (
													<Fragment key={String(employee.id)}>
														<tr
															key={String(employee.id)}
															className="hover:bg-gray-50"
														>
															<td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-[#64126D]">
																{employee.employee_id || '—'}
															</td>
															<td className="whitespace-nowrap px-5 py-4">
																<div className="flex items-center gap-3">
																	<EmployeeAvatar
																		src={employee.profile_photo_url}
																		firstName={employee.first_name}
																		lastName={employee.last_name}
																		size={44}
																	/>
																	<div>
																		<div className="text-sm font-medium text-gray-900">
																			{`${employee.first_name || ''} ${employee.last_name || ''}`.trim()}
																		</div>
																		<div className="text-sm text-gray-500">
																			{employee.email || '—'}
																		</div>
																	</div>
																</div>
															</td>
															<td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
																{String(employee.department || '—')}
															</td>
															<td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
																{String(employee.position || '—')}
															</td>
															<td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
																{String(employee.workplace || '—')}
															</td>
															<td className="whitespace-nowrap px-5 py-4 text-sm text-gray-700">
																{formatDate(
																	employee.hire_date as string | null
																)}
															</td>
															<td className="whitespace-nowrap px-5 py-4">
																<span
																	className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(employee.status)}`}
																>
																	{String(employee.status || 'active')}
																</span>
															</td>
															<td className="whitespace-nowrap px-5 py-4 text-right">
																<div className="flex justify-end gap-1">
																	<button
																		type="button"
																		aria-label={`View salary profile for ${employee.first_name || ''} ${employee.last_name || ''}`}
																		onClick={() =>
																			setExpandedSalaryId((current) =>
																				current === employee.id
																					? null
																					: employee.id
																			)
																		}
																		className={`rounded-lg p-2 ${
																			expandedSalaryId === employee.id
																				? 'bg-[#64126D] text-white'
																				: 'text-green-600 hover:bg-green-50'
																		}`}
																	>
																		<CurrencyRupeeIcon className="h-4 w-4" />
																	</button>
																	<button
																		type="button"
																		aria-label={`View ${employee.first_name || ''} ${employee.last_name || ''}`}
																		onClick={() => openView(employee)}
																		className="rounded-lg p-2 text-purple-600 hover:bg-purple-50"
																	>
																		<EyeIcon className="h-4 w-4" />
																	</button>
																	<button
																		type="button"
																		aria-label={`Edit ${employee.first_name || ''} ${employee.last_name || ''}`}
																		onClick={() => openEdit(employee)}
																		className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
																	>
																		<PencilIcon className="h-4 w-4" />
																	</button>
																	<button
																		type="button"
																		aria-label={`Delete ${employee.first_name || ''} ${employee.last_name || ''}`}
																		onClick={() =>
																			void deleteEmployee(employee)
																		}
																		className="rounded-lg p-2 text-red-600 hover:bg-red-50"
																	>
																		<TrashIcon className="h-4 w-4" />
																	</button>
																</div>
															</td>
														</tr>
														{expandedSalaryId === employee.id && (
															<tr
																key={`${employee.id}-salary`}
																className="bg-purple-50/50"
															>
																<td colSpan={8} className="px-6 py-4">
																	<InlineSalaryPanel
																		employee={employee}
																		profile={inlineQuery.data}
																		loading={
																			inlineQuery.isPending ||
																			inlineQuery.isFetching
																		}
																		error={
																			inlineQuery.error instanceof Error
																				? inlineQuery.error.message
																				: ''
																		}
																		onOpenEditor={openEdit}
																	/>
																</td>
															</tr>
														)}
													</Fragment>
												))}
											</tbody>
										</table>
									</div>
								)}
								{directory.pagination.total &&
									directory.pagination.total > 1 && (
										<div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 text-sm text-gray-600">
											<span>
												Page {directory.page} of {directory.pagination.total}
											</span>
											<div className="flex gap-2">
												<button
													type="button"
													aria-label="Previous page"
													onClick={() =>
														directory.setPage(Math.max(1, directory.page - 1))
													}
													disabled={directory.page === 1}
													className="rounded border border-gray-300 p-2 disabled:opacity-40"
												>
													<ChevronLeftIcon className="h-4 w-4" />
												</button>
												<button
													type="button"
													aria-label="Next page"
													onClick={() =>
														directory.setPage(
															Math.min(
																directory.pagination.total || directory.page,
																directory.page + 1
															)
														)
													}
													disabled={
														directory.page === directory.pagination.total
													}
													className="rounded border border-gray-300 p-2 disabled:opacity-40"
												>
													<ChevronRightIcon className="h-4 w-4" />
												</button>
											</div>
										</div>
									)}
							</div>
						</>
					)}
				</main>
			</div>
		</AccessGuard>
	);
}
