import { z } from 'zod';

export interface HttpResponse {
	status: number;
	text: string;
	json: () => unknown;
}

export function extractSessionCookie(setCookie: string | null): string | null {
	if (!setCookie) return null;
	const match = setCookie.match(/(?:^|,\s*)session=([^;,\s]+)/);
	return match ? match[1] : null;
}

const LeadReviewItemSchema = z.object({
	type: z.string(),
	label: z.string(),
	original_value: z.string().nullable(),
});

const LeadReviewResolutionSchema = z.object({
	id: z.number(),
	review_type: z.string(),
	original_value: z.string().nullable(),
	resolved_value: z.string().nullable(),
	resolved_reference: z.number().nullable(),
	reason: z.string(),
	resolution_source: z.string(),
	reviewer_user_id: z.number().nullable(),
	reviewer_name: z.string().nullable(),
	resolved_at: z.string().nullable(),
});

const LinkedProposalSchema = z.object({
	id: z.number(),
	proposal_title: z.string().nullable(),
	proposal_id: z.string().nullable(),
	quotation_number: z.string().nullable(),
	status: z.string().nullable(),
	created_at: z.string().nullable(),
	is_deleted: z.boolean(),
	is_canonical: z.boolean(),
});

const LeadReviewStateSchema = z.object({
	open_items: z.array(LeadReviewItemSchema),
	resolutions: z.array(LeadReviewResolutionSchema),
	linked_proposals: z.array(LinkedProposalSchema),
	canonical_proposal_id: z.number().nullable(),
	proposal_link_conflict: z.boolean(),
	unknown_facts: z.object({
		stage_entry_date: z.string(),
		original_author: z.string(),
		original_outcome: z.string(),
	}),
});

const LeadDetailSchema = z
	.object({
		id: z.number(),
		lead_id: z.string().nullable(),
		company_name: z.string(),
		project_description: z.string().nullable(),
		enquiry_status: z.string().nullable(),
		owner_user_id: z.number().nullable(),
		owner_name: z.string().nullable(),
		legacy_stage: z.string().nullable(),
		legacy_owner_name: z.string().nullable(),
		legacy_review_required: z.boolean(),
		canonical_proposal_id: z.number().nullable().optional(),
		review: LeadReviewStateSchema.optional(),
		follow_up_date: z.string().nullable().optional(),
		duplicate_candidates: z
			.array(
				z.object({
					id: z.number(),
					lead_id: z.string().nullable(),
					project_description: z.string().nullable(),
				})
			)
			.optional(),
		ownership_history: z
			.array(
				z.object({
					id: z.number(),
					prior_owner_user_id: z.number().nullable(),
					owner_user_id: z.number().nullable(),
					actor_user_id: z.number().nullable(),
					created_at: z.string(),
				})
			)
			.optional(),
	})
	.passthrough();

export type LeadDetail = z.infer<typeof LeadDetailSchema>;

const LeadListRowSchema = z
	.object({
		id: z.number(),
		company_name: z.string(),
		enquiry_status: z.string().nullable(),
		owner_user_id: z.number().nullable(),
		owner_name: z.string().nullable(),
		legacy_stage: z.string().nullable(),
		legacy_owner_name: z.string().nullable(),
		legacy_review_required: z.boolean(),
		follow_up_date: z.string().nullable().optional(),
	})
	.passthrough();

export type LeadListRow = z.infer<typeof LeadListRowSchema>;

const OwnerDirectoryEntrySchema = z.object({
	id: z.number(),
	full_name: z.string(),
});

export type OwnerDirectoryEntry = z.infer<typeof OwnerDirectoryEntrySchema>;

export function parseLeadDetail(raw: unknown): LeadDetail {
	return LeadDetailSchema.parse(raw);
}

export function parseLeadListRow(raw: unknown): LeadListRow {
	return LeadListRowSchema.parse(raw);
}

export function parseOwnerDirectory(raw: unknown): OwnerDirectoryEntry[] {
	return z.array(OwnerDirectoryEntrySchema).parse(raw);
}

export interface DbLeadRow {
	id: number;
	lead_id: string | null;
	company_name: string;
	project_description: string | null;
	enquiry_status: string | null;
	owner_user_id: number | null;
	legacy_stage: string | null;
	legacy_owner_name: string | null;
	legacy_review_required: number | boolean | null;
	legacy_stage_reviewed: number | boolean | null;
	legacy_owner_reviewed: number | boolean | null;
	legacy_proposal_reviewed: number | boolean | null;
	legacy_proposal_conflict: number | boolean | null;
	canonical_proposal_id: number | null;
	converted_at: string | null;
	converted_by: number | null;
	follow_up_date: string | null;
	isDelete: number | null;
}

export interface DbReviewRow {
	id: number;
	lead_id: number;
	review_type: string;
	original_value: string | null;
	resolved_value: string | null;
	resolved_reference: number | null;
	reason: string;
	resolution_source: string;
	reviewer_user_id: number | null;
	resolved_at: string;
}

export interface DbProposalRow {
	id: number;
	lead_id: number | null;
	proposal_title: string | null;
	description: string | null;
	status: string | null;
	progress: string | null;
	proposal_value: string | null;
	value: string | null;
	currency: string | null;
	project_id: number | null;
	canonical_lead_id: number | null;
	isDelete: number | null;
}

/** The Project a Proposal links to after its conversion. */
export interface DbProjectRow {
	project_id: number;
	project_title: string | null;
	name: string | null;
	status: string | null;
	progress: string | null;
	proposal_id: number | null;
	isDelete: number | null;
}

