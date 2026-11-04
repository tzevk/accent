import { strict as assert } from 'node:assert';
import process from 'node:process';
import { z } from 'zod';
import { extractSessionCookie } from '../client.ts';
import { hashFixturePassword } from '../support.ts';
import type { ScenarioContext } from '../client.ts';

// The Lead Audit cohort and conversion slice (#402). The report is proved
// through its authenticated HTTP reads only: fixture Leads, Proposals,
// Projects, and conversion evidence go straight into the disposable database
// with explicit times, and every expected figure is derived from those known
// values, never from the report's own aggregates.

const DownstreamSchema = z
	.object({
		proposal_state: z.enum(['none', 'unresolved', 'restricted', 'available']),
		proposal: z
			.object({
				id: z.number(),
				title: z.string().nullable(),
				status: z.string().nullable(),
				progress: z.number().nullable(),
				project_state: z.enum(['none', 'restricted', 'available']),
				project: z
					.object({
						id: z.number(),
						title: z.string().nullable(),
						status: z.string().nullable(),
						progress: z.number().nullable(),
					})
					.passthrough()
					.nullable(),
			})
			.passthrough()
			.nullable(),
	})
	.passthrough();

const SourceConversionSchema = z
	.object({
		label: z.string().nullable(),
		is_unknown: z.boolean(),
		cohort_size: z.number(),
		handoffs_evidenced: z.number(),
		conversion_rate: z.number().nullable(),
		unresolved_evidence: z.number(),
		stage_only_claims: z.number(),
	})
	.passthrough();

const ConversionSectionSchema = z
	.object({
		cohort: z
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
			.passthrough(),
		period: z
			.object({
				handoffs: z.number(),
				undated_canonical_links: z.number(),
				date_basis: z.string(),
			})
			.passthrough(),
		source_conversion: z.array(SourceConversionSchema),
		stage_distribution: z.array(
			z
				.object({
					stage: z.object({
						value: z.string().nullable(),
						label: z.string(),
					}),
					count: z.number(),
				})
				.passthrough()
		),
		downstream: z
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
			.passthrough(),
		evidence_filters: z
			.object({
				effective: z.array(z.object({ key: z.string(), label: z.string() })),
				ignored: z.array(z.object({ key: z.string(), reason: z.string() })),
			})
			.passthrough(),
		scope: z
			.object({
				preset: z.string(),
				from_date: z.string(),
				to_date: z.string(),
				date_basis: z.string(),
			})
			.passthrough(),
		meta: z
			.object({
				generated_at: z.string(),
				today: z.string(),
				live_data_warning: z.string(),
			})
			.passthrough(),
		disclosures: z.array(
			z.object({ code: z.string(), text: z.string() }).passthrough()
		),
	})
	.passthrough();

const ReportEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				conversion: ConversionSectionSchema,
			})
			.passthrough(),
	})
	.passthrough();

const EvidenceRowSchema = z
	.object({
		id: z.number(),
		lead_id: z.string().nullable(),
		company_name: z.string(),
		source: z.object({
			label: z.string().nullable(),
			is_unknown: z.boolean(),
		}),
		stage: z.object({
			value: z.string().nullable(),
			label: z.string(),
		}),
		owner: z.object({ id: z.number(), name: z.string().nullable() }).nullable(),
		recorded_at: z.string(),
		enquiry_date: z.string().nullable(),
		evidence: z.enum([
			'conversion_event',
			'canonical_link',
			'unresolved_link',
			'stage_only',
			'none',
		]),
		handoff_evidenced: z.boolean(),
		conversion_at: z.string().nullable(),
		in_period_handoff: z.boolean(),
		downstream: DownstreamSchema,
	})
	.passthrough();

const EvidenceEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				evidence: z.object({
					key: z.string(),
					label: z.string(),
					definition: z.string(),
				}),
				rows: z.array(EvidenceRowSchema),
				pagination: z.object({
					page: z.number(),
					limit: z.number(),
					total: z.number(),
					total_pages: z.number(),
				}),
				downstream_options: z.object({
					include_proposals: z.boolean(),
					include_projects: z.boolean(),
				}),
				evidence_filters: z
					.object({
						effective: z.array(
							z.object({ key: z.string(), label: z.string() })
						),
						ignored: z.array(z.object({ key: z.string(), reason: z.string() })),
					})
					.passthrough(),
				scope: z
					.object({ from_date: z.string(), to_date: z.string() })
					.passthrough(),
				meta: z.object({ generated_at: z.string() }).passthrough(),
				disclosures: z.array(
					z.object({ code: z.string(), text: z.string() }).passthrough()
				),
			})
			.passthrough(),
	})
	.passthrough();

type ConversionSection = z.infer<typeof ConversionSectionSchema>;
type EvidenceBody = z.infer<typeof EvidenceEnvelopeSchema>['data'];

const ErrorEnvelopeSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
		code: z.string().optional(),
	})
	.passthrough();

const PREFIX = 'ReportConversion';
const PERIOD_FROM = '2026-05-01';
const PERIOD_TO = '2026-05-31';
const EMPTY_FROM = '2020-01-01';
const EMPTY_TO = '2020-01-31';

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

