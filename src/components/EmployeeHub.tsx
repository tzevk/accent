'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	CurrencyRupeeIcon,
	EyeIcon,
	FunnelIcon,
	MagnifyingGlassIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import AccessGuard from '@/components/AccessGuard';
import EmployeeAvatar from '@/components/employees/EmployeeAvatar';
import EmployeeEditor from '@/components/employees/EmployeeEditor';
import InlineSalaryPanel from '@/components/employees/InlineSalaryPanel';
import SalaryStructureExportButton from '@/components/employees/SalaryStructureExportButton';
import Navbar from '@/components/Navbar';
import { formatDate } from '@/lib/format';
import { apiGet } from '@/lib/api-client';
import type { SalaryProfileResolution } from '@/lib/salary-profile-directory';
import {
	useEmployeeDirectory,
	type EmployeeRecord,
} from '@/hooks/useEmployeeDirectory';
import { useEmployeeForm } from '@/hooks/useEmployeeForm';
import { useSessionRBAC } from '@/utils/client-rbac';

function employeeName(employee: EmployeeRecord): string {
	return (
		`${employee.first_name || ''} ${employee.last_name || ''}`.trim() ||
		'Unnamed employee'
	);
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
	active: 'bg-blue-100 text-blue-800',
	sent: 'bg-blue-100 text-blue-800',
	pending: 'bg-amber-100 text-amber-800',
	approved: 'bg-green-100 text-green-800',
	paid: 'bg-green-100 text-green-800',
	completed: 'bg-green-100 text-green-800',
	rejected: 'bg-red-100 text-red-800',
	overdue: 'bg-red-100 text-red-800',
	'on hold': 'bg-orange-100 text-orange-800',
	draft: 'bg-slate-100 text-slate-800',
};

function statusBadgeClass(value: unknown): string {
	return (
		STATUS_BADGE_CLASSES[String(value || 'active').toLowerCase()] ||
		'bg-slate-100 text-slate-800'
	);
}

/**
 * Employee Type filter values. This is employee master data only: an
 * agreement's Salary Type, never Employee Type, decides the pay stream.
 */
const EMPLOYEE_TYPES = {
	payroll: 'Payroll',
	contract: 'Contract',
} as const;

const EMPLOYEE_TYPE_VALUES: readonly string[] = Object.values(EMPLOYEE_TYPES);

