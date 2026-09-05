'use client';

import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import {
	createEmployeeFormData,
	type EmployeeFormData,
	type EmployeeFormValue,
	type EmployeeSection,
	stringValue,
	validateEmployeeForm,
} from '@/utils/employee-form';
import type { EmployeeRecord } from '@/hooks/useEmployeeDirectory';

export interface EmployeeOption {
	id: number | string;
	role_name?: string;
	name?: string;
	username?: string;
	full_name?: string;
	employee_id?: number | string | null;
	company_name?: string;
	[key: string]: unknown;
}

export interface EmployeeFormOptions {
	employeeType?: string | null;
	onSaved?: (
		employee: EmployeeRecord,
		created: boolean
	) => void | Promise<void>;
}

export interface EmployeeAttendanceState {
	summary: Record<string, unknown>[];
	dayDetails: Record<string, unknown>[];
	loading: boolean;
}

export interface EmployeeFormBoundary {
	selectedEmployee: EmployeeRecord | null;
	formData: EmployeeFormData;
	formError: string;
	successMessage: string;
	saving: boolean;
	autoSaving: boolean;
	lastAutoSave: Date | null;
	photoUploading: boolean;
	profileLocked: boolean;
	setProfileLocked: (locked: boolean) => void;
	activeSection: EmployeeSection;
	setActiveSection: (section: EmployeeSection) => void;
	roles: EmployeeOption[];
	users: EmployeeOption[];
	companies: EmployeeOption[];
	attendance: EmployeeAttendanceState;
	attendanceSummaryMonth: string;
	setAttendanceSummaryMonth: (month: string) => void;
	openEmployee: (employee: EmployeeRecord) => void;
	startNewEmployee: () => void;
	updateField: (field: string, value: EmployeeFormValue) => void;
	saveEmployee: (event?: FormEvent<HTMLFormElement>) => Promise<boolean>;
	autoSaveEmployee: () => Promise<boolean>;
	uploadPhoto: (file: File) => Promise<boolean>;
	loadAttendance: () => Promise<void>;
}

interface ApiResponse {
	success?: boolean;
	data?: unknown;
	error?: string;
	message?: string;
}

interface AttendanceResponse extends ApiResponse {
	dayDetails?: unknown[];
}

interface EmployeeSaveInput {
	created: boolean;
	employeeId?: number | string;
	formData: EmployeeFormData;
}

async function saveEmployeeRequest({
	created,
	employeeId,
	formData,
}: EmployeeSaveInput): Promise<ApiResponse> {
	return (
		created
			? await apiPost('/api/employees', formData)
			: await apiPut(`/api/employees?id=${employeeId}`, {
					...formData,
					id: employeeId,
				})
	) as ApiResponse;
}

async function readJson(url: string): Promise<ApiResponse> {
	return (await apiGet(url)) as ApiResponse;
}

