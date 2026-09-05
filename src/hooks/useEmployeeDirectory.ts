'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet } from '@/lib/api-client';

export interface EmployeeRecord {
	[key: string]: unknown;
	id: number | string;
	first_name?: string;
	last_name?: string;
	employee_id?: string;
	email?: string;
	profile_photo_url?: string;
}

export interface EmployeeFilters {
	search: string;
	department: string;
	status: string;
	workplace: string;
	employmentStatus: string;
}

export interface EmployeePagination {
	total?: number;
	totalRecords?: number;
	limit?: number;
}

interface EmployeeListResponse {
	employees?: EmployeeRecord[];
	departments?: string[];
	workplaces?: string[];
	pagination?: EmployeePagination;
}

const EMPTY_FILTERS: EmployeeFilters = {
	search: '',
	department: '',
	status: '',
	workplace: '',
	employmentStatus: '',
};

function sortEmployees(records: EmployeeRecord[]): EmployeeRecord[] {
	return [...records].sort((first, second) => {
		const getNumber = (value: unknown) => {
			const match = String(value || '').match(/(\d+)$/);
			return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
		};
		const firstNumber = getNumber(first.employee_id);
		const secondNumber = getNumber(second.employee_id);
		if (firstNumber === secondNumber) return 0;
		return firstNumber === Number.POSITIVE_INFINITY
			? 1
			: secondNumber === Number.POSITIVE_INFINITY
				? -1
				: firstNumber - secondNumber;
	});
}

export function useEmployeeDirectory(employeeType?: string | null) {
	const [filters, setFilters] = useState<EmployeeFilters>(EMPTY_FILTERS);
	const [sidebarSearch, setSidebarSearch] = useState('');
	const [page, setPage] = useState(1);
	const queryClient = useQueryClient();
	const queryParams = useMemo(
		() => ({
			page,
			limit: 100,
			...(filters.search.trim() && { search: filters.search.trim() }),
			...(filters.department && { department: filters.department }),
			...(filters.status && { status: filters.status }),
			...(filters.workplace && { workplace: filters.workplace }),
			...(filters.employmentStatus && {
				employment_status: filters.employmentStatus,
			}),
			...(employeeType && { employee_type: employeeType }),
		}),
		[employeeType, filters, page]
	);
	const listQuery = useQuery<EmployeeListResponse>({
		queryKey: ['employees', employeeType || 'all', queryParams],
		queryFn: () =>
			apiGet(
				'/api/employees/list',
				queryParams
			) as Promise<EmployeeListResponse>,
	});
	const allQuery = useQuery<EmployeeListResponse>({
		queryKey: ['employees', 'all', employeeType || 'all'],
		queryFn: () =>
			apiGet('/api/employees/list', {
				page: 1,
				limit: 1000,
				...(employeeType && { employee_type: employeeType }),
			}) as Promise<EmployeeListResponse>,
	});
	const deleteMutation = useMutation({
		mutationFn: (employeeId: number | string) =>
			apiDelete(`/api/employees?id=${encodeURIComponent(String(employeeId))}`),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
	});
	const employees = useMemo(
		() => sortEmployees(listQuery.data?.employees || []),
		[listQuery.data?.employees]
	);
	const allEmployees = useMemo(
		() => sortEmployees(allQuery.data?.employees || []),
		[allQuery.data?.employees]
	);
	const filteredAllEmployees = useMemo(() => {
		const query = sidebarSearch.trim().toLowerCase();
		if (!query) return allEmployees;
		return allEmployees.filter((employee) => {
			const name =
				`${employee.first_name || ''} ${employee.last_name || ''}`.toLowerCase();
			return (
				name.includes(query) ||
				String(employee.employee_id || '')
					.toLowerCase()
					.includes(query) ||
				String(employee.email || '')
					.toLowerCase()
					.includes(query)
			);
		});
	}, [allEmployees, sidebarSearch]);
	const refresh = useCallback(async () => {
		await listQuery.refetch();
	}, [listQuery.refetch]);
	const refreshAll = useCallback(async () => {
		await allQuery.refetch();
	}, [allQuery.refetch]);
	const setFilter = useCallback((key: keyof EmployeeFilters, value: string) => {
		setFilters((current) => ({ ...current, [key]: value }));
		setPage(1);
	}, []);
	const clearFilters = useCallback(() => {
		setFilters(EMPTY_FILTERS);
		setPage(1);
	}, []);
	const deleteEmployee = useCallback(
		async (employeeId: number | string) => {
			await deleteMutation.mutateAsync(employeeId);
		},
		[deleteMutation]
	);

	return {
		employees,
		allEmployees,
		filteredAllEmployees,
		departments: listQuery.data?.departments || [],
		workplaces: listQuery.data?.workplaces || [],
		pagination: listQuery.data?.pagination || {},
		filters,
		setFilter,
		clearFilters,
		page,
		setPage,
		loading: listQuery.isLoading || listQuery.isFetching,
		error: listQuery.error instanceof Error ? listQuery.error.message : '',
		refresh,
		refreshAll,
		deleteEmployee,
		sidebarSearch,
		setSidebarSearch,
	};
}
