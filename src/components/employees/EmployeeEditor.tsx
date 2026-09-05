'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { EmployeeRecord } from '@/hooks/useEmployeeDirectory';
import type { EmployeeFormBoundary } from '@/hooks/useEmployeeForm';
import EmployeeAvatar from '@/components/employees/EmployeeAvatar';
import EmployeeFields from '@/components/employees/EmployeeFields';
import { EMPLOYEE_SECTIONS, type EmployeeSection } from '@/utils/employee-form';

interface EmployeeEditorProps {
	mode: 'add' | 'edit' | 'view';
	form: EmployeeFormBoundary;
	employees: EmployeeRecord[];
	sidebarSearch: string;
	onSidebarSearchChange: (value: string) => void;
	onSelectEmployee: (employee: EmployeeRecord) => void;
	onBack: () => void;
	onEdit: () => void;
	workplaces: string[];
	/**
	 * Optional route-owned section (e.g. the Salary Profile on the Payroll
	 * page). Rendered after Work Details; unmounts when another section is
	 * active so its state stays scoped to the owning route.
	 */
	extraSection?: {
		key: string;
		label: string;
		render: () => ReactNode;
	};
}

function AttendancePanel({ form }: { form: EmployeeFormBoundary }) {
	const summary = form.attendance.summary[0];
	return (
		<div>
			<div className="mb-5 flex flex-wrap items-end justify-between gap-3">
				<div>
					<h3 className="text-lg font-semibold text-gray-900">
						Attendance Summary
					</h3>
					<p className="text-sm text-gray-500">
						Review monthly attendance for this employee.
					</p>
				</div>
				<label className="text-sm font-medium text-gray-700">
					Month
					<input
						type="month"
						value={form.attendanceSummaryMonth}
						onChange={(event) =>
							form.setAttendanceSummaryMonth(event.target.value)
						}
						className="ml-2 rounded-lg border border-gray-300 px-3 py-2"
					/>
				</label>
			</div>
			{form.attendance.loading ? (
				<div className="py-8 text-center text-sm text-gray-500">
					Loading attendance...
				</div>
			) : summary ? (
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
						{[
							['Present', summary.total_present || 0],
							['Absent', summary.total_absent || 0],
							['Weekly Off', summary.total_weekly_off || 0],
							['Holiday', summary.total_holiday || 0],
							['Overtime (hrs)', summary.total_overtime_hours || 0],
						].map(([label, value]) => (
							<div
								key={String(label)}
								className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-center"
							>
								<div className="text-xl font-bold text-purple-700">
									{String(value)}
								</div>
								<div className="text-xs text-gray-600">{String(label)}</div>
							</div>
						))}
					</div>
					{form.attendance.dayDetails.length > 0 && (
						<div>
							<h4 className="mb-2 text-sm font-semibold text-gray-700">
								Day-wise Details
							</h4>
							<div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200">
								<table className="w-full text-sm">
									<thead className="sticky top-0 bg-gray-50">
										<tr>
											{[
												'Date',
												'Status',
												'In Time',
												'Out Time',
												'OT (hrs)',
											].map((label) => (
												<th
													key={label}
													className="px-3 py-2 text-left text-xs font-medium text-gray-500"
												>
													{label}
												</th>
											))}
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-100">
										{form.attendance.dayDetails.map((day, index) => (
											<tr key={String(day.attendance_date || index)}>
												<td className="px-3 py-1.5 text-gray-700">
													{String(day.attendance_date || '—')}
												</td>
												<td className="px-3 py-1.5 text-gray-600">
													{String(day.status || '—')}
												</td>
												<td className="px-3 py-1.5 text-gray-600">
													{String(day.in_time || '—')}
												</td>
												<td className="px-3 py-1.5 text-gray-600">
													{String(day.out_time || '—')}
												</td>
												<td className="px-3 py-1.5 text-gray-600">
													{String(day.overtime_hours || '—')}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</div>
			) : (
				<div className="rounded-xl border border-gray-200 bg-gray-50 py-8 text-center text-sm text-gray-500">
					No attendance data for this month
				</div>
			)}
		</div>
	);
}

function SectionNavigation({
	sections,
	activeSection,
	onSelect,
}: {
	sections: { key: string; label: string }[];
	activeSection: string;
	onSelect: (section: string) => void;
}) {
	return (
		<nav
			className="flex flex-wrap gap-2 border-b border-gray-200"
			aria-label="Employee Sections"
		>
			{sections.map((section) => (
				<button
					key={section.key}
					type="button"
					onClick={() => onSelect(section.key)}
					className={`border-b-2 px-3 py-2 text-sm font-medium ${
						activeSection === section.key
							? 'border-purple-600 text-purple-700'
							: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
					}`}
				>
					{section.label}
				</button>
			))}
		</nav>
	);
}

function EmployeeSidebar({
	employees,
	selectedEmployee,
	search,
	onSearchChange,
	onSelect,
}: {
	employees: EmployeeRecord[];
	selectedEmployee: EmployeeRecord | null;
	search: string;
	onSearchChange: (value: string) => void;
	onSelect: (employee: EmployeeRecord) => void;
}) {
	return (
		<aside className="rounded-xl border border-gray-200 bg-white shadow-sm lg:col-span-3">
			<div className="border-b border-gray-200 p-4">
				<h2 className="font-semibold text-gray-900">Employees</h2>
				<p className="text-xs text-gray-500">{employees.length} available</p>
				<input
					aria-label="Search employees"
					value={search}
					onChange={(event) => onSearchChange(event.target.value)}
					placeholder="Search employees"
					className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
				/>
			</div>
			<div className="max-h-[calc(100vh-340px)] overflow-y-auto">
				{employees.map((employee) => {
					const name =
						`${employee.first_name || ''} ${employee.last_name || ''}`.trim();
					return (
						<button
							key={String(employee.id)}
							type="button"
							onClick={() => onSelect(employee)}
							aria-label={`Select ${name}`}
							className={`flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${selectedEmployee?.id === employee.id ? 'bg-purple-50' : ''}`}
						>
							<EmployeeAvatar
								src={employee.profile_photo_url}
								firstName={employee.first_name}
								lastName={employee.last_name}
								size={42}
							/>
							<span className="min-w-0">
								<span className="block truncate text-sm font-medium text-gray-900">
									{name}
								</span>
								<span className="block truncate text-xs text-gray-500">
									{employee.employee_id || employee.email}
								</span>
							</span>
						</button>
					);
				})}
				{employees.length === 0 && (
					<div className="p-5 text-center text-sm text-gray-500">
						No employees found
					</div>
				)}
			</div>
		</aside>
	);
}

export default function EmployeeEditor({
	mode,
	form,
	employees,
	sidebarSearch,
	onSidebarSearchChange,
	onSelectEmployee,
	onBack,
	onEdit,
	workplaces,
	extraSection,
}: EmployeeEditorProps) {
	const readOnly = mode === 'view' || form.profileLocked;
	const title =
		mode === 'add'
			? 'Add Employee'
			: mode === 'view'
				? 'Employee Details'
				: 'Edit Employee';
	const name = `${form.formData.first_name} ${form.formData.last_name}`.trim();
	const { activeSection, attendanceSummaryMonth, loadAttendance } = form;
	const [extraActive, setExtraActive] = useState(false);
	const extraUsable = Boolean(extraSection) && mode === 'edit';

	useEffect(() => {
		if (mode !== 'add' && activeSection === 'attendance') void loadAttendance();
	}, [activeSection, attendanceSummaryMonth, loadAttendance, mode]);

	const [lastEmployeeId, setLastEmployeeId] = useState<string | number | null>(
		form.selectedEmployee?.id ?? null
	);
	if (lastEmployeeId !== (form.selectedEmployee?.id ?? null)) {
		// Adjusting during render: a newly selected employee restarts on the
		// first section instead of the previous employee's route-owned tab.
		setLastEmployeeId(form.selectedEmployee?.id ?? null);
		setExtraActive(false);
	}

	const sections = useMemo(() => {
		const list: { key: string; label: string }[] = EMPLOYEE_SECTIONS.map(
			(section) => ({ ...section })
		);
		if (extraUsable && extraSection) {
			list.splice(3, 0, {
				key: extraSection.key,
				label: extraSection.label,
			});
		}
		return list;
	}, [extraSection, extraUsable]);

	const activeKey =
		extraActive && extraSection ? extraSection.key : activeSection;

	const selectSection = async (section: string) => {
		if (extraUsable && extraSection && section === extraSection.key) {
			if (mode === 'edit' && form.activeSection !== 'attendance')
				await form.autoSaveEmployee();
			setExtraActive(true);
			return;
		}
		setExtraActive(false);
		// Leaving the route-owned section does not autosave employee fields;
		// switching between employee sections keeps the existing autosave.
		if (mode === 'edit' && !extraActive && form.activeSection !== 'attendance')
			await form.autoSaveEmployee();
		form.setActiveSection(section as EmployeeSection);
	};

	const moveSection = async (direction: -1 | 1) => {
		const keys = sections.map((section) => section.key);
		const currentIndex = keys.indexOf(activeKey);
		const next = keys[currentIndex + direction];
		if (next) await selectSection(next);
	};

	return (
		<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
			<EmployeeSidebar
				employees={employees}
				selectedEmployee={form.selectedEmployee}
				search={sidebarSearch}
				onSearchChange={onSidebarSearchChange}
				onSelect={onSelectEmployee}
			/>
			<section className="rounded-xl border border-gray-200 bg-white shadow-sm lg:col-span-9">
				<div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-gray-50 px-6 py-5">
					<div className="flex items-center gap-4">
						{mode !== 'add' && (
							<EmployeeAvatar
								src={String(form.formData.profile_photo_url || '')}
								firstName={form.formData.first_name}
								lastName={form.formData.last_name}
								size={54}
							/>
						)}
						<div>
							<h2 className="text-2xl font-semibold text-gray-900">
								{mode === 'add' ? title : name}
							</h2>
							{mode !== 'add' && (
								<p className="text-sm text-gray-500">
									{form.formData.employee_id}
								</p>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						{mode === 'edit' && (
							<button
								type="button"
								onClick={() => form.setProfileLocked(!form.profileLocked)}
								className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-white"
							>
								{form.profileLocked ? 'Unlock' : 'Lock'}
							</button>
						)}
						{mode === 'view' && (
							<button
								type="button"
								onClick={onEdit}
								className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white"
							>
								Edit
							</button>
						)}
						<button
							type="button"
							onClick={onBack}
							className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
						>
							Back to Employees
						</button>
					</div>
				</div>
				<div className="p-6 lg:p-8">
					<SectionNavigation
						sections={sections}
						activeSection={activeKey}
						onSelect={(section) => void selectSection(section)}
					/>
					{form.successMessage && (
						<div
							role="status"
							className="mt-5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
						>
							{form.successMessage}
						</div>
					)}
					{form.formError && (
						<div
							role="alert"
							className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
						>
							{form.formError}
						</div>
					)}
					{mode === 'edit' && (form.autoSaving || form.lastAutoSave) && (
						<div className="mt-3 text-xs text-gray-500">
							{form.autoSaving ? 'Saving changes...' : 'Changes saved'}
						</div>
					)}
					<form
						onSubmit={(event) => void form.saveEmployee(event)}
						className="mt-6 space-y-6"
					>
						<fieldset
							disabled={readOnly}
							className={readOnly ? 'opacity-70' : ''}
						>
							{extraActive && extraSection ? (
								extraSection.render()
							) : form.activeSection === 'attendance' && mode !== 'add' ? (
								<AttendancePanel form={form} />
							) : (
								<EmployeeFields
									section={form.activeSection}
									formData={form.formData}
									onChange={form.updateField}
									onPhotoChange={(file) => void form.uploadPhoto(file)}
									photoUploading={form.photoUploading}
									readOnly={readOnly}
									roles={form.roles}
									users={form.users}
									companies={form.companies}
									workplaces={workplaces}
								/>
							)}
						</fieldset>
						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-5">
							<button
								type="button"
								onClick={() => void moveSection(-1)}
								disabled={activeKey === sections[0].key}
								className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-40"
							>
								Previous
							</button>
							<div className="flex gap-3">
								<button
									type="button"
									onClick={onBack}
									className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
								>
									Cancel
								</button>
								{mode !== 'view' && (
									<button
										type="submit"
										disabled={form.saving || form.profileLocked}
										className="rounded-lg bg-[#64126D] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
									>
										{form.saving ? 'Saving...' : 'Save Employee'}
									</button>
								)}
								<button
									type="button"
									onClick={() => void moveSection(1)}
									disabled={activeKey === sections[sections.length - 1].key}
									className="rounded-lg bg-[#64126D] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
								>
									Next
								</button>
							</div>
						</div>
					</form>
				</div>
			</section>
		</div>
	);
}