export function useEmployeeForm({
	employeeType = null,
	onSaved,
}: EmployeeFormOptions = {}): EmployeeFormBoundary {
	const [selectedEmployee, setSelectedEmployee] =
		useState<EmployeeRecord | null>(null);
	const [formData, setFormData] = useState<EmployeeFormData>(() =>
		createEmployeeFormData(null, employeeType)
	);
	const [formError, setFormError] = useState('');
	const [successMessage, setSuccessMessage] = useState('');
	const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
	const [profileLocked, setProfileLocked] = useState(false);
	const [activeSection, setActiveSection] =
		useState<EmployeeSection>('personal');
	const [attendanceSummaryMonth, setAttendanceSummaryMonth] = useState(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	});
	const rolesQuery = useQuery<ApiResponse>({
		queryKey: ['employee-options', 'roles'],
		queryFn: () => readJson('/api/roles-master'),
	});
	const usersQuery = useQuery<ApiResponse>({
		queryKey: ['employee-options', 'users'],
		queryFn: () => readJson('/api/users?limit=1000'),
	});
	const companiesQuery = useQuery<ApiResponse>({
		queryKey: ['employee-options', 'companies'],
		queryFn: () => readJson('/api/companies'),
	});
	const roles = useMemo(
		() =>
			(rolesQuery.data?.success
				? rolesQuery.data.data || []
				: []) as EmployeeOption[],
		[rolesQuery.data]
	);
	const users = useMemo(
		() =>
			(usersQuery.data?.success
				? usersQuery.data.data || []
				: []) as EmployeeOption[],
		[usersQuery.data]
	);
	const companies = useMemo(
		() =>
			(companiesQuery.data?.success
				? companiesQuery.data.data || []
				: []) as EmployeeOption[],
		[companiesQuery.data]
	);
	const saveMutation = useMutation<ApiResponse, Error, EmployeeSaveInput>({
		mutationFn: saveEmployeeRequest,
	});
	const autoSaveMutation = useMutation<ApiResponse, Error, EmployeeSaveInput>({
		mutationFn: saveEmployeeRequest,
	});
	const uploadMutation = useMutation<
		ApiResponse & { data?: { fileUrl?: string } },
		Error,
		{ filename: string; b64: string }
	>({
		mutationFn: (body) => apiPost('/api/uploads', body),
	});
	const attendanceQuery = useQuery<AttendanceResponse>({
		queryKey: [
			'employee-attendance',
			selectedEmployee?.id ?? null,
			attendanceSummaryMonth,
		],
		queryFn: () =>
			readJson(
				`/api/attendance/summary?employee_id=${encodeURIComponent(String(selectedEmployee?.id))}&month=${encodeURIComponent(attendanceSummaryMonth)}`
			) as Promise<AttendanceResponse>,
		enabled: Boolean(selectedEmployee?.id),
	});
	const attendance = useMemo<EmployeeAttendanceState>(
		() => ({
			summary: (attendanceQuery.data?.data || []) as Record<string, unknown>[],
			dayDetails: (attendanceQuery.data?.dayDetails || []) as Record<
				string,
				unknown
			>[],
			loading: attendanceQuery.isFetching,
		}),
		[attendanceQuery.data, attendanceQuery.isFetching]
	);

	const openEmployee = useCallback(
		(employee: EmployeeRecord) => {
			const role = roles.find((option) => option.role_name === employee.role);
			const systemRoleId =
				role?.id || employee.system_role_id || employee.role || '';
			setSelectedEmployee(employee);
			setFormData({
				...createEmployeeFormData(employee),
				system_role_id: String(systemRoleId),
				system_role_name: stringValue(employee.role),
			});
			setFormError('');
			setSuccessMessage('');
			setProfileLocked(false);
			setActiveSection('personal');
		},
		[roles]
	);

	const startNewEmployee = useCallback(() => {
		setSelectedEmployee(null);
		setFormData(createEmployeeFormData(null, employeeType));
		setFormError('');
		setSuccessMessage('');
		setProfileLocked(false);
		setActiveSection('personal');
	}, [employeeType]);

	const updateField = useCallback((field: string, value: EmployeeFormValue) => {
		setFormData((current) => ({ ...current, [field]: value }));
		setFormError('');
	}, []);

	const saveEmployee = useCallback(
		async (event?: FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			if (profileLocked) {
				setFormError('Profile is locked. Unlock to make changes.');
				return false;
			}
			const validationError = validateEmployeeForm(formData);
			if (validationError) {
				setFormError(validationError);
				return false;
			}
			setFormError('');
			setSuccessMessage('');
			const created = !selectedEmployee;
			try {
				const data = await saveMutation.mutateAsync({
					created,
					employeeId: selectedEmployee?.id,
					formData,
				});
				const savedEmployee = {
					...(created ? {} : selectedEmployee),
					...formData,
					...((data.data || {}) as Record<string, unknown>),
				} as EmployeeRecord;
				await onSaved?.(savedEmployee, created);
				if (created) startNewEmployee();
				setSuccessMessage(
					created
						? 'Employee created successfully!'
						: 'Employee updated successfully!'
				);
				return true;
			} catch (saveError) {
				setFormError((saveError as Error).message || 'Failed to save employee');
				return false;
			}
		},
		[
			formData,
			onSaved,
			profileLocked,
			saveMutation,
			selectedEmployee,
			startNewEmployee,
		]
	);

	const autoSaveEmployee = useCallback(async () => {
		if (!selectedEmployee?.id || profileLocked) return false;
		try {
			const data = await autoSaveMutation.mutateAsync({
				created: false,
				employeeId: selectedEmployee.id,
				formData,
			});
			const savedEmployee = {
				...selectedEmployee,
				...formData,
				...((data.data || {}) as Record<string, unknown>),
			} as EmployeeRecord;
			setSelectedEmployee(savedEmployee);
			setLastAutoSave(new Date());
			return true;
		} catch (saveError) {
			console.error('Autosave failed:', saveError);
			return false;
		}
	}, [autoSaveMutation, formData, profileLocked, selectedEmployee]);

	const uploadPhoto = useCallback(
		async (file: File) => {
			if (!file.type.startsWith('image/')) {
				setFormError('Please upload an image file.');
				return false;
			}
			if (file.size > 15 * 1024 * 1024) {
				setFormError('Image is too large. Please upload a file up to 15 MB.');
				return false;
			}
			try {
				const dataUrl = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result));
					reader.onerror = () =>
						reject(reader.error || new Error('Failed to read image'));
					reader.readAsDataURL(file);
				});
				const data = await uploadMutation.mutateAsync({
					filename: file.name || 'upload.png',
					b64: dataUrl.split(',')[1] || dataUrl,
				});
				if (!data.success || !data.data?.fileUrl) {
					throw new Error(data.error || 'Upload failed');
				}
				updateField('profile_photo_url', data.data.fileUrl);
				setSelectedEmployee((current) =>
					current
						? { ...current, profile_photo_url: data.data?.fileUrl }
						: current
				);
				return true;
			} catch (uploadError) {
				setFormError(
					(uploadError as Error).message || 'Failed to upload photo'
				);
				return false;
			}
		},
		[updateField, uploadMutation]
	);

	const loadAttendance = useCallback(async () => {
		if (!selectedEmployee?.id) return;
		await attendanceQuery.refetch();
	}, [attendanceQuery.refetch, selectedEmployee?.id]);

	return {
		selectedEmployee,
		formData,
		formError,
		successMessage,
		saving: saveMutation.isPending,
		autoSaving: autoSaveMutation.isPending,
		lastAutoSave,
		photoUploading: uploadMutation.isPending,
		profileLocked,
		setProfileLocked,
		activeSection,
		setActiveSection,
		roles,
		users,
		companies,
		attendance,
		attendanceSummaryMonth,
		setAttendanceSummaryMonth,
		openEmployee,
		startNewEmployee,
		updateField,
		saveEmployee,
		autoSaveEmployee,
		uploadPhoto,
		loadAttendance,
	};
}
