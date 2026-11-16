'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
	SalaryDirectoryCounts,
	SalaryDirectoryFilter,
	SalaryDirectoryRow,
	SalaryPeriod,
} from '@/lib/salary-profile-directory';
import type {
	SalaryCommandInput,
	SalaryCommandOperation,
	SalaryTimelineDto,
} from '@/lib/salary-profile-commands';

/**
 * Client reads/writes for the Salary Profiles workspace (#444).
 *
 * The routes are payroll-authorized; these hooks add no permission of their
 * own. Command failures keep the server's `code`, `details` and HTTP status so
 * the editor can explain a stale version, a protected agreement or a payroll
 * use conflict instead of flattening every refusal into one message.
 */

export interface SalaryDirectoryRequest {
	date: string;
	search: string;
	stream: SalaryDirectoryFilter | 'all';
	page: number;
	limit: number;
}

export interface SalaryDirectoryPayload {
	success: true;
	period: SalaryPeriod;
	as_of: string;
	page: number;
	limit: number;
	total: number;
	counts: SalaryDirectoryCounts;
	data: SalaryDirectoryRow[];
}

export interface SalaryTimelinePayload {
	success: true;
	data: SalaryTimelineDto;
}

export interface SalaryCommandResult {
	operation: SalaryCommandOperation;
	agreement_id: number;
	timeline_version: number;
	classification: 'current' | 'scheduled' | 'previous' | 'cancelled';
	effective_from: string;
	effective_to: string | null;
}

export interface SalaryRatesPayload {
	date: string;
	gross_salary: number;
	components: Record<string, unknown>;
}

/** A salary-route refusal that keeps the machine-readable reason. */
export class SalaryProfileRequestError extends Error {
	readonly status: number;
	readonly code: string | null;
	readonly details: Record<string, unknown> | null;

	constructor(
		message: string,
		status: number,
		code: string | null,
		details: Record<string, unknown> | null
	) {
		super(message);
		this.name = 'SalaryProfileRequestError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

async function requestSalaryJson<T>(
	url: string,
	init?: RequestInit
): Promise<T> {
	const response = await fetch(url, {
		credentials: 'include',
		...init,
	});
	let payload: unknown = null;
	try {
		payload = await response.json();
	} catch {
		// A non-JSON body is reported by status below.
	}
	const record =
		payload && typeof payload === 'object'
			? (payload as Record<string, unknown>)
			: {};
	if (!response.ok || record.success === false) {
		const message =
			typeof record.error === 'string'
				? record.error
				: `Request failed (${response.status})`;
		throw new SalaryProfileRequestError(
			message,
			response.status,
			typeof record.code === 'string' ? record.code : null,
			record.details && typeof record.details === 'object'
				? (record.details as Record<string, unknown>)
				: null
		);
	}
	return record as unknown as T;
}

function directoryUrl(request: SalaryDirectoryRequest): string {
	const params = new URLSearchParams();
	params.set('date', request.date);
	const search = request.search.trim();
	if (search) params.set('search', search);
	if (request.stream !== 'all') params.set('stream', request.stream);
	params.set('page', String(request.page));
	params.set('limit', String(request.limit));
	return `/api/payroll/employees-with-profiles?${params.toString()}`;
}

export function useSalaryProfileDirectory(
	request: SalaryDirectoryRequest,
	enabled = true
) {
	return useQuery<SalaryDirectoryPayload>({
		queryKey: ['salary-profiles', 'directory', request],
		queryFn: () =>
			requestSalaryJson<SalaryDirectoryPayload>(directoryUrl(request)),
		enabled,
		// Filter and page changes keep the previous rows visible while the next
		// page loads instead of flashing an empty table.
		placeholderData: (previous) => previous,
	});
}

export function useSalaryProfileTimeline(
	employeeId: number,
	options: { date: string; month: string },
	enabled = true
) {
	const params = new URLSearchParams();
	params.set('employee_id', String(employeeId));
	if (options.date) params.set('date', options.date);
	if (options.month) params.set('month', options.month);

	return useQuery<SalaryTimelinePayload>({
		queryKey: [
			'salary-profiles',
			'timeline',
			employeeId,
			options.date,
			options.month,
		],
		queryFn: () =>
			requestSalaryJson<SalaryTimelinePayload>(
				`/api/payroll/salary-profile?${params.toString()}`
			),
		enabled: enabled && Number.isInteger(employeeId) && employeeId > 0,
	});
}

/**
 * Date-effective Component Rates used by the estimate. A failure is surfaced
 * by the preview, never replaced with invented component amounts.
 */
export function useSalaryComponentRates(
	date: string,
	gross: number,
	enabled = true
) {
	const params = new URLSearchParams();
	params.set('date', date);
	params.set('gross', String(gross));

	return useQuery<SalaryRatesPayload>({
		queryKey: ['salary-profiles', 'rates', date, gross],
		queryFn: async () => {
			const response = await requestSalaryJson<{
				success: true;
				data: SalaryRatesPayload;
			}>(`/api/payroll/schedules/current?${params.toString()}`);
			return response.data;
		},
		enabled: enabled && Boolean(date),
		staleTime: 60_000,
	});
}

export function useSalaryCommand() {
	const queryClient = useQueryClient();
	return useMutation<SalaryCommandResult, Error, SalaryCommandInput>({
		mutationFn: async (input) => {
			const response = await requestSalaryJson<{
				success: true;
				data: SalaryCommandResult;
			}>('/api/payroll/salary-profile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(input),
			});
			return response.data;
		},
		onSuccess: () => {
			// The timeline, the directory state and the estimate's provenance all
			// move together after a command.
			void queryClient.invalidateQueries({ queryKey: ['salary-profiles'] });
		},
	});
}
