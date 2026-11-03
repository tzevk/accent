import { strict as assert } from 'node:assert';
import process from 'node:process';
import { z } from 'zod';
import { extractSessionCookie } from '../client.ts';
import { hashFixturePassword } from '../support.ts';
import type { ScenarioContext } from '../client.ts';

// The printable management summary (#406). The browser print surface is
// rendered from the same authenticated report body this scenario reads, so
// the scenario proves the data and permission behaviour the printout depends
// on through the real HTTP interface only: every expected figure below is an
// independent literal derived from the fixture rows, never from the report's
// own aggregates.
//
// No browser suite is added. The print stylesheet and the browser's own print
// dialog are presentation concerns owned by the report page.

const EffectiveFiltersSchema = z
	.object({
		owner: z.object({ value: z.string().nullable(), label: z.string() }),
		source: z.object({
			value: z.string().nullable(),
			label: z.string(),
			is_unknown: z.boolean(),
		}),
		stage: z.object({ value: z.string().nullable(), label: z.string() }),
		priority: z.string().nullable(),
		search: z.string(),
	})
	.passthrough();

const WorkSummarySchema = z
	.object({
		completed_total: z.number(),
		by_type: z.object({
			call: z.number(),
			email: z.number(),
			meeting: z.number(),
			note: z.number(),
			unknown: z.number(),
		}),
		outreach_total: z.number(),
		distinct_leads_worked: z.number(),
		distinct_leads_with_outreach: z.number(),
		successful_contact: z.number(),
		distinct_leads_with_successful_contact: z.number(),
		calls_connected: z.number(),
		calls_failed: z.number(),
		emails_confirmed_reply: z.number(),
		emails_unconfirmed: z.number(),
		corrected_activities: z.number(),
	})
	.passthrough();

const WorkCoverageSchema = z
	.object({
		unknown_occurrence_date: z.number(),
		unknown_activity_type: z.number(),
		unknown_author: z.number(),
		inactive_author: z.number(),
		cancelled_in_period: z.number(),
		deleted_activity_rows: z.number(),
	})
	.passthrough();

const CohortSchema = z
	.object({
		cohort_size: z.number(),
		handoffs_evidenced: z.number(),
		conversion_rate: z.number().nullable(),
		conversion_events: z.number(),
		undated_links: z.number(),
		unresolved_evidence: z.number(),
		stage_only_claims: z.number(),
		no_handoff_evidence: z.number(),
		observed_through: z.string(),
	})
	.passthrough();

const PeriodSchema = z
	.object({
		handoffs: z.number(),
		undated_canonical_links: z.number(),
		date_basis: z.string(),
	})
	.passthrough();

const DownstreamSchema = z
	.object({
		handoffs: z.number(),
		proposal_states: z.object({
			none: z.number(),
			unresolved: z.number(),
			restricted: z.number(),
			available: z.number(),
		}),
		project_states: z.object({
			none: z.number(),
			restricted: z.number(),
			available: z.number(),
		}),
	})
	.passthrough();

const TimingSchema = z
	.object({
		available: z.boolean(),
		median_seconds: z.number().nullable(),
		p90_seconds: z.number().nullable(),
		valid_samples: z.number(),
		cohort_leads: z.number(),
		without_outreach: z.number(),
		without_outreach_share: z.number().nullable(),
		exclusions: z.object({
			missing_timestamp: z.number(),
			incomplete_earlier: z.number(),
			negative: z.number(),
			total: z.number(),
		}),
		metric: z
			.object({
				key: z.literal('time_to_first_outreach'),
				label: z.literal('Time to first outreach'),
				clock: z.string(),
				observation: z.string(),
			})
			.passthrough(),
	})
	.passthrough();

const CurrentStateSchema = z
	.object({
		as_of: z
			.object({
				generated_at: z.string(),
				today: z.string(),
				date_basis: z.string(),
				time_zone: z.object({ label: z.string() }).passthrough(),
				live_data_warning: z.string(),
			})
			.passthrough(),
		scope: z
			.object({
				ignored_filters: z.array(
					z
						.object({
							key: z.string(),
							label: z.string(),
							value: z.string().nullable(),
							reason: z.string(),
						})
						.passthrough()
				),
			})
			.passthrough(),
		workload: z
			.object({
				counter_unit: z.literal('distinct_leads'),
				total: z.number(),
				owners: z.array(
					z
						.object({
							owner: z
								.object({
									id: z.number().nullable(),
									name: z.string(),
									is_inactive: z.boolean(),
									is_unknown: z.boolean(),
								})
								.passthrough(),
							count: z.number(),
						})
						.passthrough()
				),
			})
			.passthrough(),
		risks: z.array(
			z
				.object({
					key: z.string(),
					label: z.string(),
					count: z.number(),
					counter_unit: z.literal('distinct_leads'),
					evidence_unit: z.enum(['lead', 'scheduled_work_item']),
					as_of: z.string(),
				})
				.passthrough()
		),
	})
	.passthrough();