async function readConversion(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<{ section: ConversionSection; text: string }> {
	const response = await context.http.get(
		`/api/reports/lead-audit${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`conversion report status (body: ${response.text})`
	);
	const parsed = ReportEnvelopeSchema.parse(response.json());
	return { section: parsed.data.conversion, text: response.text };
}

const ConversionSectionEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: ConversionSectionSchema,
	})
	.passthrough();

async function readConversionSectionRoute(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<{ section: ConversionSection; text: string }> {
	const response = await context.http.get(
		`/api/reports/lead-audit/conversion${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`conversion section status (body: ${response.text})`
	);
	const parsed = ConversionSectionEnvelopeSchema.parse(response.json());
	return { section: parsed.data, text: response.text };
}

async function readEvidence(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<{ body: EvidenceBody; text: string }> {
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

interface Seeded {
	id: number;
	company: string;
}

function withPrefix(context: ScenarioContext, suffix: string): string {
	return `${context.runTag} ${PREFIX} ${suffix}`;
}

async function seedLead(
	context: ScenarioContext,
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
): Promise<Seeded> {
	const company = withPrefix(context, suffix);
	const id = await context.reader.seedReportLead({
		companyName: company,
		contactName: `${context.runTag} Contact ${suffix}`,
		projectDescription: `${context.runTag} ${PREFIX} need ${suffix}`,
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

async function insertProposal(
	context: ScenarioContext,
	input: {
		title: string;
		status: string;
		progress: number;
		leadId: number;
		canonicalLeadId: number | null;
		isDeleted?: boolean;
		createdAt: string;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO proposals (
       proposal_title, status, progress, lead_id, canonical_lead_id,
       isDelete, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.title,
			input.status,
			input.progress,
			input.leadId,
			input.canonicalLeadId,
			input.isDeleted ? 1 : 0,
			input.createdAt,
			input.createdAt,
		]
	);
	assert.ok(result.insertId > 0, 'the Proposal fixture has an id');
	return result.insertId;
}

async function insertProject(
	context: ScenarioContext,
	input: {
		title: string;
		status: string;
		progress: number;
		proposalId: number;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO projects (
       project_title, status, progress, proposal_id, isDelete,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
		[
			input.title,
			input.status,
			input.progress,
			input.proposalId,
			'2026-05-21 09:00:00',
			'2026-05-21 09:00:00',
		]
	);
	assert.ok(result.insertId > 0, 'the Project fixture has an id');
	return result.insertId;
}

async function insertConversion(
	context: ScenarioContext,
	input: {
		leadId: number;
		proposalId: number;
		convertedAt: string;
	}
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

function sourceRow(section: ConversionSection, label: string | null) {
	const row = section.source_conversion.find((entry) =>
		label === null ? entry.is_unknown : entry.label === label
	);
	assert.ok(row, `source conversion row ${JSON.stringify(label)} is reported`);
	return row;
}

function stageCount(section: ConversionSection, stage: string | null): number {
	const row = section.stage_distribution.find((entry) =>
		stage === null ? entry.stage.value === null : entry.stage.value === stage
	);
	return row?.count ?? 0;
}

interface SeededReader {
	id: number;
	username: string;
	sessionToken: string;
}

async function seedReader(
	context: ScenarioContext,
	index: number,
	suffix: string,
	permissions: string[]
): Promise<SeededReader> {
	const username = `${context.runTag}-conv-${suffix}`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-');
	const email = `${username}@example.com`;
	const password = 'Lit402-pass!';
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
			`${context.runTag} Conversion ${suffix}`,
			JSON.stringify(permissions),
		]
	);
	assert.ok(inserted.insertId > 0, 'the permission fixture user has an id');

	// A real login on the running target, never a hand-issued session token.
	const baseUrl = `http://127.0.0.1:${process.env.LEADS_INTEGRATION_PORT ?? 31369}`;
	const response = await fetch(`${baseUrl}/api/login`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-vercel-forwarded-for': `127.0.0.${40 + index}`,
		},
		body: JSON.stringify({ username, password }),
	});
	const text = await response.text();
	assert.equal(
		response.status,
		200,
		`conversion reader login for ${username} (body: ${text})`
	);
	const sessionToken = extractSessionCookie(response.headers.get('set-cookie'));
	assert.ok(sessionToken, `conversion reader login sets a session cookie`);
	const parsed = z
		.object({ success: z.literal(true), user: z.object({ id: z.number() }) })
		.passthrough()
		.parse(JSON.parse(text) as unknown);
	assert.equal(
		parsed.user.id,
		inserted.insertId,
		'login resolves the seeded user'
	);
	return { id: inserted.insertId, username, sessionToken };
}

export async function leadAuditConversionScenario(
	context: ScenarioContext
): Promise<void> {
	const today = await context.reader.databaseToday();
	assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'the database calendar day');

	const search = `${context.runTag} ${PREFIX}`;
	const proposalPrefix = `${context.runTag} ${PREFIX} Proposal`;
	const projectPrefix = `${context.runTag} ${PREFIX} Project`;
	const token = context.reportReader.sessionToken;

	// ── Known cohort and downstream evidence, independent of the report ─────
	// A: recorded before the period, converted inside it.
	const a = await seedLead(context, 'A Older Dated', {
		recordedAt: '2026-04-10 09:00:00',
		source: 'Website',
		stage: 'Converted',
		enquiryDate: '2026-04-10',
	});
	// B: cohort Lead, dated handoff inside the period, with a Project.
	const b = await seedLead(context, 'B Cohort Dated', {
		recordedAt: '2026-05-03 09:00:00',
		source: 'Website',
		stage: 'Converted',
		enquiryDate: '2026-05-03',
	});
	// C: cohort Lead, handoff after the intake period.
	const c = await seedLead(context, 'C After Period', {
		recordedAt: '2026-05-04 09:00:00',
		source: 'Website',
		stage: 'Converted',
		enquiryDate: '2026-05-04',
	});
	// D: cohort Lead with a resolved canonical link and no recorded date.
	const d = await seedLead(context, 'D Undated Link', {
		recordedAt: '2026-05-05 09:00:00',
		source: 'website',
		stage: 'Converted',
		enquiryDate: '2026-05-05',
	});
	// E: cohort Lead with two live linked Proposals and no canonical choice.
	const e = await seedLead(context, 'E Unresolved Link', {
		recordedAt: '2026-05-06 09:00:00',
		source: 'Referral',
		stage: 'Converted',
		enquiryDate: '2026-05-06',
	});
	// F: cohort Lead that claims Converted with no evidence at all.
	const f = await seedLead(context, 'F Stage Only', {
		recordedAt: '2026-05-07 09:00:00',
		source: '',
		stage: 'Converted',
		enquiryDate: '2026-05-07',
	});
	// G: cohort Lead with no handoff evidence.
	const g = await seedLead(context, 'G No Evidence', {
		recordedAt: '2026-05-08 09:00:00',
		source: '  Website  ',
		stage: 'Qualified',
		enquiryDate: '2026-05-08',
	});
	// H: retained conversion event; the canonical link later changed.
	const h = await seedLead(context, 'H Relinked', {
		recordedAt: '2026-05-09 09:00:00',
		source: 'Event',
		stage: 'Converted',
		enquiryDate: '2026-05-09',
	});
	// I: cohort Lead with a dated handoff inside the period.
	const i = await seedLead(context, 'I Cohort Dated Two', {
		recordedAt: '2026-05-10 09:00:00',
		source: 'Referral',
		stage: 'Converted',
		enquiryDate: '2026-05-10',
	});
	// J: cohort Lead with no handoff evidence.
	const j = await seedLead(context, 'J No Evidence Two', {
		recordedAt: '2026-05-11 09:00:00',
		source: 'Website',
		stage: 'New',
		enquiryDate: '2026-05-11',
	});
	// K: soft-deleted cohort Lead whose retained conversion stays out.
	const k = await seedLead(context, 'K Deleted', {
		recordedAt: '2026-05-12 09:00:00',
		source: 'Website',
		stage: 'Converted',
		enquiryDate: '2026-05-12',
		isDeleted: true,
	});
	// L: older Lead with an undated canonical link, never a period handoff.
	const l = await seedLead(context, 'L Older Undated', {
		recordedAt: '2026-04-01 09:00:00',
		source: 'Referral',
		stage: 'Converted',
		enquiryDate: '2026-04-01',
	});

	// The downstream fixtures. Proposal creation times inside and outside the
	// period prove that no figure reads them as a conversion date. The Project
	// is inserted after its Proposal, because the database enforces the link.
	const proposalA = await insertProposal(context, {
		title: `${proposalPrefix} A`,
		status: 'SENT',
		progress: 30,
		leadId: a.id,
		canonicalLeadId: a.id,
		createdAt: '2026-04-02 09:00:00',
	});
	const proposalB = await insertProposal(context, {
		title: `${proposalPrefix} B`,
		status: 'SENT',
		progress: 40,
		leadId: b.id,
		canonicalLeadId: b.id,
		createdAt: '2026-05-03 10:00:00',
	});
	const proposalC = await insertProposal(context, {
		title: `${proposalPrefix} C`,
		status: 'DRAFT',
		progress: 0,
		leadId: c.id,
		canonicalLeadId: c.id,
		createdAt: '2026-05-04 10:00:00',
	});
	const proposalD = await insertProposal(context, {
		title: `${proposalPrefix} D`,
		status: 'NEGOTIATION',
		progress: 60,
		leadId: d.id,
		canonicalLeadId: d.id,
		createdAt: '2026-05-16 10:00:00',
	});
	const proposalE1 = await insertProposal(context, {
		title: `${proposalPrefix} E One`,
		status: 'DRAFT',
		progress: 10,
		leadId: e.id,
		canonicalLeadId: null,
		createdAt: '2026-05-06 10:00:00',
	});
	await insertProposal(context, {
		title: `${proposalPrefix} E Two`,
		status: 'DRAFT',
		progress: 5,
		leadId: e.id,
		canonicalLeadId: null,
		createdAt: '2026-05-06 11:00:00',
	});
	const proposalHOld = await insertProposal(context, {
		title: `${proposalPrefix} H Old`,
		status: 'DRAFT',
		progress: 0,
		leadId: h.id,
		canonicalLeadId: null,
		isDeleted: true,
		createdAt: '2026-05-09 10:00:00',
	});
	const proposalHNew = await insertProposal(context, {
		title: `${proposalPrefix} H New`,
		status: 'SENT',
		progress: 35,
		leadId: h.id,
		canonicalLeadId: h.id,
		createdAt: '2026-05-25 10:00:00',
	});
	const proposalI = await insertProposal(context, {
		title: `${proposalPrefix} I`,
		status: 'DRAFT',
		progress: 10,
		leadId: i.id,
		canonicalLeadId: i.id,
		createdAt: '2026-05-10 10:00:00',
	});
	const proposalK = await insertProposal(context, {
		title: `${proposalPrefix} K`,
		status: 'SENT',
		progress: 20,
		leadId: k.id,
		canonicalLeadId: k.id,
		createdAt: '2026-05-12 10:00:00',
	});
	const proposalL = await insertProposal(context, {
		title: `${proposalPrefix} L`,
		status: 'DRAFT',
		progress: 0,
		leadId: l.id,
		canonicalLeadId: l.id,
		createdAt: '2026-04-03 10:00:00',
	});
	// The Project references its Proposal's primary key, and the Proposal
	// points back at the Project afterwards.
	const projectB = await insertProject(context, {
		title: `${projectPrefix} B`,
		status: 'ONGOING',
		progress: 25,
		proposalId: proposalB,
	});
	await context.reader.fixtureWrite(
		'UPDATE proposals SET project_id = ? WHERE id = ?',
		[projectB, proposalB]
	);

	await setCanonicalLink(context, {
		leadId: a.id,
		proposalId: proposalA,
		convertedAt: '2026-05-12 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, {
		leadId: b.id,
		proposalId: proposalB,
		convertedAt: '2026-05-20 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, {
		leadId: c.id,
		proposalId: proposalC,
		convertedAt: '2026-06-05 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, { leadId: d.id, proposalId: proposalD });
	await setCanonicalLink(context, { leadId: e.id, proposalId: null });
	await setCanonicalLink(context, {
		leadId: h.id,
		proposalId: proposalHNew,
		convertedAt: '2026-05-10 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, {
		leadId: i.id,
		proposalId: proposalI,
		convertedAt: '2026-05-11 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, {
		leadId: k.id,
		proposalId: proposalK,
		convertedAt: '2026-05-13 10:00:00',
		convertedBy: context.assignee.id,
	});
	await setCanonicalLink(context, { leadId: l.id, proposalId: proposalL });

	await insertConversion(context, {
		leadId: a.id,
		proposalId: proposalA,
		convertedAt: '2026-05-12 10:00:00',
	});
	await insertConversion(context, {
		leadId: b.id,
		proposalId: proposalB,
		convertedAt: '2026-05-20 10:00:00',
	});
	await insertConversion(context, {
		leadId: c.id,
		proposalId: proposalC,
		convertedAt: '2026-06-05 10:00:00',
	});
	await insertConversion(context, {
		leadId: h.id,
		proposalId: proposalHOld,
		convertedAt: '2026-05-10 10:00:00',
	});
	await insertConversion(context, {
		leadId: i.id,
		proposalId: proposalI,
		convertedAt: '2026-05-11 10:00:00',
	});
	await insertConversion(context, {
		leadId: k.id,
		proposalId: proposalK,
		convertedAt: '2026-05-13 10:00:00',
	});
	assert.ok(
		[
			proposalA,
			proposalB,
			proposalC,
			proposalD,
			proposalE1,
			proposalHOld,
			proposalHNew,
			proposalI,
			proposalK,
			proposalL,
			projectB,
		].every((id) => id > 0),
		'every downstream fixture row exists'
	);

	// ── Source snapshots, read independently before and after the report ────
	const leadSnapshotSql = `SELECT id, company_name, enquiry_status, canonical_proposal_id,
       converted_at, converted_by, isDelete
     FROM leads WHERE company_name LIKE ? ORDER BY id`;
	const proposalSnapshotSql = `SELECT id, proposal_title, status, progress, lead_id,
       canonical_lead_id, project_id, isDelete
     FROM proposals WHERE proposal_title LIKE ? ORDER BY id`;
	const conversionSnapshotSql = `SELECT c.id, c.lead_id, c.proposal_id, c.converted_by, c.converted_at
     FROM lead_conversions c JOIN leads l ON l.id = c.lead_id
     WHERE l.company_name LIKE ? ORDER BY c.id`;
	const leadSnapshot = await context.reader.fixtureRows(leadSnapshotSql, [
		`%${search}%`,
	]);
	const proposalSnapshot = await context.reader.fixtureRows(
		proposalSnapshotSql,
		[`%${proposalPrefix}%`]
	);
	const conversionSnapshot = await context.reader.fixtureRows(
		conversionSnapshotSql,
		[`%${search}%`]
	);

	// ── Cohort progress, distinct from period handoffs ─────────────────────
	const may = await readConversion(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	const cohort = may.section.cohort;
	assert.equal(
		cohort.cohort_size,
		9,
		`distinct non-deleted cohort Leads: ${JSON.stringify({
			scope: may.section.scope,
			intake: JSON.parse(may.text).data.summary,
			cohort,
		})}`
	);
	assert.equal(cohort.handoffs_evidenced, 5, 'evidenced cohort handoffs');
	assert.equal(cohort.conversion_rate, 55.56, '5 of 9 cohort Leads');
	assert.equal(
		cohort.conversion_events,
		4,
		'dated conversion events in the cohort'
	);
	assert.equal(cohort.undated_links, 1, 'the undated canonical link');
	assert.equal(cohort.unresolved_evidence, 1, 'unresolved links are gaps');
	assert.equal(
		cohort.stage_only_claims,
		1,
		'a Converted label alone is not evidence'
	);
	assert.equal(
		cohort.no_handoff_evidence,
		2,
		'cohort Leads without handoff evidence'
	);
	assert.match(cohort.observed_through, /^\d{4}-\d{2}-\d{2}/);
	assert.equal(
		cohort.handoffs_evidenced +
			cohort.unresolved_evidence +
			cohort.stage_only_claims +
			cohort.no_handoff_evidence,
		cohort.cohort_size,
		'the evidence states partition the cohort'
	);

	const period = may.section.period;
	assert.equal(
		period.handoffs,
		4,
		'dated handoffs inside the period, including older Leads'
	);
	assert.equal(
		period.undated_canonical_links,
		2,
		'both undated canonical links stay out of period handoffs'
	);
	assert.match(period.date_basis, /conversion|handoff/i);
	assert.equal(
		(may.section as Record<string, unknown>).period_conversion_rate,
		undefined,
		'period handoffs are never divided by period intake as a rate'
	);

	// The dedicated section route reports the same applied figures.
	const sectionRoute = await readConversionSectionRoute(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	assert.equal(sectionRoute.section.cohort.cohort_size, 9);
	assert.equal(sectionRoute.section.cohort.conversion_rate, 55.56);
	assert.equal(sectionRoute.section.period.handoffs, 4);
	assert.equal(sectionRoute.section.downstream.proposal_states.restricted, 5);
	assert.equal(sectionRoute.text.includes(proposalPrefix), false);

	// H's conversion event survives the later relink: it is still a handoff,
	// and its current canonical Proposal is the new one.
	const handoffs = await readEvidence(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, evidence: 'handoff' },
		token
	);
	assert.equal(handoffs.body.pagination.total, 5);
	assert.deepEqual(
		handoffs.body.rows.map((row) => row.id),
		[i.id, h.id, d.id, c.id, b.id],
		'deterministic newest-first cohort evidence'
	);
	const relinked = handoffs.body.rows.find((row) => row.id === h.id);
	assert.ok(relinked, 'the relinked Lead remains handoff evidence');
	assert.equal(relinked.evidence, 'conversion_event');
	assert.equal(relinked.conversion_at, '2026-05-10 10:00:00');
	assert.equal(relinked.in_period_handoff, true);
	assert.equal(relinked.downstream.proposal_state, 'restricted');

	// ── Period evidence: undated links never become dated handoffs ──────────
	const periodEvidence = await readEvidence(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, evidence: 'period' },
		token
	);
	assert.equal(periodEvidence.body.pagination.total, 4);
	assert.deepEqual(
		periodEvidence.body.rows.map((row) => row.id),
		[b.id, a.id, i.id, h.id],
		'period handoffs order by authoritative conversion time'
	);
	assert.ok(
		periodEvidence.body.rows.every((row) => row.conversion_at !== null),
		'a period handoff always carries an authoritative date'
	);
	assert.equal(
		periodEvidence.body.rows.some((row) => row.id === d.id),
		false,
		'the undated canonical link is not a period handoff'
	);
	assert.equal(
		periodEvidence.body.rows.some((row) => row.id === c.id),
		false,
		'a handoff after the period stays out even though its Proposal was created inside it'
	);
	assert.equal(
		periodEvidence.body.rows.some((row) => row.id === k.id),
		false,
		'a soft-deleted Lead stays out of operational handoffs'
	);

	// ── Undated, unresolved, stage-only and full evidence populations ──────
	const undated = await readEvidence(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, evidence: 'undated' },
		token
	);
	assert.deepEqual(
		undated.body.rows.map((row) => row.id),
		[d.id]
	);
	assert.equal(undated.body.rows[0]?.conversion_at, null);
	assert.equal(undated.body.rows[0]?.evidence, 'canonical_link');

	const unresolved = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'unresolved',
		},
		token
	);
	assert.deepEqual(
		unresolved.body.rows.map((row) => row.id),
		[e.id]
	);
	assert.equal(unresolved.body.rows[0]?.handoff_evidenced, false);
	assert.equal(
		unresolved.body.rows[0]?.downstream.proposal_state,
		'unresolved'
	);

	const stageOnly = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'stage_only',
		},
		token
	);
	assert.deepEqual(
		stageOnly.body.rows.map((row) => row.id),
		[f.id]
	);
	assert.equal(stageOnly.body.rows[0]?.handoff_evidenced, false);
	assert.equal(stageOnly.body.rows[0]?.stage.value, 'Converted');
	assert.equal(stageOnly.body.rows[0]?.downstream.proposal_state, 'none');

	const all = await readEvidence(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, evidence: 'all' },
		token
	);
	assert.equal(
		all.body.pagination.total,
		10,
		'the cohort plus the older period handoff'
	);
	assert.equal(
		all.body.rows.some((row) => row.id === k.id),
		false,
		'the deleted Lead is not authoring evidence'
	);
	assert.equal(
		all.body.rows.some((row) => row.id === l.id),
		false,
		'an older Lead without a period handoff stays out'
	);

	// ── Deterministic pagination over the full population ──────────────────
	const pageOne = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'all',
			page: 1,
			limit: 4,
		},
		token
	);
	const pageTwo = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'all',
			page: 2,
			limit: 4,
		},
		token
	);
	const pageThree = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'all',
			page: 3,
			limit: 4,
		},
		token
	);
	assert.equal(pageOne.body.pagination.total, 10);
	assert.equal(pageOne.body.pagination.total_pages, 3);
	assert.equal(pageThree.body.rows.length, 2);
	const pageIds = [
		...pageOne.body.rows,
		...pageTwo.body.rows,
		...pageThree.body.rows,
	].map((row) => row.id);
	assert.equal(
		new Set(pageIds).size,
		10,
		'each Lead appears once across pages'
	);
	const beyond = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'all',
			page: 99,
			limit: 4,
		},
		token
	);
	assert.equal(beyond.body.rows.length, 0);
	assert.equal(beyond.body.pagination.total, 10);

	// ── Source conversion preserves exact labels and Unknown source ────────
	assert.equal(may.section.source_conversion.length, 6);
	const website = sourceRow(may.section, 'Website');
	assert.equal(website.cohort_size, 3);
	assert.equal(website.handoffs_evidenced, 2);
	assert.equal(website.conversion_rate, 66.67);
	assert.equal(sourceRow(may.section, 'website').conversion_rate, 100);
	assert.equal(sourceRow(may.section, '  Website  ').cohort_size, 1);
	assert.equal(sourceRow(may.section, '  Website  ').handoffs_evidenced, 0);
	assert.equal(
		sourceRow(may.section, '  Website  ').conversion_rate,
		0,
		'a measured zero differs from a not-applicable cohort'
	);
	const referral = sourceRow(may.section, 'Referral');
	assert.equal(referral.cohort_size, 2);
	assert.equal(referral.handoffs_evidenced, 1);
	assert.equal(referral.conversion_rate, 50);
	assert.equal(referral.unresolved_evidence, 1);
	const unknown = sourceRow(may.section, null);
	assert.equal(unknown.is_unknown, true);
	assert.equal(unknown.cohort_size, 1);
	assert.equal(unknown.stage_only_claims, 1);
	assert.equal(sourceRow(may.section, 'Event').conversion_rate, 100);

	// ── Current stage distribution is present state, not a funnel ──────────
	const stageTotal = may.section.stage_distribution.reduce(
		(sum, row) => sum + row.count,
		0
	);
	assert.equal(stageTotal, 9, 'the current stages cover the full cohort');
	assert.equal(stageCount(may.section, 'Converted'), 7);
	assert.equal(stageCount(may.section, 'Qualified'), 1);
	assert.equal(stageCount(may.section, 'New'), 1);
	assert.equal(
		may.section.stage_distribution.some((row) =>
			/funnel|transition/i.test(JSON.stringify(row))
		),
		false,
		'stage rows claim no funnel or transitions'
	);

	// ── Applied filters narrow the cohort, source rows, and period ──────────
	const websiteOnly = await readConversion(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			source: 'Website',
		},
		token
	);
	assert.equal(websiteOnly.section.cohort.cohort_size, 3);
	assert.equal(websiteOnly.section.cohort.handoffs_evidenced, 2);
	assert.equal(websiteOnly.section.cohort.conversion_rate, 66.67);
	assert.equal(
		websiteOnly.section.period.handoffs,
		2,
		'A and B carry the label'
	);
	assert.equal(websiteOnly.section.source_conversion.length, 1);

	const convertedWebsite = await readConversion(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			source: 'Website',
			stage: 'Converted',
		},
		token
	);
	assert.equal(convertedWebsite.section.cohort.cohort_size, 2);
	assert.equal(convertedWebsite.section.cohort.handoffs_evidenced, 2);
	assert.equal(convertedWebsite.section.cohort.conversion_rate, 100);
	assert.equal(stageCount(convertedWebsite.section, 'New'), 0);

	// ── The new activity filters are explicitly ignored here ────────────────
	const ignoredFilters = await readConversion(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: String(context.assignee.id),
			activity_type: 'Call',
			outcome: 'Connected',
			event_type: 'stage_change',
		},
		token
	);
	assert.equal(
		ignoredFilters.section.cohort.cohort_size,
		9,
		'activity and audit filters do not narrow conversion'
	);
	const ignoredKeys = ignoredFilters.section.evidence_filters.ignored.map(
		(entry) => entry.key
	);
	for (const key of ['actor', 'activity_type', 'outcome', 'event_type']) {
		assert.ok(ignoredKeys.includes(key), `${key} is disclosed as ignored`);
	}
	assert.deepEqual(
		ignoredFilters.section.evidence_filters.effective.map((entry) => entry.key),
		['period', 'search'],
		'only the applied period and search are effective'
	);

	const fullyFiltered = await readConversion(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			owner: context.assignee.id,
			source: 'Website',
			stage: 'Converted',
			priority: 'Medium',
		},
		token
	);
	assert.deepEqual(
		fullyFiltered.section.evidence_filters.effective.map((entry) => entry.key),
		['period', 'owner', 'source', 'stage', 'priority', 'search'],
		'each applied shared filter is disclosed as effective'
	);

	// ── Empty cohorts are Not applicable, never zero percent ────────────────
	const empty = await readConversion(
		context,
		{ from_date: EMPTY_FROM, to_date: EMPTY_TO, search },
		token
	);
	assert.equal(empty.section.cohort.cohort_size, 0);
	assert.equal(empty.section.cohort.handoffs_evidenced, 0);
	assert.equal(empty.section.cohort.conversion_rate, null);
	assert.equal(empty.section.period.handoffs, 0);
	assert.equal(empty.section.source_conversion.length, 0);
	assert.equal(empty.section.stage_distribution.length, 0);
	assert.ok(
		empty.section.disclosures.some((entry) =>
			/not applicable/i.test(entry.text)
		),
		'the empty cohort explains Not applicable'
	);
	const emptyEvidence = await readEvidence(
		context,
		{ from_date: EMPTY_FROM, to_date: EMPTY_TO, search, evidence: 'all' },
		token
	);
	assert.equal(emptyEvidence.body.rows.length, 0);
	assert.equal(emptyEvidence.body.pagination.total, 0);

	// ── Invalid requests are explicit ───────────────────────────────────────
	const invalidEvidence = await context.http.get(
		`/api/reports/lead-audit/conversion${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'not_an_evidence_kind',
		})}`,
		token
	);
	assert.equal(invalidEvidence.status, 422);
	assert.equal(
		ErrorEnvelopeSchema.parse(invalidEvidence.json()).code,
		'invalid_conversion_evidence'
	);
	for (const [values, code] of [
		[{ from_date: '2026-02-30', to_date: '2026-03-01' }, 'invalid_date'],
		[{ from_date: '2026-05-31', to_date: '2026-05-01' }, 'invalid_range'],
		[{ stage: 'Not A Stage' }, 'invalid_stage'],
	] as const) {
		const response = await context.http.get(
			`/api/reports/lead-audit/conversion${query({
				...values,
				search,
			})}`,
			token
		);
		assert.equal(response.status, 422, `invalid filter ${code} status`);
		assert.equal(ErrorEnvelopeSchema.parse(response.json()).code, code);
	}

	// ── Independent downstream grants and server-side redaction ─────────────
	// The report reader has reports+leads only: every downstream fact is
	// Restricted, and no Proposal or Project value crosses the boundary.
	const restrictedEvidence = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'handoff',
		},
		token
	);
	assert.equal(
		restrictedEvidence.body.downstream_options.include_proposals,
		false
	);
	assert.equal(
		restrictedEvidence.body.downstream_options.include_projects,
		false
	);
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
	assert.equal(may.section.downstream.proposal_states.restricted, 5);
	assert.equal(may.section.downstream.proposal_states.available, 0);
	assert.deepEqual(may.section.downstream.project_states, {
		none: 0,
		restricted: 0,
		available: 0,
	});

	const proposalsOnly = await seedReader(context, 1, 'proposals', [
		'leads:read',
		'reports:read',
		'proposals:read',
	]);
	const projectsOnly = await seedReader(context, 2, 'projects', [
		'leads:read',
		'reports:read',
		'projects:read',
	]);
	const bothGrants = await seedReader(context, 3, 'both', [
		'leads:read',
		'reports:read',
		'proposals:read',
		'projects:read',
	]);

	const proposalReader = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'handoff',
		},
		proposalsOnly.sessionToken
	);
	assert.equal(proposalReader.body.downstream_options.include_proposals, true);
	assert.equal(proposalReader.body.downstream_options.include_projects, false);
	const proposalBRow = proposalReader.body.rows.find((row) => row.id === b.id);
	assert.ok(proposalBRow);
	assert.equal(proposalBRow.downstream.proposal_state, 'available');
	assert.equal(proposalBRow.downstream.proposal?.title, `${proposalPrefix} B`);
	assert.equal(proposalBRow.downstream.proposal?.status, 'SENT');
	assert.equal(proposalBRow.downstream.proposal?.progress, 40);
	assert.equal(proposalBRow.downstream.proposal?.project_state, 'restricted');
	assert.equal(proposalBRow.downstream.proposal?.project, null);
	assert.equal(proposalReader.text.includes(`${projectPrefix} B`), false);
	const proposalCRow = proposalReader.body.rows.find((row) => row.id === c.id);
	assert.equal(proposalCRow?.downstream.proposal?.project_state, 'none');
	assert.equal(proposalCRow?.downstream.proposal?.project, null);

	const projectReader = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'handoff',
		},
		projectsOnly.sessionToken
	);
	assert.equal(projectReader.body.downstream_options.include_proposals, false);
	assert.equal(projectReader.body.downstream_options.include_projects, true);
	assert.ok(
		projectReader.body.rows.every(
			(row) =>
				row.downstream.proposal_state === 'restricted' &&
				row.downstream.proposal === null
		),
		'projects:read alone cannot expose Proposal fields'
	);
	assert.equal(projectReader.text.includes(proposalPrefix), false);
	assert.equal(projectReader.text.includes(projectPrefix), false);

	const bothReader = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'handoff',
		},
		bothGrants.sessionToken
	);
	assert.equal(bothReader.body.downstream_options.include_proposals, true);
	assert.equal(bothReader.body.downstream_options.include_projects, true);
	const bothB = bothReader.body.rows.find((row) => row.id === b.id);
	assert.equal(bothB?.downstream.proposal?.project_state, 'available');
	assert.equal(
		bothB?.downstream.proposal?.project?.title,
		`${projectPrefix} B`
	);
	assert.equal(bothB?.downstream.proposal?.project?.status, 'ONGOING');
	assert.equal(bothB?.downstream.proposal?.project?.progress, 25);
	const bothH = bothReader.body.rows.find((row) => row.id === h.id);
	assert.equal(bothH?.downstream.proposal_state, 'available');
	assert.equal(bothH?.downstream.proposal?.title, `${proposalPrefix} H New`);
	assert.equal(bothH?.downstream.proposal?.status, 'SENT');
	assert.equal(bothH?.downstream.proposal?.progress, 35);
	const handoffSummary = await readConversion(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		bothGrants.sessionToken
	);
	assert.equal(handoffSummary.section.downstream.proposal_states.available, 5);
	assert.equal(handoffSummary.section.downstream.proposal_states.restricted, 0);
	assert.deepEqual(handoffSummary.section.downstream.project_states, {
		none: 4,
		restricted: 0,
		available: 1,
	});

	const projectProposalReaderSection = await readConversion(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		proposalsOnly.sessionToken
	);
	assert.deepEqual(
		projectProposalReaderSection.section.downstream.project_states,
		{ none: 4, restricted: 1, available: 0 },
		'the Project link is restricted, not absent, without projects:read'
	);

	// ── Super-admin bypass keeps the full downstream context ────────────────
	const superEvidence = await readEvidence(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			evidence: 'handoff',
		},
		context.superAdmin.sessionToken
	);
	assert.equal(superEvidence.body.downstream_options.include_proposals, true);
	assert.equal(superEvidence.body.downstream_options.include_projects, true);
	assert.equal(
		superEvidence.body.rows.find((row) => row.id === b.id)?.downstream.proposal
			?.status,
		'SENT'
	);

	// ── Report access gates on both conversion routes ──────────────────────
	const sectionPath = `/api/reports/lead-audit/conversion${query({
		from_date: PERIOD_FROM,
		to_date: PERIOD_TO,
		search,
	})}`;
	const evidencePath = `/api/reports/lead-audit/conversion/evidence${query({
		from_date: PERIOD_FROM,
		to_date: PERIOD_TO,
		search,
	})}`;
	assert.equal((await context.http.get(sectionPath)).status, 401);
	assert.equal((await context.http.get(evidencePath)).status, 401);
	for (const identity of [
		context.readOnly,
		context.reportOnly,
		context.projectReportOnly,
	]) {
		assert.equal(
			(await context.http.get(sectionPath, identity.sessionToken)).status,
			403,
			`${identity.username} lacks a required read grant on the section`
		);
		assert.equal(
			(await context.http.get(evidencePath, identity.sessionToken)).status,
			403,
			`${identity.username} lacks a required read grant on the evidence`
		);
	}

	// ── Report reads do not mutate the handoff or its evidence ─────────────
	const leadSnapshotAfter = await context.reader.fixtureRows(leadSnapshotSql, [
		`%${search}%`,
	]);
	const proposalSnapshotAfter = await context.reader.fixtureRows(
		proposalSnapshotSql,
		[`%${proposalPrefix}%`]
	);
	const conversionSnapshotAfter = await context.reader.fixtureRows(
		conversionSnapshotSql,
		[`%${search}%`]
	);
	assert.deepEqual(leadSnapshotAfter, leadSnapshot, 'Leads are unchanged');
	assert.deepEqual(
		proposalSnapshotAfter,
		proposalSnapshot,
		'Proposals are unchanged'
	);
	assert.deepEqual(
		conversionSnapshotAfter,
		conversionSnapshot,
		'conversion evidence is unchanged'
	);
	assert.equal(
		proposalSnapshotAfter.some(
			(row) => row.id === proposalHOld && row.isDelete === 1
		),
		true,
		'the retained event keeps its deleted Proposal reference'
	);
	assert.equal(
		(await context.reader.leadRow(k.id))?.isDelete,
		1,
		'the deleted Lead stays deleted'
	);
	assert.ok(proposalE1 > 0);
}