/** One row of the conversion evidence. */
export interface DbConversionRow {
	id: number;
	lead_id: number;
	proposal_id: number;
	converted_by: number | null;
	converted_at: string | null;
}

/** One Proposal follow-up: the work that moved to the Proposal. */
export interface DbProposalFollowupRow {
	id: number;
	proposal_id: number;
	follow_up_date: string | null;
	follow_up_type: string | null;
	description: string | null;
	status: string | null;
	created_by: number | null;
	/** The Lead activity this follow-up came from. */
	source_lead_activity_id: number | null;
}

export interface DbOwnershipRow {
	id: number;
	lead_id: number;
	prior_owner_user_id: number | null;
	owner_user_id: number | null;
	actor_user_id: number | null;
	created_at: string;
}

export interface DbActivityRow {
	id: number;
	lead_id: number;
	activity_type: string | null;
	status: string | null;
	call_outcome: string | null;
	reply_confirmed: number | null;
	scheduled_for: string | null;
	occurred_at: string | null;
	completed_at: string | null;
	next_action: string | null;
	notes: string | null;
	created_by: number | null;
	recorded_at: string | null;
	isDelete: number | null;
	version: number | null;
	transferred_followup_id: number | null;
	transferred_at: string | null;
}

export interface DbCorrectionRow {
	id: number;
	activity_id: number;
	lead_id: number;
	previous_values: string;
	corrected_values: string;
	reason: string;
	corrected_by: number | null;
	corrected_at: string | null;
}

export interface DbStageHistoryRow {
	id: number;
	lead_id: number;
	from_stage: string | null;
	to_stage: string | null;
	change_source: string | null;
	reason: string | null;
	actor_user_id: number | null;
	recorded_at: string | null;
}

export interface FixtureIdentity {
	id: number;
	username: string;
	email: string;
	fullName: string;
	password: string;
	sessionToken: string;
	permissions: string[];
}

/**
 * The queue counts of the active Lead table, counted by the reader and not
 * by the API: the scenarios compare the two.
 */
export interface DbQueueCounts {
	total: number;
	my_leads: number;
	unassigned: number;
	due_today: number;
	overdue: number;
	untouched: number;
	no_next_action: number;
}

export interface Reader {
	leadRow: (id: number) => Promise<DbLeadRow | null>;
	ownershipHistory: (leadId: number) => Promise<DbOwnershipRow[]>;
	reviewRows: (leadId: number) => Promise<DbReviewRow[]>;
	proposalRows: (leadId: number) => Promise<DbProposalRow[]>;
	proposalRow: (id: number) => Promise<DbProposalRow | null>;
	/** The Project a Proposal links to, read straight from the database. */
	projectRow: (id: number) => Promise<DbProjectRow | null>;
	activityRows: (leadId: number) => Promise<DbActivityRow[]>;
	correctionRows: (leadId: number) => Promise<DbCorrectionRow[]>;
	stageHistory: (leadId: number) => Promise<DbStageHistoryRow[]>;
	/** The conversion evidence of one enquiry. */
	conversionRows: (leadId: number) => Promise<DbConversionRow[]>;
	/** The Proposal work one Proposal inherited. */
	proposalFollowups: (proposalId: number) => Promise<DbProposalFollowupRow[]>;
	/** Every Proposal follow-up in the database, for the rollback proof. */
	countProposalFollowups: () => Promise<number>;
	/**
	 * The open transactions that hold a row lock. A released connection
	 * with an open transaction would show up here.
	 */
	countOpenTransactions: () => Promise<number>;
	userByUsername: (username: string) => Promise<Record<string, unknown> | null>;
	countLeadsByCompany: (companyName: string) => Promise<number>;
	/** The calendar day of the database, the date policy of the queues. */
	databaseToday: () => Promise<string>;
	/** The queue counts of the active Leads matching the search term. */
	queueCounts: (search: string, viewerUserId: number) => Promise<DbQueueCounts>;
	/** The active Leads matching the search term, counted by the reader. */
	countActiveLeads: (search: string) => Promise<number>;
}

export interface HttpClient {
	get: (path: string, sessionToken?: string) => Promise<HttpResponse>;
	post: (
		path: string,
		body: Record<string, unknown> | FormData,
		sessionToken?: string
	) => Promise<HttpResponse>;
	put: (
		path: string,
		body: Record<string, unknown>,
		sessionToken?: string
	) => Promise<HttpResponse>;
	patch: (
		path: string,
		body: Record<string, unknown>,
		sessionToken?: string
	) => Promise<HttpResponse>;
	delete: (path: string, sessionToken?: string) => Promise<HttpResponse>;
}

export interface LoginResult {
	id: number;
	sessionToken: string;
}

export interface LoginHttpClient extends HttpClient {
	login: (username: string, password: string) => Promise<LoginResult>;
}

export interface ScenarioContext {
	http: HttpClient;
	reader: Reader;
	runTag: string;
	creator: FixtureIdentity;
	assignee: FixtureIdentity;
	readOnly: FixtureIdentity;
	noAssign: FixtureIdentity;
	proposer: FixtureIdentity;
	/** A super admin: no resource grant at all, every check bypassed. */
	superAdmin: FixtureIdentity;
	/** The Lead convert right and the Proposal create right, no Lead update. */
	convertOnly: FixtureIdentity;
	/** The Lead update right and the Proposal create right, no Lead convert. */
	updateOnly: FixtureIdentity;
	trackLead: (id: number) => void;
}

export type Scenario = (context: ScenarioContext) => Promise<void>;
