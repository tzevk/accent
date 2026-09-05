import Image from 'next/image';
import type { ChangeEvent, ReactNode } from 'react';
import {
	booleanValue,
	stringValue,
	type EmployeeFormData,
	type EmployeeFormValue,
	type EmployeeSection,
} from '@/utils/employee-form';
import type { EmployeeOption } from '@/hooks/useEmployeeForm';

interface EmployeeFieldsProps {
	section: EmployeeSection;
	formData: EmployeeFormData;
	onChange: (field: string, value: EmployeeFormValue) => void;
	onPhotoChange: (file: File) => void;
	photoUploading: boolean;
	readOnly?: boolean;
	roles: EmployeeOption[];
	users: EmployeeOption[];
	companies: EmployeeOption[];
	workplaces: string[];
}

interface FieldProps {
	field: string;
	label: string;
	formData: EmployeeFormData;
	onChange: EmployeeFieldsProps['onChange'];
	type?: 'text' | 'email' | 'tel' | 'date' | 'number';
	required?: boolean;
	readOnly?: boolean;
}

function Field({
	field,
	label,
	formData,
	onChange,
	type = 'text',
	required = false,
	readOnly = false,
}: FieldProps) {
	return (
		<label className="block text-sm font-medium text-gray-700">
			{label} {required && <span className="text-red-500">*</span>}
			<input
				id={`employee-${field}`}
				name={field}
				type={type}
				value={stringValue(formData[field])}
				onChange={(event) => onChange(field, event.target.value)}
				required={required}
				readOnly={readOnly}
				className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 read-only:bg-gray-50"
			/>
		</label>
	);
}

interface SelectProps {
	field: string;
	label: string;
	formData: EmployeeFormData;
	onChange: EmployeeFieldsProps['onChange'];
	options: Array<{ value: string; label: string }>;
	readOnly?: boolean;
}

