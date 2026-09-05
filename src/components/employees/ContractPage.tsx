'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	EyeIcon,
	FunnelIcon,
	MagnifyingGlassIcon,
	PencilIcon,
	TrashIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import ContractPaySection from '@/components/employees/ContractPaySection';
import EmployeeEditor from '@/components/employees/EmployeeEditor';
import AccessGuard from '@/components/AccessGuard';
import Navbar from '@/components/Navbar';
import EmployeeAvatar from '@/components/employees/EmployeeAvatar';
import {
	useEmployeeDirectory,
	type EmployeeRecord,
} from '@/hooks/useEmployeeDirectory';
import { useEmployeeForm } from '@/hooks/useEmployeeForm';
import { formatDate } from '@/lib/format';

/**
 * Route-owned Contract employee page: the Contract list with its own
 * search, filters, and pagination, plus the contract pay workflow injected
 * into the shared employee editor.
 */
export default function ContractPage() {
	const directory = useEmployeeDirectory('Contract');
	const [mode, setMode] = useState<'list' | 'edit' | 'view'>('list');
	const [actionMessage, setActionMessage] = useState('');
	const [actionError, setActionError] = useState('');

	const form = useEmployeeForm({
		employeeType: 'Contract',
		onSaved: async () => {
			await Promise.all([directory.refresh(), directory.refreshAll()]);
			setMode('list');
			setActionMessage('Employee updated successfully!');
		},
	});

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
		if (status === 'active') return 'bg-blue-100 text-blue-800';
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
								Contract Employees
							</h1>
							<p className="text-gray-600">
								Contract amount, duration, and TDS information for Contract
								employees. Add employees from the{' '}
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
								key: 'contract',
								label: 'Contract Pay',
								render: () => <ContractPaySection employee={selected} />,
							}}
						/>
					) : (
						<>
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

							{/* Contract employee list */}
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
											No Contract employees yet. Add them from the employee hub.
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
