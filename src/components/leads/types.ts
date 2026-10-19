import type { LeadStage } from '@/lib/lead-stages';
import type { LeadReviewState } from '@/lib/lead-review';

export interface DuplicateCandidate {
	id: number;
	lead_id: string | null;
	project_description: string | null;
}

export interface OwnershipHistoryEntry {
	id: number;
	prior_owner_user_id: number | null;
	owner_user_id: number | null;
	actor_user_id: number | null;
	created_at: string | null;
}

export interface LeadListRow {
	id: number;
	lead_id: string | null;
	company_name: string | null;
	contact_name: string | null;
	contact_email: string | null;
	phone: string | null;
	city: string | null;
	project_description: string | null;
	enquiry_type: string | null;
	enquiry_status: LeadStage | null;
	owner_user_id: number | null;
	owner_name: string | null;
	legacy_review_required: boolean;
	legacy_stage: string | null;
	legacy_owner_name: string | null;
	canonical_proposal_id: number | null;
	follow_up_date: string | null;
	enquiry_date: string | null;
	priority: string | null;
	lead_source: string | null;
	created_at: string | null;
	updated_at?: string | null;
}

export interface LeadDetail extends LeadListRow {
	lead_id: string | null;
	designation: string | null;
	inquiry_email: string | null;
	cc_emails: string | null;
	notes: string | null;
	duplicate_candidates: DuplicateCandidate[];
	ownership_history: OwnershipHistoryEntry[];
	review: LeadReviewState;
}

export interface LeadListStats {
	total_leads: number;
	unassigned_leads: number;
	needs_review_leads: number;
	stage_new: number;
	stage_attempting_contact: number;
	stage_connected: number;
	stage_qualified: number;
	stage_nurture: number;
	stage_disqualified: number;
	stage_converted: number;
	stage_unresolved: number;
}

export interface LeadListResponse {
	success: boolean;
	data: {
		leads: LeadListRow[];
		stats: LeadListStats;
		pagination: {
			page: number;
			limit: number;
			total: number;
			totalPages: number;
		};
	};
}

export interface LeadDetailResponse {
	success: boolean;
	data: LeadDetail;
}

export interface OwnersResponse {
	success: boolean;
	data: Array<{ id: number; full_name: string }>;
}

export interface ImportResponse {
	success: boolean;
	imported: number;
	needs_review: number;
	errors: string[] | null;
	message: string;
}
