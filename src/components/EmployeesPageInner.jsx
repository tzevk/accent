/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import PAYROLL_CONFIG from '@/utils/payroll-config';
import { usePayrollPreview } from '@/hooks/usePayrollPreview';
import {
	getSalaryProfileOverrides,
	hasSalaryOverrides,
} from '@/utils/payroll-calculation';
import MonthlySalaryPreview from '@/components/MonthlySalaryPreview';
import { useSessionRBAC } from '@/utils/client-rbac';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import {
	UserGroupIcon,
	PlusIcon,
	MagnifyingGlassIcon,
	FunnelIcon,
	PencilIcon,
	TrashIcon,
	EyeIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CalendarDaysIcon,
	CurrencyRupeeIcon,
	ChevronDownIcon,
	DocumentArrowDownIcon,
	ArrowPathIcon,
	DocumentTextIcon,
	TableCellsIcon,
} from '@heroicons/react/24/outline';

const Avatar = ({ src, firstName, lastName, size = 40 }) => {
	const initials =
		`${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();

	if (src) {
		return (
			<div className="relative" style={{ width: size, height: size }}>
				<Image
					src={src}
					alt={`${firstName} ${lastName}`}
					fill
					className="rounded-full object-cover"
					unoptimized
				/>
			</div>
		);
	}

	return (
		<div
			className="rounded-full bg-gradient-to-r from-purple-500 to-purple-600 flex items-center justify-center text-white font-medium"
			style={{ width: size, height: size, fontSize: size * 0.4 }}
		>
			{initials}
		</div>
	);
};

// Currency formatter with 2 decimal places for Indian Rupee
const formatCurrency = (value) => {
	const num = parseFloat(value) || 0;
	return num.toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
};

// Normalize legacy salary rows where basic_plus_da sometimes contained Basic
// instead of the combined Basic + DA amount.
const normalizeSalaryBreakdown = (profile) => {
	const storedBasic = parseFloat(profile?.basic);
	const da = parseFloat(profile?.da) || 0;
	const storedBasicPlusDa = parseFloat(profile?.basic_plus_da);
	const basic = Number.isFinite(storedBasic)
		? storedBasic
		: Math.max(
				0,
				(Number.isFinite(storedBasicPlusDa) ? storedBasicPlusDa : 0) - da
			);
	const basicPlusDa =
		Number.isFinite(storedBasicPlusDa) && storedBasicPlusDa > basic
			? storedBasicPlusDa
			: basic + da;

	return { basic, da, basicPlusDa };
};

export default function EmployeesPageInner({ employeeType = null }) {
	const defaultSalaryType = employeeType === 'Payroll' ? 'monthly' : 'custom';
	const { user, can, RESOURCES, PERMISSIONS } = useSessionRBAC();
	const canOverrideSalary = Boolean(
		user?.is_super_admin ||
		can(RESOURCES.PAYROLL, PERMISSIONS.UPDATE) ||
		can(RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE)
	);

	// Safe profile photo change handler: forwards to canonical handler if present,
	// otherwise shows a friendly error and avoids runtime ReferenceError while
	// the file is mid-refactor.
	const handleProfilePhotoChange_safe = async (e) => {
		if (typeof handleProfilePhotoChange === 'function') {
			try {
				await handleProfilePhotoChange(e);
			} catch (err) {
				console.error('handleProfilePhotoChange invocation failed', err);
			}
			return;
		}
		try {
			if (e && typeof e.preventDefault === 'function') e.preventDefault();
		} catch {}
		setFormErrors((prev) => ({
			...prev,
			general:
				'Photo upload temporarily unavailable while the editor is updating. Please try again.',
		}));
		console.error('handleProfilePhotoChange is not available yet');
	};
	const defaultFormData = {
		// Personal details
		first_name: '',
		last_name: '',
		email: '',
		phone: '',
		emergency_contact_name: '',
		emergency_contact_phone: '',
		gender: '',
		date_of_birth: '',
		marital_status: '',
		nationality: '',

		// Address
		address: '',
		address_2: '',
		city: '',
		state: '',
		country: '',
		pin: '',

		// Work details
		employee_id: '',
		department: '',
		position: '',
		manager: '',
		hire_date: '',
		employment_status: '',
		status: '',
		workplace: '',
		level: '',
		reporting_to: '',
		joining_date: '',
		smartoffice_code: '',

		// Statutory toggles (match API)
		bonus_eligible: false,
		stat_pf: false,
		stat_mlwf: false,
		stat_pt: false,
		stat_esic: false,
		stat_tds: false,

		// Academic / experience
		qualification: '',
		institute: '',
		passing_year: '',
		work_experience: '',

		// Bank details
		bank_name: '',
		bank_branch: '',
		account_holder_name: '',
		bank_account_no: '',
		bank_ifsc: '',

		// Govt IDs
		pan: '',
		aadhar: '',
		gratuity_no: '',
		uan: '',
		esi_no: '',

		// Attendance / exit
		biometric_code: '',
		device_code: '',
		attendance_id: '',
		exit_date: '',
		exit_reason: '',

		// Media
		profile_photo_url: '',

		// Emergency and misc
		emergency_contact_name: '',
		emergency_contact_phone: '',
		notes: '',
		// System Role assignment (maps to roles_master.id and role_name)
		system_role_id: '',
		system_role_name: '',
		// Deputation company
		deputation_company_id: '',
		// Company
		company_name: 'Accent Techno Solutions Pvt Ltd',
	};
	const [employees, setEmployees] = useState([]);
	const [departments, setDepartments] = useState([]);
	const [workplaces, setWorkplaces] = useState([]);
	const [loading, setLoading] = useState(true);
	const [errorMsg, setErrorMsg] = useState('');
	const [activeTab, setActiveTab] = useState(employeeType ? 'list' : 'add'); // list for type pages, add for main page
	const [searchTerm, setSearchTerm] = useState('');
	const [selectedDepartment, setSelectedDepartment] = useState('');
	const [selectedStatus, setSelectedStatus] = useState('');
	const [selectedWorkplace, setSelectedWorkplace] = useState('');
	const [selectedEmploymentStatus, setSelectedEmploymentStatus] = useState('');
	const [addPageEmployeeSearch, setAddPageEmployeeSearch] = useState('');
	const [currentPage, setCurrentPage] = useState(1);
	const [pagination, setPagination] = useState({});
	const [selectedEmployee, setSelectedEmployee] = useState(null);
	const [allEmployeesForSidebar, setAllEmployeesForSidebar] = useState([]);
	const [profileLocked, setProfileLocked] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');
	// Payroll generation & export
	const [payrollMonth, setPayrollMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	});
	const [generatingPayroll, setGeneratingPayroll] = useState(false);
	const [exportingSlipPdf, setExportingSlipPdf] = useState(false);
	const [exportingSheetExcel, setExportingSheetExcel] = useState(false);
	const [payrollMessage, setPayrollMessage] = useState({ type: '', text: '' });

	const payrollMonthForApi = `${payrollMonth}-01`;

	const generatePayroll = async () => {
		if (
			!confirm(
				`Generate payroll for all Payroll employees for ${new Date(payrollMonthForApi).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}?`
			)
		)
			return;
		setGeneratingPayroll(true);
		setPayrollMessage({ type: '', text: '' });
		try {
			const res = await fetch('/api/payroll/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					month: payrollMonthForApi,
					all: true,
					salary_type: 'payroll',
				}),
			});
			const data = await res.json();
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
		try {
			const res = await fetch(
				`/api/payroll/bulk-pdf?month=${payrollMonthForApi}&salary_type=payroll`
			);
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Export failed');
			}
			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Salary_Slips_Payroll_${payrollMonth}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
			setPayrollMessage({
				type: 'success',
				text: 'Salary slips PDF downloaded',
			});
		} catch (err) {
			setPayrollMessage({
				type: 'error',
				text: err.message || 'Failed to export PDF',
			});
		} finally {
			setExportingSlipPdf(false);
			setTimeout(() => setPayrollMessage({ type: '', text: '' }), 5000);
		}
	};

	const exportSalarySheetExcel = async () => {
		setExportingSheetExcel(true);
		setPayrollMessage({ type: '', text: '' });
		try {
			const res = await fetch(
				`/api/payroll/export-sheet?month=${payrollMonthForApi}&salary_type=payroll`
			);
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Export failed');
			}
			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Salary_Sheet_Payroll_${payrollMonth}.xlsx`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
			setPayrollMessage({
				type: 'success',
				text: 'Salary sheet Excel downloaded',
			});
		} catch (err) {
			setPayrollMessage({
				type: 'error',
				text: err.message || 'Failed to export Excel',
			});
		} finally {
			setExportingSheetExcel(false);
			setTimeout(() => setPayrollMessage({ type: '', text: '' }), 5000);
		}
	};

	// Inline salary structure in payroll list
	const [expandedSalaryId, setExpandedSalaryId] = useState(null);
	const [inlineSalaryData, setInlineSalaryData] = useState({});
	const [inlineSalaryLoading, setInlineSalaryLoading] = useState(null);

	const toggleInlineSalary = async (employeeId) => {
		if (expandedSalaryId === employeeId) {
			setExpandedSalaryId(null);
			return;
		}
		setExpandedSalaryId(employeeId);
		if (inlineSalaryData[employeeId]) return; // already fetched
		setInlineSalaryLoading(employeeId);
		try {
			const res = await fetch(
				`/api/payroll/salary-profile?employee_id=${employeeId}&_t=${Date.now()}`,
				{ cache: 'no-store' }
			);
			const data = await res.json();
			if (data.success) {
				const profile = data.data && data.data.length > 0 ? data.data[0] : null;
				let customData = {
					ctc: null,
					monthly_hours: 160,
					custom_components: [],
				};
				// Always try to parse lumpsum_description for custom data (CTC, components etc.)
				if (profile && profile.lumpsum_description) {
					try {
						customData = JSON.parse(profile.lumpsum_description);
					} catch {}
				}
				setInlineSalaryData((prev) => ({
					...prev,
					[employeeId]: { profile, customData },
				}));
			}
		} catch (err) {
			console.error('Failed to fetch salary:', err);
		} finally {
			setInlineSalaryLoading(null);
		}
	};

	// The inline salary preview is cached while the list is open. Invalidate it
	// after editing a profile so returning to the list cannot show stale values.
	const invalidateInlineSalary = (employeeId) => {
		if (!employeeId) return;

		setInlineSalaryData((prev) => {
			if (!prev[employeeId]) return prev;
			const next = { ...prev };
			delete next[employeeId];
			return next;
		});
		setExpandedSalaryId((currentId) =>
			currentId === employeeId ? null : currentId
		);
	};

	// Attendance summary for employee master
	const [attendanceSummary, setAttendanceSummary] = useState([]);
	const [attendanceDayDetails, setAttendanceDayDetails] = useState([]);
	const [attendanceSummaryLoading, setAttendanceSummaryLoading] =
		useState(false);
	const [attendanceSummaryMonth, setAttendanceSummaryMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	});
	const [formData, setFormData] = useState(defaultFormData);
	const [formErrors, setFormErrors] = useState({});
	const [photoUploading, setPhotoUploading] = useState(false);
	// Roles for System Role assignment
	const [roles, setRoles] = useState([]);
	// Users from user master for username dropdown
	const [users, setUsers] = useState([]);
	// Companies for deputation dropdown
	const [companies, setCompanies] = useState([]);
	// Safe wrapper for opening the view form
	const openViewForm = (employee) => {
		if (!employee) return;
		try {
			setSelectedEmployee(employee);
			setActiveTab('view');
		} catch (e) {
			console.error('openViewForm failed', e);
		}
	};

	// Safe wrapper for opening the edit form. We add this wrapper to avoid TDZ/hoisting
	// issues if the original `openEditForm` declaration is temporarily unavailable
	// during ongoing edits. This mirrors the core behavior needed by the UI and
	// keeps changes minimal.
	const openEditForm_safe = (employee) => {
		if (!employee) return;
		try {
			const sysRoleId = (() => {
				try {
					const match = roles.find((r) => r.role_name === employee.role);
					return match ? String(match.id) : '';
				} catch {
					return '';
				}
			})();

			setFormData({
				...defaultFormData,
				...employee,
				system_role_id: sysRoleId,
				system_role_name: employee.role || '',
				hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : '',
				joining_date: employee.joining_date
					? employee.joining_date.split('T')[0]
					: '',
				dob: employee.dob ? employee.dob.split('T')[0] : '',
			});
			setSelectedEmployee(employee);
			setProfileLocked(false); // Reset lock when opening new employee
			setFormErrors({});
			setEditSubTab('personal');
			setActiveTab('edit');

			// Reset all salary-related states for new employee profile
			setSavedSalaryProfiles([]);
			setEditingSalaryProfileId(null); // Reset editing state when switching employees
			setEffectivePayrollSchedule({});
			setScheduleLoading(false);
			setScheduleError('');
			setManualValues({
				basic_plus_da: '',
				da: '',
				hra: '',
				conveyance: '',
				call_allowance: '',
				bonus: '',
				incentive: '',
				other_allowances: '',
				retention: '',
				insurance: '',
				pf_employee: '',
				esic_employee: '',
				pf_employer: '',
				esic_employer: '',
			});
			setSalaryOverrides({});
			setSalaryOverrideMode(false);
			setSalaryPreview({
				salary_type:
					employee.employee_type === 'Payroll' || employeeType === 'Payroll'
						? 'monthly'
						: 'custom',
				gross: '',
				hourly_rate: '',
				daily_rate: '',
				contract_amount: '',
				lumpsum_amount: '',
				lumpsum_description: '',
				contract_duration: 'monthly',
				contract_end_date: '',
				tds_percentage: '',
				std_hours_per_day: 8,
				std_in_time: '09:00',
				std_out_time: '17:30',
				std_working_days: 26,
				ot_multiplier: 1.5,
				other_allowances: '',
				effective_from: new Date().toISOString().split('T')[0],
				effective_to: '',
				pf_applicable: true,
				esic_applicable: false,
				pt_applicable: false,
				mlwf_applicable: false,
				retention_applicable: false,
				bonus_applicable: false,
				monthly_bonus: false,
				incentive_applicable: false,
				insurance_applicable: false,
				custom_components: [],
				// Custom salary type fields
				custom_ctc: '',
				custom_hourly_rate: '',
				custom_monthly_hours: '',
				custom_basic: '',
				custom_da: '',
				custom_hra: '',
				custom_conveyance: '',
				custom_call_allowance: '',
				custom_incentive: '',
				custom_other_allowances: '',
				custom_pf_employee: '',
				custom_esic_employee: '',
				custom_pt: '',
				custom_mlwf: '',
				custom_retention: '',
				custom_pf_employer: '',
				custom_esic_employer: '',
				custom_mlwf_employer: '',
				custom_bonus: '',
				custom_insurance: '',
				// Privilege Leave (PL) fields
				pl_total: '21',
				pl_used: '0',
				pl_balance: '21',
				// Loan fields
				loan_amount: '',
				loan_amount_per_month: '',
				loan_no_of_months: '',
				loan_total_amount: '',
				loan_active: false,
				// Advance fields
				advance_amount: '',
				advance_active: false,
			});
			setSalaryProfileSuccess('');
			setPreviewError('');

			// Reset payroll component states
			setCurrentDA(0);
			setCurrentPT(0);
			setCurrentMLWF(0);
			setCurrentMLWFEmployer(0);
			setCurrentRetention(0);
			setCurrentBonus(0);
			setCurrentIncentive(0);
			setCurrentInsurance(0);

			// Fetch saved salary profiles for this employee
			if (employee.id) {
				fetchSavedSalaryProfiles(employee.id);
			}
		} catch (e) {
			console.error('openEditForm_safe failed', e);
		}
	};

	// Handle form submission for creating/updating employees
	const handleSubmit = async (e) => {
		e.preventDefault();

		// Prevent submission if profile is locked
		if (profileLocked) {
			setFormErrors({ general: 'Profile is locked. Unlock to make changes.' });
			return;
		}

		// Validate required fields before submission
		const requiredFields = {
			employee_id: 'Employee ID',
			first_name: 'First Name',
			last_name: 'Last Name',
			email: 'Email',
		};

		const missingFields = [];
		for (const [field, label] of Object.entries(requiredFields)) {
			if (!formData[field] || formData[field].trim() === '') {
				missingFields.push(label);
			}
		}

		if (missingFields.length > 0) {
			setFormErrors({
				general: `Please fill in required fields: ${missingFields.join(', ')}`,
			});
			return;
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(formData.email)) {
			setFormErrors({ general: 'Please enter a valid email address' });
			return;
		}

		setLoading(true);
		setFormErrors({});
		setErrorMsg('');
		setSuccessMessage('');

		try {
			const method = selectedEmployee ? 'PUT' : 'POST';
			const url = selectedEmployee
				? `/api/employees?id=${selectedEmployee.id}`
				: '/api/employees';

			// Prepare the data to send
			const dataToSend = { ...formData };

			// If updating, include the id
			if (selectedEmployee) {
				dataToSend.id = selectedEmployee.id;
			}

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(dataToSend),
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(
					result.error || result.message || 'Failed to save employee'
				);
			}

			setSuccessMessage(
				selectedEmployee
					? 'Employee updated successfully!'
					: 'Employee created successfully!'
			);

			// Refresh the employee list
			await fetchEmployees();

			// If editing, stay on the same page; if adding new, go back to list
			if (selectedEmployee) {
				// Update selectedEmployee with latest data and stay on edit page
				const updatedEmployee = result.data || {
					...selectedEmployee,
					...formData,
				};
				setSelectedEmployee(updatedEmployee);
				setTimeout(() => {
					setSuccessMessage('');
				}, 2000);
			} else {
				// Reset form and go back to list for type pages, stay on add for main page
				setTimeout(() => {
					setActiveTab(employeeType ? 'list' : 'add');
					setSelectedEmployee(null);
					setFormData(
						employeeType
							? { ...defaultFormData, employee_type: employeeType }
							: defaultFormData
					);
					setSuccessMessage('');
				}, 1500);
			}
		} catch (error) {
			console.error('Error saving employee:', error);
			setFormErrors({
				general: error.message || 'Failed to save employee. Please try again.',
			});
		} finally {
			setLoading(false);
		}
	};

	// Safe submit wrapper to avoid runtime ReferenceError if `handleSubmit` is temporarily
	// undefined during an in-progress refactor. If the canonical `handleSubmit` exists
	// it will be invoked; otherwise we show a friendly error and prevent default.
	const handleSubmit_safe = async (e) => {
		// Try calling the canonical handleSubmit if it's available. In some
		// in-flight refactor states the `handleSubmit` binding may not be ready
		// yet; retry a few times before failing gracefully.
		const callIfReady = async () => {
			if (typeof handleSubmit === 'function') {
				try {
					await handleSubmit(e);
					return true;
				} catch (err) {
					// forward error to console but don't spam user with internal messages
					console.error('handleSubmit invocation failed', err);
					return false;
				}
			}
			return false;
		};

		// Immediate attempt
		if (await callIfReady()) return;

		// Retry a few times (short backoff) in case of a transient binding order issue
		const maxAttempts = 20;
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			// small delay

			await new Promise((res) => setTimeout(res, 50));

			if (await callIfReady()) return;
		}

		// If still not available, show a user-friendly message but avoid noisy console errors
		try {
			if (e && typeof e.preventDefault === 'function') e.preventDefault();
		} catch {}
		setFormErrors((prev) => ({
			...prev,
			general: 'Form submission temporarily unavailable. Please try again.',
		}));
	};

	// Autosave function - silently saves employee data without redirecting
	const [autoSaving, setAutoSaving] = useState(false);
	const [lastAutoSave, setLastAutoSave] = useState(null);

	const autoSaveEmployee = async () => {
		// Only autosave if we're editing an existing employee and profile is not locked
		if (!selectedEmployee?.id || profileLocked) return;

		try {
			setAutoSaving(true);
			const dataToSend = { ...formData, id: selectedEmployee.id };

			const response = await fetch(`/api/employees?id=${selectedEmployee.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(dataToSend),
			});

			if (response.ok) {
				setLastAutoSave(new Date());
				// Silently refresh employee list in background
				fetchEmployees();
			}
		} catch (error) {
			console.error('Autosave failed:', error);
		} finally {
			setAutoSaving(false);
		}
	};

	// Delete employee
	const handleDelete = async (employee) => {
		if (!employee?.id) return;

		if (
			!confirm(
				`Are you sure you want to delete ${employee.first_name} ${employee.last_name}? This action cannot be undone.`
			)
		) {
			return;
		}

		try {
			setLoading(true);
			const response = await fetch(`/api/employees?id=${employee.id}`, {
				method: 'DELETE',
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'Failed to delete employee');
			}

			setSuccessMessage('Employee deleted successfully!');
			// Refresh the employee list
			await fetchEmployees();

			setTimeout(() => {
				setSuccessMessage('');
			}, 3000);
		} catch (error) {
			console.error('Error deleting employee:', error);
			setFormErrors({
				general:
					error.message || 'Failed to delete employee. Please try again.',
			});
		} finally {
			setLoading(false);
		}
	};

	// Add Employee sub-tabs (like Projects edit tabs)
	const addSubTabOrder = [
		'personal',
		'contact',
		'work',
		'academic',
		'govt',
		'bank',
		'attendance',
	];
	const [addSubTab, setAddSubTab] = useState('personal');

	// Edit Employee sub-tabs (same structure as add) - includes salary structure
	const editSubTabOrder = [
		'personal',
		'contact',
		'work',
		'salary',
		'academic',
		'govt',
		'bank',
		'attendance',
	];
	const [editSubTab, setEditSubTab] = useState('personal');

	// Salary Structure State - New Core Payroll Tables Based
	const [salaryStructures, setSalaryStructures] = useState([]);
	const [activeSalaryStructure, setActiveSalaryStructure] = useState(null);
	const [salaryLoading, setSalaryLoading] = useState(false);
	const [salaryError, setSalaryError] = useState('');
	const [exportingSalaryStructureExcel, setExportingSalaryStructureExcel] =
		useState(false);
	const [
		exportingAllSalaryStructuresExcel,
		setExportingAllSalaryStructuresExcel,
	] = useState(false);
	const [showSalaryForm, setShowSalaryForm] = useState(false);
	const [calculatedBreakdown, setCalculatedBreakdown] = useState(null);

	// New Salary Preview State (using core payroll tables)
	const [salaryPreview, setSalaryPreview] = useState({
		salary_type: defaultSalaryType,
		gross: '',
		hourly_rate: '',
		daily_rate: '',
		contract_amount: '',
		lumpsum_amount: '',
		other_allowances: '',
		tds_percentage: '',
		effective_from: new Date().toISOString().split('T')[0],
		effective_to: '',
		pf_applicable: true,
		esic_applicable: false,
		pt_applicable: false,
		mlwf_applicable: false,
		retention_applicable: false,
		bonus_applicable: false,
		monthly_bonus: false,
		incentive_applicable: false,
		insurance_applicable: false,
		custom_components: [], // For custom salary type: [{name: 'Basic', amount: 10000, type: 'earning'}, ...]
		custom_hourly_rate: '', // For custom salary type hourly rate
		custom_monthly_hours: '160', // Standard 160 hours/month
		// Privilege Leave (PL) fields
		pl_total: '21',
		pl_used: '0',
		pl_balance: '21',
		// Loan fields
		loan_amount: '',
		loan_amount_per_month: '',
		loan_no_of_months: '',
		loan_total_amount: '',
		loan_active: false,
		// Advance fields
		advance_amount: '',
		advance_active: false,
	});
	const [currentDA, setCurrentDA] = useState(0);
	const [currentPT, setCurrentPT] = useState(0);
	const [currentMLWF, setCurrentMLWF] = useState(0);
	const [currentMLWFEmployer, setCurrentMLWFEmployer] = useState(0);
	const [currentRetention, setCurrentRetention] = useState(0);
	const [currentBonus, setCurrentBonus] = useState(0);
	const [currentIncentive, setCurrentIncentive] = useState(0);
	const [currentInsurance, setCurrentInsurance] = useState(0);
	const [salaryOverrides, setSalaryOverrides] = useState({});
	const [salaryOverrideMode, setSalaryOverrideMode] = useState(false);
	const [manualValues, setManualValues] = useState({
		basic_plus_da: '',
		da: '',
		hra: '',
		conveyance: '',
		call_allowance: '',
		pf_employee: '',
		esic_employee: '',
		pf_employer: '',
		esic_employer: '',
	});
	const [currentComponents, setCurrentComponents] = useState({
		pf_employee: 0,
		pf_employer: 0,
		esic_employee: 0,
		esic_employer: 0,
		pt: 0,
		mlwf: 0,
		insurance: 0,
		personal_accident: 0,
		mediclaim: 0,
		bonus: 0,
		leaves: 0,
		tds: 0,
		tds_type: null,
		tds_percentage: 0,
	});
	const [previewError, setPreviewError] = useState('');
	const [effectivePayrollSchedule, setEffectivePayrollSchedule] = useState({});
	const [scheduleLoading, setScheduleLoading] = useState(false);
	const [scheduleError, setScheduleError] = useState('');

	const payrollPreviewProfile = useMemo(
		() => ({ ...salaryPreview, gross_salary: salaryPreview.gross }),
		[salaryPreview]
	);
	const { preview: derivedPayrollPreview } = usePayrollPreview({
		employeeId: selectedEmployee?.id,
		month: salaryPreview.effective_from,
		salaryProfile: payrollPreviewProfile,
		payrollSchedule: effectivePayrollSchedule,
		attendance: {
			standardWorkingDays: salaryPreview.std_working_days || 26,
		},
		overrides: salaryOverrides,
		includeBonus: true,
	});

	const loadEffectivePayrollSchedule = useCallback(
		async ({ date, gross, signal }) => {
			const response = await fetch(
				`/api/payroll/schedules/current?date=${encodeURIComponent(date)}&gross=${encodeURIComponent(gross)}`,
				{ signal, cache: 'no-store' }
			);
			const data = await response.json();
			if (!response.ok || !data.success) {
				throw new Error(data.error || 'Failed to load payroll schedule');
			}
			return data.data || {};
		},
		[]
	);

	useEffect(() => {
		const gross = Number(salaryPreview.gross);
		const isDerivedMonthly = salaryPreview.salary_type === 'monthly';
		if (!selectedEmployee?.id || !isDerivedMonthly || !gross) {
			setEffectivePayrollSchedule({});
			setScheduleLoading(false);
			setScheduleError('');
			return undefined;
		}

		const controller = new AbortController();
		setEffectivePayrollSchedule({});
		setScheduleLoading(true);
		setScheduleError('');
		loadEffectivePayrollSchedule({
			date:
				salaryPreview.effective_from || new Date().toISOString().split('T')[0],
			gross,
			signal: controller.signal,
		})
			.then((schedule) => {
				if (!controller.signal.aborted) setEffectivePayrollSchedule(schedule);
			})
			.catch((error) => {
				if (error.name !== 'AbortError' && !controller.signal.aborted) {
					setEffectivePayrollSchedule({});
					setScheduleError(error.message);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setScheduleLoading(false);
			});

		return () => controller.abort();
	}, [
		loadEffectivePayrollSchedule,
		selectedEmployee?.id,
		salaryPreview.effective_from,
		salaryPreview.gross,
		salaryPreview.salary_type,
	]);

	// Salary calculation percentages - now using centralized config
	// These values are frozen in /src/utils/payroll-config.js
	const [salaryPercentages, setSalaryPercentages] = useState({
		basic_percent: PAYROLL_CONFIG.BASIC_DA_PERCENT, // 60% - Basic+DA % of Gross
		da_fixed: PAYROLL_CONFIG.DA_FIXED_AMOUNT, // 0 - DA Fixed amount (if any)
		hra_percent: PAYROLL_CONFIG.HRA_PERCENT, // 20% - HRA % of Gross
		conveyance_percent: PAYROLL_CONFIG.CONVEYANCE_PERCENT, // 10% - Conveyance % of Gross
		conveyance: PAYROLL_CONFIG.CONVEYANCE_FIXED_AMOUNT, // 0 - Fixed conveyance (if any)
		call_allowance_percent: PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT, // 10% - Call Allowance % of Gross
		employee_pf_percent: PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT, // 12% - Employee PF
		employer_pf_percent: PAYROLL_CONFIG.EMPLOYER_PF_PERCENT, // 13% - Employer PF
		employee_esic_percent: PAYROLL_CONFIG.EMPLOYEE_ESIC_PERCENT, // 0.75% - Employee ESIC
		employer_esic_percent: PAYROLL_CONFIG.EMPLOYER_ESIC_PERCENT, // 3.25% - Employer ESIC
		gratuity_percent: PAYROLL_CONFIG.GRATUITY_PERCENT, // 4.81% - Gratuity
		pf_admin_percent: PAYROLL_CONFIG.PF_ADMIN_PERCENT, // 0.5% - PF Admin
		edli_percent: PAYROLL_CONFIG.EDLI_PERCENT, // 0.5% - EDLI
	});

	// Manual salary values for legacy form
	const [manualSalaryValues, setManualSalaryValues] = useState({
		hra: '',
		conveyance: '',
		medical: '',
		special_allowance: '',
		employee_pf: '',
		employer_pf: '',
		employee_esic: '',
		employer_esic: '',
		gratuity: '',
		pt: '',
	});

	const [salaryFormData, setSalaryFormData] = useState({
		pay_type: 'monthly',
		effective_from: new Date().toISOString().split('T')[0],
		ctc: '',
		gross_salary: '',
		basic_salary: '',
		hourly_rate: '',
		daily_rate: '',
		ot_multiplier: '1.5',
		pf_applicable: true,
		esic_applicable: false,
		pt_applicable: true,
		mlwf_applicable: true,
		tds_applicable: true,
		pf_wage_ceiling: '15000',
		standard_working_days: '26',
		standard_hours_per_day: '8',
		remarks: '',
	});
	const [salaryComponents, setSalaryComponents] = useState([]);

	// Fetch salary structures for an employee
	const fetchSalaryStructures = useCallback(async (employeeId) => {
		if (!employeeId) return;
		setSalaryLoading(true);
		setSalaryError('');
		try {
			const res = await fetch(`/api/employees/${employeeId}/salary-structure`);
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.error || 'Failed to fetch salary structures');
			setSalaryStructures(data.salaryStructures || []);
			setActiveSalaryStructure(data.activeSalaryStructure || null);
		} catch (err) {
			console.error('Error fetching salary structures:', err);
			setSalaryError(err.message);
		} finally {
			setSalaryLoading(false);
		}
	}, []);

	const exportSalaryStructureExcel = async () => {
		if (!selectedEmployee?.id) {
			setPreviewError('Please select an employee first.');
			return;
		}

		setExportingSalaryStructureExcel(true);
		setPreviewError('');
		try {
			const res = await fetch(
				`/api/employees/${selectedEmployee.id}/salary-structure/export`
			);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(
					data.error || data.details || 'Failed to export salary structure'
				);
			}

			const blob = await res.blob();
			const contentDisposition = res.headers.get('content-disposition') || '';
			const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
			const filename =
				match?.[1] ||
				`Salary_Structure_${selectedEmployee.employee_id || selectedEmployee.id}.xlsx`;

			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);
		} catch (err) {
			setPreviewError(err.message || 'Failed to export salary structure');
		} finally {
			setExportingSalaryStructureExcel(false);
		}
	};

	const exportAllSalaryStructuresExcel = async () => {
		setExportingAllSalaryStructuresExcel(true);
		setPreviewError('');
		try {
			const res = await fetch('/api/employees/salary-structure/export');
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(
					data.error || data.details || 'Failed to export all salary structures'
				);
			}

			const blob = await res.blob();
			const contentDisposition = res.headers.get('content-disposition') || '';
			const match = contentDisposition.match(/filename="?([^\"]+)"?/i);
			const filename = match?.[1] || 'Salary_Structure_All_Users.xlsx';

			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);
		} catch (err) {
			setPreviewError(err.message || 'Failed to export all salary structures');
		} finally {
			setExportingAllSalaryStructuresExcel(false);
		}
	};

	// Fetch monthly hours from attendance for custom salary calculation
	const fetchAttendanceHours = async (employeeId) => {
		if (!employeeId) return ''; // No employee
		try {
			const now = new Date();
			const year = now.getFullYear();
			const month = String(now.getMonth() + 1).padStart(2, '0');
			const monthParam = `${year}-${month}`;

			console.log(
				'Fetching attendance for employee:',
				employeeId,
				'month:',
				monthParam
			);

			const res = await fetch(
				`/api/attendance?employee_id=${employeeId}&month=${monthParam}`
			);
			const data = await res.json();

			console.log('Attendance API response:', data);

			if (data.success) {
				// Check summary first
				if (data.summary && data.summary.length > 0) {
					const empData =
						data.summary.find(
							(e) => String(e.employee_id) === String(employeeId)
						) || data.summary[0];
					console.log('Found employee data in summary:', empData);

					if (empData && empData.days && Object.keys(empData.days).length > 0) {
						let totalHours = 0;
						const defaultHours = 8.5; // Default 9:00 to 17:30

						Object.entries(empData.days).forEach(([date, dayInfo]) => {
							if (['P', 'HD', 'OT'].includes(dayInfo.status)) {
								if (dayInfo.in_time && dayInfo.out_time) {
									const hrs = calculateHoursDiff(
										dayInfo.in_time,
										dayInfo.out_time
									);
									totalHours += hrs;
									console.log(
										`Date ${date}: ${dayInfo.status} - ${dayInfo.in_time} to ${dayInfo.out_time} = ${hrs} hrs`
									);
								} else {
									const hrs =
										dayInfo.status === 'HD' ? defaultHours / 2 : defaultHours;
									totalHours += hrs;
									console.log(
										`Date ${date}: ${dayInfo.status} - default = ${hrs} hrs`
									);
								}
							}
						});

						console.log('Total hours calculated:', totalHours);
						return totalHours > 0 ? totalHours.toFixed(1) : '';
					}
				}

				// If no summary, try to calculate from records directly
				if (data.records && data.records.length > 0) {
					console.log('Using records directly, count:', data.records.length);
					let totalHours = 0;
					const defaultHours = 8.5;

					data.records.forEach((record) => {
						if (['P', 'HD', 'OT'].includes(record.status)) {
							if (record.in_time && record.out_time) {
								totalHours += calculateHoursDiff(
									record.in_time,
									record.out_time
								);
							} else {
								totalHours +=
									record.status === 'HD' ? defaultHours / 2 : defaultHours;
							}
						}
					});

					console.log('Total hours from records:', totalHours);
					return totalHours > 0 ? totalHours.toFixed(1) : '';
				}
			}
		} catch (err) {
			console.error('Error fetching attendance hours:', err);
		}
		return '';
	};

	// Helper function to calculate hours difference
	const calculateHoursDiff = (inTime, outTime) => {
		if (!inTime || !outTime) return 8.5;
		try {
			// Handle various time formats (HH:MM:SS, HH:MM, etc.)
			const parseTime = (time) => {
				const timeStr = String(time).substring(0, 5); // Get HH:MM part
				const parts = timeStr.split(':').map(Number);
				return parts[0] + (parts[1] || 0) / 60;
			};

			const inDecimal = parseTime(inTime);
			const outDecimal = parseTime(outTime);
			const diff = outDecimal - inDecimal;

			return diff > 0 ? diff : 8.5;
		} catch (err) {
			console.error('Error parsing time:', inTime, outTime, err);
			return 8.5;
		}
	};

	// Fetch attendance summary for selected employee
	const fetchAttendanceSummary = useCallback(async (employeeId, month) => {
		if (!employeeId) return;
		setAttendanceSummaryLoading(true);
		try {
			const res = await fetch(
				`/api/attendance/summary?employee_id=${employeeId}&month=${month}`
			);
			const data = await res.json();
			if (data.success) {
				setAttendanceSummary(data.data || []);
				setAttendanceDayDetails(data.dayDetails || []);
			} else {
				setAttendanceSummary([]);
				setAttendanceDayDetails([]);
			}
		} catch (err) {
			console.error('Error fetching attendance summary:', err);
			setAttendanceSummary([]);
			setAttendanceDayDetails([]);
		} finally {
			setAttendanceSummaryLoading(false);
		}
	}, []);

	// Load attendance summary when employee is selected or month changes
	useEffect(() => {
		if (
			selectedEmployee?.id &&
			(activeTab === 'edit' || activeTab === 'view')
		) {
			fetchAttendanceSummary(selectedEmployee.id, attendanceSummaryMonth);
		}
	}, [
		selectedEmployee?.id,
		attendanceSummaryMonth,
		activeTab,
		fetchAttendanceSummary,
	]);

	// Check if employee is exempt from PT
	// Male: up to 7500 = exempt
	// Female: up to 25000 = exempt
	const isPTExempt = (grossSalary) => {
		const gender = formData.gender || selectedEmployee?.gender || '';
		const gross = parseFloat(grossSalary) || 0;
		if (gender === 'Female' && gross <= 25000) return true;
		if (gender === 'Male' && gross <= 7500) return true;
		return false;
	};

	// Calculate PT amount based on gender, salary and month
	// Male: 7501-10000 = 175, above 10000 = 200
	// Female: 25000+ = 200
	// February: 300 for all (except exempt employees)
	const calculatePTAmount = (grossSalary) => {
		const gender = formData.gender || selectedEmployee?.gender || '';
		const gross = parseFloat(grossSalary) || 0;
		const currentMonth = new Date().getMonth(); // 0 = Jan, 1 = Feb

		// Check exemptions first
		if (isPTExempt(gross)) return 0;

		// February special rate (300) for non-exempt employees
		if (currentMonth === 1) {
			// February
			return 300;
		}

		// Regular rates by gender and salary
		if (gender === 'Male') {
			if (gross >= 7501 && gross <= 10000) return 175;
			if (gross > 10000) return 200;
		}

		if (gender === 'Female') {
			if (gross >= 25000) return 200;
		}

		return 200; // Default PT amount
	};

	// Save Salary Profile to employee_salary_profile table
	const [salaryProfileSaving, setSalaryProfileSaving] = useState(false);
	const [salaryProfileSuccess, setSalaryProfileSuccess] = useState('');
	const [savedSalaryProfiles, setSavedSalaryProfiles] = useState([]);
	const [editingSalaryProfileId, setEditingSalaryProfileId] = useState(null); // ID of profile being edited
	const [loadingSavedProfiles, setLoadingSavedProfiles] = useState(false);
	const [deletingSalaryProfile, setDeletingSalaryProfile] = useState(false);

	// Fetch saved salary profiles for an employee and load into form if exists
	const fetchSavedSalaryProfiles = async (employeeId) => {
		if (!employeeId) return;
		setLoadingSavedProfiles(true);
		try {
			const res = await fetch(
				`/api/payroll/salary-profile?employee_id=${employeeId}`
			);
			const data = await res.json();
			if (data.success && data.data) {
				setSavedSalaryProfiles(data.data);

				// If there's a saved profile, load it into the form
				if (data.data.length > 0) {
					const savedProfile = data.data[0]; // Most recent profile
					const savedOverrides = getSalaryProfileOverrides(savedProfile);
					setSalaryOverrides(savedOverrides);
					setSalaryOverrideMode(hasSalaryOverrides(savedOverrides));

					// Parse custom data from lumpsum_description if salary_type is custom
					let customData = {
						ctc: null,
						monthly_hours: 160,
						custom_components: [],
					};
					if (
						savedProfile.salary_type === 'custom' &&
						savedProfile.lumpsum_description
					) {
						try {
							customData = JSON.parse(savedProfile.lumpsum_description);
						} catch (e) {
							console.error('Failed to parse custom salary data:', e);
						}
					}

					const {
						basic: savedBasic,
						da: storedDa,
						basicPlusDa: savedBasicPlusDa,
					} = normalizeSalaryBreakdown(savedProfile);

					// Load gross and other settings
					setSalaryPreview({
						gross: savedProfile.gross_salary || savedProfile.gross || '',
						other_allowances: savedProfile.other_allowances || '',
						pf_applicable:
							savedProfile.pf_applicable === 1 ||
							savedProfile.pf_applicable === true,
						esic_applicable:
							savedProfile.esic_applicable === 1 ||
							savedProfile.esic_applicable === true,
						pt_applicable:
							savedProfile.pt_applicable === 1 ||
							savedProfile.pt_applicable === true,
						mlwf_applicable:
							savedProfile.mlwf_applicable === 1 ||
							savedProfile.mlwf_applicable === true,
						retention_applicable:
							savedProfile.retention_applicable === 1 ||
							savedProfile.retention_applicable === true,
						bonus_applicable:
							savedProfile.bonus_applicable === 1 ||
							savedProfile.bonus_applicable === true,
						monthly_bonus:
							savedProfile.monthly_bonus === 1 ||
							savedProfile.monthly_bonus === true,
						incentive_applicable:
							savedProfile.incentive_applicable === 1 ||
							savedProfile.incentive_applicable === true,
						insurance_applicable:
							savedProfile.insurance_applicable === 1 ||
							savedProfile.insurance_applicable === true,
						// Salary type fields
						salary_type:
							savedProfile.salary_type ||
							(employeeType === 'Payroll' ||
							formData.employee_type === 'Payroll'
								? 'monthly'
								: 'custom'),
						hourly_rate: savedProfile.hourly_rate || '',
						std_hours_per_day: savedProfile.std_hours_per_day || 8,
						std_in_time: savedProfile.std_in_time
							? savedProfile.std_in_time.substring(0, 5)
							: '09:00',
						std_out_time: savedProfile.std_out_time
							? savedProfile.std_out_time.substring(0, 5)
							: '17:30',
						ot_multiplier: savedProfile.ot_multiplier || 1.5,
						daily_rate: savedProfile.daily_rate || '',
						std_working_days: savedProfile.std_working_days || 26,
						contract_amount: savedProfile.contract_amount || '',
						contract_duration: savedProfile.contract_duration || 'monthly',
						contract_end_date: savedProfile.contract_end_date || '',
						tds_percentage: savedProfile.tds_percentage || '',
						lumpsum_amount: savedProfile.lumpsum_amount || '',
						lumpsum_description:
							savedProfile.salary_type === 'custom'
								? ''
								: savedProfile.lumpsum_description || '',
						effective_from: savedProfile.effective_from
							? savedProfile.effective_from.split('T')[0]
							: new Date().toISOString().split('T')[0],
						effective_to: savedProfile.effective_to
							? savedProfile.effective_to.split('T')[0]
							: '',
						custom_components: customData.custom_components || [],
						// Custom salary type fields - load from saved data
						custom_ctc: customData.ctc || savedProfile.employer_cost || '',
						custom_hourly_rate: savedProfile.hourly_rate || '',
						custom_monthly_hours: customData.monthly_hours || '160',
						custom_basic: savedBasic || '',
						custom_da: storedDa || '',
						custom_hra: savedProfile.hra || '',
						custom_conveyance: savedProfile.conveyance || '',
						custom_call_allowance: savedProfile.call_allowance || '',
						custom_incentive: savedProfile.incentive || '',
						custom_other_allowances: savedProfile.other_allowances || '',
						custom_pf_employee: savedProfile.pf_employee || '',
						custom_esic_employee: savedProfile.esic_employee || '',
						custom_pt: savedProfile.pt || '',
						custom_mlwf: savedProfile.mlwf || '',
						custom_retention: savedProfile.retention || '',
						custom_pf_employer: savedProfile.pf_employer || '',
						custom_esic_employer: savedProfile.esic_employer || '',
						custom_mlwf_employer: savedProfile.mlwf_employer || '',
						custom_bonus: savedProfile.bonus || '',
						custom_insurance: savedProfile.insurance || '',
						// PL - load total from saved profile, used will be fetched from attendance API
						pl_total: savedProfile.pl_total?.toString() || '21',
						pl_used: '0',
						pl_balance: savedProfile.pl_total?.toString() || '21',
						// Loan fields
						loan_amount: savedProfile.loan_amount?.toString() || '',
						loan_amount_per_month:
							savedProfile.loan_amount_per_month?.toString() || '',
						loan_no_of_months: savedProfile.loan_no_of_months?.toString() || '',
						loan_total_amount: savedProfile.loan_total_amount?.toString() || '',
						loan_active: !!savedProfile.loan_active,
						// Advance fields
						advance_amount: savedProfile.advance_amount?.toString() || '',
						advance_active: !!savedProfile.advance_active,
					});

					// Fetch PL used from attendance summary API
					try {
						const currentYear = new Date().getFullYear();
						const plRes = await fetch(
							`/api/attendance/summary?year=${currentYear}&employee_id=${employeeId}`
						);
						const plData = await plRes.json();
						if (plData.success && plData.data) {
							const totalUsed = plData.data.reduce(
								(sum, row) => sum + (parseInt(row.total_privilege_leave) || 0),
								0
							);
							const plTotal = parseInt(savedProfile.pl_total) || 21;
							setSalaryPreview((prev) => ({
								...prev,
								pl_used: String(totalUsed),
								pl_balance: String(Math.max(0, plTotal - totalUsed)),
							}));
						}
					} catch (plErr) {
						console.error('Error fetching PL usage:', plErr);
					}

					// Set DA value
					if (storedDa) {
						setCurrentDA(storedDa);
					}

					// Set Insurance value
					if (savedProfile.insurance) {
						setCurrentInsurance(parseFloat(savedProfile.insurance));
					}
				}
			}
		} catch (err) {
			console.error('Error fetching saved salary profiles:', err);
		} finally {
			setLoadingSavedProfiles(false);
		}
	};

	// Delete salary profile
	const handleDeleteSalaryProfile = async (profileId) => {
		if (!profileId) return;

		if (
			!confirm(
				'Are you sure you want to delete this salary profile? This action cannot be undone.'
			)
		) {
			return;
		}

		setDeletingSalaryProfile(true);
		try {
			const res = await fetch(`/api/payroll/salary-profile?id=${profileId}`, {
				method: 'DELETE',
			});
			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || 'Failed to delete salary profile');
			}

			// Refresh the list
			await fetchSavedSalaryProfiles(selectedEmployee.id);
			// If we were editing this profile, reset the form
			if (editingSalaryProfileId === profileId) {
				handleResetSalaryForm();
			}
			setSalaryProfileSuccess('Salary profile deleted successfully');
			setTimeout(() => setSalaryProfileSuccess(''), 3000);
		} catch (err) {
			console.error('Error deleting salary profile:', err);
			setPreviewError('Failed to delete: ' + err.message);
		} finally {
			setDeletingSalaryProfile(false);
		}
	};

	// Function to edit an existing salary profile - load it into the form
	const handleEditSalaryProfile = (profile) => {
		setEditingSalaryProfileId(profile.id);
		const savedOverrides = getSalaryProfileOverrides(profile);
		setSalaryOverrides(savedOverrides);
		setSalaryOverrideMode(hasSalaryOverrides(savedOverrides));

		// Parse custom data from lumpsum_description if salary_type is custom
		let customData = { ctc: null, monthly_hours: 160, custom_components: [] };
		if (profile.salary_type === 'custom' && profile.lumpsum_description) {
			try {
				customData = JSON.parse(profile.lumpsum_description);
			} catch (e) {
				console.error('Failed to parse custom salary data:', e);
			}
		}

		const { basic: editBasic, da: storedDa } =
			normalizeSalaryBreakdown(profile);
		setSalaryPreview({
			salary_type:
				profile.salary_type ||
				(employeeType === 'Payroll' ||
				selectedEmployee?.employee_type === 'Payroll'
					? 'monthly'
					: 'custom'),
			gross: profile.gross_salary || profile.gross || '',
			hourly_rate: profile.hourly_rate || '',
			daily_rate: profile.daily_rate || '',
			contract_amount: profile.contract_amount || '',
			lumpsum_amount: profile.lumpsum_amount || '',
			lumpsum_description:
				profile.salary_type === 'custom'
					? ''
					: profile.lumpsum_description || '',
			contract_duration: profile.contract_duration || 'monthly',
			contract_end_date: profile.contract_end_date
				? profile.contract_end_date.split('T')[0]
				: '',
			tds_percentage: profile.tds_percentage || '',
			std_hours_per_day: profile.std_hours_per_day || 8,
			std_in_time: profile.std_in_time
				? profile.std_in_time.substring(0, 5)
				: '09:00',
			std_out_time: profile.std_out_time
				? profile.std_out_time.substring(0, 5)
				: '17:30',
			std_working_days: profile.std_working_days || 26,
			ot_multiplier: profile.ot_multiplier || 1.5,
			other_allowances: profile.other_allowances || '',
			effective_from: profile.effective_from
				? profile.effective_from.split('T')[0]
				: new Date().toISOString().split('T')[0],
			effective_to: profile.effective_to
				? profile.effective_to.split('T')[0]
				: '',
			pf_applicable: !!profile.pf_applicable,
			esic_applicable: !!profile.esic_applicable,
			pt_applicable: !!profile.pt_applicable,
			mlwf_applicable: !!profile.mlwf_applicable,
			retention_applicable: !!profile.retention_applicable,
			bonus_applicable: !!profile.bonus_applicable,
			incentive_applicable: !!profile.incentive_applicable,
			insurance_applicable: !!profile.insurance_applicable,
			custom_components: customData.custom_components || [],
			// Custom salary type fields - load from saved data
			custom_ctc: customData.ctc || profile.employer_cost || '',
			custom_hourly_rate: profile.hourly_rate || '',
			custom_monthly_hours: customData.monthly_hours || '160',
			custom_basic: editBasic || '',
			custom_da: storedDa || '',
			custom_hra: profile.hra || '',
			custom_conveyance: profile.conveyance || '',
			custom_call_allowance: profile.call_allowance || '',
			custom_incentive: profile.incentive || '',
			custom_other_allowances: profile.other_allowances || '',
			custom_pf_employee: profile.pf_employee || '',
			custom_esic_employee: profile.esic_employee || '',
			custom_pt: profile.pt || '',
			custom_mlwf: profile.mlwf || '',
			custom_retention: profile.retention || '',
			custom_pf_employer: profile.pf_employer || '',
			custom_esic_employer: profile.esic_employer || '',
			custom_mlwf_employer: profile.mlwf_employer || '',
			custom_bonus: profile.bonus || '',
			custom_insurance: profile.insurance || '',
			// PL - load total from profile, used will be fetched from attendance API
			pl_total: profile.pl_total?.toString() || '21',
			pl_used: '0',
			pl_balance: profile.pl_total?.toString() || '21',
			// Loan fields
			loan_amount: profile.loan_amount?.toString() || '',
			loan_amount_per_month: profile.loan_amount_per_month?.toString() || '',
			loan_no_of_months: profile.loan_no_of_months?.toString() || '',
			loan_total_amount: profile.loan_total_amount?.toString() || '',
			loan_active: !!profile.loan_active,
			// Advance fields
			advance_amount: profile.advance_amount?.toString() || '',
			advance_active: !!profile.advance_active,
		});

		// Fetch PL used from attendance summary API
		(async () => {
			try {
				const currentYear = new Date().getFullYear();
				const plRes = await fetch(
					`/api/attendance/summary?year=${currentYear}&employee_id=${profile.employee_id}`
				);
				const plData = await plRes.json();
				if (plData.success && plData.data) {
					const totalUsed = plData.data.reduce(
						(sum, row) => sum + (parseInt(row.total_privilege_leave) || 0),
						0
					);
					const plTotal = parseInt(profile.pl_total) || 21;
					setSalaryPreview((prev) => ({
						...prev,
						pl_used: String(totalUsed),
						pl_balance: String(Math.max(0, plTotal - totalUsed)),
					}));
				}
			} catch (plErr) {
				console.error('Error fetching PL usage:', plErr);
			}
		})();

		setManualValues({});
		setCurrentRetention(parseFloat(profile.retention) || 0);
		setCurrentInsurance(parseFloat(profile.insurance) || 0);
	};

	// Function to reset salary form for adding a new profile
	const handleResetSalaryForm = () => {
		setEditingSalaryProfileId(null);
		setSalaryOverrides({});
		setSalaryOverrideMode(false);
		setSalaryPreview({
			salary_type: defaultSalaryType,
			gross: '',
			hourly_rate: '',
			daily_rate: '',
			contract_amount: '',
			lumpsum_amount: '',
			lumpsum_description: '',
			contract_duration: 'monthly',
			contract_end_date: '',
			std_hours_per_day: 8,
			std_in_time: '09:00',
			std_out_time: '17:30',
			std_working_days: 26,
			ot_multiplier: 1.5,
			other_allowances: '',
			effective_from: new Date().toISOString().split('T')[0],
			effective_to: '',
			pf_applicable: true,
			esic_applicable: false,
			pt_applicable: false,
			mlwf_applicable: false,
			retention_applicable: false,
			bonus_applicable: false,
			monthly_bonus: false,
			incentive_applicable: false,
			insurance_applicable: false,
			custom_components: [],
			// Custom salary type fields
			custom_ctc: '',
			custom_hourly_rate: '',
			custom_monthly_hours: '160',
			custom_basic: '',
			custom_da: '',
			custom_hra: '',
			custom_conveyance: '',
			custom_call_allowance: '',
			custom_incentive: '',
			custom_other_allowances: '',
			custom_pf_employee: '',
			custom_esic_employee: '',
			custom_pt: '',
			custom_mlwf: '',
			custom_retention: '',
			custom_pf_employer: '',
			custom_esic_employer: '',
			custom_mlwf_employer: '',
			custom_bonus: '',
			custom_insurance: '',
			// PL defaults
			pl_total: '21',
			pl_used: '0',
			pl_balance: '21',
			// Loan defaults
			loan_amount: '',
			loan_amount_per_month: '',
			loan_no_of_months: '',
			loan_total_amount: '',
			loan_active: false,
			// Advance defaults
			advance_amount: '',
			advance_active: false,
		});
		setManualValues({
			basic_plus_da: '',
			da: '',
			hra: '',
			conveyance: '',
			call_allowance: '',
			pf_employee: '',
			esic_employee: '',
			pf_employer: '',
			esic_employer: '',
			retention: '',
			insurance: '',
		});
		setEffectivePayrollSchedule({});
		setScheduleLoading(false);
		setScheduleError('');
		setCurrentRetention(0);
		setCurrentInsurance(0);
		setPreviewError('');
	};

	const handleSaveSalaryProfile = async () => {
		if (!selectedEmployee?.id) {
			setPreviewError('No employee selected');
			return;
		}
		// Validate based on salary type
		const salaryType = salaryPreview.salary_type || 'custom';
		const breakdown = salaryType === 'monthly' ? derivedPayrollPreview : null;
		const profileHasOverrides =
			salaryType === 'monthly' && hasSalaryOverrides(salaryOverrides);
		const hasOverride = (key) =>
			salaryOverrides[key] !== undefined &&
			salaryOverrides[key] !== null &&
			salaryOverrides[key] !== '';
		const persistedOverride = (key) =>
			hasOverride(key) ? (breakdown?.[key] ?? null) : null;

		if (salaryType === 'monthly') {
			if (!salaryPreview.gross) {
				setPreviewError('Please enter gross salary');
				return;
			}
			if (!breakdown) {
				setPreviewError(
					'Please enter a gross salary first to calculate breakdown'
				);
				return;
			}
		} else if (salaryType === 'hourly' && !salaryPreview.hourly_rate) {
			setPreviewError('Please enter hourly rate');
			return;
		} else if (salaryType === 'daily' && !salaryPreview.daily_rate) {
			setPreviewError('Please enter daily rate');
			return;
		} else if (salaryType === 'contract' && !salaryPreview.contract_amount) {
			setPreviewError('Please enter contract amount');
			return;
		} else if (salaryType === 'lumpsum' && !salaryPreview.lumpsum_amount) {
			setPreviewError('Please enter lumpsum amount');
			return;
		} else if (salaryType === 'custom' && !salaryPreview.custom_ctc) {
			setPreviewError('Please enter CTC amount');
			return;
		}

		setSalaryProfileSaving(true);
		setPreviewError('');
		setSalaryProfileSuccess('');

		try {
			const currentDate = new Date().toISOString().split('T')[0];
			const currentYear = new Date().getFullYear();

			// Build payload based on salary type
			// Include id if we're editing an existing profile
			let payload = {
				...(editingSalaryProfileId ? { id: editingSalaryProfileId } : {}),
				employee_id: selectedEmployee.id,
				salary_type: salaryType,
				effective_from: salaryPreview.effective_from || currentDate,
				effective_to: salaryPreview.effective_to || null,
				da_year: currentYear,
				is_manual_override: profileHasOverrides,
				std_in_time: salaryPreview.std_in_time || '09:00',
				std_out_time: salaryPreview.std_out_time || '17:30',
				// Privilege Leave (PL) fields
				pl_total: parseInt(salaryPreview.pl_total) || 0,
				pl_used: parseInt(salaryPreview.pl_used) || 0,
				pl_balance: parseInt(salaryPreview.pl_balance) || 0,
				// Loan fields
				loan_amount: parseFloat(salaryPreview.loan_amount) || 0,
				loan_amount_per_month:
					parseFloat(salaryPreview.loan_amount_per_month) || 0,
				loan_no_of_months: parseInt(salaryPreview.loan_no_of_months) || 0,
				loan_total_amount: parseFloat(salaryPreview.loan_total_amount) || 0,
				loan_active: salaryPreview.loan_active,
				// Advance fields
				advance_amount: parseFloat(salaryPreview.advance_amount) || 0,
				advance_active: salaryPreview.advance_active,
			};

			if (salaryType === 'monthly') {
				payload = {
					...payload,
					gross_salary: parseFloat(salaryPreview.gross),
					other_allowances: parseFloat(salaryPreview.other_allowances) || 0,
					pf_applicable: salaryPreview.pf_applicable,
					esic_applicable: salaryPreview.esic_applicable,
					pt_applicable: salaryPreview.pt_applicable,
					mlwf_applicable: salaryPreview.mlwf_applicable,
					retention_applicable: salaryPreview.retention_applicable,
					bonus_applicable: salaryPreview.bonus_applicable,
					monthly_bonus: salaryPreview.monthly_bonus,
					incentive_applicable: salaryPreview.incentive_applicable,
					insurance_applicable: salaryPreview.insurance_applicable,
					// Persist only deliberate component exceptions. The calculation
					// boundary derives null components from the current schedule.
					basic: persistedOverride('basic'),
					basic_plus_da: null,
					da: persistedOverride('da'),
					basic_da_total: null, // Kept for API/client compatibility
					hra: persistedOverride('hra'),
					conveyance: persistedOverride('conveyance'),
					call_allowance: persistedOverride('call_allowance'),
					bonus: persistedOverride('bonus'),
					incentive: persistedOverride('incentive'),
					pf_employee: persistedOverride('pf_employee'),
					esic_employee: persistedOverride('esic_employee'),
					pt: persistedOverride('pt'),
					mlwf: persistedOverride('mlwf'),
					mlwf_employer: persistedOverride('mlwf_employer'),
					retention: persistedOverride('retention'),
					insurance: persistedOverride('insurance'),
					pf_employer: persistedOverride('pf_employer'),
					esic_employer: persistedOverride('esic_employer'),
					tds_percentage: persistedOverride('tds_percentage'),
					total_earnings: breakdown.total_earnings,
					total_deductions: breakdown.total_deductions,
					net_pay: breakdown.net_pay,
					employer_cost: breakdown.employer_cost,
				};
				console.log(
					'Monthly salary payload - employer_cost (CTC):',
					breakdown.employer_cost
				);
			} else if (salaryType === 'hourly') {
				const hourlyRate = parseFloat(salaryPreview.hourly_rate) || 0;
				const stdHours = parseFloat(salaryPreview.std_hours_per_day) || 8;
				const estimatedMonthly = hourlyRate * stdHours * 26;
				payload = {
					...payload,
					hourly_rate: hourlyRate,
					std_hours_per_day: stdHours,
					ot_multiplier: parseFloat(salaryPreview.ot_multiplier) || 1.5,
					gross_salary: estimatedMonthly,
					net_pay: estimatedMonthly,
					employer_cost: estimatedMonthly,
				};
			} else if (salaryType === 'daily') {
				const dailyRate = parseFloat(salaryPreview.daily_rate) || 0;
				const stdDays = parseFloat(salaryPreview.std_working_days) || 26;
				const estimatedMonthly = dailyRate * stdDays;
				payload = {
					...payload,
					daily_rate: dailyRate,
					std_working_days: stdDays,
					gross_salary: estimatedMonthly,
					net_pay: estimatedMonthly,
					employer_cost: estimatedMonthly,
				};
			} else if (salaryType === 'contract') {
				const contractAmount = parseFloat(salaryPreview.contract_amount) || 0;
				const tdsPercent = parseFloat(salaryPreview.tds_percentage) || 10;
				const tdsAmount = (contractAmount * tdsPercent) / 100;
				const netAfterTds = contractAmount - tdsAmount;
				payload = {
					...payload,
					contract_amount: contractAmount,
					contract_duration: salaryPreview.contract_duration || 'monthly',
					contract_end_date: salaryPreview.contract_end_date || null,
					tds_percentage: tdsPercent,
					gross_salary: contractAmount,
					net_pay: netAfterTds,
					employer_cost: contractAmount,
				};
			} else if (salaryType === 'lumpsum') {
				const lumpsumAmount = parseFloat(salaryPreview.lumpsum_amount) || 0;
				payload = {
					...payload,
					lumpsum_amount: lumpsumAmount,
					lumpsum_description: salaryPreview.lumpsum_description || '',
					gross_salary: lumpsumAmount,
					net_pay: lumpsumAmount,
					employer_cost: lumpsumAmount,
				};
			} else if (salaryType === 'custom') {
				const savedMlwfEmployee = salaryPreview.mlwf_applicable
					? parseFloat(salaryPreview.custom_mlwf) ||
						0 ||
						parseFloat(currentMLWF) ||
						PAYROLL_CONFIG.LWF_HALF_YEARLY
					: 0;
				const savedMlwfEmployer = salaryPreview.mlwf_applicable
					? parseFloat(salaryPreview.custom_mlwf_employer) ||
						0 ||
						parseFloat(currentMLWFEmployer) ||
						72
					: 0;

				// Keep custom totals consistent with UI cards.
				// Total CTC = Total Earnings + Employer Contributions.
				const employerContributions =
					(parseFloat(salaryPreview.custom_pf_employer) || 0) +
					(parseFloat(salaryPreview.custom_esic_employer) || 0) +
					savedMlwfEmployer +
					(parseFloat(salaryPreview.custom_bonus) || 0) +
					(parseFloat(salaryPreview.custom_insurance) || 0) +
					(salaryPreview.custom_components || [])
						.filter((c) => c.type === 'employer')
						.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

				// Calculate totals
				const totalEarnings =
					(parseFloat(salaryPreview.custom_basic) || 0) +
					(parseFloat(salaryPreview.custom_hra) || 0) +
					(parseFloat(salaryPreview.custom_conveyance) || 0) +
					(parseFloat(salaryPreview.custom_call_allowance) || 0) +
					(parseFloat(salaryPreview.custom_incentive) || 0) +
					(parseFloat(salaryPreview.custom_other_allowances) || 0);
				const totalCtc = totalEarnings + employerContributions;
				const grossSalary = totalEarnings;

				const totalDeductions =
					(parseFloat(salaryPreview.custom_pf_employee) || 0) +
					(parseFloat(salaryPreview.custom_esic_employee) || 0) +
					(parseFloat(salaryPreview.custom_pt) || 0) +
					savedMlwfEmployee +
					(parseFloat(salaryPreview.custom_retention) || 0);

				const netPay = totalEarnings - totalDeductions;

				payload = {
					...payload,
					salary_type: 'custom',
					// CTC and hourly rate
					employer_cost: totalCtc,
					hourly_rate: parseFloat(salaryPreview.custom_hourly_rate) || 0,
					std_hours_per_day:
						(parseFloat(salaryPreview.custom_monthly_hours) || 160) / 20, // Convert monthly hours to daily
					// Gross salary equals total earnings for custom profiles
					gross_salary: grossSalary,
					// Earnings breakdown
					basic: parseFloat(salaryPreview.custom_basic) || 0,
					basic_plus_da:
						(parseFloat(salaryPreview.custom_basic) || 0) +
						(parseFloat(salaryPreview.custom_da) || 0),
					da: parseFloat(salaryPreview.custom_da) || 0,
					hra: parseFloat(salaryPreview.custom_hra) || 0,
					conveyance: parseFloat(salaryPreview.custom_conveyance) || 0,
					call_allowance: parseFloat(salaryPreview.custom_call_allowance) || 0,
					incentive: parseFloat(salaryPreview.custom_incentive) || 0,
					other_allowances:
						parseFloat(salaryPreview.custom_other_allowances) || 0,
					// Employee deductions
					pf_employee: parseFloat(salaryPreview.custom_pf_employee) || 0,
					esic_employee: parseFloat(salaryPreview.custom_esic_employee) || 0,
					pt: parseFloat(salaryPreview.custom_pt) || 0,
					mlwf: savedMlwfEmployee,
					retention: parseFloat(salaryPreview.custom_retention) || 0,
					// Employer contributions
					pf_employer: parseFloat(salaryPreview.custom_pf_employer) || 0,
					esic_employer: parseFloat(salaryPreview.custom_esic_employer) || 0,
					mlwf_employer: savedMlwfEmployer,
					bonus: parseFloat(salaryPreview.custom_bonus) || 0,
					insurance: parseFloat(salaryPreview.custom_insurance) || 0,
					// Totals
					total_earnings: totalEarnings,
					total_deductions: totalDeductions,
					net_pay: netPay,
					// Store custom components and CTC in description
					lumpsum_description: JSON.stringify({
						ctc: totalCtc,
						monthly_hours:
							parseFloat(salaryPreview.custom_monthly_hours) || 160,
						custom_components: salaryPreview.custom_components || [],
					}),
				};
			}

			console.log('Sending salary profile:', payload);

			const res = await fetch('/api/payroll/salary-profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const data = await res.json();
			console.log('Response:', data);

			if (!res.ok) {
				throw new Error(data.error || 'Failed to save salary profile');
			}

			const isUpdate = !!editingSalaryProfileId;
			setSalaryProfileSuccess(
				isUpdate ? '✓ Salary profile updated!' : '✓ New salary profile created!'
			);

			// Refresh saved profiles to show the new/updated record
			const savedEmployeeId = selectedEmployee.id;
			invalidateInlineSalary(savedEmployeeId);
			await fetchSavedSalaryProfiles(savedEmployeeId);

			// Reset form after successful save
			handleResetSalaryForm();

			// Auto clear success message after 4 seconds
			setTimeout(() => setSalaryProfileSuccess(''), 4000);
		} catch (err) {
			console.error('Error saving salary profile:', err);
			setPreviewError('Failed to save: ' + err.message);
		} finally {
			setSalaryProfileSaving(false);
		}
	};

	// Fetch employees
	const fetchEmployees = useCallback(async () => {
		try {
			setLoading(true);
			setErrorMsg('');
			const s = (searchTerm || '').trim();
			const params = new URLSearchParams({
				page: currentPage,
				// Request a larger page size so the UI shows more employees (server caps at 100)
				limit: 100,
				...(s && { search: s }),
				...(selectedDepartment && { department: selectedDepartment }),
				...(selectedStatus && { status: selectedStatus }),
				...(selectedWorkplace && { workplace: selectedWorkplace }),
				...(selectedEmploymentStatus && {
					employment_status: selectedEmploymentStatus,
				}),
				...(employeeType && { employee_type: employeeType }),
				// Add cache buster to ensure fresh data
				_t: Date.now(),
			});
			// Add a client-side timeout to avoid hanging forever on network issues
			const controller = new AbortController();
			const t = setTimeout(() => controller.abort(), 12000);
			// Use optimized /api/employees/list endpoint for better TTFB
			// Use cache: 'no-store' to bypass browser cache and get fresh data
			const response = await fetch(`/api/employees/list?${params}`, {
				signal: controller.signal,
				cache: 'no-store',
			});
			clearTimeout(t);
			const data = await response.json();

			if (response.ok) {
				// Sort employees by numeric suffix in their employee_id (e.g., ATS001 -> 1)
				const sortByIdNumber = (a, b) => {
					const extract = (s) => {
						if (!s) return Number.POSITIVE_INFINITY;
						const m = String(s).match(/(\d+)$/);
						if (!m) return Number.POSITIVE_INFINITY;
						return Number(m[1]);
					};
					const na = extract(a.employee_id);
					const nb = extract(b.employee_id);
					if (na === nb) return 0;
					return na === Number.POSITIVE_INFINITY
						? 1
						: nb === Number.POSITIVE_INFINITY
							? -1
							: na - nb;
				};
				const sorted = Array.isArray(data.employees)
					? [...data.employees].sort(sortByIdNumber)
					: data.employees || [];
				setEmployees(sorted);
				setDepartments(data.departments);
				setWorkplaces(data.workplaces || []);
				setPagination(data.pagination);
			} else {
				console.error('Error fetching employees:', data.error);
				setErrorMsg(data.error || 'Failed to fetch employees');
			}
		} catch (error) {
			console.error('Error fetching employees:', error);
			setErrorMsg(error?.message || 'Failed to fetch employees');
		} finally {
			setLoading(false);
		}
	}, [
		currentPage,
		searchTerm,
		selectedDepartment,
		selectedStatus,
		selectedWorkplace,
		selectedEmploymentStatus,
		employeeType,
	]);

	useEffect(() => {
		fetchEmployees();
	}, [fetchEmployees]);

	const fetchAllEmployeesForSidebar = useCallback(async () => {
		try {
			const params = new URLSearchParams({
				page: 1,
				limit: 1000,
				...(employeeType && { employee_type: employeeType }),
				_t: Date.now(),
			});
			const response = await fetch(`/api/employees/list?${params}`, {
				cache: 'no-store',
			});
			const data = await response.json();
			if (!response.ok) return;

			const sortByIdNumber = (a, b) => {
				const extract = (value) => {
					if (!value) return Number.POSITIVE_INFINITY;
					const match = String(value).match(/(\d+)$/);
					return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
				};
				const first = extract(a.employee_id);
				const second = extract(b.employee_id);
				if (first === second) return 0;
				return first === Number.POSITIVE_INFINITY
					? 1
					: second === Number.POSITIVE_INFINITY
						? -1
						: first - second;
			};

			const sorted = Array.isArray(data.employees)
				? [...data.employees].sort(sortByIdNumber)
				: [];
			setAllEmployeesForSidebar(sorted);
		} catch (error) {
			console.error('Error fetching sidebar employees:', error);
		}
	}, [employeeType]);

	useEffect(() => {
		fetchAllEmployeesForSidebar();
	}, [fetchAllEmployeesForSidebar]);

	const addPageFilteredEmployees = useMemo(() => {
		const query = addPageEmployeeSearch.trim().toLowerCase();
		if (!query) return allEmployeesForSidebar;
		return allEmployeesForSidebar.filter((employee) => {
			const fullName =
				`${employee.first_name || ''} ${employee.last_name || ''}`.toLowerCase();
			return (
				fullName.includes(query) ||
				String(employee.employee_id || '')
					.toLowerCase()
					.includes(query) ||
				String(employee.email || '')
					.toLowerCase()
					.includes(query)
			);
		});
	}, [addPageEmployeeSearch, allEmployeesForSidebar]);

	// Compute next ATS id from current employees list (e.g. ATS001 -> ATS002)
	const nextAtsId = useMemo(() => {
		try {
			let max = 0;
			for (const e of employees || []) {
				const m = String(e.employee_id || '').match(/ATS0*(\d+)$/i);
				if (m) {
					const n = parseInt(m[1], 10);
					if (Number.isFinite(n)) max = Math.max(max, n);
				}
			}
			const next = String(max + 1).padStart(3, '0');
			return `ATS${next}`;
		} catch {
			return 'ATS001';
		}
	}, [employees]);

	// Load roles for System Role assignment
	useEffect(() => {
		const loadRoles = async () => {
			try {
				const res = await fetch('/api/roles-master');
				const json = await res.json();
				if (res.ok && json?.success) {
					setRoles(json.data || []);
				}
			} catch {}
		};
		loadRoles();
	}, []);

	// Load users from user master for username dropdown
	useEffect(() => {
		const loadUsers = async () => {
			try {
				const res = await fetch('/api/users?limit=1000');
				const json = await res.json();
				if (res.ok && json?.success) {
					setUsers(json.data || []);
				}
			} catch {}
		};
		loadUsers();
	}, []);

	// Load companies for deputation dropdown
	useEffect(() => {
		const loadCompanies = async () => {
			try {
				const res = await fetch('/api/companies');
				const json = await res.json();
				if (res.ok && json?.success) {
					setCompanies(json.data || []);
				}
			} catch {}
		};
		loadCompanies();
	}, []);

	// Clear success messages automatically after a short delay so setter is plainly used
	useEffect(() => {
		if (!successMessage) return undefined;
		const t = setTimeout(() => setSuccessMessage(''), 3000);
		return () => clearTimeout(t);
	}, [successMessage]);

	// Stable helper: update linked user's role if a user account exists for this employee
	const applySystemRoleToLinkedUser = useCallback(
		async (employeeDbId, roleId) => {
			try {
				if (!employeeDbId || !roleId) return;
				const response = await fetch(
					'/api/employees/available-for-users?include_with_users=true'
				);
				const json = await response.json();
				if (!response.ok || !json?.success) return;
				const record = (json.data || []).find(
					(r) => String(r.id) === String(employeeDbId)
				);
				const userId = record?.user_id;
				if (!userId) return;
				await fetch('/api/users', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: userId, role_id: Number(roleId) }),
				});
			} catch {}
		},
		[]
	);

	// No-op reference to ensure linter recognizes the helper as used (it is invoked conditionally elsewhere)
	useEffect(() => {
		if (typeof applySystemRoleToLinkedUser === 'function') {
			void applySystemRoleToLinkedUser;
		}
	}, [applySystemRoleToLinkedUser]);

	// Handle profile photo upload to /api/uploads
	const handleProfilePhotoChange = async (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			setPhotoUploading(true); // Client-side checks: ensure it's an image and within size limits (15 MB)
			const isImage = file.type && file.type.startsWith('image/');
			const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
			if (!isImage) {
				setFormErrors((prev) => ({
					...prev,
					general:
						'Please upload an image file (PNG, JPG, GIF, WebP, BMP, HEIC/HEIF, or SVG).',
				}));
				return;
			}
			if (file.size > MAX_BYTES) {
				setFormErrors((prev) => ({
					...prev,
					general: 'Image is too large. Please upload a file up to 15 MB.',
				}));
				return;
			}
			// Read file as base64
			const b64 = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
			const dataUrl = String(b64);
			const base64String = dataUrl.includes(',')
				? dataUrl.split(',')[1]
				: dataUrl;
			const uploadRes = await fetch('/api/uploads', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filename: file.name || 'upload.png',
					b64: base64String,
				}),
			});
			const data = await uploadRes.json();
			if (!uploadRes.ok || !data?.success) {
				throw new Error(data?.error || 'Upload failed');
			}
			const fileUrl = data?.data?.fileUrl;
			if (fileUrl) {
				setFormData((prev) => ({ ...prev, profile_photo_url: fileUrl }));
				// Also update selectedEmployee preview if present
				setSelectedEmployee((prev) =>
					prev ? { ...prev, profile_photo_url: fileUrl } : prev
				);
			}
		} catch (err) {
			console.error('Photo upload error:', err);
			setFormErrors((prev) => ({
				...prev,
				general: err?.message || 'Failed to upload photo. Please try again.',
			}));
		} finally {
			setPhotoUploading(false);
		}
	};

	const formatDate = (date) => {
		return date
			? new Date(date).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
				})
			: '-';
	};

	return (
		<AccessGuard resource="employees" permission="read" showNavbar={false}>
			<div className="min-h-screen bg-gray-50 flex flex-col overflow-hidden">
				<Navbar />
				<div className="flex-1 overflow-hidden">
					<div className="h-full overflow-y-auto">
						<div className="px-6 lg:px-8 xl:px-12 2xl:px-16 pt-24 pb-8 max-w-[1920px] mx-auto w-full">
							{/* Header */}
							<div className="mb-8 flex items-start justify-between gap-4">
								<div>
									<h1 className="text-3xl xl:text-4xl font-bold text-gray-900 mb-2 flex items-center">
										<UserGroupIcon className="h-8 w-8 xl:h-9 xl:w-9 mr-3 text-purple-600" />
										{employeeType
											? `${employeeType} Employees`
											: 'Add Employee'}
									</h1>
									<p className="text-gray-600 xl:text-lg">
										{employeeType
											? `Manage ${employeeType.toLowerCase()} employees`
											: 'Add a new employee to the system'}
									</p>
									{successMessage && (
										<div className="mt-2 text-sm text-green-600">
											{successMessage}
										</div>
									)}
								</div>
								<div className="flex-shrink-0 flex items-center gap-3">
									{employeeType && (
										<button
											onClick={() => {
												setActiveTab('add');
												setFormData({
													...defaultFormData,
													employee_type: employeeType,
												});
												setFormErrors({});
											}}
											className="inline-flex items-center space-x-2 bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-4 py-2.5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
										>
											<PlusIcon className="h-5 w-5" />
											<span>Add {employeeType} Employee</span>
										</button>
									)}
								</div>
							</div>

							{/* Content */}
							<div className="pb-8">
								{activeTab === 'list' && (
									<>
										{/* Filters */}
										<div className="bg-white shadow-lg rounded-xl border border-gray-200 p-6 mb-6">
											<div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
												{/* Search */}
												<div className="relative">
													<MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
													<input
														type="text"
														placeholder="Search employees..."
														value={searchTerm}
														onChange={(e) => {
															setSearchTerm(e.target.value);
															setCurrentPage(1);
														}}
														className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
													/>
												</div>

												{/* Department Filter */}
												<select
													value={selectedDepartment}
													onChange={(e) =>
														setSelectedDepartment(e.target.value)
													}
													className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
												>
													<option value="">All Departments</option>
													{departments.map((dept) => (
														<option key={dept} value={dept}>
															{dept}
														</option>
													))}
												</select>

												{/* Status Filter */}
												<select
													value={selectedStatus}
													onChange={(e) => setSelectedStatus(e.target.value)}
													className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
												>
													<option value="">All Status</option>
													<option value="active">Active</option>
													<option value="inactive">Inactive</option>
													<option value="terminated">Terminated</option>
												</select>

												{/* Employment Status Filter (Resigned/Employed) */}
												<select
													value={selectedEmploymentStatus}
													onChange={(e) =>
														setSelectedEmploymentStatus(e.target.value)
													}
													className="px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
												>
													<option value="">All Employees</option>
													<option value="employed">Employed</option>
													<option value="resigned">Resigned</option>
												</select>

												{/* Clear Filters */}
												<button
													onClick={() => {
														setSearchTerm('');
														setSelectedDepartment('');
														setSelectedStatus('');
														setSelectedWorkplace('');
														setSelectedEmploymentStatus('');
														setCurrentPage(1);
													}}
													className="px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center"
												>
													<FunnelIcon className="h-5 w-5 mr-2" />
													Clear Filters
												</button>
											</div>
										</div>

										{/* Payroll Actions Bar - only on Payroll page */}
										{employeeType === 'Payroll' && (
											<div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 animate-slide-up">
												<div className="flex flex-wrap items-center gap-3">
													{/* Month Picker */}
													<div className="flex items-center gap-2">
														<CalendarDaysIcon className="h-5 w-5 text-gray-500" />
														<input
															type="month"
															value={payrollMonth}
															onChange={(e) => setPayrollMonth(e.target.value)}
															className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
														/>
													</div>

													<div className="h-8 w-px bg-gray-200" />

													{/* Generate Payroll */}
													<button
														onClick={generatePayroll}
														disabled={generatingPayroll}
														className="flex items-center gap-2 px-4 py-2 bg-[#64126D] text-white text-sm font-medium rounded-lg hover:bg-[#86288F] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
													>
														<ArrowPathIcon
															className={`h-4 w-4 ${generatingPayroll ? 'animate-spin' : ''}`}
														/>
														{generatingPayroll
															? 'Generating...'
															: 'Generate Payroll'}
													</button>

													{/* Export Salary Slip PDF */}
													<button
														onClick={exportSalarySlipPdf}
														disabled={exportingSlipPdf}
														className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
													>
														<DocumentTextIcon
															className={`h-4 w-4 ${exportingSlipPdf ? 'animate-pulse' : ''}`}
														/>
														{exportingSlipPdf
															? 'Exporting...'
															: 'Salary Slip (PDF)'}
													</button>

													{/* Export Salary Sheet Excel */}
													<button
														onClick={exportSalarySheetExcel}
														disabled={exportingSheetExcel}
														className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
													>
														<TableCellsIcon
															className={`h-4 w-4 ${exportingSheetExcel ? 'animate-pulse' : ''}`}
														/>
														{exportingSheetExcel
															? 'Exporting...'
															: 'Salary Sheet (Excel)'}
													</button>

													{/* Export Salary Structures Excel (All Users) */}
													<button
														onClick={exportAllSalaryStructuresExcel}
														disabled={exportingAllSalaryStructuresExcel}
														className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
													>
														<DocumentArrowDownIcon
															className={`h-4 w-4 ${exportingAllSalaryStructuresExcel ? 'animate-pulse' : ''}`}
														/>
														{exportingAllSalaryStructuresExcel
															? 'Exporting...'
															: 'Salary Structure (All Users)'}
													</button>

													{/* Status Message */}
													{payrollMessage.text && (
														<span
															className={`text-sm font-medium ml-auto ${
																payrollMessage.type === 'success'
																	? 'text-emerald-600'
																	: 'text-red-600'
															}`}
														>
															{payrollMessage.text}
														</span>
													)}
												</div>
											</div>
										)}

										{/* Employee Table */}
										<div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden animate-slide-up">
											{loading ? (
												<div className="p-6">
													<div className="space-y-4">
														{[...Array(6)].map((_, i) => (
															<div
																key={i}
																className="skeleton h-12 w-full rounded-lg"
															></div>
														))}
													</div>
												</div>
											) : errorMsg ? (
												<div className="p-6 text-center">
													<div className="mb-2 text-red-700 bg-red-50 border border-red-200 inline-block px-3 py-2 rounded">
														{errorMsg}
													</div>
													<div>
														<button
															onClick={fetchEmployees}
															className="mt-2 inline-flex items-center px-4 py-2 rounded-lg bg-[#64126D] text-white"
														>
															Retry
														</button>
													</div>
												</div>
											) : employees.length === 0 ? (
												<div className="text-center py-16">
													<UserGroupIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
													<h3 className="text-lg font-medium text-gray-600 mb-2">
														No {employeeType ? employeeType.toLowerCase() : ''}{' '}
														employees yet
													</h3>
													<p className="text-gray-500 mb-6">
														Get started by adding your first{' '}
														{employeeType ? employeeType.toLowerCase() : ''}{' '}
														employee
													</p>
													<button
														onClick={() => {
															setActiveTab('add');
															if (employeeType)
																setFormData({
																	...defaultFormData,
																	employee_type: employeeType,
																});
														}}
														className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl inline-flex items-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
													>
														<PlusIcon className="h-5 w-5" />
														<span>
															Add Your First {employeeType || ''} Employee
														</span>
													</button>
												</div>
											) : (
												<>
													<div className="overflow-x-auto">
														<div className="max-h-[calc(100vh-320px)] overflow-y-auto">
															<table className="min-w-full divide-y divide-gray-200">
																<thead className="bg-gradient-to-r from-gray-50 to-gray-100">
																	<tr>
																		<th className="px-3 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100 w-28">
																			Employee ID
																		</th>
																		<th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Employee
																		</th>
																		<th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Department
																		</th>
																		<th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Position
																		</th>
																		<th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Branch
																		</th>
																		<th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Hire Date
																		</th>
																		<th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Status
																		</th>
																		<th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 z-20 bg-gradient-to-r from-gray-50 to-gray-100">
																			Actions
																		</th>
																	</tr>
																</thead>
																<tbody className="bg-white divide-y divide-gray-200">
																	{employees.map((employee) => (
																		<React.Fragment key={employee.id}>
																			<tr className="hover:bg-gray-50 transition-colors duration-200 motion-safe:hover:scale-[1.01]">
																				<td className="px-3 py-4 whitespace-nowrap w-28">
																					<div className="text-sm font-medium text-[#64126D] truncate">
																						{employee.employee_id}
																					</div>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap">
																					<div className="flex items-center">
																						<Avatar
																							src={employee.profile_photo_url}
																							firstName={employee.first_name}
																							lastName={employee.last_name}
																							size={48}
																						/>
																						<div className="ml-4">
																							<div className="text-sm font-medium text-gray-900">
																								{employee.first_name}{' '}
																								{employee.last_name}
																							</div>
																							<div className="text-sm text-gray-500">
																								{employee.email}
																							</div>
																						</div>
																					</div>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap">
																					<div className="text-sm text-gray-900">
																						{employee.department || '-'}
																					</div>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap">
																					<div className="text-sm text-gray-900">
																						{employee.position || '-'}
																					</div>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap">
																					<div className="text-sm text-gray-900">
																						{employee.workplace || '-'}
																					</div>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap">
																					<div className="text-sm text-gray-900">
																						{formatDate(employee.hire_date)}
																					</div>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap">
																					<span
																						className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
																							employee.status === 'active'
																								? 'bg-green-300 text-black'
																								: employee.status === 'inactive'
																									? 'bg-yellow-100 text-yellow-800'
																									: 'bg-red-300 text-red-800'
																						}`}
																					>
																						{employee.status}
																					</span>
																				</td>
																				<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
																					<div className="flex space-x-2 justify-end">
																						{employeeType === 'Payroll' && (
																							<button
																								onClick={() =>
																									toggleInlineSalary(
																										employee.id
																									)
																								}
																								className={`p-2 rounded-lg transition-colors ${
																									expandedSalaryId ===
																									employee.id
																										? 'text-white bg-[#64126D]'
																										: 'text-green-600 hover:text-green-900 hover:bg-green-50'
																								}`}
																								title="View Salary Structure"
																							>
																								<CurrencyRupeeIcon className="h-4 w-4" />
																							</button>
																						)}
																						<button
																							onClick={() =>
																								openViewForm(employee)
																							}
																							className="text-purple-600 hover:text-purple-900 p-2 rounded-lg hover:bg-purple-50 transition-colors"
																							title="View Details"
																						>
																							<EyeIcon className="h-4 w-4" />
																						</button>
																						<button
																							onClick={() =>
																								openEditForm_safe(employee)
																							}
																							className="text-blue-600 hover:text-blue-900 p-2 rounded-lg hover:bg-blue-50 transition-colors"
																							title="Edit Employee"
																						>
																							<PencilIcon className="h-4 w-4" />
																						</button>
																						<button
																							onClick={() =>
																								handleDelete(employee)
																							}
																							className="text-red-600 hover:text-red-900 p-2 rounded-lg hover:bg-red-50 transition-colors"
																							title="Delete Employee"
																						>
																							<TrashIcon className="h-4 w-4" />
																						</button>
																					</div>
																				</td>
																			</tr>
																			{/* Inline Salary Structure Row */}
																			{employeeType === 'Payroll' &&
																				expandedSalaryId === employee.id && (
																					<tr className="bg-purple-50/50">
																						<td
																							colSpan="8"
																							className="px-6 py-4"
																						>
																							{inlineSalaryLoading ===
																							employee.id ? (
																								<div className="flex items-center justify-center py-6 space-x-2">
																									<svg
																										className="animate-spin h-5 w-5 text-purple-600"
																										xmlns="http://www.w3.org/2000/svg"
																										fill="none"
																										viewBox="0 0 24 24"
																									>
																										<circle
																											className="opacity-25"
																											cx="12"
																											cy="12"
																											r="10"
																											stroke="currentColor"
																											strokeWidth="4"
																										></circle>
																										<path
																											className="opacity-75"
																											fill="currentColor"
																											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
																										></path>
																									</svg>
																									<span className="text-sm text-gray-500">
																										Loading salary structure...
																									</span>
																								</div>
																							) : !inlineSalaryData[employee.id]
																									?.profile ? (
																								<div className="text-center py-4">
																									<p className="text-gray-500 text-sm mb-2">
																										No salary structure found
																										for this employee.
																									</p>
																									<button
																										onClick={() => {
																											openEditForm_safe(
																												employee
																											);
																										}}
																										className="text-sm text-purple-600 hover:text-purple-800 font-medium"
																									>
																										+ Add Salary Structure
																									</button>
																								</div>
																							) : (
																								(() => {
																									const p =
																										inlineSalaryData[
																											employee.id
																										].profile;
																									const cd =
																										inlineSalaryData[
																											employee.id
																										].customData;
																									const customComponents =
																										cd?.custom_components || [];
																									const customComponentsTotal =
																										customComponents.reduce(
																											(sum, c) =>
																												sum +
																												(parseFloat(c.amount) ||
																													0),
																											0
																										);
																									const loanEMI =
																										p.loan_active &&
																										parseFloat(
																											p.loan_amount_per_month
																										) > 0
																											? parseFloat(
																													p.loan_amount_per_month
																												) || 0
																											: 0;
																									const advanceAmt =
																										p.advance_active &&
																										parseFloat(
																											p.advance_amount
																										) > 0
																											? parseFloat(
																													p.advance_amount
																												) || 0
																											: 0;
																									const basicDaTotal =
																										parseFloat(
																											p.basic_da_total
																										) ||
																										(parseFloat(p.basic) || 0) +
																											(parseFloat(p.da) || 0);
																									const totalEarnings =
																										basicDaTotal +
																										(parseFloat(p.hra) || 0) +
																										(parseFloat(p.conveyance) ||
																											0) +
																										(parseFloat(
																											p.call_allowance
																										) || 0) +
																										(parseFloat(p.incentive) ||
																											0) +
																										(parseFloat(
																											p.other_allowances
																										) || 0) +
																										(parseFloat(p.bonus) || 0) +
																										customComponentsTotal;
																									const totalDeductions =
																										(parseFloat(
																											p.pf_employee
																										) || 0) +
																										(parseFloat(
																											p.esic_employee
																										) || 0) +
																										(parseFloat(p.pt) || 0) +
																										(parseFloat(p.mlwf) || 0) +
																										(parseFloat(p.retention) ||
																											0) +
																										(parseFloat(p.tds) || 0) +
																										loanEMI +
																										advanceAmt;
																									const totalEmployer =
																										(parseFloat(
																											p.pf_employer
																										) || 0) +
																										(parseFloat(
																											p.esic_employer
																										) || 0) +
																										(parseFloat(
																											p.mlwf_employer
																										) || 0) +
																										(parseFloat(p.insurance) ||
																											0);
																									const netPay =
																										totalEarnings -
																										totalDeductions;
																									const hasLoan =
																										p.loan_active &&
																										parseFloat(
																											p.loan_amount_per_month
																										) > 0;
																									const hasAdvance =
																										p.advance_active &&
																										parseFloat(
																											p.advance_amount
																										) > 0;
																									return (
																										<div className="space-y-3">
																											{/* Summary Cards */}
																											<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
																												<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
																													<p className="text-[10px] text-yellow-600 font-medium uppercase">
																														Hourly Rate
																													</p>
																													<p className="text-lg font-bold text-yellow-800">
																														₹
																														{formatCurrency(
																															parseFloat(
																																p.hourly_rate
																															) || 0
																														)}
																													</p>
																												</div>
																												<div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
																													<p className="text-[10px] text-blue-600 font-medium uppercase">
																														CTC
																													</p>
																													<p className="text-lg font-bold text-blue-800">
																														₹
																														{formatCurrency(
																															parseFloat(
																																cd?.ctc ||
																																	p.employer_cost
																															) || 0
																														)}
																													</p>
																												</div>
																												<div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
																													<p className="text-[10px] text-green-600 font-medium uppercase">
																														Total Earnings
																													</p>
																													<p className="text-lg font-bold text-green-800">
																														₹
																														{formatCurrency(
																															totalEarnings
																														)}
																													</p>
																												</div>
																												<div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
																													<p className="text-[10px] text-red-600 font-medium uppercase">
																														Total Deductions
																													</p>
																													<p className="text-lg font-bold text-red-800">
																														₹
																														{formatCurrency(
																															totalDeductions
																														)}
																													</p>
																												</div>
																												<div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
																													<p className="text-[10px] text-purple-600 font-medium uppercase">
																														Net Pay
																													</p>
																													<p className="text-lg font-bold text-purple-800">
																														₹
																														{formatCurrency(
																															netPay
																														)}
																													</p>
																												</div>
																											</div>
																											{/* Detail Columns */}
																											<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
																												{/* Earnings */}
																												<div className="bg-green-50 border border-green-200 rounded-lg p-3">
																													<h6 className="text-xs font-semibold text-green-800 mb-2">
																														Earnings
																													</h6>
																													<div className="space-y-1 text-sm">
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Basic + DA
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	basicDaTotal
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																HRA
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.hra
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Conveyance
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.conveyance
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Call Allowance
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.call_allowance
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Incentive
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.incentive
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Other Allowances
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.other_allowances
																																	) || 0
																																)}
																															</span>
																														</div>
																														{(parseFloat(
																															p.bonus
																														) || 0) > 0 && (
																															<div className="flex justify-between">
																																<span className="text-gray-600">
																																	Bonus
																																</span>
																																<span className="font-medium">
																																	₹
																																	{formatCurrency(
																																		parseFloat(
																																			p.bonus
																																		) || 0
																																	)}
																																</span>
																															</div>
																														)}
																														{customComponents.map(
																															(comp, idx) => (
																																<div
																																	key={idx}
																																	className="flex justify-between"
																																>
																																	<span className="text-gray-600">
																																		{comp.name ||
																																			`Custom ${idx + 1}`}
																																	</span>
																																	<span className="font-medium">
																																		₹
																																		{formatCurrency(
																																			parseFloat(
																																				comp.amount
																																			) || 0
																																		)}
																																	</span>
																																</div>
																															)
																														)}
																														<div className="border-t border-green-300 pt-1 mt-1 flex justify-between font-semibold text-green-900">
																															<span>Total</span>
																															<span>
																																₹
																																{formatCurrency(
																																	totalEarnings
																																)}
																															</span>
																														</div>
																													</div>
																												</div>
																												{/* Deductions */}
																												<div className="bg-red-50 border border-red-200 rounded-lg p-3">
																													<h6 className="text-xs font-semibold text-red-800 mb-2">
																														Deductions
																													</h6>
																													<div className="space-y-1 text-sm">
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																PF (Employee)
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.pf_employee
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																ESIC (Employee)
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.esic_employee
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																PT
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.pt
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																MLWF
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.mlwf
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Retention
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.retention
																																	) || 0
																																)}
																															</span>
																														</div>
																														{(parseFloat(
																															p.tds
																														) || 0) > 0 && (
																															<div className="flex justify-between">
																																<span className="text-gray-600">
																																	TDS
																																</span>
																																<span className="font-medium">
																																	₹
																																	{formatCurrency(
																																		parseFloat(
																																			p.tds
																																		) || 0
																																	)}
																																</span>
																															</div>
																														)}
																														{loanEMI > 0 && (
																															<div className="flex justify-between">
																																<span className="text-gray-600">
																																	Loan EMI
																																</span>
																																<span className="font-medium">
																																	₹
																																	{formatCurrency(
																																		loanEMI
																																	)}
																																</span>
																															</div>
																														)}
																														{advanceAmt > 0 && (
																															<div className="flex justify-between">
																																<span className="text-gray-600">
																																	Advance
																																</span>
																																<span className="font-medium">
																																	₹
																																	{formatCurrency(
																																		advanceAmt
																																	)}
																																</span>
																															</div>
																														)}
																														<div className="border-t border-red-300 pt-1 mt-1 flex justify-between font-semibold text-red-900">
																															<span>Total</span>
																															<span>
																																₹
																																{formatCurrency(
																																	totalDeductions
																																)}
																															</span>
																														</div>
																														<div className="border-t-2 border-green-400 pt-1 mt-1 flex justify-between font-bold text-green-700">
																															<span>
																																Net Pay
																															</span>
																															<span>
																																₹
																																{formatCurrency(
																																	netPay
																																)}
																															</span>
																														</div>
																													</div>
																												</div>
																												{/* Employer Costs */}
																												<div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
																													<h6 className="text-xs font-semibold text-blue-800 mb-2">
																														Employer / CTC
																													</h6>
																													<div className="space-y-1 text-sm">
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																PF (Employer)
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.pf_employer
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																ESIC (Employer)
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.esic_employer
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																MLWF (Employer)
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.mlwf_employer
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="flex justify-between">
																															<span className="text-gray-600">
																																Insurance
																															</span>
																															<span className="font-medium">
																																₹
																																{formatCurrency(
																																	parseFloat(
																																		p.insurance
																																	) || 0
																																)}
																															</span>
																														</div>
																														<div className="border-t border-blue-300 pt-1 mt-1 flex justify-between font-semibold text-blue-900">
																															<span>
																																Total Employer
																															</span>
																															<span>
																																₹
																																{formatCurrency(
																																	totalEmployer
																																)}
																															</span>
																														</div>
																														<div className="border-t border-blue-300 pt-1 mt-1 flex justify-between font-bold text-blue-900">
																															<span>CTC</span>
																															<span>
																																₹
																																{formatCurrency(
																																	totalEarnings +
																																		totalEmployer
																																)}
																															</span>
																														</div>
																													</div>
																												</div>
																											</div>
																											{/* Loan & Advance details */}
																											{(hasLoan ||
																												hasAdvance) && (
																												<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																													{hasLoan && (
																														<div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
																															<h6 className="text-xs font-semibold text-amber-800 mb-2">
																																Loan{' '}
																																<span className="text-amber-500 font-normal text-[10px]">
																																	(included in
																																	deductions)
																																</span>
																															</h6>
																															<div className="space-y-1 text-sm">
																																<div className="flex justify-between">
																																	<span className="text-gray-600">
																																		Total Loan
																																	</span>
																																	<span className="font-medium">
																																		₹
																																		{formatCurrency(
																																			parseFloat(
																																				p.loan_amount
																																			) || 0
																																		)}
																																	</span>
																																</div>
																																<div className="flex justify-between">
																																	<span className="text-gray-600">
																																		EMI / Month
																																	</span>
																																	<span className="font-medium text-amber-700">
																																		₹
																																		{formatCurrency(
																																			parseFloat(
																																				p.loan_amount_per_month
																																			) || 0
																																		)}
																																	</span>
																																</div>
																																<div className="flex justify-between">
																																	<span className="text-gray-600">
																																		Duration
																																	</span>
																																	<span className="font-medium">
																																		{p.loan_no_of_months ||
																																			'-'}{' '}
																																		months
																																	</span>
																																</div>
																															</div>
																														</div>
																													)}
																													{hasAdvance && (
																														<div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
																															<h6 className="text-xs font-semibold text-orange-800 mb-2">
																																Advance{' '}
																																<span className="text-orange-500 font-normal text-[10px]">
																																	(included in
																																	deductions)
																																</span>
																															</h6>
																															<div className="space-y-1 text-sm">
																																<div className="flex justify-between">
																																	<span className="text-gray-600">
																																		Advance
																																		Amount
																																	</span>
																																	<span className="font-medium text-orange-700">
																																		₹
																																		{formatCurrency(
																																			parseFloat(
																																				p.advance_amount
																																			) || 0
																																		)}
																																	</span>
																																</div>
																															</div>
																														</div>
																													)}
																												</div>
																											)}
																											{/* PL Balance */}
																											{p.pl_total != null && (
																												<div className="flex items-center gap-4 text-sm text-gray-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
																													<span className="font-medium text-indigo-800">
																														Privilege Leave:
																													</span>
																													<span>
																														Total:{' '}
																														{p.pl_total || 21}
																													</span>
																												</div>
																											)}
																											{/* Effective dates & edit link */}
																											<div className="flex items-center justify-between text-xs text-gray-500 pt-1">
																												<span>
																													Effective:{' '}
																													{p.effective_from
																														? new Date(
																																p.effective_from
																															).toLocaleDateString(
																																'en-IN'
																															)
																														: 'N/A'}
																													{p.effective_to
																														? ` → ${new Date(p.effective_to).toLocaleDateString('en-IN')}`
																														: ' → Ongoing'}
																												</span>
																												<button
																													onClick={() => {
																														openEditForm_safe(
																															employee
																														);
																													}}
																													className="text-purple-600 hover:text-purple-800 font-medium"
																												>
																													Edit Salary Structure
																													→
																												</button>
																											</div>
																										</div>
																									);
																								})()
																							)}
																						</td>
																					</tr>
																				)}
																		</React.Fragment>
																	))}
																</tbody>
															</table>
														</div>
													</div>

													{/* Pagination */}
													{pagination.total > 1 && (
														<div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
															<div className="flex-1 flex justify-between sm:hidden">
																<button
																	onClick={() =>
																		setCurrentPage(currentPage - 1)
																	}
																	disabled={currentPage === 1}
																	className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
																>
																	Previous
																</button>
																<button
																	onClick={() =>
																		setCurrentPage(currentPage + 1)
																	}
																	disabled={currentPage === pagination.total}
																	className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
																>
																	Next
																</button>
															</div>
															<div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
																<div>
																	<p className="text-sm text-gray-700">
																		Showing{' '}
																		<span className="font-medium">
																			{(currentPage - 1) * pagination.limit + 1}
																		</span>{' '}
																		to{' '}
																		<span className="font-medium">
																			{Math.min(
																				currentPage * pagination.limit,
																				pagination.totalRecords
																			)}
																		</span>{' '}
																		of{' '}
																		<span className="font-medium">
																			{pagination.totalRecords}
																		</span>{' '}
																		results
																	</p>
																</div>
																<div>
																	<nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
																		<button
																			onClick={() =>
																				setCurrentPage(currentPage - 1)
																			}
																			disabled={currentPage === 1}
																			className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
																		>
																			<ChevronLeftIcon className="h-5 w-5" />
																		</button>
																		<span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
																			{currentPage} of {pagination.total}
																		</span>
																		<button
																			onClick={() =>
																				setCurrentPage(currentPage + 1)
																			}
																			disabled={
																				currentPage === pagination.total
																			}
																			className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
																		>
																			<ChevronRightIcon className="h-5 w-5" />
																		</button>
																	</nav>
																</div>
															</div>
														</div>
													)}
												</>
											)}
										</div>
									</>
								)}

								{activeTab === 'add' && (
									<div className="grid grid-cols-12 gap-6">
										<aside className="col-span-12 lg:col-span-3">
											<div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden max-h-[calc(100vh-220px)] flex flex-col">
												<div className="px-4 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
													<div>
														<h2 className="text-base font-semibold text-gray-900 tracking-tight">
															EMPLOYEES
														</h2>
														<p className="text-xs text-gray-500">
															{allEmployeesForSidebar.length} Total
														</p>
													</div>
													<div className="relative mt-4">
														<input
															type="text"
															placeholder="Search employees"
															value={addPageEmployeeSearch}
															onChange={(e) =>
																setAddPageEmployeeSearch(e.target.value)
															}
															className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
														/>
														<svg
															className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
															viewBox="0 0 20 20"
															fill="currentColor"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387a1 1 0 01-1.414 1.414l-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z"
																clipRule="evenodd"
															/>
														</svg>
													</div>
												</div>
												<div className="overflow-y-auto">
													{addPageFilteredEmployees.map((emp) => (
														<div
															key={emp.id}
															className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
															onClick={() => openEditForm_safe(emp)}
														>
															<div className="flex items-center">
																<Avatar
																	src={emp.profile_photo_url}
																	firstName={emp.first_name}
																	lastName={emp.last_name}
																	size={44}
																/>
																<div className="ml-3 min-w-0">
																	<p className="text-sm font-medium text-gray-900 truncate">
																		{emp.first_name} {emp.last_name}
																	</p>
																	<p className="text-xs text-gray-500 truncate">
																		{emp.employee_id || emp.email}
																	</p>
																	<p className="text-xs text-gray-400 truncate">
																		{emp.email}
																	</p>
																</div>
															</div>
														</div>
													))}
													{addPageFilteredEmployees.length === 0 && (
														<div className="p-6 text-center text-sm text-gray-500">
															No employees found
														</div>
													)}
												</div>
											</div>
										</aside>

										{/* Right Pane: Add Employee form */}
										<section className="col-span-12 lg:col-span-9">
											<div className="bg-white shadow-lg rounded-xl border border-gray-200 p-6 lg:p-8 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
												<div className="flex items-center justify-between mb-4">
													<h3 className="text-2xl font-semibold text-gray-900">
														Add Employee
													</h3>
												</div>

												{/* Sub Tabs */}
												<div className="border-b border-gray-200 mb-6">
													<nav
														className="flex flex-wrap gap-4"
														aria-label="Employee Sections"
													>
														{[
															{
																key: 'personal',
																label: 'Personal Information',
															},
															{ key: 'contact', label: 'Contact Information' },
															{ key: 'work', label: 'Work Details' },
															{
																key: 'academic',
																label: 'Academic & Experience',
															},
															{ key: 'govt', label: 'Government IDs' },
															{ key: 'bank', label: 'Bank Details' },
															{ key: 'attendance', label: 'Attendance & Exit' },
														].map((t) => (
															<button
																key={t.key}
																type="button"
																onClick={() => setAddSubTab(t.key)}
																className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
																	addSubTab === t.key
																		? 'border-[#86288F] text-[#64126D]'
																		: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
																}`}
															>
																{t.label}
															</button>
														))}
													</nav>
												</div>

												{successMessage && (
													<div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
														{successMessage}
													</div>
												)}

												<form
													onSubmit={handleSubmit_safe}
													className="space-y-8"
												>
													{formErrors.general && (
														<div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
															{formErrors.general}
														</div>
													)}
													{/* Personal Information */}
													{addSubTab === 'personal' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Personal Information
															</h4>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div className="md:col-span-3 flex items-center gap-4">
																	<div className="relative">
																		<Avatar
																			src={formData.profile_photo_url}
																			firstName={formData.first_name}
																			lastName={formData.last_name}
																			size={80}
																		/>
																	</div>
																	<div>
																		<label className="block text-sm font-medium text-gray-700 mb-1">
																			Profile Photo
																		</label>
																		<input
																			type="file"
																			accept="image/*,.heic,.heif,.bmp"
																			onChange={handleProfilePhotoChange_safe}
																			className="block text-sm text-gray-600"
																		/>
																		{photoUploading && (
																			<p className="text-xs text-purple-600 mt-1">
																				Uploading...
																			</p>
																		)}
																	</div>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		First Name{' '}
																		<span className="text-red-500">*</span>
																	</label>
																	<input
																		type="text"
																		value={formData.first_name || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				first_name: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																		required
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Middle Name
																	</label>
																	<input
																		type="text"
																		value={formData.middle_name || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				middle_name: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Last Name{' '}
																		<span className="text-red-500">*</span>
																	</label>
																	<input
																		type="text"
																		value={formData.last_name || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				last_name: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																		required
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Employee ID{' '}
																		<span className="text-red-500">*</span>
																	</label>
																	<div className="flex items-center gap-2">
																		<input
																			type="text"
																			value={formData.employee_id || ''}
																			onChange={(e) =>
																				setFormData({
																					...formData,
																					employee_id: e.target.value,
																				})
																			}
																			className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			required
																		/>
																		<button
																			type="button"
																			className="px-3 py-2 bg-gray-100 text-sm rounded-lg border border-gray-200 hover:bg-gray-200"
																			onClick={() =>
																				setFormData({
																					...formData,
																					employee_id: nextAtsId,
																				})
																			}
																			title="Auto-fill next ATS id"
																		>
																			Auto-fill
																		</button>
																	</div>
																	<p className="text-xs text-gray-400 mt-1">
																		Next ATS:{' '}
																		<span className="font-medium text-[#64126D]">
																			{nextAtsId}
																		</span>
																	</p>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Username (from User Master)
																	</label>
																	<select
																		value={formData.username || ''}
																		onChange={(e) => {
																			const selectedUser = users.find(
																				(u) => u.username === e.target.value
																			);
																			setFormData({
																				...formData,
																				username: e.target.value,
																				user_id: selectedUser?.id || null,
																			});
																		}}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
																	>
																		<option value="">Select user</option>
																		{users
																			.filter(
																				(u) =>
																					!u.employee_id ||
																					u.employee_id === formData.id
																			)
																			.map((u) => (
																				<option key={u.id} value={u.username}>
																					{u.username}{' '}
																					{u.full_name
																						? `(${u.full_name})`
																						: ''}
																				</option>
																			))}
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		System Role
																	</label>
																	<select
																		value={formData.system_role_id || ''}
																		onChange={(e) => {
																			const nextId = e.target.value;
																			const picked = roles.find(
																				(r) => String(r.id) === String(nextId)
																			);
																			setFormData({
																				...formData,
																				system_role_id: nextId,
																				role: picked ? picked.role_name : '',
																				system_role_name: picked
																					? picked.role_name
																					: '',
																			});
																		}}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
																	>
																		<option value="">Select a role</option>
																		{roles.map((r) => (
																			<option key={r.id} value={r.id}>
																				{r.role_name}
																			</option>
																		))}
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Company
																	</label>
																	<select
																		value={
																			formData.company_name ||
																			'Accent Techno Solutions Pvt Ltd'
																		}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				company_name: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
																	>
																		<option value="Accent Techno Solutions Pvt Ltd">
																			Accent Techno Solutions Pvt Ltd
																		</option>
																		{companies
																			.filter(
																				(c) =>
																					c.company_name !==
																					'Accent Techno Solutions Pvt Ltd'
																			)
																			.map((company) => (
																				<option
																					key={company.id}
																					value={company.company_name}
																				>
																					{company.company_name}
																				</option>
																			))}
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Gender
																	</label>
																	<select
																		value={formData.gender || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				gender: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	>
																		<option value="">Select</option>
																		<option value="Male">Male</option>
																		<option value="Female">Female</option>
																		<option value="Other">Other</option>
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Date of Birth
																	</label>
																	<input
																		type="date"
																		value={formData.dob || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				dob: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Marital Status
																	</label>
																	<select
																		value={formData.marital_status || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				marital_status: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	>
																		<option value="">Select</option>
																		<option value="Single">Single</option>
																		<option value="Married">Married</option>
																		<option value="Other">Divorced</option>
																		<option value="Other">Widowed</option>
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Status{' '}
																		<span className="text-red-500">*</span>
																	</label>
																	<select
																		value={
																			formData.employment_status || 'active'
																		}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				employment_status: e.target.value,
																				status: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																		required
																	>
																		<option value="active">Active</option>
																		<option value="inactive">Inactive</option>
																		<option value="terminated">
																			Terminated
																		</option>
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Branch
																	</label>
																	<select
																		value={formData.workplace || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				workplace: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	>
																		<option value="">Select Branch</option>
																		<option value="Malvan">Malvan</option>
																		<option value="Mumbai">Mumbai</option>
																	</select>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Employee Type
																	</label>
																	<select
																		value={formData.employee_type || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				employee_type: e.target.value,
																				deputation_company_id:
																					e.target.value !== 'Deputation'
																						? ''
																						: formData.deputation_company_id,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	>
																		<option value="">Select</option>
																		<option value="Payroll">Payroll</option>
																		<option value="Contract">Contract</option>
																		<option value="Deputation">
																			Deputation
																		</option>
																	</select>
																</div>
																{formData.employee_type === 'Deputation' && (
																	<div>
																		<label className="block text-sm font-medium text-gray-700 mb-2">
																			Company Name *
																		</label>
																		<select
																			value={
																				formData.deputation_company_id || ''
																			}
																			onChange={(e) =>
																				setFormData({
																					...formData,
																					deputation_company_id: e.target.value,
																				})
																			}
																			className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																		>
																			<option value="">Select Company</option>
																			{companies.map((company) => (
																				<option
																					key={company.id}
																					value={company.id}
																				>
																					{company.company_name}
																				</option>
																			))}
																		</select>
																	</div>
																)}
															</div>
														</div>
													)}

													{/* Contact Information */}
													{addSubTab === 'contact' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Contact Information
															</h4>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Email{' '}
																		<span className="text-red-500">*</span>
																	</label>
																	<input
																		type="email"
																		value={formData.email || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				email: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																		required
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Personal Email
																	</label>
																	<input
																		type="email"
																		value={formData.personal_email || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				personal_email: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Mobile
																	</label>
																	<input
																		type="tel"
																		value={formData.mobile || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				mobile: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div className="md:col-span-3">
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Present Address
																	</label>
																	<textarea
																		rows={3}
																		value={
																			formData.present_address ||
																			formData.address ||
																			''
																		}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				present_address: e.target.value,
																				address: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		City
																	</label>
																	<input
																		type="text"
																		value={formData.city || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				city: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		State
																	</label>
																	<input
																		type="text"
																		value={formData.state || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				state: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Country
																	</label>
																	<input
																		type="text"
																		value={formData.country || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				country: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		PIN
																	</label>
																	<input
																		type="text"
																		value={formData.pin || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				pin: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
															</div>
														</div>
													)}

													{/* Work Details */}
													{addSubTab === 'work' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Work Details
															</h4>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Department
																	</label>
																	<input
																		type="text"
																		value={formData.department || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				department: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Position
																	</label>
																	<input
																		type="text"
																		value={formData.position || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				position: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Grade
																	</label>
																	<input
																		type="text"
																		value={formData.grade || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				grade: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Workplace
																	</label>
																	<input
																		type="text"
																		value={formData.workplace || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				workplace: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Level
																	</label>
																	<input
																		type="text"
																		value={formData.level || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				level: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Smart Office Code
																	</label>
																	<input
																		type="text"
																		value={formData.smartoffice_code || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				smartoffice_code: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Reporting To
																	</label>
																	<input
																		type="text"
																		value={formData.reporting_to || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				reporting_to: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Hire Date
																	</label>
																	<input
																		type="date"
																		value={formData.hire_date || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				hire_date: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Joining Date
																	</label>
																	<input
																		type="date"
																		value={formData.joining_date || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				joining_date: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		PF No
																	</label>
																	<input
																		type="text"
																		value={formData.pf_no || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				pf_no: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
															</div>
														</div>
													)}

													{/* Statutory */}

													{/* Academic & Experience */}
													{addSubTab === 'academic' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Academic & Experience
															</h4>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Qualification
																	</label>
																	<input
																		type="text"
																		value={formData.qualification || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				qualification: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Institute
																	</label>
																	<input
																		type="text"
																		value={formData.institute || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				institute: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Passing Year
																	</label>
																	<input
																		type="text"
																		value={formData.passing_year || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				passing_year: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div className="md:col-span-3">
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Work Experience
																	</label>
																	<textarea
																		rows={2}
																		value={formData.work_experience || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				work_experience: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
															</div>
														</div>
													)}

													{/* Government IDs */}
													{addSubTab === 'govt' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Government IDs
															</h4>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		PAN
																	</label>
																	<input
																		type="text"
																		value={formData.pan || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				pan: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		AADHAR
																	</label>
																	<input
																		type="text"
																		value={formData.aadhar || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				aadhar: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Gratuity No
																	</label>
																	<input
																		type="text"
																		value={formData.gratuity_no || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				gratuity_no: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		UAN
																	</label>
																	<input
																		type="text"
																		value={formData.uan || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				uan: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		ESI No
																	</label>
																	<input
																		type="text"
																		value={formData.esi_no || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				esi_no: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
															</div>
														</div>
													)}

													{/* Bank Details */}
													{addSubTab === 'bank' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Bank Details
															</h4>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Bank Name
																	</label>
																	<input
																		type="text"
																		value={formData.bank_name || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				bank_name: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Branch
																	</label>
																	<input
																		type="text"
																		value={formData.bank_branch || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				bank_branch: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Account Holder Name
																	</label>
																	<input
																		type="text"
																		value={formData.account_holder_name || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				account_holder_name: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Account Number
																	</label>
																	<input
																		type="text"
																		value={formData.bank_account_no || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				bank_account_no: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		IFSC
																	</label>
																	<input
																		type="text"
																		value={formData.bank_ifsc || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				bank_ifsc: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
															</div>
														</div>
													)}

													{/* Attendance & Exit */}
													{addSubTab === 'attendance' && (
														<div>
															<h4 className="text-lg font-semibold text-gray-900 mb-3">
																Attendance & Exit
															</h4>
															<div className="text-center py-6 bg-gray-50 rounded-xl border border-gray-200 mb-4">
																<CalendarDaysIcon className="h-10 w-10 text-gray-300 mx-auto mb-2" />
																<p className="text-sm text-gray-500">
																	Attendance data will be available after saving
																	the employee
																</p>
															</div>
															<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																<div>
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Exit Date
																	</label>
																	<input
																		type="date"
																		value={formData.exit_date || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				exit_date: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
																<div className="md:col-span-3">
																	<label className="block text-sm font-medium text-gray-700 mb-2">
																		Exit Reason
																	</label>
																	<textarea
																		rows={2}
																		value={formData.exit_reason || ''}
																		onChange={(e) =>
																			setFormData({
																				...formData,
																				exit_reason: e.target.value,
																			})
																		}
																		className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																	/>
																</div>
															</div>
														</div>
													)}

													<div className="flex items-center justify-between pt-6 border-t border-gray-200">
														<div className="flex gap-3">
															<button
																type="button"
																onClick={() => {
																	const idx = addSubTabOrder.indexOf(addSubTab);
																	if (idx > 0)
																		setAddSubTab(addSubTabOrder[idx - 1]);
																}}
																disabled={
																	addSubTabOrder.indexOf(addSubTab) === 0
																}
																className="px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 disabled:opacity-50"
															>
																Previous
															</button>
															<button
																type="button"
																onClick={() => {
																	const idx = addSubTabOrder.indexOf(addSubTab);
																	if (idx < addSubTabOrder.length - 1)
																		setAddSubTab(addSubTabOrder[idx + 1]);
																}}
																disabled={
																	addSubTabOrder.indexOf(addSubTab) ===
																	addSubTabOrder.length - 1
																}
																className="px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 disabled:opacity-50"
															>
																Next
															</button>
														</div>
														<div className="flex gap-3">
															<button
																type="button"
																onClick={() =>
																	setActiveTab(employeeType ? 'list' : 'add')
																}
																className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
															>
																Cancel
															</button>
															<button
																type="submit"
																disabled={loading}
																className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
															>
																{loading ? 'Saving...' : 'Save Employee'}
															</button>
														</div>
													</div>
												</form>
											</div>
										</section>
									</div>
								)}

								{activeTab === 'edit' && selectedEmployee && (
									<div className="grid grid-cols-12 gap-6">
										{/* Left Pane: Employee list */}
										<aside className="col-span-12 lg:col-span-3">
											<div className="bg-white shadow-lg rounded-xl border border-gray-200 overflow-hidden max-h-[calc(100vh-220px)] flex flex-col">
												<div className="px-4 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
													<div className="flex items-center justify-between">
														<div>
															<h2 className="text-base font-semibold text-gray-900 tracking-tight">
																EMPLOYEE
															</h2>
															<p className="text-xs text-gray-500">
																{employees.length} Total
															</p>
														</div>
														<button
															onClick={() => setActiveTab('add')}
															className="h-8 px-3 rounded-lg text-white text-sm font-medium"
															style={{
																background:
																	'linear-gradient(135deg, #64126D 0%, #86288F 100%)',
															}}
															title="Add Employee"
														>
															Add
														</button>
													</div>
													<div className="relative mt-4">
														<input
															type="text"
															placeholder="Search"
															value={searchTerm}
															onChange={(e) => {
																setSearchTerm(e.target.value);
																setCurrentPage(1);
															}}
															className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
														/>
														<svg
															className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
															viewBox="0 0 20 20"
															fill="currentColor"
															aria-hidden="true"
														>
															<path
																fillRule="evenodd"
																d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387a1 1 0 01-1.414 1.414l-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z"
																clipRule="evenodd"
															/>
														</svg>
													</div>
												</div>
												<div className="overflow-y-auto">
													{employees.map((emp) => (
														<div
															key={emp.id}
															className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
																selectedEmployee?.id === emp.id
																	? 'bg-purple-50 border-purple-200'
																	: ''
															}`}
															onClick={() => openEditForm_safe(emp)}
														>
															<div className="flex items-center">
																<Avatar
																	src={emp.profile_photo_url}
																	firstName={emp.first_name}
																	lastName={emp.last_name}
																	size={44}
																/>
																<div className="ml-3 min-w-0">
																	<p className="text-sm font-medium text-gray-900 truncate">
																		{emp.first_name} {emp.last_name}
																	</p>
																	<p className="text-xs text-gray-500 truncate">
																		{emp.email}
																	</p>
																	<p className="text-xs text-gray-400">
																		Hired: {formatDate(emp.hire_date)}
																	</p>
																</div>
															</div>
														</div>
													))}
													{employees.length === 0 && (
														<div className="p-6 text-center text-sm text-gray-500">
															No employees found
														</div>
													)}
												</div>
											</div>
										</aside>

										{/* Right Pane: Edit Employee form */}
										<section className="col-span-12 lg:col-span-9">
											<div className="bg-white shadow-lg rounded-xl border border-gray-200 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
												{/* Edit Header */}
												<div className="px-6 lg:px-8 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-gray-50">
													<div className="flex items-center justify-between gap-6">
														<div className="flex items-center gap-4">
															<Avatar
																src={selectedEmployee.profile_photo_url}
																firstName={selectedEmployee.first_name}
																lastName={selectedEmployee.last_name}
																size={56}
															/>
															<div>
																<h3 className="text-2xl font-semibold">
																	Editing {selectedEmployee.first_name}{' '}
																	{selectedEmployee.last_name}
																</h3>
																<p className="text-sm mt-1">
																	Employee ID •{' '}
																	<span className="text-[#64126D] font-medium">
																		{selectedEmployee.employee_id}
																	</span>
																</p>
																<p className="text-sm">
																	{selectedEmployee.department || '—'}{' '}
																	{selectedEmployee.position
																		? `• ${selectedEmployee.position}`
																		: ''}
																</p>
															</div>
														</div>
														<div className="flex items-center gap-3">
															{/* Autosave Status Indicator */}
															{autoSaving && (
																<span className="text-sm text-blue-600 flex items-center gap-1">
																	<svg
																		className="w-4 h-4 animate-spin"
																		fill="none"
																		viewBox="0 0 24 24"
																	>
																		<circle
																			className="opacity-25"
																			cx="12"
																			cy="12"
																			r="10"
																			stroke="currentColor"
																			strokeWidth="4"
																		></circle>
																		<path
																			className="opacity-75"
																			fill="currentColor"
																			d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
																		></path>
																	</svg>
																	Saving...
																</span>
															)}
															{!autoSaving && lastAutoSave && (
																<span className="text-xs text-green-600 flex items-center gap-1">
																	<svg
																		className="w-3.5 h-3.5"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																	>
																		<path
																			strokeLinecap="round"
																			strokeLinejoin="round"
																			strokeWidth={2}
																			d="M5 13l4 4L19 7"
																		/>
																	</svg>
																	Saved
																</span>
															)}
															{/* Lock/Unlock Toggle */}
															<button
																type="button"
																onClick={() => setProfileLocked(!profileLocked)}
																className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-colors ${
																	profileLocked
																		? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
																		: 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
																}`}
																title={
																	profileLocked
																		? 'Click to unlock and enable editing'
																		: 'Click to lock and prevent changes'
																}
															>
																{profileLocked ? (
																	<>
																		<svg
																			className="w-5 h-5"
																			fill="none"
																			stroke="currentColor"
																			viewBox="0 0 24 24"
																		>
																			<path
																				strokeLinecap="round"
																				strokeLinejoin="round"
																				strokeWidth={2}
																				d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
																			/>
																		</svg>
																		Locked
																	</>
																) : (
																	<>
																		<svg
																			className="w-5 h-5"
																			fill="none"
																			stroke="currentColor"
																			viewBox="0 0 24 24"
																		>
																			<path
																				strokeLinecap="round"
																				strokeLinejoin="round"
																				strokeWidth={2}
																				d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
																			/>
																		</svg>
																		Unlocked
																	</>
																)}
															</button>
															<button
																type="button"
																onClick={() =>
																	setActiveTab(employeeType ? 'list' : 'add')
																}
																className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 transition-colors"
															>
																{employeeType ? 'Back to List' : 'Back'}
															</button>
														</div>
													</div>

													{/* Locked Banner */}
													{profileLocked && (
														<div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-3">
															<svg
																className="w-6 h-6 text-red-600 flex-shrink-0"
																fill="none"
																stroke="currentColor"
																viewBox="0 0 24 24"
															>
																<path
																	strokeLinecap="round"
																	strokeLinejoin="round"
																	strokeWidth={2}
																	d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
																/>
															</svg>
															<div>
																<p className="font-semibold text-red-800">
																	Profile is Locked
																</p>
																<p className="text-sm text-red-600">
																	All fields are read-only. Click the Locked
																	button to unlock and enable editing.
																</p>
															</div>
														</div>
													)}
												</div>
												<div className="p-6 lg:p-8">
													{/* Sub Tabs */}
													<div className="border-b border-gray-200 mb-6">
														<nav
															className="flex flex-wrap gap-4"
															aria-label="Employee Sections"
														>
															{[
																{
																	key: 'personal',
																	label: 'Personal Information',
																},
																{
																	key: 'contact',
																	label: 'Contact Information',
																},
																{ key: 'work', label: 'Work Details' },
																{ key: 'salary', label: 'Salary Structure' },
																{
																	key: 'academic',
																	label: 'Academic & Experience',
																},
																{ key: 'govt', label: 'Government IDs' },
																{ key: 'bank', label: 'Bank Details' },
																{
																	key: 'attendance',
																	label: 'Attendance & Exit',
																},
															].map((t) => (
																<button
																	key={t.key}
																	onClick={async () => {
																		// Autosave current tab data before switching (except when going to salary tab from another)
																		if (
																			editSubTab !== 'salary' &&
																			!profileLocked
																		) {
																			await autoSaveEmployee();
																		}
																		setEditSubTab(t.key);
																		if (
																			t.key === 'salary' &&
																			selectedEmployee?.id
																		) {
																			fetchSalaryStructures(
																				selectedEmployee.id
																			);
																			// Fetch saved salary profiles to load existing values
																			await fetchSavedSalaryProfiles(
																				selectedEmployee.id
																			);
																			// The fetchSavedSalaryProfiles function will load saved values if they exist
																		}
																	}}
																	className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
																		editSubTab === t.key
																			? 'border-purple-500 text-purple-600'
																			: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
																	}`}
																>
																	{t.label}
																</button>
															))}
														</nav>
													</div>

													<form
														onSubmit={handleSubmit_safe}
														className="space-y-8"
													>
														<fieldset
															disabled={profileLocked}
															style={
																profileLocked
																	? {
																			pointerEvents: 'none',
																			userSelect: 'none',
																		}
																	: {}
															}
															className={
																profileLocked
																	? 'opacity-60 cursor-not-allowed'
																	: ''
															}
														>
															{formErrors.general && (
																<div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
																	{formErrors.general}
																</div>
															)}

															{/* Personal Information */}
															{editSubTab === 'personal' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Personal Information
																	</h4>
																	<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																		<div className="md:col-span-3 flex items-center gap-4">
																			<div className="relative">
																				<Avatar
																					src={formData.profile_photo_url}
																					firstName={formData.first_name}
																					lastName={formData.last_name}
																					size={80}
																				/>
																			</div>
																			<div>
																				<label className="block text-sm font-medium text-gray-700 mb-1">
																					Profile Photo
																				</label>
																				<input
																					type="file"
																					accept="image/*,.heic,.heif,.bmp"
																					onChange={
																						handleProfilePhotoChange_safe
																					}
																					className="block text-sm text-gray-600"
																				/>
																				{photoUploading && (
																					<p className="text-xs text-purple-600 mt-1">
																						Uploading...
																					</p>
																				)}
																			</div>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				First Name{' '}
																				<span className="text-red-500">*</span>
																			</label>
																			<input
																				type="text"
																				value={formData.first_name || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						first_name: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				required
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Middle Name
																			</label>
																			<input
																				type="text"
																				value={formData.middle_name || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						middle_name: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Last Name{' '}
																				<span className="text-red-500">*</span>
																			</label>
																			<input
																				type="text"
																				value={formData.last_name || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						last_name: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				required
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Employee ID{' '}
																				<span className="text-red-500">*</span>
																			</label>
																			<input
																				type="text"
																				value={formData.employee_id || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						employee_id: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				required
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Username (from User Master)
																			</label>
																			<select
																				value={formData.username || ''}
																				onChange={(e) => {
																					const selectedUser = users.find(
																						(u) => u.username === e.target.value
																					);
																					setFormData({
																						...formData,
																						username: e.target.value,
																						user_id: selectedUser?.id || null,
																					});
																				}}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
																			>
																				<option value="">Select user</option>
																				{users
																					.filter(
																						(u) =>
																							!u.employee_id ||
																							u.employee_id ===
																								selectedEmployee?.id
																					)
																					.map((u) => (
																						<option
																							key={u.id}
																							value={u.username}
																						>
																							{u.username}{' '}
																							{u.full_name
																								? `(${u.full_name})`
																								: ''}
																						</option>
																					))}
																			</select>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Employee Type
																			</label>
																			<select
																				value={formData.employee_type || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						employee_type: e.target.value,
																						deputation_company_id:
																							e.target.value !== 'Deputation'
																								? ''
																								: formData.deputation_company_id,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			>
																				<option value="">Select</option>
																				<option value="Payroll">Payroll</option>
																				<option value="Contract">
																					Contract
																				</option>
																				<option value="Deputation">
																					Deputation
																				</option>
																			</select>
																		</div>
																		{formData.employee_type ===
																			'Deputation' && (
																			<div>
																				<label className="block text-sm font-medium text-gray-700 mb-2">
																					Company Name *
																				</label>
																				<select
																					value={
																						formData.deputation_company_id || ''
																					}
																					onChange={(e) =>
																						setFormData({
																							...formData,
																							deputation_company_id:
																								e.target.value,
																						})
																					}
																					className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				>
																					<option value="">
																						Select Company
																					</option>
																					{companies.map((company) => (
																						<option
																							key={company.id}
																							value={company.id}
																						>
																							{company.company_name}
																						</option>
																					))}
																				</select>
																			</div>
																		)}
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				System Role
																			</label>
																			<select
																				value={formData.system_role_id || ''}
																				onChange={(e) => {
																					const nextId = e.target.value;
																					const picked = roles.find(
																						(r) =>
																							String(r.id) === String(nextId)
																					);
																					setFormData({
																						...formData,
																						system_role_id: nextId,
																						role: picked
																							? picked.role_name
																							: '',
																						system_role_name: picked
																							? picked.role_name
																							: '',
																					});
																				}}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
																			>
																				<option value="">Select a role</option>
																				{roles.map((r) => (
																					<option key={r.id} value={r.id}>
																						{r.role_name}
																					</option>
																				))}
																			</select>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Company
																			</label>
																			<select
																				value={
																					formData.company_name ||
																					'Accent Techno Solutions Pvt Ltd'
																				}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						company_name: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
																			>
																				<option value="Accent Techno Solutions Pvt Ltd">
																					Accent Techno Solutions Pvt Ltd
																				</option>
																				{companies
																					.filter(
																						(c) =>
																							c.company_name !==
																							'Accent Techno Solutions Pvt Ltd'
																					)
																					.map((company) => (
																						<option
																							key={company.id}
																							value={company.company_name}
																						>
																							{company.company_name}
																						</option>
																					))}
																			</select>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Gender
																			</label>
																			<select
																				value={formData.gender || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						gender: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			>
																				<option value="">Select</option>
																				<option value="Male">Male</option>
																				<option value="Female">Female</option>
																				<option value="Other">Other</option>
																			</select>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Date of Birth
																			</label>
																			<input
																				type="date"
																				value={formData.dob || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						dob: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Marital Status
																			</label>
																			<select
																				value={formData.marital_status || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						marital_status: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			>
																				<option value="">Select</option>
																				<option value="Single">Single</option>
																				<option value="Married">Married</option>
																				<option value="Other">Divorced</option>
																				<option value="Other">Widowed</option>
																			</select>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Status{' '}
																				<span className="text-red-500">*</span>
																			</label>
																			<select
																				value={
																					formData.employment_status ||
																					formData.status ||
																					'active'
																				}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						employment_status: e.target.value,
																						status: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				required
																			>
																				<option value="active">Active</option>
																				<option value="inactive">
																					Inactive
																				</option>
																				<option value="terminated">
																					Terminated
																				</option>
																			</select>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Branch
																			</label>
																			<select
																				value={formData.workplace || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						workplace: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			>
																				<option value="">Select Branch</option>
																				<option value="Malvan">Malvan</option>
																				<option value="Mumbai">Mumbai</option>
																			</select>
																		</div>
																	</div>
																</div>
															)}

															{/* Contact Information */}
															{editSubTab === 'contact' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Contact Information
																	</h4>
																	<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Email{' '}
																				<span className="text-red-500">*</span>
																			</label>
																			<input
																				type="email"
																				value={formData.email || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						email: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				required
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Personal Email
																			</label>
																			<input
																				type="email"
																				value={formData.personal_email || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						personal_email: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Mobile
																			</label>
																			<input
																				type="tel"
																				value={formData.mobile || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						mobile: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div className="md:col-span-3">
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Present Address
																			</label>
																			<textarea
																				rows={3}
																				value={
																					formData.present_address ||
																					formData.address ||
																					''
																				}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						present_address: e.target.value,
																						address: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				City
																			</label>
																			<input
																				type="text"
																				value={formData.city || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						city: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				State
																			</label>
																			<input
																				type="text"
																				value={formData.state || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						state: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Country
																			</label>
																			<input
																				type="text"
																				value={formData.country || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						country: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				PIN
																			</label>
																			<input
																				type="text"
																				value={formData.pin || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						pin: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																	</div>
																</div>
															)}

															{/* Work Details */}
															{editSubTab === 'work' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Work Details
																	</h4>
																	<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Department
																			</label>
																			<input
																				type="text"
																				value={formData.department || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						department: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Position
																			</label>
																			<input
																				type="text"
																				value={formData.position || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						position: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Grade
																			</label>
																			<input
																				type="text"
																				value={formData.grade || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						grade: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Workplace
																			</label>
																			<input
																				type="text"
																				value={formData.workplace || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						workplace: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Level
																			</label>
																			<input
																				type="text"
																				value={formData.level || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						level: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Smart Office Code
																			</label>
																			<input
																				type="text"
																				value={formData.smartoffice_code || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						smartoffice_code: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Reporting To
																			</label>
																			<input
																				type="text"
																				value={formData.reporting_to || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						reporting_to: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Hire Date
																			</label>
																			<input
																				type="date"
																				value={formData.hire_date || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						hire_date: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Joining Date
																			</label>
																			<input
																				type="date"
																				value={formData.joining_date || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						joining_date: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				PF No
																			</label>
																			<input
																				type="text"
																				value={formData.pf_no || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						pf_no: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																	</div>
																</div>
															)}

															{/* Salary Structure */}
															{editSubTab === 'salary' && (
																<div className="space-y-6">
																	{/* SECTION 1: Salary Structure History - Shows ALL profiles as a set */}
																	{savedSalaryProfiles.length > 0 && (
																		<div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4">
																			<div className="flex items-center justify-between mb-4">
																				<h4 className="text-lg font-semibold text-purple-900 flex items-center gap-2">
																					<svg
																						className="w-5 h-5"
																						fill="none"
																						stroke="currentColor"
																						viewBox="0 0 24 24"
																					>
																						<path
																							strokeLinecap="round"
																							strokeLinejoin="round"
																							strokeWidth={2}
																							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
																						/>
																					</svg>
																					Salary Structure History
																					<span className="ml-2 px-2 py-0.5 text-xs font-medium bg-purple-200 text-purple-800 rounded-full">
																						{savedSalaryProfiles.length}{' '}
																						{savedSalaryProfiles.length === 1
																							? 'record'
																							: 'records'}
																					</span>
																				</h4>
																				<div className="flex items-center gap-2">
																					<button
																						onClick={exportSalaryStructureExcel}
																						disabled={
																							exportingSalaryStructureExcel ||
																							!selectedEmployee?.id
																						}
																						className="px-3 py-2 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg border border-green-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
																					>
																						<DocumentArrowDownIcon
																							className={`w-4 h-4 ${exportingSalaryStructureExcel ? 'animate-pulse' : ''}`}
																						/>
																						{exportingSalaryStructureExcel
																							? 'Exporting...'
																							: 'Export Selected (Excel)'}
																					</button>
																					<button
																						onClick={
																							exportAllSalaryStructuresExcel
																						}
																						disabled={
																							exportingAllSalaryStructuresExcel
																						}
																						className="px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg border border-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
																					>
																						<DocumentArrowDownIcon
																							className={`w-4 h-4 ${exportingAllSalaryStructuresExcel ? 'animate-pulse' : ''}`}
																						/>
																						{exportingAllSalaryStructuresExcel
																							? 'Exporting...'
																							: 'Export All Users (Excel)'}
																					</button>
																				</div>
																			</div>

																			{/* List of all salary profiles */}
																			<div className="space-y-3 max-h-[400px] overflow-y-auto">
																				{savedSalaryProfiles.map(
																					(profile, index) => {
																						const isCurrentlyActive =
																							!profile.effective_to ||
																							new Date(profile.effective_to) >=
																								new Date();
																						const isBeingEdited =
																							editingSalaryProfileId ===
																							profile.id;

																						return (
																							<div
																								key={profile.id}
																								className={`bg-white rounded-xl p-4 shadow-sm border-2 transition-all ${
																									isBeingEdited
																										? 'border-purple-500 ring-2 ring-purple-200'
																										: isCurrentlyActive &&
																											  index === 0
																											? 'border-green-300'
																											: 'border-gray-100'
																								}`}
																							>
																								<div className="flex items-start justify-between gap-4">
																									{/* Left side - Profile info */}
																									<div className="flex-1 min-w-0">
																										<div className="flex items-center gap-2 mb-2">
																											{isCurrentlyActive &&
																												index === 0 && (
																													<span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
																														✓ Active
																													</span>
																												)}
																											{isBeingEdited && (
																												<span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full animate-pulse">
																													Editing...
																												</span>
																											)}
																										</div>

																										{/* Amount display based on salary type */}
																										<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
																											{(!profile.salary_type ||
																												profile.salary_type ===
																													'monthly') && (
																												<>
																													<span className="text-lg font-bold text-gray-900">
																														₹
																														{formatCurrency(
																															profile.gross_salary ||
																																0
																														)}
																													</span>
																													<span className="text-sm text-gray-500">
																														Gross/month
																													</span>
																													<span className="text-sm text-green-600 font-medium">
																														• Net: ₹
																														{formatCurrency(
																															profile.net_pay ||
																																0
																														)}
																													</span>
																													<span className="text-sm text-blue-600 font-medium">
																														• CTC: ₹
																														{formatCurrency(
																															profile.employer_cost ||
																																0
																														)}
																													</span>
																													{!!profile.loan_active &&
																														parseFloat(
																															profile.loan_amount_per_month
																														) > 0 && (
																															<span className="text-sm text-amber-600 font-medium">
																																• Loan: ₹
																																{formatCurrency(
																																	profile.loan_amount_per_month
																																)}
																																/mo
																															</span>
																														)}
																													{!!profile.advance_active &&
																														parseFloat(
																															profile.advance_amount
																														) > 0 && (
																															<span className="text-sm text-orange-600 font-medium">
																																• Adv: ₹
																																{formatCurrency(
																																	profile.advance_amount
																																)}
																															</span>
																														)}
																												</>
																											)}
																											{profile.salary_type ===
																												'hourly' && (
																												<>
																													<span className="text-lg font-bold text-gray-900">
																														₹
																														{formatCurrency(
																															profile.hourly_rate ||
																																0
																														)}
																														/hr
																													</span>
																													<span className="text-sm text-gray-500">
																														{profile.std_hours_per_day ||
																															8}{' '}
																														hrs/day
																													</span>
																												</>
																											)}
																											{profile.salary_type ===
																												'daily' && (
																												<>
																													<span className="text-lg font-bold text-gray-900">
																														₹
																														{formatCurrency(
																															profile.daily_rate ||
																																0
																														)}
																														/day
																													</span>
																													<span className="text-sm text-gray-500">
																														{profile.std_working_days ||
																															26}{' '}
																														days/month
																													</span>
																												</>
																											)}
																											{profile.salary_type ===
																												'contract' &&
																												(() => {
																													const amt =
																														parseFloat(
																															profile.contract_amount ||
																																profile.gross_salary
																														) || 0;
																													const tdsRate =
																														parseFloat(
																															profile.tds_percentage
																														) || 10;
																													const tdsAmt =
																														Math.round(
																															(amt * tdsRate) /
																																100
																														);
																													const inHand =
																														amt - tdsAmt;
																													return (
																														<>
																															<span className="text-lg font-bold text-gray-900">
																																₹
																																{formatCurrency(
																																	amt
																																)}
																															</span>
																															<span className="text-sm text-gray-500 capitalize">
																																{profile.contract_duration?.replace(
																																	'_',
																																	' '
																																) || 'Monthly'}
																															</span>
																															<span className="text-sm text-red-500 font-medium">
																																• TDS {tdsRate}
																																%: ₹
																																{formatCurrency(
																																	tdsAmt
																																)}
																															</span>
																															<span className="text-sm text-green-600 font-medium">
																																• In-Hand: ₹
																																{formatCurrency(
																																	inHand
																																)}
																															</span>
																														</>
																													);
																												})()}
																											{profile.salary_type ===
																												'lumpsum' && (
																												<>
																													<span className="text-lg font-bold text-gray-900">
																														₹
																														{formatCurrency(
																															profile.lumpsum_amount ||
																																profile.gross_salary ||
																																0
																														)}
																													</span>
																													<span className="text-sm text-gray-500">
																														Lumpsum
																													</span>
																												</>
																											)}
																											{profile.salary_type ===
																												'custom' && (
																												<>
																													<span className="text-lg font-bold text-gray-900">
																														₹
																														{formatCurrency(
																															profile.gross_salary ||
																																0
																														)}
																													</span>
																													<span className="text-sm text-gray-500">
																														Earnings
																													</span>
																													<span className="text-sm text-green-600 font-medium">
																														• Net: ₹
																														{formatCurrency(
																															profile.net_pay ||
																																0
																														)}
																													</span>
																													<span className="text-sm text-blue-600 font-medium">
																														• CTC: ₹
																														{formatCurrency(
																															profile.employer_cost ||
																																0
																														)}
																													</span>
																													{!!profile.loan_active &&
																														parseFloat(
																															profile.loan_amount_per_month
																														) > 0 && (
																															<span className="text-sm text-amber-600 font-medium">
																																• Loan: ₹
																																{formatCurrency(
																																	profile.loan_amount_per_month
																																)}
																																/mo
																															</span>
																														)}
																													{!!profile.advance_active &&
																														parseFloat(
																															profile.advance_amount
																														) > 0 && (
																															<span className="text-sm text-orange-600 font-medium">
																																• Adv: ₹
																																{formatCurrency(
																																	profile.advance_amount
																																)}
																															</span>
																														)}
																												</>
																											)}
																										</div>

																										{/* Date range */}
																										<p className="text-xs text-gray-500 mt-2">
																											<span className="font-medium">
																												Effective:
																											</span>{' '}
																											{profile.effective_from
																												? new Date(
																														profile.effective_from
																													).toLocaleDateString(
																														'en-IN'
																													)
																												: '-'}
																											{profile.effective_to ? (
																												<>
																													{' '}
																													→{' '}
																													{new Date(
																														profile.effective_to
																													).toLocaleDateString(
																														'en-IN'
																													)}
																												</>
																											) : (
																												<span className="text-green-600 font-medium">
																													{' '}
																													→ Ongoing
																												</span>
																											)}
																										</p>
																									</div>

																									{/* Right side - Actions */}
																									<div className="flex items-center gap-2 flex-shrink-0">
																										<button
																											onClick={() =>
																												handleEditSalaryProfile(
																													profile
																												)
																											}
																											disabled={isBeingEdited}
																											className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
																												isBeingEdited
																													? 'bg-purple-100 text-purple-700 cursor-default'
																													: 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
																											}`}
																										>
																											<svg
																												className="w-3.5 h-3.5"
																												fill="none"
																												stroke="currentColor"
																												viewBox="0 0 24 24"
																											>
																												<path
																													strokeLinecap="round"
																													strokeLinejoin="round"
																													strokeWidth={2}
																													d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
																												/>
																											</svg>
																											{isBeingEdited
																												? 'Editing'
																												: 'Edit'}
																										</button>
																										<button
																											onClick={() =>
																												handleDeleteSalaryProfile(
																													profile.id
																												)
																											}
																											disabled={
																												deletingSalaryProfile
																											}
																											className="px-3 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded-lg border border-red-200 transition-colors flex items-center gap-1 disabled:opacity-50"
																										>
																											<svg
																												className="w-3.5 h-3.5"
																												fill="none"
																												stroke="currentColor"
																												viewBox="0 0 24 24"
																											>
																												<path
																													strokeLinecap="round"
																													strokeLinejoin="round"
																													strokeWidth={2}
																													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
																												/>
																											</svg>
																											Delete
																										</button>
																									</div>
																								</div>
																							</div>
																						);
																					}
																				)}
																			</div>
																		</div>
																	)}

																	{/* Success Message */}
																	{salaryProfileSuccess && (
																		<div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
																			<svg
																				className="w-6 h-6 text-green-600"
																				fill="none"
																				stroke="currentColor"
																				viewBox="0 0 24 24"
																			>
																				<path
																					strokeLinecap="round"
																					strokeLinejoin="round"
																					strokeWidth={2}
																					d="M5 13l4 4L19 7"
																				/>
																			</svg>
																			<p className="font-semibold text-green-800">
																				{salaryProfileSuccess}
																			</p>
																		</div>
																	)}

																	{/* Error Display */}
																	{previewError && (
																		<div className="bg-red-50 border border-red-200 rounded-lg p-3">
																			<p className="text-sm text-red-800">
																				{previewError}
																			</p>
																		</div>
																	)}

																	{/* SECTION 2: Edit/Add Salary Structure */}
																	<div
																		className={`bg-white border-2 rounded-xl p-4 ${editingSalaryProfileId ? 'border-purple-300' : 'border-gray-200'}`}
																	>
																		<div className="flex items-center justify-between mb-4">
																			<div className="flex items-center gap-4">
																				<h4 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
																					{editingSalaryProfileId ? (
																						<>
																							<svg
																								className="w-5 h-5 text-purple-600"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																							>
																								<path
																									strokeLinecap="round"
																									strokeLinejoin="round"
																									strokeWidth={2}
																									d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
																								/>
																							</svg>
																							Edit Salary Structure
																						</>
																					) : (
																						<>
																							<svg
																								className="w-5 h-5 text-green-600"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																							>
																								<path
																									strokeLinecap="round"
																									strokeLinejoin="round"
																									strokeWidth={2}
																									d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																								/>
																							</svg>
																							Add New Salary Structure
																						</>
																					)}
																				</h4>
																				{editingSalaryProfileId && (
																					<button
																						onClick={handleResetSalaryForm}
																						className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors flex items-center gap-1"
																					>
																						<svg
																							className="w-3.5 h-3.5"
																							fill="none"
																							stroke="currentColor"
																							viewBox="0 0 24 24"
																						>
																							<path
																								strokeLinecap="round"
																								strokeLinejoin="round"
																								strokeWidth={2}
																								d="M6 18L18 6M6 6l12 12"
																							/>
																						</svg>
																						Cancel Edit
																					</button>
																				)}
																			</div>
																			<a
																				href="/admin/payroll-schedules"
																				target="_blank"
																				className="text-xs text-purple-600 hover:text-purple-700 underline flex items-center gap-1"
																			>
																				<svg
																					className="w-3.5 h-3.5"
																					fill="none"
																					stroke="currentColor"
																					viewBox="0 0 24 24"
																				>
																					<path
																						strokeLinecap="round"
																						strokeLinejoin="round"
																						strokeWidth={2}
																						d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
																					/>
																					<path
																						strokeLinecap="round"
																						strokeLinejoin="round"
																						strokeWidth={2}
																						d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
																					/>
																				</svg>
																				Manage Schedules
																			</a>
																		</div>

																		{/* Input Row: Gross + Checkboxes */}
																		<div className="bg-gray-50 rounded-lg p-4 mb-4">
																			{/* Effective Date Range */}
																			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
																				<div>
																					<label className="block text-sm font-medium text-gray-700 mb-1">
																						Effective From *
																					</label>
																					<input
																						type="date"
																						value={
																							salaryPreview.effective_from || ''
																						}
																						onChange={(e) =>
																							setSalaryPreview({
																								...salaryPreview,
																								effective_from: e.target.value,
																							})
																						}
																						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																					/>
																				</div>
																				<div>
																					<label className="block text-sm font-medium text-gray-700 mb-1">
																						Effective To{' '}
																						<span className="text-gray-400 text-xs">
																							(Optional - leave blank for
																							ongoing)
																						</span>
																					</label>
																					<input
																						type="date"
																						value={
																							salaryPreview.effective_to || ''
																						}
																						onChange={(e) =>
																							setSalaryPreview({
																								...salaryPreview,
																								effective_to: e.target.value,
																							})
																						}
																						min={salaryPreview.effective_from}
																						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																					/>
																				</div>
																			</div>

																			{/* Standard Working Times */}
																			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
																				<div>
																					<label className="block text-sm font-medium text-gray-700 mb-1">
																						Standard In Time
																					</label>
																					<input
																						type="time"
																						value={
																							salaryPreview.std_in_time ||
																							'09:00'
																						}
																						onChange={(e) =>
																							setSalaryPreview({
																								...salaryPreview,
																								std_in_time: e.target.value,
																							})
																						}
																						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																					/>
																				</div>
																				<div>
																					<label className="block text-sm font-medium text-gray-700 mb-1">
																						Standard Out Time
																					</label>
																					<input
																						type="time"
																						value={
																							salaryPreview.std_out_time ||
																							'17:30'
																						}
																						onChange={(e) =>
																							setSalaryPreview({
																								...salaryPreview,
																								std_out_time: e.target.value,
																							})
																						}
																						className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																					/>
																				</div>
																			</div>

																			{/* Privilege Leave (PL) Section */}
																			<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
																				<h5 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
																					<svg
																						className="w-4 h-4"
																						fill="none"
																						stroke="currentColor"
																						viewBox="0 0 24 24"
																					>
																						<path
																							strokeLinecap="round"
																							strokeLinejoin="round"
																							strokeWidth={2}
																							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
																						/>
																					</svg>
																					Privilege Leave (PL)
																				</h5>
																				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
																					<div>
																						<label className="block text-xs font-medium text-gray-600 mb-1">
																							Total Leaves
																						</label>
																						<input
																							type="number"
																							min="0"
																							value={
																								salaryPreview.pl_total || ''
																							}
																							onChange={(e) => {
																								const total =
																									parseInt(e.target.value) || 0;
																								const used =
																									parseInt(
																										salaryPreview.pl_used
																									) || 0;
																								setSalaryPreview({
																									...salaryPreview,
																									pl_total: e.target.value,
																									pl_balance: String(
																										Math.max(0, total - used)
																									),
																								});
																							}}
																							className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
																							placeholder="e.g. 21"
																						/>
																					</div>
																					<div>
																						<label className="block text-xs font-medium text-gray-600 mb-1">
																							Used Leaves
																						</label>
																						<input
																							type="number"
																							value={
																								salaryPreview.pl_used || '0'
																							}
																							readOnly
																							className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-blue-100 text-blue-800 font-semibold cursor-not-allowed"
																							title="Fetched from attendance records"
																						/>
																						<span className="text-[10px] text-blue-500 mt-0.5 block">
																							Auto-fetched from attendance
																						</span>
																					</div>
																					<div>
																						<label className="block text-xs font-medium text-gray-600 mb-1">
																							Balance
																						</label>
																						<input
																							type="number"
																							value={
																								salaryPreview.pl_balance || ''
																							}
																							readOnly
																							className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-blue-100 text-blue-800 font-semibold cursor-not-allowed"
																						/>
																					</div>
																				</div>
																			</div>

																			{/* Loan & Advance Section */}
																			<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
																				{/* Loan Section */}
																				<div
																					className={`border rounded-lg p-4 transition-all ${salaryPreview.loan_active ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}
																				>
																					<div className="flex items-center justify-between mb-3">
																						<h5 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
																							<svg
																								className="w-4 h-4"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																							>
																								<path
																									strokeLinecap="round"
																									strokeLinejoin="round"
																									strokeWidth={2}
																									d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
																								/>
																							</svg>
																							Loan Deduction
																						</h5>
																						<label className="relative inline-flex items-center cursor-pointer">
																							<input
																								type="checkbox"
																								checked={
																									salaryPreview.loan_active
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										loan_active:
																											e.target.checked,
																									})
																								}
																								className="sr-only peer"
																							/>
																							<div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
																						</label>
																					</div>
																					{salaryPreview.loan_active && (
																						<div className="space-y-3">
																							<div>
																								<label className="block text-[11px] font-medium text-gray-600 mb-1">
																									Loan Amount (₹)
																								</label>
																								<input
																									type="number"
																									min="0"
																									value={
																										salaryPreview.loan_amount ||
																										''
																									}
																									onChange={(e) =>
																										setSalaryPreview({
																											...salaryPreview,
																											loan_amount:
																												e.target.value,
																										})
																									}
																									className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
																									placeholder="e.g. 50000"
																								/>
																							</div>
																							<div className="grid grid-cols-3 gap-3">
																								<div>
																									<label className="block text-[11px] font-medium text-gray-600 mb-1">
																										EMI / Month (₹)
																									</label>
																									<input
																										type="number"
																										min="0"
																										value={
																											salaryPreview.loan_amount_per_month ||
																											''
																										}
																										onChange={(e) => {
																											const emi =
																												parseFloat(
																													e.target.value
																												) || 0;
																											const months =
																												parseInt(
																													salaryPreview.loan_no_of_months
																												) || 0;
																											setSalaryPreview({
																												...salaryPreview,
																												loan_amount_per_month:
																													e.target.value,
																												loan_total_amount:
																													String(emi * months),
																											});
																										}}
																										className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
																										placeholder="e.g. 5000"
																									/>
																								</div>
																								<div>
																									<label className="block text-[11px] font-medium text-gray-600 mb-1">
																										No. of Months
																									</label>
																									<input
																										type="number"
																										min="1"
																										value={
																											salaryPreview.loan_no_of_months ||
																											''
																										}
																										onChange={(e) => {
																											const months =
																												parseInt(
																													e.target.value
																												) || 0;
																											const emi =
																												parseFloat(
																													salaryPreview.loan_amount_per_month
																												) || 0;
																											setSalaryPreview({
																												...salaryPreview,
																												loan_no_of_months:
																													e.target.value,
																												loan_total_amount:
																													String(emi * months),
																											});
																										}}
																										className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
																										placeholder="e.g. 12"
																									/>
																								</div>
																								<div>
																									<label className="block text-[11px] font-medium text-gray-600 mb-1">
																										Total Amount (₹)
																									</label>
																									<input
																										type="number"
																										value={
																											salaryPreview.loan_total_amount ||
																											''
																										}
																										readOnly
																										className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-amber-100 text-amber-800 font-semibold cursor-not-allowed"
																									/>
																								</div>
																							</div>
																						</div>
																					)}
																					{!salaryPreview.loan_active && (
																						<p className="text-xs text-gray-400 italic">
																							Toggle to enable loan deduction
																							from salary
																						</p>
																					)}
																				</div>

																				{/* Advance Section */}
																				<div
																					className={`border rounded-lg p-4 transition-all ${salaryPreview.advance_active ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'}`}
																				>
																					<div className="flex items-center justify-between mb-3">
																						<h5 className="text-sm font-semibold text-green-800 flex items-center gap-2">
																							<svg
																								className="w-4 h-4"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																							>
																								<path
																									strokeLinecap="round"
																									strokeLinejoin="round"
																									strokeWidth={2}
																									d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
																								/>
																							</svg>
																							Monthly Advance
																						</h5>
																						<label className="relative inline-flex items-center cursor-pointer">
																							<input
																								type="checkbox"
																								checked={
																									salaryPreview.advance_active
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										advance_active:
																											e.target.checked,
																									})
																								}
																								className="sr-only peer"
																							/>
																							<div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
																						</label>
																					</div>
																					{salaryPreview.advance_active && (
																						<div>
																							<label className="block text-[11px] font-medium text-gray-600 mb-1">
																								Advance Amount (₹)
																							</label>
																							<input
																								type="number"
																								min="0"
																								value={
																									salaryPreview.advance_amount ||
																									''
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										advance_amount:
																											e.target.value,
																									})
																								}
																								className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400"
																								placeholder="e.g. 10000"
																							/>
																							<span className="text-[10px] text-green-600 mt-0.5 block">
																								This amount will be subtracted
																								from gross in the payroll export
																							</span>
																						</div>
																					)}
																					{!salaryPreview.advance_active && (
																						<p className="text-xs text-gray-400 italic">
																							Toggle to enable advance deduction
																							for this month
																						</p>
																					)}
																				</div>
																			</div>

																			{/* Monthly salary input */}
																			{salaryPreview.salary_type ===
																				'monthly' && (
																				<div className="grid grid-cols-1 gap-4 mb-3 md:grid-cols-4">
																					<div>
																						<label
																							className="block text-sm font-medium text-gray-700 mb-1"
																							htmlFor="salary-gross"
																						>
																							Gross Salary *
																						</label>
																						<input
																							id="salary-gross"
																							type="number"
																							min="0"
																							value={salaryPreview.gross}
																							onChange={(e) =>
																								setSalaryPreview((prev) => ({
																									...prev,
																									gross: e.target.value,
																								}))
																							}
																							className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																							placeholder="Enter gross salary"
																						/>
																					</div>
																					<div>
																						<span className="block text-sm font-medium text-gray-700 mb-1">
																							Retention
																						</span>
																						<output className="block w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-100 text-gray-700">
																							{derivedPayrollPreview
																								? formatCurrency(
																										derivedPayrollPreview.retention
																									)
																								: '—'}
																						</output>
																					</div>
																					<div>
																						<span className="block text-sm font-medium text-gray-700 mb-1">
																							Insurance
																						</span>
																						<output className="block w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-100 text-gray-700">
																							{derivedPayrollPreview
																								? formatCurrency(
																										derivedPayrollPreview.insurance
																									)
																								: '—'}
																						</output>
																					</div>
																					<div>
																						<label
																							className="block text-sm font-medium text-gray-700 mb-1"
																							htmlFor="salary-other-allowances"
																						>
																							Other Allowances
																						</label>
																						<input
																							id="salary-other-allowances"
																							type="number"
																							min="0"
																							value={
																								salaryPreview.other_allowances ||
																								''
																							}
																							onChange={(e) =>
																								setSalaryPreview((prev) => ({
																									...prev,
																									other_allowances:
																										e.target.value,
																								}))
																							}
																							className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																							placeholder="0"
																						/>
																					</div>
																				</div>
																			)}

																			{/* Hourly Rate Fields */}
																			{salaryPreview.salary_type ===
																				'hourly' && (
																				<div className="space-y-4 mb-3">
																					<div className="grid grid-cols-2 gap-3">
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Hourly Rate (₹) *
																							</label>
																							<input
																								type="number"
																								value={
																									salaryPreview.hourly_rate
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										hourly_rate: e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
																								placeholder="0"
																							/>
																						</div>
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Hours/Day
																							</label>
																							<input
																								type="number"
																								value={
																									salaryPreview.std_hours_per_day ||
																									'8'
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										std_hours_per_day:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
																								placeholder="8"
																							/>
																						</div>
																					</div>
																					<div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center justify-between">
																						<div>
																							<p className="text-xs text-orange-600 font-medium">
																								Est. Monthly (26 days)
																							</p>
																							<p className="text-lg font-bold text-orange-700">
																								₹
																								{formatCurrency(
																									(parseFloat(
																										salaryPreview.hourly_rate
																									) || 0) *
																										(parseFloat(
																											salaryPreview.std_hours_per_day
																										) || 8) *
																										26
																								)}
																							</p>
																						</div>
																						<button
																							onClick={handleSaveSalaryProfile}
																							disabled={
																								salaryProfileSaving ||
																								!salaryPreview.hourly_rate
																							}
																							className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
																								editingSalaryProfileId
																									? 'bg-blue-600 hover:bg-blue-700'
																									: 'bg-orange-600 hover:bg-orange-700'
																							}`}
																						>
																							{salaryProfileSaving
																								? '⏳'
																								: editingSalaryProfileId
																									? 'Update'
																									: '+ Add'}
																						</button>
																					</div>
																				</div>
																			)}

																			{/* Daily Rate Fields */}
																			{salaryPreview.salary_type ===
																				'daily' && (
																				<div className="space-y-4 mb-3">
																					<div className="grid grid-cols-2 gap-3">
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Daily Rate (₹) *
																							</label>
																							<input
																								type="number"
																								value={salaryPreview.daily_rate}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										daily_rate: e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
																								placeholder="0"
																							/>
																						</div>
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Days/Month
																							</label>
																							<input
																								type="number"
																								value={
																									salaryPreview.std_working_days ||
																									'26'
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										std_working_days:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
																								placeholder="26"
																							/>
																						</div>
																					</div>
																					<div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
																						<div>
																							<p className="text-xs text-green-600 font-medium">
																								Est. Monthly
																							</p>
																							<p className="text-lg font-bold text-green-700">
																								₹
																								{formatCurrency(
																									(parseFloat(
																										salaryPreview.daily_rate
																									) || 0) *
																										(parseFloat(
																											salaryPreview.std_working_days
																										) || 26)
																								)}
																							</p>
																						</div>
																						<button
																							onClick={handleSaveSalaryProfile}
																							disabled={
																								salaryProfileSaving ||
																								!salaryPreview.daily_rate
																							}
																							className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
																								editingSalaryProfileId
																									? 'bg-blue-600 hover:bg-blue-700'
																									: 'bg-green-600 hover:bg-green-700'
																							}`}
																						>
																							{salaryProfileSaving
																								? '⏳'
																								: editingSalaryProfileId
																									? 'Update'
																									: '+ Add'}
																						</button>
																					</div>
																				</div>
																			)}

																			{/* Contract Amount Fields */}
																			{salaryPreview.salary_type ===
																				'contract' && (
																				<div className="space-y-4 mb-3">
																					<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Amount (₹) *
																							</label>
																							<input
																								type="number"
																								value={
																									salaryPreview.contract_amount
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										contract_amount:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
																								placeholder="0"
																							/>
																						</div>
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Duration
																							</label>
																							<select
																								value={
																									salaryPreview.contract_duration ||
																									'monthly'
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										contract_duration:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
																							>
																								<option value="monthly">
																									Monthly
																								</option>
																								<option value="quarterly">
																									Quarterly
																								</option>
																								<option value="half_yearly">
																									6 Months
																								</option>
																								<option value="yearly">
																									Yearly
																								</option>
																								<option value="project">
																									Project
																								</option>
																							</select>
																						</div>
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								End Date
																							</label>
																							<input
																								type="date"
																								value={
																									salaryPreview.contract_end_date ||
																									''
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										contract_end_date:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
																							/>
																						</div>
																					</div>
																					<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
																						<p className="text-xs text-amber-700">
																							{(() => {
																								const amt =
																									parseFloat(
																										salaryPreview.contract_amount
																									) || 0;
																								const tdsRate =
																									parseFloat(
																										salaryPreview.tds_percentage
																									) || 10;
																								const tdsAmt = Math.round(
																									(amt * tdsRate) / 100
																								);
																								const inHand = amt - tdsAmt;
																								return amt > 0
																									? `💡 No PF/ESIC. TDS @ ${tdsRate}% = ₹${tdsAmt.toLocaleString('en-IN')} | In-Hand CTC: ₹${inHand.toLocaleString('en-IN')}`
																									: '💡 No PF/ESIC. 10% TDS will be deducted by default.';
																							})()}
																						</p>
																						<button
																							onClick={handleSaveSalaryProfile}
																							disabled={
																								salaryProfileSaving ||
																								!salaryPreview.contract_amount
																							}
																							className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
																								editingSalaryProfileId
																									? 'bg-blue-600 hover:bg-blue-700'
																									: 'bg-amber-600 hover:bg-amber-700'
																							}`}
																						>
																							{salaryProfileSaving
																								? '⏳'
																								: editingSalaryProfileId
																									? 'Update'
																									: '+ Add'}
																						</button>
																					</div>
																				</div>
																			)}

																			{/* Lumpsum Amount Fields */}
																			{salaryPreview.salary_type ===
																				'lumpsum' && (
																				<div className="space-y-4 mb-3">
																					<div className="grid grid-cols-2 gap-3">
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Amount (₹) *
																							</label>
																							<input
																								type="number"
																								value={
																									salaryPreview.lumpsum_amount
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										lumpsum_amount:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																								placeholder="0"
																							/>
																						</div>
																						<div>
																							<label className="block text-xs font-medium text-gray-600 mb-1">
																								Description
																							</label>
																							<input
																								type="text"
																								value={
																									salaryPreview.lumpsum_description ||
																									''
																								}
																								onChange={(e) =>
																									setSalaryPreview({
																										...salaryPreview,
																										lumpsum_description:
																											e.target.value,
																									})
																								}
																								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
																								placeholder="e.g., Bonus"
																							/>
																						</div>
																					</div>
																					<div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center justify-between">
																						<p className="text-xs text-purple-700">
																							💰 One-time payment. No recurring.
																						</p>
																						<button
																							onClick={handleSaveSalaryProfile}
																							disabled={
																								salaryProfileSaving ||
																								!salaryPreview.lumpsum_amount
																							}
																							className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
																								editingSalaryProfileId
																									? 'bg-blue-600 hover:bg-blue-700'
																									: 'bg-purple-600 hover:bg-purple-700'
																							}`}
																						>
																							{salaryProfileSaving
																								? '⏳'
																								: editingSalaryProfileId
																									? 'Update'
																									: '+ Add'}
																						</button>
																					</div>
																				</div>
																			)}

																			{/* Custom Salary Structure Fields - Hourly Rate Based Calculation */}
																			{salaryPreview.salary_type ===
																				'custom' && (
																				<div className="space-y-4 mb-3">
																					{/* Hourly Rate Input and CTC Calculation Section */}
																					<div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
																						<h5 className="text-sm font-semibold text-yellow-800 mb-3 flex items-center gap-2">
																							<svg
																								className="w-4 h-4"
																								fill="none"
																								stroke="currentColor"
																								viewBox="0 0 24 24"
																							>
																								<path
																									strokeLinecap="round"
																									strokeLinejoin="round"
																									strokeWidth={2}
																									d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
																								/>
																							</svg>
																							Hourly Rate & CTC Calculation
																						</h5>
																						<div className="grid grid-cols-2 md:grid-cols-5 gap-2">
																							<div>
																								<label className="block text-xs font-medium text-gray-600 mb-1">
																									Hourly Rate (₹) *
																								</label>
																								<input
																									type="number"
																									step="0.01"
																									value={
																										salaryPreview.custom_hourly_rate ||
																										''
																									}
																									onChange={(e) => {
																										const hourlyRate =
																											parseFloat(
																												e.target.value
																											) || 0;
																										const hours =
																											parseFloat(
																												salaryPreview.custom_monthly_hours
																											) || 0;
																										const ctc =
																											hourlyRate * hours; // CTC = Hourly Rate × Hours

																										// Keep configured MLWF values in salary structure all year.
																										// Deduction application is controlled during payroll processing (Jun/Dec only).
																										const mlwfConfiguredEmployee =
																											parseFloat(currentMLWF) ||
																											PAYROLL_CONFIG.LWF_HALF_YEARLY;
																										const mlwfConfiguredEmployer =
																											parseFloat(
																												currentMLWFEmployer
																											) || 72;
																										const insurance = 500;

																										// Iterative calculation to converge on correct values
																										let calculatedGross =
																											ctc * 0.9; // Initial estimate
																										let basicDa,
																											pfBase,
																											pfEmployer,
																											esicEmployer,
																											bonus,
																											employerCosts;

																										// Iterate until values stabilize (usually 2-3 iterations)
																										for (
																											let i = 0;
																											i < 5;
																											i++
																										) {
																											basicDa = Math.round(
																												calculatedGross *
																													(PAYROLL_CONFIG.BASIC_DA_PERCENT /
																														100)
																											);
																											pfBase = Math.min(
																												basicDa,
																												PAYROLL_CONFIG.PF_WAGE_CEILING
																											);
																											pfEmployer = Math.round(
																												pfBase *
																													(PAYROLL_CONFIG.EMPLOYER_PF_PERCENT /
																														100)
																											);
																											esicEmployer =
																												calculatedGross <=
																												PAYROLL_CONFIG.ESIC_SALARY_CEILING
																													? Math.round(
																															calculatedGross *
																																(PAYROLL_CONFIG.EMPLOYER_ESIC_PERCENT /
																																	100)
																														)
																													: 0;
																											bonus = Math.round(
																												basicDa * 0.0833
																											);
																											employerCosts =
																												pfEmployer +
																												esicEmployer +
																												mlwfConfiguredEmployer +
																												bonus +
																												insurance;
																											const newGross =
																												ctc - employerCosts;
																											if (
																												Math.abs(
																													newGross -
																														calculatedGross
																												) < 1
																											)
																												break; // Converged
																											calculatedGross =
																												newGross;
																										}

																										// Final calculation with converged gross
																										calculatedGross =
																											ctc - employerCosts;
																										basicDa = Math.round(
																											calculatedGross *
																												(PAYROLL_CONFIG.BASIC_DA_PERCENT /
																													100)
																										);
																										const hra = Math.round(
																											calculatedGross *
																												(PAYROLL_CONFIG.HRA_PERCENT /
																													100)
																										);
																										const callAllowance =
																											Math.round(
																												calculatedGross *
																													(PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT /
																														100)
																											);
																										const conveyance =
																											Math.round(
																												calculatedGross *
																													(PAYROLL_CONFIG.CONVEYANCE_PERCENT /
																														100)
																											);
																										const otherAllowance =
																											calculatedGross -
																											basicDa -
																											hra -
																											callAllowance -
																											conveyance;

																										// Recalculate employer PF/Bonus based on final basicDa
																										pfBase = Math.min(
																											basicDa,
																											PAYROLL_CONFIG.PF_WAGE_CEILING
																										);
																										pfEmployer = Math.round(
																											pfBase *
																												(PAYROLL_CONFIG.EMPLOYER_PF_PERCENT /
																													100)
																										);
																										bonus = Math.round(
																											basicDa * 0.0833
																										);

																										// Calculate Employee Deductions
																										const pfEmployee =
																											Math.round(
																												pfBase *
																													(PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT /
																														100)
																											);
																										const esicEmployee =
																											calculatedGross <=
																											PAYROLL_CONFIG.ESIC_SALARY_CEILING
																												? Math.round(
																														calculatedGross *
																															(PAYROLL_CONFIG.EMPLOYEE_ESIC_PERCENT /
																																100)
																													)
																												: 0;
																										const pt =
																											PAYROLL_CONFIG
																												.PROFESSIONAL_TAX
																												.ABOVE_10000;
																										const mlwf =
																											mlwfConfiguredEmployee;

																										setSalaryPreview({
																											...salaryPreview,
																											custom_hourly_rate:
																												e.target.value,
																											custom_ctc:
																												ctc.toFixed(2),
																											// Employer contributions
																											custom_pf_employer:
																												pfEmployer.toString(),
																											custom_esic_employer:
																												esicEmployer.toString(),
																											custom_mlwf_employer:
																												mlwfConfiguredEmployer.toString(),
																											custom_bonus:
																												bonus.toString(),
																											custom_insurance:
																												insurance.toString(),
																											// Earnings (calculated from Calculated Gross)
																											custom_basic:
																												basicDa.toString(),
																											custom_hra:
																												hra.toString(),
																											custom_conveyance:
																												conveyance.toString(),
																											custom_call_allowance:
																												callAllowance.toString(),
																											custom_other_allowances:
																												Math.max(
																													0,
																													otherAllowance
																												).toString(),
																											// Employee deductions
																											custom_pf_employee:
																												pfEmployee.toString(),
																											custom_esic_employee:
																												esicEmployee.toString(),
																											custom_pt: pt.toString(),
																											custom_mlwf:
																												mlwf.toString(),
																										});
																									}}
																									className="w-full px-2 py-1.5 text-sm border border-yellow-400 rounded focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-yellow-100 font-semibold"
																									placeholder="Enter Rate"
																								/>
																							</div>
																							<div>
																								<label className="block text-xs font-medium text-gray-600 mb-1">
																									Monthly Hours
																								</label>
																								<div
																									className={`w-full px-2 py-1.5 text-sm border rounded font-medium flex items-center gap-1 ${
																										salaryPreview.custom_monthly_hours
																											? 'bg-blue-100 border-blue-300 text-blue-700'
																											: 'bg-orange-100 border-orange-300 text-orange-700'
																									}`}
																								>
																									<svg
																										className="w-3.5 h-3.5"
																										fill="none"
																										stroke="currentColor"
																										viewBox="0 0 24 24"
																									>
																										<path
																											strokeLinecap="round"
																											strokeLinejoin="round"
																											strokeWidth={2}
																											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
																										/>
																									</svg>
																									{salaryPreview.custom_monthly_hours
																										? `${salaryPreview.custom_monthly_hours} hrs`
																										: 'No attendance'}
																								</div>
																								<p className="text-[10px] text-blue-600 mt-0.5">
																									From Attendance (Current
																									Month)
																								</p>
																							</div>
																							<div>
																								<label className="block text-xs font-medium text-gray-600 mb-1">
																									Calculated CTC (₹)
																								</label>
																								<div className="w-full px-2 py-1.5 text-sm bg-yellow-200 border border-yellow-400 rounded text-yellow-800 font-semibold">
																									₹
																									{formatCurrency(
																										parseFloat(
																											salaryPreview.custom_ctc
																										) || 0
																									)}
																								</div>
																								<p className="text-[10px] text-yellow-700 mt-0.5">
																									Rate × Hours
																								</p>
																							</div>
																							<div>
																								<label className="block text-xs font-medium text-gray-600 mb-1">
																									Employer Contributions
																								</label>
																								<div className="w-full px-2 py-1.5 text-sm bg-red-100 border border-red-300 rounded text-red-700 font-semibold">
																									₹
																									{formatCurrency(
																										(parseFloat(
																											salaryPreview.custom_pf_employer
																										) || 0) +
																											(parseFloat(
																												salaryPreview.custom_esic_employer
																											) || 0) +
																											(parseFloat(
																												salaryPreview.custom_mlwf_employer
																											) || 0) +
																											(parseFloat(
																												salaryPreview.custom_bonus
																											) || 0) +
																											(parseFloat(
																												salaryPreview.custom_insurance
																											) || 0) +
																											(
																												salaryPreview.custom_components ||
																												[]
																											)
																												.filter(
																													(c) =>
																														c.type ===
																														'employer'
																												)
																												.reduce(
																													(sum, c) =>
																														sum +
																														(parseFloat(
																															c.amount
																														) || 0),
																													0
																												)
																									)}
																								</div>
																								<p className="text-[10px] text-red-600 mt-0.5">
																									PF + ESIC + MLWF + Bonus + Ins
																								</p>
																							</div>
																							<div>
																								<label className="block text-xs font-medium text-gray-600 mb-1">
																									Calculated Gross
																								</label>
																								<div className="w-full px-2 py-1.5 text-sm bg-green-100 border border-green-300 rounded text-green-700 font-semibold">
																									₹
																									{formatCurrency(
																										(parseFloat(
																											salaryPreview.custom_ctc
																										) || 0) -
																											((parseFloat(
																												salaryPreview.custom_pf_employer
																											) || 0) +
																												(parseFloat(
																													salaryPreview.custom_esic_employer
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_mlwf_employer
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_bonus
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_insurance
																												) || 0) +
																												(
																													salaryPreview.custom_components ||
																													[]
																												)
																													.filter(
																														(c) =>
																															c.type ===
																															'employer'
																													)
																													.reduce(
																														(sum, c) =>
																															sum +
																															(parseFloat(
																																c.amount
																															) || 0),
																														0
																													))
																									)}
																								</div>
																								<p className="text-[10px] text-green-600 mt-0.5">
																									CTC - Employer Costs
																								</p>
																							</div>
																						</div>
																						<p className="text-xs text-gray-500 mt-2">
																							💡 Monthly Hours fetched from
																							Attendance Master during payroll
																							calculation
																						</p>
																					</div>

																					{/* 3 COLUMNS SIDE BY SIDE */}
																					<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
																						{/* COLUMN 1: EARNINGS (Editable, based on CTC) */}
																						<div className="bg-green-50 border border-green-200 rounded-xl p-3">
																							<h5 className="text-sm font-semibold text-green-800 mb-3 flex items-center gap-2">
																								<svg
																									className="w-4 h-4"
																									fill="none"
																									stroke="currentColor"
																									viewBox="0 0 24 24"
																								>
																									<path
																										strokeLinecap="round"
																										strokeLinejoin="round"
																										strokeWidth={2}
																										d="M12 4v16m8-8H4"
																									/>
																								</svg>
																								Earnings
																							</h5>
																							<div className="space-y-2">
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Basic + DA
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_basic ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_basic:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										HRA
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_hra ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_hra:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Conveyance
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_conveyance ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_conveyance:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Call Allowance
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_call_allowance ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_call_allowance:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Incentive
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_incentive ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_incentive:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Other
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_other_allowances ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_other_allowances:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="border-t border-green-300 pt-2 mt-2">
																									<div className="flex justify-between font-semibold">
																										<span className="text-green-900">
																											Total Earnings
																										</span>
																										<span className="text-green-900">
																											₹
																											{formatCurrency(
																												(parseFloat(
																													salaryPreview.custom_basic
																												) || 0) +
																													(parseFloat(
																														salaryPreview.custom_hra
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_conveyance
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_call_allowance
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_incentive
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_other_allowances
																													) || 0)
																											)}
																										</span>
																									</div>
																								</div>
																							</div>
																						</div>

																						{/* COLUMN 2: DEDUCTIONS (Fixed like Monthly) */}
																						<div className="bg-red-50 border border-red-200 rounded-xl p-3">
																							<h5 className="text-sm font-semibold text-red-800 mb-3 flex items-center gap-2">
																								<svg
																									className="w-4 h-4"
																									fill="none"
																									stroke="currentColor"
																									viewBox="0 0 24 24"
																								>
																									<path
																										strokeLinecap="round"
																										strokeLinejoin="round"
																										strokeWidth={2}
																										d="M20 12H4"
																									/>
																								</svg>
																								Deductions
																							</h5>
																							<div className="space-y-2">
																								<div className="flex justify-between items-center text-sm text-gray-500 mb-2">
																									<span>From Earnings:</span>
																									<span>
																										₹
																										{formatCurrency(
																											(parseFloat(
																												salaryPreview.custom_basic
																											) || 0) +
																												(parseFloat(
																													salaryPreview.custom_hra
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_conveyance
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_call_allowance
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_incentive
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_other_allowances
																												) || 0)
																										)}
																									</span>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Emp PF
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_pf_employee ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_pf_employee:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Emp ESIC
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_esic_employee ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_esic_employee:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										PT
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_pt ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_pt:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										MLWF{' '}
																										<span className="text-[10px] text-gray-400">
																											(Jun/Dec)
																										</span>
																									</span>
																									<input
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
																										placeholder="0"
																									/>
																								</div>
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Retention
																									</span>
																									<input
																										type="number"
																										value={
																											salaryPreview.custom_retention ||
																											''
																										}
																										onChange={(e) =>
																											setSalaryPreview({
																												...salaryPreview,
																												custom_retention:
																													e.target.value,
																											})
																										}
																										className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-red-500"
																										placeholder="0"
																									/>
																								</div>
																								{salaryPreview.loan_active &&
																									parseFloat(
																										salaryPreview.loan_amount_per_month
																									) > 0 && (
																										<div className="flex justify-between items-center">
																											<span className="text-sm text-amber-700 font-medium">
																												Loan EMI
																											</span>
																											<span className="text-sm font-medium text-amber-700">
																												₹
																												{formatCurrency(
																													parseFloat(
																														salaryPreview.loan_amount_per_month
																													) || 0
																												)}
																											</span>
																										</div>
																									)}
																								{salaryPreview.advance_active &&
																									parseFloat(
																										salaryPreview.advance_amount
																									) > 0 && (
																										<div className="flex justify-between items-center">
																											<span className="text-sm text-green-700 font-medium">
																												Advance
																											</span>
																											<span className="text-sm font-medium text-green-700">
																												₹
																												{formatCurrency(
																													parseFloat(
																														salaryPreview.advance_amount
																													) || 0
																												)}
																											</span>
																										</div>
																									)}
																								<div className="border-t border-red-300 pt-2 mt-2">
																									<div className="flex justify-between font-semibold">
																										<span className="text-red-900">
																											Total Deductions
																										</span>
																										<span className="text-red-900">
																											₹
																											{formatCurrency(
																												(parseFloat(
																													salaryPreview.custom_pf_employee
																												) || 0) +
																													(parseFloat(
																														salaryPreview.custom_esic_employee
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_pt
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_mlwf
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_retention
																													) || 0) +
																													(salaryPreview.loan_active
																														? parseFloat(
																																salaryPreview.loan_amount_per_month
																															) || 0
																														: 0) +
																													(salaryPreview.advance_active
																														? parseFloat(
																																salaryPreview.advance_amount
																															) || 0
																														: 0)
																											)}
																										</span>
																									</div>
																								</div>
																								<div className="border-t-2 border-green-400 pt-2 mt-2">
																									<div className="flex justify-between font-bold text-base">
																										<span className="text-green-700">
																											Net Pay
																										</span>
																										<span className="text-green-700">
																											₹
																											{formatCurrency(
																												(parseFloat(
																													salaryPreview.custom_basic
																												) || 0) +
																													(parseFloat(
																														salaryPreview.custom_hra
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_conveyance
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_call_allowance
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_incentive
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_other_allowances
																													) || 0) -
																													((parseFloat(
																														salaryPreview.custom_pf_employee
																													) || 0) +
																														(parseFloat(
																															salaryPreview.custom_esic_employee
																														) || 0) +
																														(parseFloat(
																															salaryPreview.custom_pt
																														) || 0) +
																														(parseFloat(
																															salaryPreview.custom_mlwf
																														) || 0) +
																														(parseFloat(
																															salaryPreview.custom_retention
																														) || 0) +
																														(salaryPreview.loan_active
																															? parseFloat(
																																	salaryPreview.loan_amount_per_month
																																) || 0
																															: 0) +
																														(salaryPreview.advance_active
																															? parseFloat(
																																	salaryPreview.advance_amount
																																) || 0
																															: 0))
																											)}
																										</span>
																									</div>
																								</div>
																							</div>
																						</div>

																						{/* COLUMN 3: EMPLOYER COST / CTC (Dynamic - can add custom items) */}
																						<div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
																							<div className="flex items-center justify-between mb-3">
																								<h5 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
																									<svg
																										className="w-4 h-4"
																										fill="none"
																										stroke="currentColor"
																										viewBox="0 0 24 24"
																									>
																										<path
																											strokeLinecap="round"
																											strokeLinejoin="round"
																											strokeWidth={2}
																											d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
																										/>
																									</svg>
																									CTC / Employer
																								</h5>
																								<button
																									type="button"
																									onClick={() => {
																										const newComponent = {
																											id: Date.now(),
																											name: '',
																											amount: '',
																											type: 'employer',
																										};
																										setSalaryPreview({
																											...salaryPreview,
																											custom_components: [
																												...(salaryPreview.custom_components ||
																													[]),
																												newComponent,
																											],
																										});
																									}}
																									className="p-1 bg-blue-600 text-white hover:bg-blue-700 rounded"
																									title="Add Employer Cost"
																								>
																									<svg
																										className="w-3 h-3"
																										fill="none"
																										stroke="currentColor"
																										viewBox="0 0 24 24"
																									>
																										<path
																											strokeLinecap="round"
																											strokeLinejoin="round"
																											strokeWidth={2}
																											d="M12 6v6m0 0v6m0-6h6m-6 0H6"
																										/>
																									</svg>
																								</button>
																							</div>
																							<div className="space-y-2">
																								<div className="flex justify-between items-center">
																									<span className="text-sm text-gray-600">
																										Total Earnings
																									</span>
																									<span className="text-sm font-medium text-gray-900">
																										₹
																										{formatCurrency(
																											(parseFloat(
																												salaryPreview.custom_basic
																											) || 0) +
																												(parseFloat(
																													salaryPreview.custom_hra
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_conveyance
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_call_allowance
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_incentive
																												) || 0) +
																												(parseFloat(
																													salaryPreview.custom_other_allowances
																												) || 0)
																										)}
																									</span>
																								</div>
																								<div className="border-t border-blue-200 pt-2 mt-2">
																									<p className="text-xs text-gray-500 mb-2">
																										Employer Contributions:
																									</p>
																									<div className="flex justify-between items-center">
																										<span className="text-sm text-gray-600">
																											Empr PF
																										</span>
																										<input
																											type="number"
																											value={
																												salaryPreview.custom_pf_employer ||
																												''
																											}
																											onChange={(e) =>
																												setSalaryPreview({
																													...salaryPreview,
																													custom_pf_employer:
																														e.target.value,
																												})
																											}
																											className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																											placeholder="0"
																										/>
																									</div>
																									<div className="flex justify-between items-center mt-2">
																										<span className="text-sm text-gray-600">
																											Empr ESIC
																										</span>
																										<input
																											type="number"
																											value={
																												salaryPreview.custom_esic_employer ||
																												''
																											}
																											onChange={(e) =>
																												setSalaryPreview({
																													...salaryPreview,
																													custom_esic_employer:
																														e.target.value,
																												})
																											}
																											className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																											placeholder="0"
																										/>
																									</div>
																									<div className="flex justify-between items-center mt-2">
																										<span className="text-sm text-gray-600">
																											Empr MLWF{' '}
																											<span className="text-[10px] text-gray-400">
																												(Jun/Dec)
																											</span>
																										</span>
																										<input
																											type="number"
																											value={
																												salaryPreview.custom_mlwf_employer ||
																												''
																											}
																											onChange={(e) =>
																												setSalaryPreview({
																													...salaryPreview,
																													custom_mlwf_employer:
																														e.target.value,
																												})
																											}
																											className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																											placeholder="0"
																										/>
																									</div>
																									<div className="flex justify-between items-center mt-2">
																										<span className="text-sm text-gray-600">
																											Bonus
																										</span>
																										<input
																											type="number"
																											value={
																												salaryPreview.custom_bonus ||
																												''
																											}
																											onChange={(e) =>
																												setSalaryPreview({
																													...salaryPreview,
																													custom_bonus:
																														e.target.value,
																												})
																											}
																											className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																											placeholder="0"
																										/>
																									</div>
																									<div className="flex justify-between items-center mt-2">
																										<span className="text-sm text-gray-600">
																											Insurance
																										</span>
																										<input
																											type="number"
																											value={
																												salaryPreview.custom_insurance ||
																												''
																											}
																											onChange={(e) =>
																												setSalaryPreview({
																													...salaryPreview,
																													custom_insurance:
																														e.target.value,
																												})
																											}
																											className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																											placeholder="0"
																										/>
																									</div>
																									{/* Dynamic employer cost items */}
																									{(
																										salaryPreview.custom_components ||
																										[]
																									)
																										.filter(
																											(c) =>
																												c.type === 'employer'
																										)
																										.map((comp) => (
																											<div
																												key={comp.id}
																												className="flex justify-between items-center mt-2 gap-1"
																											>
																												<input
																													type="text"
																													value={comp.name}
																													onChange={(e) => {
																														const updated = [
																															...salaryPreview.custom_components,
																														];
																														const idx =
																															salaryPreview.custom_components.findIndex(
																																(c) =>
																																	c.id ===
																																	comp.id
																															);
																														updated[idx].name =
																															e.target.value;
																														setSalaryPreview({
																															...salaryPreview,
																															custom_components:
																																updated,
																														});
																													}}
																													placeholder="Name"
																													className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																												/>
																												<input
																													type="number"
																													value={comp.amount}
																													onChange={(e) => {
																														const updated = [
																															...salaryPreview.custom_components,
																														];
																														const idx =
																															salaryPreview.custom_components.findIndex(
																																(c) =>
																																	c.id ===
																																	comp.id
																															);
																														updated[
																															idx
																														].amount =
																															e.target.value;
																														setSalaryPreview({
																															...salaryPreview,
																															custom_components:
																																updated,
																														});
																													}}
																													placeholder="0"
																													className="w-20 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
																												/>
																												<button
																													type="button"
																													onClick={() => {
																														const updated =
																															salaryPreview.custom_components.filter(
																																(c) =>
																																	c.id !==
																																	comp.id
																															);
																														setSalaryPreview({
																															...salaryPreview,
																															custom_components:
																																updated,
																														});
																													}}
																													className="p-0.5 text-gray-400 hover:text-red-500 rounded"
																												>
																													<svg
																														className="w-4 h-4"
																														fill="none"
																														stroke="currentColor"
																														viewBox="0 0 24 24"
																													>
																														<path
																															strokeLinecap="round"
																															strokeLinejoin="round"
																															strokeWidth={2}
																															d="M6 18L18 6M6 6l12 12"
																														/>
																													</svg>
																												</button>
																											</div>
																										))}
																								</div>
																								<div className="border-t-2 border-blue-400 pt-2 mt-2">
																									<div className="flex justify-between font-bold text-base">
																										<span className="text-blue-800">
																											Total CTC
																										</span>
																										<span className="text-blue-800">
																											₹
																											{formatCurrency(
																												(parseFloat(
																													salaryPreview.custom_basic
																												) || 0) +
																													(parseFloat(
																														salaryPreview.custom_hra
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_conveyance
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_call_allowance
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_incentive
																													) || 0) +
																													(parseFloat(
																														salaryPreview.custom_other_allowances
																													) || 0) +
																													((parseFloat(
																														salaryPreview.custom_pf_employer
																													) || 0) +
																														(parseFloat(
																															salaryPreview.custom_esic_employer
																														) || 0) +
																														(parseFloat(
																															salaryPreview.custom_mlwf_employer
																														) || 0) +
																														(parseFloat(
																															salaryPreview.custom_bonus
																														) || 0) +
																														(parseFloat(
																															salaryPreview.custom_insurance
																														) || 0) +
																														(
																															salaryPreview.custom_components ||
																															[]
																														)
																															.filter(
																																(c) =>
																																	c.type ===
																																	'employer'
																															)
																															.reduce(
																																(sum, c) =>
																																	sum +
																																	(parseFloat(
																																		c.amount
																																	) || 0),
																																0
																															))
																											)}
																										</span>
																									</div>
																								</div>
																							</div>
																						</div>
																					</div>

																					{/* Save Button */}
																					<div className="flex justify-end">
																						<button
																							onClick={handleSaveSalaryProfile}
																							disabled={
																								salaryProfileSaving ||
																								!(
																									(parseFloat(
																										salaryPreview.custom_basic
																									) || 0) > 0 ||
																									(parseFloat(
																										salaryPreview.custom_da
																									) || 0) > 0 ||
																									(parseFloat(
																										salaryPreview.custom_hra
																									) || 0) > 0
																								)
																							}
																							className={`px-5 py-2 text-sm rounded-lg text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow ${
																								editingSalaryProfileId
																									? 'bg-blue-600 hover:bg-blue-700'
																									: 'bg-indigo-600 hover:bg-indigo-700'
																							}`}
																						>
																							{salaryProfileSaving
																								? '⏳'
																								: editingSalaryProfileId
																									? 'Update Custom Profile'
																									: '+ Add Custom Profile'}
																						</button>
																					</div>
																				</div>
																			)}

																			{/* Derived monthly preview */}
																			{salaryPreview.salary_type ===
																				'monthly' && (
																				<MonthlySalaryPreview
																					profile={salaryPreview}
																					canOverride={canOverrideSalary}
																					overrideMode={salaryOverrideMode}
																					overrides={salaryOverrides}
																					onOverrideModeChange={(enabled) => {
																						setSalaryOverrideMode(enabled);
																						if (!enabled)
																							setSalaryOverrides({});
																					}}
																					onOverrideChange={(name, value) =>
																						setSalaryOverrides((prev) => ({
																							...prev,
																							[name]: value,
																						}))
																					}
																					onOverrideReset={(name) =>
																						setSalaryOverrides((prev) => {
																							const next = { ...prev };
																							delete next[name];
																							return next;
																						})
																					}
																					onResetOverrides={() =>
																						setSalaryOverrides({})
																					}
																					breakdown={derivedPayrollPreview}
																					scheduleLoading={scheduleLoading}
																					scheduleError={scheduleError}
																					onApplicabilityChange={(
																						name,
																						value
																					) =>
																						setSalaryPreview((prev) => ({
																							...prev,
																							[name]: value,
																						}))
																					}
																				/>
																			)}
																		</div>
																		{/* Summary for Non-Monthly Types */}
																		{salaryPreview.salary_type !== 'monthly' &&
																			(salaryPreview.hourly_rate ||
																				salaryPreview.daily_rate ||
																				salaryPreview.contract_amount ||
																				salaryPreview.lumpsum_amount) && (
																				<div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5 mb-4">
																					<h5 className="text-lg font-semibold text-indigo-900 mb-4 flex items-center gap-2">
																						<span className="text-xl">
																							{salaryPreview.salary_type ===
																								'hourly' && '⏰'}
																							{salaryPreview.salary_type ===
																								'daily' && '📆'}
																							{salaryPreview.salary_type ===
																								'contract' && '📝'}
																							{salaryPreview.salary_type ===
																								'lumpsum' && '💰'}
																						</span>
																						{salaryPreview.salary_type
																							.charAt(0)
																							.toUpperCase() +
																							salaryPreview.salary_type.slice(
																								1
																							)}{' '}
																						Payment Summary
																					</h5>
																					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
																						<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																							<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																								{salaryPreview.salary_type ===
																									'hourly' && 'Hourly Rate'}
																								{salaryPreview.salary_type ===
																									'daily' && 'Daily Rate'}
																								{salaryPreview.salary_type ===
																									'contract' &&
																									'Contract Amount'}
																								{salaryPreview.salary_type ===
																									'lumpsum' && 'Lumpsum Amount'}
																							</p>
																							<p className="text-xl font-bold text-indigo-700">
																								₹
																								{formatCurrency(
																									salaryPreview.hourly_rate ||
																										salaryPreview.daily_rate ||
																										salaryPreview.contract_amount ||
																										salaryPreview.lumpsum_amount ||
																										0
																								)}
																							</p>
																						</div>
																						{salaryPreview.salary_type ===
																							'hourly' && (
																							<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																								<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																									Est. Monthly
																								</p>
																								<p className="text-xl font-bold text-green-600">
																									₹
																									{formatCurrency(
																										(parseFloat(
																											salaryPreview.hourly_rate
																										) || 0) *
																											(parseFloat(
																												salaryPreview.std_hours_per_day
																											) || 8) *
																											26
																									)}
																								</p>
																							</div>
																						)}
																						{salaryPreview.salary_type ===
																							'daily' && (
																							<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																								<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																									Est. Monthly
																								</p>
																								<p className="text-xl font-bold text-green-600">
																									₹
																									{formatCurrency(
																										(parseFloat(
																											salaryPreview.daily_rate
																										) || 0) *
																											(parseFloat(
																												salaryPreview.std_working_days
																											) || 26)
																									)}
																								</p>
																							</div>
																						)}
																						{salaryPreview.salary_type ===
																							'contract' &&
																							(() => {
																								const amt =
																									parseFloat(
																										salaryPreview.contract_amount
																									) || 0;
																								const tdsRate =
																									parseFloat(
																										salaryPreview.tds_percentage
																									) || 10;
																								const tdsAmt = Math.round(
																									(amt * tdsRate) / 100
																								);
																								const inHand = amt - tdsAmt;
																								return (
																									<>
																										<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																											<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																												TDS Deduction ({tdsRate}
																												%)
																											</p>
																											<p className="text-xl font-bold text-red-600">
																												₹
																												{formatCurrency(tdsAmt)}
																											</p>
																										</div>
																										<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																											<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																												In-Hand CTC
																											</p>
																											<p className="text-xl font-bold text-green-600">
																												₹
																												{formatCurrency(inHand)}
																											</p>
																										</div>
																										<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																											<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																												Duration
																											</p>
																											<p className="text-lg font-bold text-gray-700">
																												{salaryPreview.contract_duration ===
																													'monthly' &&
																													'Monthly'}
																												{salaryPreview.contract_duration ===
																													'quarterly' &&
																													'Quarterly'}
																												{salaryPreview.contract_duration ===
																													'half_yearly' &&
																													'6 Months'}
																												{salaryPreview.contract_duration ===
																													'yearly' && 'Yearly'}
																												{salaryPreview.contract_duration ===
																													'project' &&
																													'Project'}
																												{!salaryPreview.contract_duration &&
																													'Monthly'}
																											</p>
																										</div>
																										{salaryPreview.contract_end_date && (
																											<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																												<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																													End Date
																												</p>
																												<p className="text-lg font-bold text-orange-600">
																													{new Date(
																														salaryPreview.contract_end_date
																													).toLocaleDateString(
																														'en-IN'
																													)}
																												</p>
																											</div>
																										)}
																									</>
																								);
																							})()}
																						{salaryPreview.salary_type !==
																							'contract' && (
																							<div className="bg-white rounded-xl p-4 shadow-sm text-center">
																								<p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
																									Statutory
																								</p>
																								<p className="text-lg font-bold text-gray-500">
																									N/A
																								</p>
																							</div>
																						)}
																					</div>
																				</div>
																			)}

																		{/* Action Buttons */}
																		{(salaryPreview.salary_type === 'monthly'
																			? derivedPayrollPreview
																			: salaryPreview.hourly_rate ||
																				salaryPreview.daily_rate ||
																				salaryPreview.contract_amount ||
																				salaryPreview.lumpsum_amount) && (
																			<>
																				<div className="flex justify-end gap-3 mt-4">
																					<button
																						type="button"
																						onClick={handleResetSalaryForm}
																						className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
																					>
																						Clear
																					</button>
																					<button
																						type="button"
																						onClick={handleSaveSalaryProfile}
																						disabled={salaryProfileSaving}
																						className={`px-6 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50 flex items-center gap-2 ${
																							editingSalaryProfileId
																								? 'bg-blue-600 hover:bg-blue-700'
																								: 'bg-green-600 hover:bg-green-700'
																						}`}
																					>
																						{salaryProfileSaving && (
																							<svg
																								className="w-4 h-4 animate-spin"
																								fill="none"
																								viewBox="0 0 24 24"
																							>
																								<circle
																									className="opacity-25"
																									cx="12"
																									cy="12"
																									r="10"
																									stroke="currentColor"
																									strokeWidth="4"
																								></circle>
																								<path
																									className="opacity-75"
																									fill="currentColor"
																									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
																								></path>
																							</svg>
																						)}
																						{editingSalaryProfileId
																							? 'Update Salary Profile'
																							: '+ Add New Salary Profile'}
																					</button>
																				</div>
																			</>
																		)}
																	</div>
																</div>
															)}

															{/* Academic & Experience */}
															{editSubTab === 'academic' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Academic & Experience
																	</h4>
																	<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Qualification
																			</label>
																			<input
																				type="text"
																				value={formData.qualification || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						qualification: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Institute
																			</label>
																			<input
																				type="text"
																				value={formData.institute || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						institute: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Passing Year
																			</label>
																			<input
																				type="text"
																				value={formData.passing_year || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						passing_year: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div className="md:col-span-3">
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Work Experience
																			</label>
																			<textarea
																				rows={2}
																				value={formData.work_experience || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						work_experience: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																	</div>
																</div>
															)}

															{/* Government IDs */}
															{editSubTab === 'govt' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Government IDs
																	</h4>
																	<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				PAN
																			</label>
																			<input
																				type="text"
																				value={formData.pan || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						pan: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				AADHAR
																			</label>
																			<input
																				type="text"
																				value={formData.aadhar || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						aadhar: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				PF number
																			</label>
																			<input
																				type="text"
																				value={formData.gratuity_no || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						gratuity_no: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				UAN
																			</label>
																			<input
																				type="text"
																				value={formData.uan || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						uan: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				ESI No
																			</label>
																			<input
																				type="text"
																				value={formData.esi_no || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						esi_no: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																	</div>
																</div>
															)}

															{/* Bank Details */}
															{editSubTab === 'bank' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Bank Details
																	</h4>
																	<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Bank Name
																			</label>
																			<input
																				type="text"
																				value={formData.bank_name || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						bank_name: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Branch
																			</label>
																			<input
																				type="text"
																				value={formData.bank_branch || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						bank_branch: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Account Holder Name
																			</label>
																			<input
																				type="text"
																				value={
																					formData.account_holder_name || ''
																				}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						account_holder_name: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				Account Number
																			</label>
																			<input
																				type="text"
																				value={formData.bank_account_no || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						bank_account_no: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																		<div>
																			<label className="block text-sm font-medium text-gray-700 mb-2">
																				IFSC
																			</label>
																			<input
																				type="text"
																				value={formData.bank_ifsc || ''}
																				onChange={(e) =>
																					setFormData({
																						...formData,
																						bank_ifsc: e.target.value,
																					})
																				}
																				className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																			/>
																		</div>
																	</div>
																</div>
															)}

															{/* Attendance & Exit */}
															{editSubTab === 'attendance' && (
																<div>
																	<h4 className="text-lg font-semibold text-gray-900 mb-3">
																		Attendance & Exit
																	</h4>

																	{/* Month Selector */}
																	<div className="flex items-center gap-3 mb-4">
																		<label className="text-sm font-medium text-gray-700">
																			Month:
																		</label>
																		<input
																			type="month"
																			value={attendanceSummaryMonth}
																			onChange={(e) =>
																				setAttendanceSummaryMonth(
																					e.target.value
																				)
																			}
																			className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
																		/>
																	</div>

																	{/* Summary Cards */}
																	{attendanceSummaryLoading ? (
																		<div className="flex items-center justify-center py-8">
																			<div className="w-6 h-6 border-2 border-gray-200 border-t-purple-600 rounded-full animate-spin"></div>
																			<span className="ml-3 text-sm text-gray-500">
																				Loading attendance...
																			</span>
																		</div>
																	) : attendanceSummary.length > 0 ? (
																		<div className="space-y-4">
																			{/* Summary Grid */}
																			<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
																				{[
																					{
																						label: 'Present',
																						value:
																							attendanceSummary[0]
																								?.total_present || 0,
																						color: 'text-emerald-600',
																						bg: 'bg-emerald-50',
																						border: 'border-emerald-200',
																					},
																					{
																						label: 'Absent',
																						value:
																							attendanceSummary[0]
																								?.total_absent || 0,
																						color: 'text-red-600',
																						bg: 'bg-red-50',
																						border: 'border-red-200',
																					},
																					{
																						label: 'Weekly Off',
																						value:
																							attendanceSummary[0]
																								?.total_weekly_off || 0,
																						color: 'text-gray-600',
																						bg: 'bg-gray-50',
																						border: 'border-gray-200',
																					},
																					{
																						label: 'Holiday',
																						value:
																							attendanceSummary[0]
																								?.total_holiday || 0,
																						color: 'text-amber-600',
																						bg: 'bg-amber-50',
																						border: 'border-amber-200',
																					},
																					{
																						label: 'Overtime (hrs)',
																						value: parseFloat(
																							attendanceSummary[0]
																								?.total_overtime_hours || 0
																						).toFixed(1),
																						color: 'text-violet-600',
																						bg: 'bg-violet-50',
																						border: 'border-violet-200',
																					},
																				].map((item) => (
																					<div
																						key={item.label}
																						className={`${item.bg} border ${item.border} rounded-xl p-3 text-center`}
																					>
																						<div
																							className={`text-xl font-bold ${item.color}`}
																						>
																							{item.value}
																						</div>
																						<div className="text-xs text-gray-500 mt-0.5">
																							{item.label}
																						</div>
																					</div>
																				))}
																			</div>

																			{/* Leave Breakdown */}
																			<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
																				{[
																					{
																						label: 'Privilege Leave',
																						value:
																							attendanceSummary[0]
																								?.total_privilege_leave || 0,
																						color: 'text-blue-600',
																						bg: 'bg-blue-50',
																						border: 'border-blue-200',
																					},
																					{
																						label: 'Casual Leave',
																						value:
																							attendanceSummary[0]
																								?.total_casual_leave || 0,
																						color: 'text-cyan-600',
																						bg: 'bg-cyan-50',
																						border: 'border-cyan-200',
																					},
																					{
																						label: 'Sick Leave',
																						value:
																							attendanceSummary[0]
																								?.total_sick_leave || 0,
																						color: 'text-pink-600',
																						bg: 'bg-pink-50',
																						border: 'border-pink-200',
																					},
																					{
																						label: 'Half Day',
																						value:
																							attendanceSummary[0]
																								?.total_half_day || 0,
																						color: 'text-yellow-600',
																						bg: 'bg-yellow-50',
																						border: 'border-yellow-200',
																					},
																					{
																						label: 'LWP',
																						value:
																							attendanceSummary[0]?.total_lwp ||
																							0,
																						color: 'text-rose-600',
																						bg: 'bg-rose-50',
																						border: 'border-rose-200',
																					},
																				].map((item) => (
																					<div
																						key={item.label}
																						className={`${item.bg} border ${item.border} rounded-xl p-3 text-center`}
																					>
																						<div
																							className={`text-xl font-bold ${item.color}`}
																						>
																							{item.value}
																						</div>
																						<div className="text-xs text-gray-500 mt-0.5">
																							{item.label}
																						</div>
																					</div>
																				))}
																			</div>

																			{/* Working Hours & Time */}
																			<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
																				<div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
																					<div className="text-xl font-bold text-indigo-600">
																						{parseFloat(
																							attendanceSummary[0]
																								?.total_working_hours || 0
																						).toFixed(0)}{' '}
																						hrs
																					</div>
																					<div className="text-xs text-gray-500 mt-0.5">
																						Total Working Hours
																					</div>
																				</div>
																				<div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
																					<div className="text-xl font-bold text-gray-700">
																						{attendanceSummary[0]?.std_in_time
																							? String(
																									attendanceSummary[0]
																										.std_in_time
																								).substring(0, 5)
																							: '09:00'}
																					</div>
																					<div className="text-xs text-gray-500 mt-0.5">
																						Standard In Time
																					</div>
																				</div>
																				<div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
																					<div className="text-xl font-bold text-gray-700">
																						{attendanceSummary[0]?.std_out_time
																							? String(
																									attendanceSummary[0]
																										.std_out_time
																								).substring(0, 5)
																							: '17:30'}
																					</div>
																					<div className="text-xs text-gray-500 mt-0.5">
																						Standard Out Time
																					</div>
																				</div>
																			</div>

																			{/* Day-level Details Table */}
																			{attendanceDayDetails.length > 0 && (
																				<div>
																					<h5 className="text-sm font-semibold text-gray-700 mb-2">
																						Day-wise Details
																					</h5>
																					<div className="border border-gray-200 rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
																						<table className="w-full text-sm">
																							<thead className="bg-gray-50 sticky top-0">
																								<tr>
																									<th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
																										Date
																									</th>
																									<th className="px-3 py-2 text-center text-xs font-medium text-gray-500">
																										Status
																									</th>
																									<th className="px-3 py-2 text-center text-xs font-medium text-gray-500">
																										In Time
																									</th>
																									<th className="px-3 py-2 text-center text-xs font-medium text-gray-500">
																										Out Time
																									</th>
																									<th className="px-3 py-2 text-center text-xs font-medium text-gray-500">
																										OT (hrs)
																									</th>
																								</tr>
																							</thead>
																							<tbody className="divide-y divide-gray-100">
																								{attendanceDayDetails.map(
																									(day) => {
																										const statusColors = {
																											P: 'bg-emerald-100 text-emerald-700',
																											A: 'bg-red-100 text-red-700',
																											WO: 'bg-gray-100 text-gray-500',
																											H: 'bg-amber-100 text-amber-700',
																											PL: 'bg-blue-100 text-blue-700',
																											CL: 'bg-cyan-100 text-cyan-700',
																											SL: 'bg-pink-100 text-pink-700',
																											HD: 'bg-yellow-100 text-yellow-700',
																											OT: 'bg-violet-100 text-violet-700',
																											LWP: 'bg-rose-100 text-rose-700',
																										};
																										const dateObj = new Date(
																											day.attendance_date +
																												'T00:00:00'
																										);
																										const dayName =
																											dateObj.toLocaleDateString(
																												'en-US',
																												{ weekday: 'short' }
																											);
																										const dateDisplay =
																											dateObj.toLocaleDateString(
																												'en-US',
																												{
																													day: '2-digit',
																													month: 'short',
																												}
																											);
																										return (
																											<tr
																												key={
																													day.attendance_date
																												}
																												className="hover:bg-gray-50"
																											>
																												<td className="px-3 py-1.5 text-gray-700">
																													{dayName},{' '}
																													{dateDisplay}
																												</td>
																												<td className="px-3 py-1.5 text-center">
																													<span
																														className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusColors[day.status] || 'bg-gray-100 text-gray-500'}`}
																													>
																														{day.status}
																													</span>
																												</td>
																												<td className="px-3 py-1.5 text-center text-gray-600">
																													{day.in_time || '-'}
																												</td>
																												<td className="px-3 py-1.5 text-center text-gray-600">
																													{day.out_time || '-'}
																												</td>
																												<td className="px-3 py-1.5 text-center text-gray-600">
																													{parseFloat(
																														day.overtime_hours ||
																															0
																													) > 0
																														? parseFloat(
																																day.overtime_hours
																															).toFixed(1)
																														: '-'}
																												</td>
																											</tr>
																										);
																									}
																								)}
																							</tbody>
																						</table>
																					</div>
																				</div>
																			)}
																		</div>
																	) : (
																		<div className="text-center py-8 bg-gray-50 rounded-xl border border-gray-200">
																			<CalendarDaysIcon className="h-10 w-10 text-gray-300 mx-auto mb-2" />
																			<p className="text-sm text-gray-500 mb-1">
																				No attendance data for this month
																			</p>
																			<p className="text-xs text-gray-400">
																				Save attendance from the Attendance page
																				to see it here
																			</p>
																		</div>
																	)}

																	{/* Exit Section */}
																	<div className="mt-6 pt-4 border-t border-gray-200">
																		<h5 className="text-md font-semibold text-gray-900 mb-3">
																			Exit Details
																		</h5>
																		<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
																			<div>
																				<label className="block text-sm font-medium text-gray-700 mb-2">
																					Exit Date
																				</label>
																				<input
																					type="date"
																					value={formData.exit_date || ''}
																					onChange={(e) =>
																						setFormData({
																							...formData,
																							exit_date: e.target.value,
																						})
																					}
																					className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				/>
																			</div>
																			<div className="md:col-span-3">
																				<label className="block text-sm font-medium text-gray-700 mb-2">
																					Exit Reason
																				</label>
																				<textarea
																					rows={2}
																					value={formData.exit_reason || ''}
																					onChange={(e) =>
																						setFormData({
																							...formData,
																							exit_reason: e.target.value,
																						})
																					}
																					className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
																				/>
																			</div>
																		</div>
																	</div>
																</div>
															)}

															{/* Navigation Buttons */}
															<div className="flex justify-between items-center pt-6 border-t border-gray-200">
																<button
																	type="button"
																	onClick={async () => {
																		const currentIndex =
																			editSubTabOrder.indexOf(editSubTab);
																		if (currentIndex > 0) {
																			// Autosave before navigating
																			if (!profileLocked)
																				await autoSaveEmployee();
																			setEditSubTab(
																				editSubTabOrder[currentIndex - 1]
																			);
																		}
																	}}
																	disabled={
																		editSubTabOrder.indexOf(editSubTab) === 0
																	}
																	className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
																>
																	<ChevronLeftIcon className="h-4 w-4" />
																	Previous
																</button>

																<div className="flex space-x-4">
																	<button
																		type="button"
																		onClick={() =>
																			setActiveTab(
																				employeeType ? 'list' : 'add'
																			)
																		}
																		className="px-6 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
																	>
																		Cancel
																	</button>
																	<button
																		type="submit"
																		disabled={loading || profileLocked}
																		className="bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] text-white px-6 py-3 rounded-xl disabled:opacity-50 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
																	>
																		{loading ? 'Saving...' : 'Save'}
																	</button>
																	{editSubTabOrder.indexOf(editSubTab) <
																		editSubTabOrder.length - 1 && (
																		<button
																			type="button"
																			onClick={async () => {
																				const currentIndex =
																					editSubTabOrder.indexOf(editSubTab);
																				if (
																					currentIndex <
																					editSubTabOrder.length - 1
																				) {
																					// Autosave before navigating
																					if (!profileLocked)
																						await autoSaveEmployee();
																					setEditSubTab(
																						editSubTabOrder[currentIndex + 1]
																					);
																				}
																			}}
																			className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-lg hover:from-[#86288F] hover:to-[#64126D]"
																		>
																			Next
																			<ChevronRightIcon className="h-4 w-4" />
																		</button>
																	)}
																</div>
															</div>
														</fieldset>
													</form>
												</div>
											</div>
										</section>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</AccessGuard>
	);
}
