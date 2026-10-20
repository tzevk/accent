import type { LeadStage } from '@/lib/lead-stages';
import type { LeadReviewState } from '@/lib/lead-review';
import type { LeadTimelineEntry, LeadWorkSummary } from '@/lib/lead-activities';

export type { LeadTimelineEntry, LeadWorkSummary };

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
	last_contact_at: string | null;
	latest_activity_at: string | null;
	latest_activity_outcome: string | null;
	next_action_date: string | null;
	next_action_type: string | null;
	activity_count: number;
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
	/** One counter per actionable queue, counted over the whole dataset. */
	queue_all: number;
	queue_my_leads: number;
	queue_unassigned: number;
	queue_due_today: number;
	queue_overdue: number;
	queue_untouched: number;
	queue_no_next_action: number;
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

export interface LeadTimelineResponse {
	success: boolean;
	data: {
		entries: LeadTimelineEntry[];
	};
}

export interface LeadActivityResponse {
	success: boolean;
	data: {
		activity_id: number;
		stage: LeadStage | null;
		next_action_date: string | null;
	};
}

/** The values one correction speaks about. */
export interface LeadCorrectionValues {
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: boolean | null;
	occurred_at: string | null;
	notes: string | null;
}

/** One correction of one activity, with the values it kept and replaced. */
export interface LeadActivityCorrection {
	id: number;
	activity_id: number;
	reason: string;
	previous_values: LeadCorrectionValues;
	corrected_values: LeadCorrectionValues;
	corrected_by: number | null;
	actor_name: string | null;
	corrected_at: string | null;
}

export interface LeadCorrectionResponse {
	success: boolean;
	data: {
		activity_id: number;
		version: number;
		corrected_at: string;
	};
}

export interface LeadCorrectionStateResponse {
	success: boolean;
	data: {
		activity: {
			id: number;
			activity_type: string | null;
			status: string | null;
			call_outcome: string | null;
			reply_confirmed: boolean | null;
			occurred_at: string | null;
			notes: string | null;
			version: number;
		};
		corrections: LeadActivityCorrection[];
	};
}

export interface LeadLifecycleResponse {
	success: boolean;
	data: {
		stage: LeadStage;
		next_action_date: string | null;
		owner_user_id: number | null;
	};
}

/** The answer of the Lead-to-Proposal handoff. */
export interface LeadConversionResponse {
	success: boolean;
	data: {
		proposal_id: number;
		proposal: Record<string, unknown>;
		already_converted: boolean;
	};
}

export interface LeadTaskResponse {
	success: boolean;
	data: {
		task_id: number;
		next_action_date: string | null;
	};
}

export interface LeadTaskUpdateResponse {
	success: boolean;
	data: {
		task_id: number;
		status: string;
		next_action_date: string | null;
	};
}

/** One outstanding scheduled piece of Lead work across every Lead. */
export interface LeadWorkItem {
	id: number;
	lead_id: number;
	company_name: string | null;
	activity_type: string | null;
	scheduled_for: string | null;
	next_action: string | null;
	status: string | null;
}

export interface LeadWorkQueueResponse {
	success: boolean;
	data: {
		work: LeadWorkItem[];
	};
}

export interface ImportResponse {
	success: boolean;
	imported: number;
	needs_review: number;
	errors: string[] | null;
	message: string;
}