export default function EmployeeHub() {
	const directory = useEmployeeDirectory();
	const { setFilter, refresh, refreshAll } = directory;
	const {
		can,
		RESOURCES,
		PERMISSIONS,
		loading: rbacLoading,
	} = useSessionRBAC();
	const canPayrollRead =
		!rbacLoading && can(RESOURCES.PAYROLL, PERMISSIONS.READ);
	const [mode, setMode] = useState<'list' | 'add' | 'edit' | 'view'>('list');
	const [actionMessage, setActionMessage] = useState('');
	const [actionError, setActionError] = useState('');
	const [expandedSalaryId, setExpandedSalaryId] = useState<
		number | string | null
	>(null);

	// One row expands at a time. The resolve route enforces payroll:read
	// server-side (no employees fallback), so an employees-only session never
	// fetches or shows a salary figure.
	const inlineQuery = useQuery({
		queryKey: ['salary-profile-resolve', expandedSalaryId],
		queryFn: async () => {
			const data = (await apiGet('/api/payroll/salary-profile/resolve', {
				employee_id: expandedSalaryId,
			})) as { success?: boolean; data?: SalaryProfileResolution };
			return data.data ?? null;
		},
		enabled: expandedSalaryId !== null && canPayrollRead,
		staleTime: 0,
	});

	// Deep links (/employees?type=Payroll) seed the filter once on mount; later
	// filter changes never write the URL.
	useEffect(() => {
		const seeded = new URLSearchParams(window.location.search).get('type');
		const employeeType = EMPLOYEE_TYPE_VALUES.find((type) => type === seeded);
		if (employeeType) setFilter('employeeType', employeeType);
	}, [setFilter]);

	const handleSaved = useCallback(
		async (_employee: EmployeeRecord, created: boolean) => {
			await Promise.all([refresh(), refreshAll()]);
			if (created) {
				setActionMessage('Employee created successfully!');
				setMode('list');
			}
		},
		[refresh, refreshAll]
	);
	const form = useEmployeeForm({ onSaved: handleSaved });

	const showList = () => {
		setMode('list');
		form.startNewEmployee();
	};
	const openAdd = () => {
		form.startNewEmployee();
		setActionMessage('');
		setActionError('');
		setMode('add');
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
		setMode(mode === 'view' ? 'view' : 'edit');
	};
	const deleteEmployee = async (employee: EmployeeRecord) => {
		if (
			!window.confirm(
				`Are you sure you want to delete ${employeeName(employee)}? This action cannot be undone.`
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

	// Pay-flavored controls stay behind payroll:read (ADR-0019): the resolve
	// route enforces the grant server-side with no employees fallback, so the
	// hub never becomes a salary surface for an employees-only reader.
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
								Employees
							</h1>
							<p className="text-gray-600">
								Manage all employees and their common information.
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
						{mode === 'list' && (
							<button
								type="button"
								onClick={openAdd}
								className="inline-flex items-center gap-2 rounded-xl bg-[#64126D] px-4 py-2.5 font-medium text-white hover:bg-[#52105a]"
							>
								<PlusIcon className="h-5 w-5" />
								Add Employee
							</button>
						)}
					</div>

					{mode !== 'list' ? (
						<EmployeeEditor
							mode={mode}
							form={form}
							employees={directory.filteredAllEmployees}
							sidebarSearch={directory.sidebarSearch}
							onSidebarSearchChange={directory.setSidebarSearch}
							onSelectEmployee={selectFromEditor}
							onBack={showList}
							onEdit={() => setMode('edit')}
							workplaces={directory.workplaces}
						/>
					) : (
						<>
							{/* Salary master data actions */}
							{canPayrollRead && <SalaryStructureExportButton />}

							<div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-7">
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
										aria-label="Workplace filter"
										value={directory.filters.workplace}
										onChange={(event) =>
											directory.setFilter('workplace', event.target.value)
										}
										className="rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
									>
										<option value="">All Workplaces</option>
										{directory.workplaces.map((workplace) => (
											<option key={workplace} value={workplace}>
												{workplace}
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
										<option value="">Employment Status</option>
										<option value="employed">Employed</option>
										<option value="resigned">Resigned</option>
									</select>
									<select
										aria-label="Employee Type filter"
										value={directory.filters.employeeType}
										onChange={(event) =>
											setFilter('employeeType', event.target.value)
										}
										className="rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
									>
										<option value="">All Types</option>
										{EMPLOYEE_TYPE_VALUES.map((type) => (
											<option key={type} value={type}>
												{type}
											</option>
										))}
									</select>
									<button
										type="button"
										aria-label="Clear all filters"
										title="Clear all filters"
										onClick={() => {
											directory.clearFilters();
											setActionMessage('');
										}}
										className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-3 text-gray-700 hover:bg-gray-50"
									>
										<FunnelIcon className="h-5 w-5" />
										<span className="truncate">Clear</span>
									</button>
								</div>
							</div>
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
											{directory.filters.employeeType
												? `No ${directory.filters.employeeType} employees yet`
												: 'No employees yet'}
										</p>
										<button
											type="button"
											onClick={openAdd}
											className="rounded-lg bg-[#64126D] px-4 py-2 font-medium text-white"
										>
											Add Employee
										</button>
									</div>
								) : (
									<div className="overflow-x-auto max-xl:[scrollbar-width:thin] xl:overflow-visible">
										<table className="w-full divide-y divide-gray-200 max-xl:min-w-[1024px] xl:table-fixed">
											<colgroup className="hidden xl:table-column-group">
												<col className="w-[124px]" />
												<col />
												<col className="w-[10%]" />
												<col className="w-[104px]" />
												<col className="w-[11%]" />
												<col className="w-[10%]" />
												<col className="w-[104px]" />
												<col className="w-[92px]" />
												<col className="w-[140px]" />
											</colgroup>
											<thead className="bg-gray-50">
												<tr>
													{[
														'Employee ID',
														'Employee',
														'Department',
														'Employee Type',
														'Position',
														'Workplace',
														'Hire Date',
														'Status',
														'Actions',
													].map((heading) => (
														<th
															key={heading}
															className="truncate px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600"
														>
															{heading}
														</th>
													))}
												</tr>
											</thead>
											<tbody className="divide-y divide-gray-200 bg-white">
												{directory.employees.map((employee) => (
													<Fragment key={String(employee.id)}>
														<tr className="hover:bg-gray-50">
															<td
																className="max-w-0 truncate px-3 py-3 font-medium text-[#64126D]"
																title={employee.employee_id || undefined}
															>
																{employee.employee_id || '—'}
															</td>
															<td className="px-3 py-3">
																<div className="flex items-center gap-2.5">
																	<EmployeeAvatar
																		src={employee.profile_photo_url}
																		firstName={employee.first_name}
																		lastName={employee.last_name}
																		size={36}
																	/>
																	<div className="min-w-0">
																		<div
																			className="truncate text-sm font-medium text-gray-900"
																			title={
																				employeeName(employee) || undefined
																			}
																		>
																			{employeeName(employee)}
																		</div>
																		<div
																			className="truncate text-sm text-gray-500"
																			title={employee.email || undefined}
																		>
																			{employee.email || '—'}
																		</div>
																	</div>
																</div>
															</td>
															<td
																className="max-w-0 truncate px-3 py-3 text-sm text-gray-700"
																title={
																	String(employee.department || '') || undefined
																}
															>
																{String(employee.department || '—')}
															</td>
															<td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">
																{String(employee.employee_type || '—')}
															</td>
															<td
																className="max-w-0 truncate px-3 py-3 text-sm text-gray-700"
																title={
																	String(employee.position || '') || undefined
																}
															>
																{String(employee.position || '—')}
															</td>
															<td
																className="max-w-0 truncate px-3 py-3 text-sm text-gray-700"
																title={
																	String(employee.workplace || '') || undefined
																}
															>
																{String(employee.workplace || '—')}
															</td>
															<td className="whitespace-nowrap px-3 py-3 text-sm text-gray-700">
																{formatDate(
																	employee.hire_date as string | null
																)}
															</td>
															<td className="whitespace-nowrap px-3 py-3">
																<span
																	className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(employee.status)}`}
																>
																	{String(employee.status || 'active')}
																</span>
															</td>
															<td className="whitespace-nowrap px-3 py-3 text-right">
																<div className="flex justify-end gap-0.5">
																	{canPayrollRead && (
																		<button
																			type="button"
																			aria-label={`View salary summary for ${employeeName(employee)}`}
																			aria-expanded={
																				expandedSalaryId === employee.id
																			}
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
																	)}
																	<button
																		type="button"
																		aria-label={`View ${employeeName(employee)}`}
																		onClick={() => openView(employee)}
																		className="rounded-lg p-2 text-purple-600 hover:bg-purple-50"
																	>
																		<EyeIcon className="h-4 w-4" />
																	</button>
																	<button
																		type="button"
																		aria-label={`Edit ${employeeName(employee)}`}
																		onClick={() => openEdit(employee)}
																		className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
																	>
																		<PencilIcon className="h-4 w-4" />
																	</button>
																	<button
																		type="button"
																		aria-label={`Delete ${employeeName(employee)}`}
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
															<tr className="bg-purple-50/50">
																<td colSpan={9} className="px-6 py-4">
																	<InlineSalaryPanel
																		employee={employee}
																		resolution={inlineQuery.data}
																		loading={
																			inlineQuery.isPending ||
																			inlineQuery.isFetching
																		}
																		error={
																			inlineQuery.error instanceof Error
																				? inlineQuery.error.message
																				: ''
																		}
																		workspaceHref={`/admin/payroll/salary-profiles/${employee.id}`}
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
