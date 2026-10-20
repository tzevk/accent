'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import type {
	LeadDetailResponse,
	LeadListResponse,
	LeadTimelineResponse,
	OwnersResponse,
} from '@/components/leads/types';

export interface CompanyDirectoryRow {
	id: number;
	company_name: string;
	city?: string | null;
	state?: string | null;
	phone?: string | null;
	mobile_number?: string | null;
	email?: string | null;
	contact_person?: string | null;
	designation?: string | null;
}

interface CompanyDirectoryResponse {
	success: boolean;
	data: CompanyDirectoryRow[];
}

export const leadKeys = {
	all: ['leads'] as const,
	list: (params: Record<string, string>) => ['leads', params] as const,
	detail: (id: string) => ['leads', id] as const,
	owners: ['lead-owners'] as const,
	companies: ['companies-all'] as const,
	timeline: (leadId: string) => ['lead-timeline', leadId] as const,
};

export function useLeadList(params: Record<string, string>, enabled: boolean) {
	return useQuery<LeadListResponse>({
		queryKey: leadKeys.list(params),
		queryFn: () => apiGet<LeadListResponse>('/api/leads/list', params),
		enabled,
	});
}

export function useLeadDetail(id: string | null, enabled: boolean) {
	return useQuery<LeadDetailResponse>({
		queryKey: leadKeys.detail(id ?? ''),
		queryFn: () => apiGet<LeadDetailResponse>(`/api/leads/${id ?? ''}`),
		enabled: enabled && id !== null && id !== '',
	});
}

export function useLeadOwners(enabled: boolean) {
	return useQuery<OwnersResponse>({
		queryKey: leadKeys.owners,
		queryFn: () => apiGet<OwnersResponse>('/api/leads/owners'),
		enabled,
		staleTime: 60_000,
	});
}

export function useCompanyDirectory(enabled: boolean) {
	return useQuery<CompanyDirectoryResponse>({
		queryKey: leadKeys.companies,
		queryFn: () => apiGet<CompanyDirectoryResponse>('/api/companies'),
		enabled,
		staleTime: 60_000,
	});
}

/**
 * The chronological Lead timeline: the activities, the stage changes, and
 * the ownership changes of one Lead.
 */
export function useLeadTimeline(leadId: string | null, enabled: boolean) {
	return useQuery<LeadTimelineResponse>({
		queryKey: leadKeys.timeline(leadId ?? ''),
		queryFn: () =>
			apiGet<LeadTimelineResponse>(`/api/leads/${leadId ?? ''}/timeline`),
		enabled: enabled && leadId !== null && leadId !== '',
	});
}