const ReportSchema = z
	.object({
		scope: z
			.object({
				preset: z.string(),
				from_date: z.string(),
				to_date: z.string(),
				date_basis: z.string(),
				effective_filters: EffectiveFiltersSchema,
			})
			.passthrough(),
		meta: z
			.object({
				generated_at: z.string(),
				today: z.string(),
				time_zone: z
					.object({ label: z.string(), utc_offset: z.string() })
					.passthrough(),
				live_data_warning: z.string(),
			})
			.passthrough(),
		summary: z
			.object({
				leads_recorded: z.number(),
				enquiries_dated: z.number(),
				missing_enquiry_date: z.number(),
				distinct_sources: z.number(),
			})
			.passthrough(),
		sources: z.array(
			z
				.object({
					label: z.string().nullable(),
					is_unknown: z.boolean(),
					count: z.number(),
				})
				.passthrough()
		),
		work: z
			.object({
				work_date_basis: z.string(),
				summary: WorkSummarySchema,
				coverage: WorkCoverageSchema,
			})
			.passthrough(),
		conversion: z
			.object({
				cohort: CohortSchema,
				period: PeriodSchema,
				downstream: DownstreamSchema,
			})
			.passthrough(),
		timing: TimingSchema,
		current_state: CurrentStateSchema,
	})
	.passthrough();

type ReportBody = z.infer<typeof ReportSchema>;

const ReportEnvelopeSchema = z
	.object({ success: z.literal(true), data: ReportSchema })
	.passthrough();

const EvidenceRowSchema = z
	.object({
		id: z.number(),
		company_name: z.string(),
		downstream: z
			.object({
				proposal_state: z.enum(['none', 'unresolved', 'restricted', 'available']),
				proposal: z
					.object({
						id: z.number(),
						title: z.string().nullable(),
						status: z.string().nullable(),
						project_state: z.enum(['none', 'restricted', 'available']),
						project: z
							.object({ id: z.number(), title: z.string().nullable() })
							.nullable(),
					})
					.nullable(),
			})
			.passthrough(),
	})
	.passthrough();

const EvidenceSchema = z
	.object({
		rows: z.array(EvidenceRowSchema),
		pagination: z.object({ total: z.number() }).passthrough(),
		downstream_options: z.object({
			include_proposals: z.boolean(),
			include_projects: z.boolean(),
		}),
	})
	.passthrough();

const EvidenceEnvelopeSchema = z
	.object({ success: z.literal(true), data: EvidenceSchema })
	.passthrough();

const PREFIX = 'ReportPrint';
const INTAKE_FROM = '2026-05-01';
const INTAKE_TO = '2026-05-31';
const HISTORICAL_FROM = '2024-01-01';
const HISTORICAL_TO = '2024-01-31';

function query(
	values: Record<string, string | number | null | undefined>
): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value === null || value === undefined || value === '') continue;
		params.set(key, String(value));
	}
	const suffix = params.toString();
	return suffix ? `?${suffix}` : '';
}

