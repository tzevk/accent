export type EmployeeFormValue = string | number | boolean | null;

export interface EmployeeFormData {
	[key: string]: EmployeeFormValue | undefined;
	first_name: string;
	last_name: string;
	employee_id: string;
	email: string;
}

export const EMPLOYEE_SECTIONS = [
	{ key: 'personal', label: 'Personal Information' },
	{ key: 'contact', label: 'Contact Information' },
	{ key: 'work', label: 'Work Details' },
	{ key: 'academic', label: 'Academic & Experience' },
	{ key: 'govt', label: 'Government IDs' },
	{ key: 'bank', label: 'Bank Details' },
	{ key: 'attendance', label: 'Attendance & Exit' },
] as const;

export type EmployeeSection = (typeof EMPLOYEE_SECTIONS)[number]['key'];

export const DEFAULT_EMPLOYEE_FORM_DATA: EmployeeFormData = {
	first_name: '',
	middle_name: '',
	last_name: '',
	employee_id: '',
	email: '',
	personal_email: '',
	phone: '',
	mobile: '',
	emergency_contact_name: '',
	emergency_contact_phone: '',
	gender: '',
	dob: '',
	marital_status: '',
	nationality: '',
	present_address: '',
	address: '',
	address_2: '',
	city: '',
	state: '',
	country: '',
	pin: '',
	department: '',
	position: '',
	designation: '',
	role: '',
	employee_type: '',
	grade: '',
	level: '',
	workplace: '',
	status: 'active',
	employment_status: 'active',
	manager_id: '',
	manager: '',
	reporting_to: '',
	hire_date: '',
	joining_date: '',
	exit_date: '',
	exit_reason: '',
	deputation_company_id: '',
	company_name: 'Accent Techno Solutions Pvt Ltd',
	profile_photo_url: '',
	username: '',
	user_id: null,
	system_role_id: '',
	system_role_name: '',
	qualification: '',
	institute: '',
	passing_year: '',
	work_experience: '',
	notes: '',
	bank_name: '',
	bank_branch: '',
	account_holder_name: '',
	bank_account_no: '',
	bank_ifsc: '',
	pan: '',
	aadhar: '',
	gratuity_no: '',
	uan: '',
	esi_no: '',
	pf_no: '',
	biometric_code: '',
	device_code: '',
	attendance_id: '',
	smartoffice_code: '',
	bonus_eligible: false,
	stat_pf: false,
	stat_mlwf: false,
	stat_pt: false,
	stat_esic: false,
	stat_tds: false,
};

export function createEmployeeFormData(
	employee?: Record<string, unknown> | null,
	employeeType?: string | null
): EmployeeFormData {
	const source = employee || {};
	return {
		...DEFAULT_EMPLOYEE_FORM_DATA,
		...source,
		...(employeeType && !employee ? { employee_type: employeeType } : {}),
		hire_date: toDateInput(source.hire_date),
		joining_date: toDateInput(source.joining_date),
		dob: toDateInput(source.dob),
		exit_date: toDateInput(source.exit_date),
	};
}

export function toDateInput(value: unknown): string {
	return value ? String(value).split('T')[0] : '';
}

export function stringValue(value: unknown): string {
	return value == null ? '' : String(value);
}

export function booleanValue(value: unknown): boolean {
	return value === true || value === 1 || value === '1' || value === 'true';
}

export function validateEmployeeForm(
	formData: EmployeeFormData
): string | null {
	const requiredFields: Record<string, string> = {
		employee_id: 'Employee ID',
		first_name: 'First Name',
		last_name: 'Last Name',
		email: 'Email',
	};
	const missing = Object.entries(requiredFields)
		.filter(([field]) => !stringValue(formData[field]).trim())
		.map(([, label]) => label);
	if (missing.length > 0) {
		return `Please fill in required fields: ${missing.join(', ')}`;
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue(formData.email))) {
		return 'Please enter a valid email address';
	}
	return null;
}