function SelectField({
	field,
	label,
	formData,
	onChange,
	options,
	readOnly = false,
}: SelectProps) {
	return (
		<label className="block text-sm font-medium text-gray-700">
			{label}
			<select
				id={`employee-${field}`}
				name={field}
				value={stringValue(formData[field])}
				onChange={(event) => onChange(field, event.target.value)}
				disabled={readOnly}
				className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
			>
				{options.map((option) => (
					<option key={`${field}-${option.value}`} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

function SectionTitle({ children }: { children: string }) {
	return (
		<h3 className="mb-4 text-lg font-semibold text-gray-900">{children}</h3>
	);
}

function Grid({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-5 md:grid-cols-2">{children}</div>
	);
}

export default function EmployeeFields({
	section,
	formData,
	onChange,
	onPhotoChange,
	photoUploading,
	readOnly = false,
	roles,
	users,
	companies,
	workplaces,
}: EmployeeFieldsProps) {
	const selectedRoleId = stringValue(formData.system_role_id);
	const selectedRoleName =
		stringValue(formData.system_role_name) || stringValue(formData.role);
	const roleOptions = [
		{ value: '', label: 'Select a role' },
		...(selectedRoleId &&
		!roles.some((role) => String(role.id) === selectedRoleId)
			? [{ value: selectedRoleId, label: selectedRoleName || selectedRoleId }]
			: []),
		...roles.map((role) => ({
			value: String(role.id),
			label: String(role.role_name || role.name || role.id),
		})),
	];
	const selectedCompany = stringValue(formData.company_name);
	const companyOptions = [
		{
			value: 'Accent Techno Solutions Pvt Ltd',
			label: 'Accent Techno Solutions Pvt Ltd',
		},
		...(selectedCompany &&
		selectedCompany !== 'Accent Techno Solutions Pvt Ltd' &&
		!companies.some(
			(company) =>
				String(company.company_name || company.id) === selectedCompany
		)
			? [{ value: selectedCompany, label: selectedCompany }]
			: []),
		...companies
			.filter(
				(company) => company.company_name !== 'Accent Techno Solutions Pvt Ltd'
			)
			.map((company) => ({
				value: String(company.company_name || company.id),
				label: String(company.company_name || company.id),
			})),
	];
	const workplaceOptions = [
		{ value: '', label: 'Select Branch' },
		...Array.from(new Set([stringValue(formData.workplace), ...workplaces]))
			.filter(Boolean)
			.map((workplace) => ({ value: workplace, label: workplace })),
	];

	if (section === 'personal') {
		return (
			<div>
				<SectionTitle>Personal Information</SectionTitle>
				<div className="mb-5 flex flex-wrap items-center gap-4">
					<div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-purple-100 text-2xl font-semibold text-purple-700">
						{stringValue(formData.profile_photo_url) ? (
							<Image
								src={stringValue(formData.profile_photo_url)}
								alt="Employee profile"
								width={80}
								height={80}
								className="h-full w-full object-cover"
								unoptimized
							/>
						) : (
							`${stringValue(formData.first_name).charAt(0)}${stringValue(formData.last_name).charAt(0)}`.toUpperCase()
						)}
					</div>
					<label className="text-sm font-medium text-gray-700">
						Profile Photo
						<input
							type="file"
							accept="image/*,.heic,.heif,.bmp"
							disabled={readOnly || photoUploading}
							onChange={(event: ChangeEvent<HTMLInputElement>) => {
								const file = event.target.files?.[0];
								if (file) onPhotoChange(file);
							}}
							className="mt-2 block text-sm text-gray-600"
						/>
						{photoUploading && (
							<span className="mt-1 block text-xs text-purple-600">
								Uploading...
							</span>
						)}
					</label>
				</div>
				<Grid>
					<Field
						field="first_name"
						label="First Name"
						formData={formData}
						onChange={onChange}
						required
						readOnly={readOnly}
					/>
					<Field
						field="middle_name"
						label="Middle Name"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="last_name"
						label="Last Name"
						formData={formData}
						onChange={onChange}
						required
						readOnly={readOnly}
					/>
					<Field
						field="employee_id"
						label="Employee ID"
						formData={formData}
						onChange={onChange}
						required
						readOnly={readOnly}
					/>
					<SelectField
						field="employee_type"
						label="Employee Type"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
						options={[
							{ value: '', label: 'Select' },
							{ value: 'Payroll', label: 'Payroll' },
							{ value: 'Contract', label: 'Contract' },
							{ value: 'Deputation', label: 'Deputation' },
						]}
					/>
					{stringValue(formData.employee_type) === 'Deputation' && (
						<SelectField
							field="deputation_company_id"
							label="Deputation Company"
							formData={formData}
							onChange={onChange}
							readOnly={readOnly}
							options={[
								{ value: '', label: 'Select Company' },
								...companies.map((company) => ({
									value: String(company.id),
									label: String(company.company_name || company.id),
								})),
							]}
						/>
					)}
					<SelectField
						field="system_role_id"
						label="System Role"
						formData={formData}
						onChange={(field, value) => {
							onChange(field, value);
							const picked = roles.find(
								(role) => String(role.id) === String(value)
							);
							onChange('role', String(picked?.role_name || picked?.name || ''));
							onChange(
								'system_role_name',
								String(picked?.role_name || picked?.name || '')
							);
						}}
						options={roleOptions}
						readOnly={readOnly}
					/>
					<SelectField
						field="username"
						label="Username (from User Master)"
						formData={formData}
						onChange={(field, value) => {
							onChange(field, value);
							const user = users.find((item) => item.username === value);
							onChange('user_id', user?.id ?? null);
						}}
						readOnly={readOnly}
						options={[
							{ value: '', label: 'Select user' },
							...users
								.filter(
									(user) =>
										!user.employee_id || user.employee_id === formData.id
								)
								.map((user) => ({
									value: String(user.username || ''),
									label: `${String(user.username || '')}${user.full_name ? ` (${String(user.full_name)})` : ''}`,
								})),
						]}
					/>
					<SelectField
						field="company_name"
						label="Company"
						formData={formData}
						onChange={onChange}
						options={companyOptions}
						readOnly={readOnly}
					/>
					<SelectField
						field="gender"
						label="Gender"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
						options={[
							{ value: '', label: 'Select' },
							{ value: 'Male', label: 'Male' },
							{ value: 'Female', label: 'Female' },
							{ value: 'Other', label: 'Other' },
						]}
					/>
					<Field
						field="dob"
						label="Date of Birth"
						type="date"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<SelectField
						field="marital_status"
						label="Marital Status"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
						options={[
							{ value: '', label: 'Select' },
							{ value: 'Single', label: 'Single' },
							{ value: 'Married', label: 'Married' },
							{ value: 'Divorced', label: 'Divorced' },
							{ value: 'Widowed', label: 'Widowed' },
						]}
					/>
					<Field
						field="nationality"
						label="Nationality"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<SelectField
						field="status"
						label="Status"
						formData={formData}
						onChange={(field, value) => {
							onChange(field, value);
							onChange('employment_status', value);
						}}
						readOnly={readOnly}
						options={[
							{ value: 'active', label: 'Active' },
							{ value: 'inactive', label: 'Inactive' },
							{ value: 'terminated', label: 'Terminated' },
						]}
					/>
				</Grid>
			</div>
		);
	}

	if (section === 'contact') {
		return (
			<div>
				<SectionTitle>Contact Information</SectionTitle>
				<Grid>
					<Field
						field="email"
						label="Email"
						type="email"
						formData={formData}
						onChange={onChange}
						required
						readOnly={readOnly}
					/>
					<Field
						field="personal_email"
						label="Personal Email"
						type="email"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="phone"
						label="Phone"
						type="tel"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="mobile"
						label="Mobile"
						type="tel"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="emergency_contact_name"
						label="Emergency Contact Name"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="emergency_contact_phone"
						label="Emergency Contact Phone"
						type="tel"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<label className="text-sm font-medium text-gray-700 md:col-span-2">
						Present Address
						<textarea
							id="employee-present_address"
							value={stringValue(formData.present_address || formData.address)}
							onChange={(event) => {
								onChange('present_address', event.target.value);
								onChange('address', event.target.value);
							}}
							readOnly={readOnly}
							rows={3}
							className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 read-only:bg-gray-50"
						/>
					</label>
					<Field
						field="address_2"
						label="Address Line 2"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="city"
						label="City"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="state"
						label="State"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="country"
						label="Country"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="pin"
						label="PIN"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
				</Grid>
			</div>
		);
	}

	if (section === 'work') {
		return (
			<div>
				<SectionTitle>Work Details</SectionTitle>
				<Grid>
					<Field
						field="department"
						label="Department"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="position"
						label="Position"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="designation"
						label="Designation"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="grade"
						label="Grade"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="level"
						label="Level"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<SelectField
						field="workplace"
						label="Workplace"
						formData={formData}
						onChange={onChange}
						options={workplaceOptions}
						readOnly={readOnly}
					/>
					<Field
						field="manager"
						label="Manager"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="reporting_to"
						label="Reporting To"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="hire_date"
						label="Hire Date"
						type="date"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="joining_date"
						label="Joining Date"
						type="date"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="smartoffice_code"
						label="SmartOffice Code"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
				</Grid>
				<div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">
					{[
						['bonus_eligible', 'Bonus Eligible'],
						['stat_pf', 'PF'],
						['stat_mlwf', 'MLWF'],
						['stat_pt', 'Professional Tax'],
						['stat_esic', 'ESIC'],
						['stat_tds', 'TDS'],
					].map(([field, label]) => (
						<label
							key={field}
							className="flex items-center gap-2 text-sm text-gray-700"
						>
							<input
								type="checkbox"
								checked={booleanValue(formData[field])}
								disabled={readOnly}
								onChange={(event) => onChange(field, event.target.checked)}
							/>
							{label}
						</label>
					))}
				</div>
			</div>
		);
	}

	if (section === 'academic') {
		return (
			<div>
				<SectionTitle>Academic & Experience</SectionTitle>
				<Grid>
					<Field
						field="qualification"
						label="Qualification"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="institute"
						label="Institute"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="passing_year"
						label="Passing Year"
						type="number"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="work_experience"
						label="Work Experience"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
				</Grid>
				<label className="mt-5 block text-sm font-medium text-gray-700">
					Notes
					<textarea
						id="employee-notes"
						value={stringValue(formData.notes)}
						onChange={(event) => onChange('notes', event.target.value)}
						readOnly={readOnly}
						rows={4}
						className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 read-only:bg-gray-50"
					/>
				</label>
			</div>
		);
	}

	if (section === 'govt') {
		return (
			<div>
				<SectionTitle>Government IDs</SectionTitle>
				<Grid>
					<Field
						field="pan"
						label="PAN"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="aadhar"
						label="Aadhaar"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="gratuity_no"
						label="Gratuity Number"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="uan"
						label="UAN"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="esi_no"
						label="ESI Number"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="pf_no"
						label="PF Number"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
				</Grid>
			</div>
		);
	}

	if (section === 'bank') {
		return (
			<div>
				<SectionTitle>Bank Details</SectionTitle>
				<Grid>
					<Field
						field="bank_name"
						label="Bank Name"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="bank_branch"
						label="Bank Branch"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="account_holder_name"
						label="Account Holder Name"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="bank_account_no"
						label="Bank Account Number"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
					<Field
						field="bank_ifsc"
						label="IFSC"
						formData={formData}
						onChange={onChange}
						readOnly={readOnly}
					/>
				</Grid>
			</div>
		);
	}

	return (
		<div>
			<SectionTitle>Attendance & Exit</SectionTitle>
			<Grid>
				<Field
					field="biometric_code"
					label="Biometric Code"
					formData={formData}
					onChange={onChange}
					readOnly={readOnly}
				/>
				<Field
					field="device_code"
					label="Device Code"
					formData={formData}
					onChange={onChange}
					readOnly={readOnly}
				/>
				<Field
					field="attendance_id"
					label="Attendance ID"
					formData={formData}
					onChange={onChange}
					readOnly={readOnly}
				/>
				<Field
					field="exit_date"
					label="Exit Date"
					type="date"
					formData={formData}
					onChange={onChange}
					readOnly={readOnly}
				/>
			</Grid>
			<label className="mt-5 block text-sm font-medium text-gray-700">
				Exit Reason
				<textarea
					id="employee-exit_reason"
					value={stringValue(formData.exit_reason)}
					onChange={(event) => onChange('exit_reason', event.target.value)}
					readOnly={readOnly}
					rows={3}
					className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 read-only:bg-gray-50"
				/>
			</label>
		</div>
	);
}
