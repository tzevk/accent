'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import type {
	LeadDetailResponse,
	LeadListResponse,
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

export interface FollowUpRow {
	id: number;
	follow_up_date: string | null;
	follow_up_type: string | null;
	description: string | null;
	status: string | null;
	notes: string | null;
	next_follow_up_date?: string | null;
	next_action?: string | null;
}

interface FollowUpListResponse {
	success: boolean;
	data: FollowUpRow[];
}

interface FollowUpDetailResponse {
	success: boolean;
	data: FollowUpRow;
}

export const leadKeys = {
	all: ['leads'] as const,
	list: (params: Record<string, string>) => ['leads', params] as const,
	detail: (id: string) => ['leads', id] as const,
	owners: ['lead-owners'] as const,
	companies: ['companies-all'] as const,
	followUps: (leadId: number) => ['lead-followups', leadId] as const,
	followUp: (followUpId: number) => ['lead-followup', followUpId] as const,
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

export function useLeadFollowUps(leadId: number | null, enabled: boolean) {
	return useQuery<FollowUpListResponse>({
		queryKey: leadKeys.followUps(leadId ?? 0),
		queryFn: () =>
			apiGet<FollowUpListResponse>('/api/followups', {
				lead_id: leadId ?? 0,
			}),
		enabled: enabled && leadId !== null,
	});
}

export function useFollowUpDetail(followUpId: number | null) {
	return useQuery<FollowUpDetailResponse>({
		queryKey: leadKeys.followUp(followUpId ?? 0),
		queryFn: () =>
			apiGet<FollowUpDetailResponse>(`/api/followups/${followUpId ?? 0}`),
		enabled: followUpId !== null,
	});
}