async function readReport(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<{ body: ReportBody; text: string }> {
	const response = await context.http.get(
		`/api/reports/lead-audit${query(values)}`,
		token
	);
	assert.equal(response.status, 200, `report status (body: ${response.text})`);
	return {
		body: ReportEnvelopeSchema.parse(response.json()).data,
		text: response.text,
	};
}

async function readConversionEvidence(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<{ body: z.infer<typeof EvidenceSchema>; text: string }> {
	const response = await context.http.get(
		`/api/reports/lead-audit/conversion/evidence${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`conversion evidence status (body: ${response.text})`
	);
	return {
		body: EvidenceEnvelopeSchema.parse(response.json()).data,
		text: response.text,
	};
}

interface SeededLead {
	id: number;
	company: string;
}

async function seedLead(
	context: ScenarioContext,
	namespace: 'Intake' | 'Risk',
	suffix: string,
	input: {
		recordedAt: string;
		enquiryDate?: string | null;
		source?: string | null;
		stage?: string | null;
		priority?: 'Low' | 'Medium' | 'High' | null;
		ownerUserId?: number | null;
		isDeleted?: boolean;
	}
): Promise<SeededLead> {
	const company = `${context.runTag} ${PREFIX} ${namespace} ${suffix}`;
	const id = await context.reader.seedReportLead({
		companyName: company,
		contactName: `${context.runTag} contact ${namespace} ${suffix}`,
		projectDescription: `${context.runTag} ${PREFIX} ${namespace} need ${suffix}`,
		recordedAt: input.recordedAt,
		enquiryDate: input.enquiryDate ?? null,
		source: input.source ?? null,
		stage: input.stage ?? null,
		priority: input.priority ?? null,
		ownerUserId: input.ownerUserId ?? null,
		isDeleted: input.isDeleted ?? false,
	});
	context.trackLead(id);
	return { id, company };
}

async function seedActivity(
	context: ScenarioContext,
	leadId: number,
	input: {
		activityType: string;
		status: 'Completed' | 'Scheduled';
		occurredAt?: string | null;
		scheduledFor?: string | null;
		callOutcome?: string | null;
		replyConfirmed?: 0 | 1 | null;
		createdBy?: number | null;
		recordedAt?: string;
	}
): Promise<number> {
	const occurredAt =
		input.occurredAt === undefined ? null : input.occurredAt;
	const recordedAt =
		input.recordedAt ?? occurredAt ?? '2026-05-01 00:00:00';
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activities (
       lead_id, activity_type, status, call_outcome, reply_confirmed,
       scheduled_for, occurred_at, completed_at, created_by, recorded_at,
       created_at, updated_at, isDelete, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
		[
			leadId,
			input.activityType,
			input.status,
			input.callOutcome ?? null,
			input.replyConfirmed ?? null,
			input.scheduledFor ?? null,
			occurredAt,
			input.status === 'Completed' ? occurredAt : null,
			input.createdBy ?? null,
			recordedAt,
			recordedAt,
			recordedAt,
		]
	);
	assert.ok(result.insertId > 0, 'the activity fixture has an id');
	return result.insertId;
}

async function insertProposal(
	context: ScenarioContext,
	input: {
		title: string;
		status: string;
		progress: number;
		leadId: number;
		canonicalLeadId: number | null;
		createdAt: string;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO proposals (
       proposal_title, status, progress, lead_id, canonical_lead_id,
       isDelete, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
		[
			input.title,
			input.status,
			input.progress,
			input.leadId,
			input.canonicalLeadId,
			input.createdAt,
			input.createdAt,
		]
	);
	assert.ok(result.insertId > 0, 'the Proposal fixture has an id');
	return result.insertId;
}

async function insertProject(
	context: ScenarioContext,
	input: { title: string; proposalId: number }
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO projects (
       project_title, status, progress, proposal_id, isDelete,
       created_at, updated_at
     ) VALUES (?, 'ONGOING', 25, ?, 0, ?, ?)`,
		[
			input.title,
			input.proposalId,
			'2026-05-04 09:00:00',
			'2026-05-04 09:00:00',
		]
	);
	assert.ok(result.insertId > 0, 'the Project fixture has an id');
	return result.insertId;
}

async function setCanonicalLink(
	context: ScenarioContext,
	input: {
		leadId: number;
		proposalId: number | null;
		convertedAt?: string | null;
		convertedBy?: number | null;
	}
): Promise<void> {
	const result = await context.reader.fixtureWrite(
		`UPDATE leads
     SET canonical_proposal_id = ?, converted_at = ?, converted_by = ?
     WHERE id = ?`,
		[
			input.proposalId,
			input.convertedAt ?? null,
			input.convertedBy ?? null,
			input.leadId,
		]
	);
	assert.equal(result.affectedRows, 1, 'the Lead fixture is updated');
}

async function insertConversion(
	context: ScenarioContext,
	input: { leadId: number; proposalId: number; convertedAt: string }
): Promise<void> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_conversions (
       lead_id, proposal_id, converted_by, converted_at, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
		[
			input.leadId,
			input.proposalId,
			context.assignee.id,
			input.convertedAt,
			input.convertedAt,
		]
	);
	assert.ok(result.insertId > 0, 'the conversion evidence has an id');
}

interface SeededReader {
	username: string;
	sessionToken: string;
}

async function seedReader(
	context: ScenarioContext,
	index: number,
	suffix: string,
	permissions: string[]
): Promise<SeededReader> {
	const username = `${context.runTag}-print-${suffix}`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-');
	const email = `${username}@example.com`;
	const password = 'Lit406-pass!';
	const passwordHash = await hashFixturePassword(password);
	const inserted = await context.reader.fixtureWrite(
		`INSERT INTO users (
       username, password_hash, email, full_name, status, is_active,
       isDelete, permissions, field_permissions, is_super_admin
     ) VALUES (?, ?, ?, ?, 'active', 1, 0, ?, NULL, 0)`,
		[
			username,
			passwordHash,
			email,
			`${context.runTag} Print ${suffix}`,
			JSON.stringify(permissions),
		]
	);
	assert.ok(inserted.insertId > 0, 'the permission fixture user has an id');

	const baseUrl = `http://127.0.0.1:${process.env.LEADS_INTEGRATION_PORT ?? 31369}`;
	const response = await fetch(`${baseUrl}/api/login`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-vercel-forwarded-for': `127.0.0.${60 + index}`,
		},
		body: JSON.stringify({ username, password }),
	});
	const text = await response.text();
	assert.equal(
		response.status,
		200,
		`print reader login for ${username} (body: ${text})`
	);
	const sessionToken = extractSessionCookie(response.headers.get('set-cookie'));
	assert.ok(sessionToken, 'print reader login sets a session cookie');
	return { username, sessionToken };
}

function addDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function riskCount(body: ReportBody, key: string): number {
	const risk = body.current_state.risks.find((entry) => entry.key === key);
	assert.ok(risk, `current-state risk ${key} is reported`);
	return risk.count;
}

function workloadCount(body: ReportBody, ownerId: number | null): number {
	const group = body.current_state.workload.owners.find((entry) =>
		ownerId === null ? entry.owner.id === null : entry.owner.id === ownerId
	);
	return group?.count ?? 0;
}

function sourceCount(body: ReportBody, source: string): number {
	const entry = body.sources.find((row) => row.label === source);
	return entry?.count ?? 0;
}

export async function leadAuditPrintScenario(
	context: ScenarioContext
): Promise<void> {
	const today = await context.reader.databaseToday();
	assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'the database calendar day');
	const yesterday = addDays(today, -1);
	const tomorrow = addDays(today, 1);

	const intakeSearch = `${context.runTag} ${PREFIX} Intake`;
	const riskSearch = `${context.runTag} ${PREFIX} Risk`;
	const proposalPrefix = `${context.runTag} ${PREFIX} Proposal`;
	const projectPrefix = `${context.runTag} ${PREFIX} Project`;
	const token = context.reportReader.sessionToken;

	// ── Intake fixtures: system entry, Enquiry Dates, work, and handoffs ────
	// A is recorded before the period, has a stated Enquiry Date inside it,
	// and hands off inside the period.
	const a = await seedLead(context, 'Intake', 'A Older Dated Handoff', {
		recordedAt: '2026-04-28 09:00:00',
		enquiryDate: '2026-05-01',
		source: 'Print Web',
		stage: 'Connected',
		priority: 'High',
		ownerUserId: context.assignee.id,
	});
	// B is a cohort Lead with a connected call and a dated handoff.
	const b = await seedLead(context, 'Intake', 'B Cohort Dated Handoff', {
		recordedAt: '2026-05-03 09:00:00',
		enquiryDate: '2026-05-02',
		source: 'Print Web',
		stage: 'Connected',
		priority: 'High',
		ownerUserId: context.assignee.id,
	});
	// C is a cohort Lead with a completed note and no enquiry date.
	const c = await seedLead(context, 'Intake', 'C Note Only', {
		recordedAt: '2026-05-04 09:00:00',
		enquiryDate: null,
		source: 'Print Referral',
		stage: 'Qualified',
		priority: 'Medium',
		ownerUserId: context.assignee.id,
	});
	// D is a cohort Lead with a resolved canonical link and no conversion date.
	const d = await seedLead(context, 'Intake', 'D Undated Canonical Link', {
		recordedAt: '2026-05-05 09:00:00',
		enquiryDate: '2026-05-06',
		source: null,
		stage: 'Qualified',
		priority: 'Medium',
		ownerUserId: context.creator.id,
	});
	// E is a cohort Lead with no work and no enquiry date.
	await seedLead(context, 'Intake', 'E No Work', {
		recordedAt: '2026-05-06 09:00:00',
		enquiryDate: null,
		source: null,
		stage: 'New',
		priority: null,
		ownerUserId: null,
	});
	// G is labelled Converted without any handoff evidence.
	await seedLead(context, 'Intake', 'G Label Only', {
		recordedAt: '2026-05-07 09:00:00',
		enquiryDate: '2026-05-07',
		source: null,
		stage: 'Converted',
		priority: 'Low',
		ownerUserId: context.assignee.id,
	});
	// H has completed outreach with no recorded occurrence time.
	const h = await seedLead(context, 'Intake', 'H Unknown Occurrence', {
		recordedAt: '2026-05-09 09:00:00',
		enquiryDate: null,
		source: null,
		stage: 'Attempting Contact',
		priority: 'Medium',
		ownerUserId: context.assignee.id,
	});
	// I has two live Proposals and no canonical choice: unresolved evidence.
	const i = await seedLead(context, 'Intake', 'I Unresolved Links', {
		recordedAt: '2026-05-10 09:00:00',
		enquiryDate: '2026-05-10',
		source: null,
		stage: 'Nurture',
		priority: 'Medium',
		ownerUserId: context.assignee.id,
	});
	// F is a soft-deleted cohort Lead whose retained work stays outside totals.
	const f = await seedLead(context, 'Intake', 'F Deleted', {
		recordedAt: '2026-05-07 12:00:00',
		enquiryDate: '2026-05-07',
		source: 'Print Web',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
		isDeleted: true,
	});

	await seedActivity(context, a.id, {
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'No Answer',
		occurredAt: '2026-05-10 10:00:00',
		createdBy: context.assignee.id,
	});
	await seedActivity(context, b.id, {
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		occurredAt: '2026-05-03 10:00:00',
		createdBy: context.assignee.id,
	});
	await seedActivity(context, c.id, {
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-05-05 10:00:00',
		createdBy: context.assignee.id,
	});
	await seedActivity(context, h.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: null,
		createdBy: context.assignee.id,
		recordedAt: '2026-05-09 10:00:00',
	});
	await seedActivity(context, f.id, {
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		occurredAt: '2026-05-08 10:00:00',
		createdBy: context.assignee.id,
	});

	const proposalA = await insertProposal(context, {
		title: `${proposalPrefix} A`,
		status: 'SENT',
		progress: 40,
		leadId: a.id,
		canonicalLeadId: a.id,
		createdAt: '2026-04-29 09:00:00',
	});
	const proposalB = await insertProposal(context, {
		title: `${proposalPrefix} B`,
		status: 'SENT',
		progress: 30,
		leadId: b.id,
		canonicalLeadId: b.id,
		createdAt: '2026-05-04 09:00:00',
	});
	const projectB = await insertProject(context, {
		title: `${projectPrefix} B`,
		proposalId: proposalB,
	});
	await context.reader.fixtureWrite(
		'UPDATE proposals SET project_id = ? WHERE id = ?',
		[projectB, proposalB]
	);
	const proposalD = await insertProposal(context, {
		title: `${proposalPrefix} D`,
		status: 'DRAFT',
		progress: 10,
		leadId: d.id,
		canonicalLeadId: d.id,
		createdAt: '2026-05-06 09:00:00',
	});
	await insertProposal(context, {
		title: `${proposalPrefix} I One`,
		status: 'DRAFT',
		progress: 0,
		leadId: i.id,
		canonicalLeadId: null,
		createdAt: '2026-05-11 09:00:00',
	});
	await insertProposal(context, {
		title: `${proposalPrefix} I Two`,
		status: 'DRAFT',
		progress: 0,
		leadId: i.id,
		canonicalLeadId: null,
		createdAt: '2026-05-11 10:00:00',
	});

	await setCanonicalLink(context, {
		leadId: a.id,
		proposalId: proposalA,
		convertedAt: '2026-05-20 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, {
		leadId: b.id,
		proposalId: proposalB,
		convertedAt: '2026-05-21 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, { leadId: d.id, proposalId: proposalD });
	await insertConversion(context, {
		leadId: a.id,
		proposalId: proposalA,
		convertedAt: '2026-05-20 10:00:00',
	});
	await insertConversion(context, {
		leadId: b.id,
		proposalId: proposalB,
		convertedAt: '2026-05-21 10:00:00',
	});

	// ── Risk fixtures: current state observed under a historical period ─────
	// R1 is unassigned and untouched; its 'New' stage is not an active stage.
	await seedLead(context, 'Risk', 'A Unassigned New', {
		recordedAt: '2026-01-05 09:00:00',
		stage: 'New',
		priority: 'Low',
		ownerUserId: null,
		source: 'Print Inbound',
	});
	// R2 has completed outreach and future scheduled work.
	const r2 = await seedLead(context, 'Risk', 'B Connected Tomorrow', {
		recordedAt: '2026-01-06 09:00:00',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
	});
	// R3 has untouched outreach and overdue scheduled work.
	const r3 = await seedLead(context, 'Risk', 'C Qualified Overdue', {
		recordedAt: '2026-01-07 09:00:00',
		stage: 'Qualified',
		ownerUserId: context.assignee.id,
	});
	// R4 has untouched outreach and work due today.
	const r4 = await seedLead(context, 'Risk', 'D Nurture Due Today', {
		recordedAt: '2026-01-08 09:00:00',
		stage: 'Nurture',
		ownerUserId: context.assignee.id,
	});
	// R5 was worked by an email and a note, with no outstanding work.
	const r5 = await seedLead(context, 'Risk', 'E Qualified Worked', {
		recordedAt: '2026-01-09 09:00:00',
		stage: 'Qualified',
		ownerUserId: context.creator.id,
	});
	// R6 is untouched with no scheduled work at all.
	await seedLead(context, 'Risk', 'F Nurture No Work', {
		recordedAt: '2026-01-10 09:00:00',
		stage: 'Nurture',
		ownerUserId: context.assignee.id,
	});

	await seedActivity(context, r2.id, {
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		occurredAt: '2026-01-06 10:00:00',
		createdBy: context.assignee.id,
	});
	await seedActivity(context, r2.id, {
		activityType: 'Call',
		status: 'Scheduled',
		scheduledFor: tomorrow,
		createdBy: context.assignee.id,
	});
	await seedActivity(context, r3.id, {
		activityType: 'Email',
		status: 'Scheduled',
		scheduledFor: yesterday,
		createdBy: context.assignee.id,
	});
	await seedActivity(context, r4.id, {
		activityType: 'Meeting',
		status: 'Scheduled',
		scheduledFor: today,
		createdBy: context.assignee.id,
	});
	await seedActivity(context, r5.id, {
		activityType: 'Email',
		status: 'Completed',
		replyConfirmed: 0,
		occurredAt: '2026-01-09 10:00:00',
		createdBy: context.creator.id,
	});
	await seedActivity(context, r5.id, {
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-01-09 11:00:00',
		createdBy: context.creator.id,
	});

	// ── The intake populations the printed summary shows ───────────────────
	const intake = await readReport(
		context,
		{ from_date: INTAKE_FROM, to_date: INTAKE_TO, search: intakeSearch },
		token
	);
	const intakeBody = intake.body;
	assert.equal(intakeBody.scope.from_date, INTAKE_FROM);
	assert.equal(intakeBody.scope.to_date, INTAKE_TO);
	assert.equal(intakeBody.scope.effective_filters.search, intakeSearch);
	assert.equal(intakeBody.meta.today, today);
	assert.ok(intakeBody.meta.time_zone.label.length > 0);
	assert.ok(intakeBody.meta.live_data_warning.length > 0);

	// System entry and stated Enquiry Dates are separate populations.
	assert.equal(intakeBody.summary.leads_recorded, 7);
	assert.equal(intakeBody.summary.enquiries_dated, 5);
	assert.equal(intakeBody.summary.missing_enquiry_date, 3);
	assert.equal(intakeBody.summary.distinct_sources, 3);
	assert.equal(sourceCount(intakeBody, 'Print Web'), 1);
	assert.equal(sourceCount(intakeBody, 'Print Referral'), 1);
	const unknownSource = intakeBody.sources.find((row) => row.is_unknown);
	assert.ok(unknownSource, 'missing labels group as Unknown source');
	assert.equal(unknownSource.count, 5);

	// Completed work and contact remain separate answers.
	const work = intakeBody.work.summary;
	assert.equal(work.completed_total, 3);
	assert.deepEqual(work.by_type, {
		call: 2,
		email: 0,
		meeting: 0,
		note: 1,
		unknown: 0,
	});
	assert.equal(work.outreach_total, 2);
	assert.equal(work.distinct_leads_worked, 3);
	assert.equal(work.distinct_leads_with_outreach, 2);
	assert.equal(work.successful_contact, 1);
	assert.equal(work.distinct_leads_with_successful_contact, 1);
	assert.equal(work.calls_connected, 1);
	assert.equal(work.calls_failed, 1);
	assert.equal(work.emails_confirmed_reply, 0);
	assert.equal(work.emails_unconfirmed, 0);
	assert.equal(work.corrected_activities, 0);
	assert.equal(intakeBody.work.coverage.unknown_occurrence_date, 1);
	assert.equal(intakeBody.work.coverage.cancelled_in_period, 0);
	assert.equal(intakeBody.work.coverage.deleted_activity_rows, 0);

	// The cohort denominator stays beside its evidence gaps.
	const cohort = intakeBody.conversion.cohort;
	assert.equal(cohort.cohort_size, 7);
	assert.equal(cohort.handoffs_evidenced, 2);
	assert.equal(cohort.conversion_rate, 28.57);
	assert.equal(cohort.conversion_events, 1);
	assert.equal(cohort.undated_links, 1);
	assert.equal(cohort.unresolved_evidence, 1);
	assert.equal(cohort.stage_only_claims, 1);
	assert.equal(cohort.no_handoff_evidence, 3);
	assert.equal(intakeBody.conversion.period.handoffs, 2);
	assert.equal(intakeBody.conversion.period.undated_canonical_links, 1);

	// Timing coverage counts sit beside the measured durations.
	const timing = intakeBody.timing;
	assert.equal(timing.available, true);
	assert.equal(timing.median_seconds, 3_600);
	assert.equal(timing.p90_seconds, 3_600);
	assert.equal(timing.valid_samples, 1);
	assert.equal(timing.cohort_leads, 7);
	assert.equal(timing.without_outreach, 5);
	assert.ok(timing.without_outreach_share !== null);
	assert.equal(
		Math.round(timing.without_outreach_share * 1_000),
		Math.round((5 / 7) * 1_000)
	);
	assert.deepEqual(timing.exclusions, {
		missing_timestamp: 1,
		incomplete_earlier: 0,
		negative: 0,
		total: 1,
	});
	assert.ok(timing.metric.clock.length > 0);
	assert.ok(timing.metric.observation.length > 0);

	// ── Current risks follow queue rules even for a historical period ───────
	const historical = await readReport(
		context,
		{
			from_date: HISTORICAL_FROM,
			to_date: HISTORICAL_TO,
			search: riskSearch,
		},
		token
	);
	const historicalState = historical.body.current_state;
	assert.equal(historicalState.as_of.today, today);
	assert.match(historicalState.as_of.date_basis, /current/i);
	assert.ok(historicalState.as_of.live_data_warning.length > 0);
	const ignoredPeriod = historicalState.scope.ignored_filters.find(
		(entry) => entry.key === 'period'
	);
	assert.ok(ignoredPeriod, 'the selected period is explicitly ignored');
	assert.equal(ignoredPeriod.value, `${HISTORICAL_FROM} to ${HISTORICAL_TO}`);

	assert.equal(historicalState.workload.total, 6);
	assert.equal(workloadCount(historical.body, null), 1);
	assert.equal(workloadCount(historical.body, context.assignee.id), 4);
	assert.equal(workloadCount(historical.body, context.creator.id), 1);
	assert.equal(riskCount(historical.body, 'unassigned'), 1);
	assert.equal(riskCount(historical.body, 'untouched'), 4);
	assert.equal(riskCount(historical.body, 'overdue'), 1);
	assert.equal(riskCount(historical.body, 'due_today'), 1);
	assert.equal(riskCount(historical.body, 'no_next_action'), 2);
	assert.deepEqual(
		historicalState.risks.map((entry) => entry.key),
		['unassigned', 'untouched', 'overdue', 'due_today', 'no_next_action']
	);
	for (const entry of historicalState.risks) {
		assert.equal(entry.counter_unit, 'distinct_leads');
		assert.equal(entry.as_of, historicalState.as_of.generated_at);
	}

	// The same live figures appear under the intake month, so the historical
	// period never reconstructs a period-end backlog.
	const currentPeriod = await readReport(
		context,
		{ from_date: INTAKE_FROM, to_date: INTAKE_TO, search: riskSearch },
		token
	);
	for (const key of [
		'unassigned',
		'untouched',
		'overdue',
		'due_today',
		'no_next_action',
	]) {
		assert.equal(
			riskCount(currentPeriod.body, key),
			riskCount(historical.body, key),
			`${key} is a live figure, independent of the selected period`
		);
	}
	assert.equal(
		currentPeriod.body.current_state.workload.total,
		historicalState.workload.total
	);

	// ── Permission behaviour the printout depends on ────────────────────────
	const reportPath = `/api/reports/lead-audit${query({
		from_date: INTAKE_FROM,
		to_date: INTAKE_TO,
		search: intakeSearch,
	})}`;
	assert.equal((await context.http.get(reportPath)).status, 401);
	for (const identity of [
		context.readOnly,
		context.reportOnly,
		context.projectReportOnly,
	]) {
		assert.equal(
			(await context.http.get(reportPath, identity.sessionToken)).status,
			403,
			`${identity.username} lacks a required read grant`
		);
	}
	// The report reader has no reports:export grant: printing (and reading the
	// summary) must still work.
	assert.equal(
		(
			await context.http.get(reportPath, context.reportReader.sessionToken)
		).status,
		200
	);

	// Without proposals:read, the report body carries no Proposal values.
	const restricted = intakeBody.conversion.downstream;
	assert.equal(restricted.handoffs, 2);
	assert.deepEqual(restricted.proposal_states, {
		none: 0,
		unresolved: 0,
		restricted: 2,
		available: 0,
	});
	assert.equal(intake.text.includes(`${proposalPrefix} A`), false);
	assert.equal(intake.text.includes(`${proposalPrefix} B`), false);
	assert.equal(intake.text.includes(`${proposalPrefix} D`), false);
	assert.equal(intake.text.includes(`${projectPrefix} B`), false);

	const proposalsOnly = await seedReader(context, 3, 'proposals', [
		'leads:read',
		'reports:read',
		'proposals:read',
	]);
	const bothGrants = await seedReader(context, 4, 'both', [
		'leads:read',
		'reports:read',
		'proposals:read',
		'projects:read',
	]);
	const projectsOnly = await seedReader(context, 5, 'projects', [
		'leads:read',
		'reports:read',
		'projects:read',
	]);

	const proposalReader = await readReport(
		context,
		{ from_date: INTAKE_FROM, to_date: INTAKE_TO, search: intakeSearch },
		proposalsOnly.sessionToken
	);
	assert.deepEqual(proposalReader.body.conversion.downstream.proposal_states, {
		none: 0,
		unresolved: 0,
		restricted: 0,
		available: 2,
	});
	assert.deepEqual(proposalReader.body.conversion.downstream.project_states, {
		none: 1,
		restricted: 1,
		available: 0,
	});

	const bothReader = await readReport(
		context,
		{ from_date: INTAKE_FROM, to_date: INTAKE_TO, search: intakeSearch },
		bothGrants.sessionToken
	);
	assert.deepEqual(bothReader.body.conversion.downstream.proposal_states, {
		none: 0,
		unresolved: 0,
		restricted: 0,
		available: 2,
	});
	assert.deepEqual(bothReader.body.conversion.downstream.project_states, {
		none: 1,
		restricted: 0,
		available: 1,
	});

	// projects:read alone never unlocks a Proposal value.
	const projectReader = await readReport(
		context,
		{ from_date: INTAKE_FROM, to_date: INTAKE_TO, search: intakeSearch },
		projectsOnly.sessionToken
	);
	assert.deepEqual(projectReader.body.conversion.downstream.proposal_states, {
		none: 0,
		unresolved: 0,
		restricted: 2,
		available: 0,
	});
	assert.equal(projectReader.text.includes(`${proposalPrefix} B`), false);
	assert.equal(projectReader.text.includes(`${projectPrefix} B`), false);

	// The conversion evidence rows behind the cohort keep the same boundary.
	const restrictedEvidence = await readConversionEvidence(
		context,
		{
			from_date: INTAKE_FROM,
			to_date: INTAKE_TO,
			search: intakeSearch,
			evidence: 'handoff',
		},
		token
	);
	assert.equal(restrictedEvidence.body.pagination.total, 2);
	assert.equal(restrictedEvidence.body.downstream_options.include_proposals, false);
	assert.equal(restrictedEvidence.body.downstream_options.include_projects, false);
	assert.ok(
		restrictedEvidence.body.rows.every(
			(row) =>
				row.downstream.proposal_state === 'restricted' &&
				row.downstream.proposal === null
		),
		'no downstream value is exposed without proposals:read'
	);
	assert.equal(restrictedEvidence.text.includes(proposalPrefix), false);
	assert.equal(restrictedEvidence.text.includes(projectPrefix), false);

	const proposalEvidence = await readConversionEvidence(
		context,
		{
			from_date: INTAKE_FROM,
			to_date: INTAKE_TO,
			search: intakeSearch,
			evidence: 'handoff',
		},
		proposalsOnly.sessionToken
	);
	const proposalDRow = proposalEvidence.body.rows.find((row) => row.id === d.id);
	assert.ok(proposalDRow, 'the undated canonical Lead is in handoff evidence');
	assert.equal(proposalDRow.downstream.proposal_state, 'available');
	assert.equal(
		proposalDRow.downstream.proposal?.title,
		`${proposalPrefix} D`
	);
	assert.equal(proposalDRow.downstream.proposal?.project_state, 'restricted');
	const proposalBRow = proposalEvidence.body.rows.find((row) => row.id === b.id);
	assert.ok(proposalBRow, 'the dated handoff Lead is in handoff evidence');
	assert.equal(proposalBRow.downstream.proposal?.project_state, 'restricted');
	assert.equal(proposalEvidence.text.includes(projectPrefix), false);
}
