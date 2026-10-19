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
	follow_up_date: string | null;
	isDelete: number | null;
}

export interface DbOwnershipRow {
	id: number;
	lead_id: number;
	prior_owner_user_id: number | null;
	owner_user_id: number | null;
	actor_user_id: number | null;
	created_at: string;
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

export interface Reader {
	leadRow: (id: number) => Promise<DbLeadRow | null>;
	ownershipHistory: (leadId: number) => Promise<DbOwnershipRow[]>;
	userByUsername: (username: string) => Promise<Record<string, unknown> | null>;
	countLeadsByCompany: (companyName: string) => Promise<number>;
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
	trackLead: (id: number) => void;
}

export type Scenario = (context: ScenarioContext) => Promise<void>;
