import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { hashFixturePassword } from '../support.ts';
import type { LoginHttpClient, ScenarioContext } from '../client.ts';

// Audit evidence and Data coverage (#404). The report is proved through its
// authenticated HTTP reads only. Fixtures are written straight into the
// disposable database with explicit recording and occurrence times, and
// every expected figure is an independent literal from those values.

const PERIOD_FROM = '2026-09-01';
const PERIOD_TO = '2026-09-30';
const OUTSIDE_PERIOD_FROM = '2026-10-01';
const FIXTURE_PASSWORD = 'Lit369-pass!';

const EvidenceRowSchema = z
	.object({
		evidence_type: z.string(),
		evidence_id: z.number(),
		reference: z.string(),
		source_reference: z.object({ table: z.string(), id: z.number() }),
		lead: z.object({
			id: z.number(),
			lead_id: z.string().nullable(),
			company_name: z.string(),
		}),
		actor: z.object({
			id: z.number().nullable(),
			name: z.string().nullable(),
			is_unknown: z.boolean(),
		}),
		occurred_at: z.string().nullable(),
		occurrence_known: z.boolean(),
		recorded_at: z.string().nullable(),
		activity_type: z.string().nullable(),
		call_outcome: z.string().nullable(),
		reply_confirmed: z.boolean().nullable(),
		status: z.string().nullable(),
		summary: z.string(),
		has_narrative: z.boolean(),
		legacy: z.boolean(),
		change_fields: z.array(z.object({ field: z.string(), label: z.string() })),
		downstream: z
			.object({
				proposal: z
					.object({
						id: z.number(),
						restricted: z.boolean(),
						title: z.string().nullable(),
						status: z.string().nullable(),
						progress: z.number().nullable(),
					})
					.nullable(),
				proposal_state: z.string(),
				project: z
					.object({
						id: z.number(),
						restricted: z.boolean(),
						title: z.string().nullable(),
						status: z.string().nullable(),
						progress: z.number().nullable(),
					})
					.nullable(),
				project_state: z.string(),
			})
			.optional(),
	})
	.passthrough();

const DeletedEvidenceRowSchema = EvidenceRowSchema.extend({
	deletion: z.object({
		known: z.literal(false),
		actor: z.null(),
		at: z.null(),
		note: z.string(),
	}),
	deleted_record: z.string(),
}).passthrough();

const PaginationSchema = z.object({
	page: z.number(),
	limit: z.number(),
	total: z.number(),
	total_pages: z.number(),
});

const AuditEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				scope: z
					.object({
						from_date: z.string(),
						to_date: z.string(),
					})
					.passthrough(),
				meta: z
					.object({
						generated_at: z.string(),
						live_data_warning: z.string(),
					})
					.passthrough(),
				summary: z
					.object({
						evidence_in_period: z.number(),
						by_type: z.array(
							z.object({
								value: z.string(),
								label: z.string(),
								count: z.number(),
							})
						),
						undated_evidence: z.number(),
						unknown_actor: z.number(),
						narrative_available: z.number(),
					})
					.passthrough(),
				evidence_filters: z
					.object({
						date_basis: z.string(),
						actor: z
							.object({
								value: z.string().nullable(),
								label: z.string(),
								is_unknown: z.boolean(),
							})
							.passthrough(),
						activity_type: z
							.object({ value: z.string().nullable() })
							.passthrough(),
						outcome: z.object({ value: z.string().nullable() }).passthrough(),
						event_type: z
							.object({ value: z.string().nullable() })
							.passthrough(),
						undated: z.object({ value: z.boolean() }).passthrough(),
						ignored: z.array(
							z.object({ filter: z.string(), reason: z.string() })
						),
					})
					.passthrough(),
				filter_options: z
					.object({
						actors: z.array(z.object({ id: z.number() }).passthrough()),
						activity_types: z.array(
							z.object({ value: z.string(), label: z.string() })
						),
						outcomes: z.array(
							z.object({ value: z.string(), label: z.string() })
						),
						event_types: z.array(
							z.object({ value: z.string(), label: z.string() })
						),
					})
					.passthrough(),
				evidence: z.array(EvidenceRowSchema),
				pagination: PaginationSchema,
				deleted: z
					.object({
						summary: z
							.object({
								deleted_leads: z.number(),
								deleted_activities: z.number(),
								evidence_in_view: z.number(),
								by_type: z.array(
									z.object({
										value: z.string(),
										label: z.string(),
										count: z.number(),
									})
								),
								unknown_deletion_facts: z.literal(true),
							})
							.passthrough(),
						evidence: z.array(DeletedEvidenceRowSchema),
						pagination: PaginationSchema,
						deletion_facts: z
							.object({
								known: z.literal(false),
								actor: z.null(),
								at: z.null(),
								note: z.string(),
							})
							.passthrough(),
					})
					.passthrough(),
				narrative: z
					.object({
						route: z.string(),
						requires: z.array(z.string()),
					})
					.passthrough(),
				disclosures: z.array(
					z.object({ code: z.string(), text: z.string() }).passthrough()
				),
			})
			.passthrough(),
	})
	.passthrough();

type AuditBody = z.infer<typeof AuditEnvelopeSchema>['data'];

const DeletedEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				summary: z
					.object({
						deleted_leads: z.number(),
						deleted_activities: z.number(),
						evidence_in_view: z.number(),
					})
					.passthrough(),
				evidence: z.array(DeletedEvidenceRowSchema),
				pagination: PaginationSchema,
				deletion_facts: z
					.object({
						known: z.literal(false),
						actor: z.null(),
						at: z.null(),
					})
					.passthrough(),
			})
			.passthrough(),
	})
	.passthrough();

const NarrativeEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				evidence_type: z.string(),
				evidence_id: z.number(),
				reference: z.string(),
				actor: z
					.object({
						id: z.number().nullable(),
						name: z.string().nullable(),
						is_unknown: z.boolean(),
					})
					.passthrough(),
				recorded_at: z.string().nullable(),
				occurred_at: z.string().nullable(),
				fields: z.array(
					z.object({
						key: z.string(),
						label: z.string(),
						value: z.string().nullable(),
					})
				),
				changes: z.array(
					z.object({
						field: z.string(),
						label: z.string(),
						from: z.string().nullable(),
						to: z.string().nullable(),
					})
				),
				downstream: z
					.object({
						proposal: z
							.object({
								id: z.number(),
								title: z.string().nullable(),
								status: z.string().nullable(),
							})
							.nullable(),
						proposal_state: z.string(),
						project: z
							.object({
								id: z.number(),
								title: z.string().nullable(),
							})
							.nullable(),
						project_state: z.string(),
					})
					.optional(),
				deletion: z
					.object({ known: z.literal(false), note: z.string() })
					.nullable(),
			})
			.passthrough(),
	})
	.passthrough();

const CoverageEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				stats: z.array(
					z.object({
						code: z.string(),
						label: z.string(),
						count: z.number().nullable(),
						population: z.string(),
						detail: z.string(),
						is_exclusion: z.boolean(),
					})
				),
				evidence_by_type: z.array(
					z.object({
						value: z.string(),
						label: z.string(),
						count: z.number(),
					})
				),
				exclusions: z.array(
					z.object({
						metric: z.string(),
						label: z.string(),
						excluded: z.number().nullable(),
						reason: z.string(),
					})
				),
				history_limits: z.array(
					z.object({
						code: z.string(),
						label: z.string(),
						detail: z.string(),
					})
				),
				deleted_evidence: z
					.object({
						deleted_leads: z.number(),
						deleted_activities: z.number(),
						note: z.string(),
					})
					.passthrough(),
				disclosures: z.array(
					z.object({ code: z.string(), text: z.string() }).passthrough()
				),
			})
			.passthrough(),
	})
	.passthrough();

const ErrorEnvelopeSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
		code: z.string().optional(),
	})
	.passthrough();

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

async function readAudit(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<AuditBody> {
	const response = await context.http.get(
		`/api/reports/lead-audit/audit${query(values)}`,
		token
	);
	assert.equal(response.status, 200, `audit status (body: ${response.text})`);
	return AuditEnvelopeSchema.parse(response.json()).data;
}

async function readDeleted(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
) {
	const response = await context.http.get(
		`/api/reports/lead-audit/audit/deleted${query(values)}`,
		token
	);
	assert.equal(response.status, 200, `deleted status (body: ${response.text})`);
	return DeletedEnvelopeSchema.parse(response.json()).data;
}

async function readNarrative(
	context: ScenarioContext,
	type: string,
	id: number,
	token: string
) {
	const response = await context.http.get(
		`/api/reports/lead-audit/audit/narrative${query({ type, id })}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`narrative status (body: ${response.text})`
	);
	return NarrativeEnvelopeSchema.parse(response.json()).data;
}

async function readCoverage(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
) {
	const response = await context.http.get(
		`/api/reports/lead-audit/coverage${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`coverage status (body: ${response.text})`
	);
	return CoverageEnvelopeSchema.parse(response.json()).data;
}

async function expectRefusedStatus(
	context: ScenarioContext,
	path: string,
	token: string | undefined,
	status: number
): Promise<void> {
	const response = await context.http.get(path, token);
	assert.equal(
		response.status,
		status,
		`${path} status for ${token ? 'session' : 'anonymous'} (body: ${response.text})`
	);
}

async function expectValidationCode(
	context: ScenarioContext,
	path: string,
	token: string,
	code: string
): Promise<void> {
	const response = await context.http.get(path, token);
	assert.equal(
		response.status,
		422,
		`422 for ${path} (body: ${response.text})`
	);
	const body = ErrorEnvelopeSchema.parse(response.json());
	assert.equal(body.code, code, `validation code for ${path}`);
}

async function insertActivity(
	context: ScenarioContext,
	leadId: number,
	input: {
		recordedAt: string;
		occurredAt: string | null;
		actorId: number | null;
		activityType: string | null;
		status: string;
		callOutcome?: string | null;
		replyConfirmed?: number | null;
		notes?: string | null;
		isDeleted?: boolean;
		scheduledFor?: string | null;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activities (
      lead_id, activity_type, status, call_outcome, reply_confirmed,
      scheduled_for, occurred_at, next_action, notes, created_by,
      recorded_at, created_at, updated_at, isDelete
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
		[
			leadId,
			input.activityType,
			input.status,
			input.callOutcome ?? null,
			input.replyConfirmed ?? null,
			input.scheduledFor ?? null,
			input.occurredAt,
			input.notes ?? null,
			input.actorId,
			input.recordedAt,
			input.recordedAt,
			input.recordedAt,
			input.isDeleted ? 1 : 0,
		]
	);
	return result.insertId;
}

async function insertStage(
	context: ScenarioContext,
	leadId: number,
	input: {
		recordedAt: string;
		from: string | null;
		to: string;
		source: string;
		reason: string | null;
		actorId: number | null;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_stage_history (
      lead_id, from_stage, to_stage, change_source, reason,
      actor_user_id, recorded_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			leadId,
			input.from,
			input.to,
			input.source,
			input.reason,
			input.actorId,
			input.recordedAt,
			input.recordedAt,
		]
	);
	return result.insertId;
}

async function insertOwnerChange(
	context: ScenarioContext,
	leadId: number,
	input: {
		recordedAt: string;
		priorOwnerId: number | null;
		ownerId: number | null;
		actorId: number | null;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_ownership_history (
      lead_id, prior_owner_user_id, owner_user_id, actor_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
		[leadId, input.priorOwnerId, input.ownerId, input.actorId, input.recordedAt]
	);
	return result.insertId;
}

async function insertCorrection(
	context: ScenarioContext,
	leadId: number,
	activityId: number,
	input: {
		recordedAt: string;
		previous: Record<string, unknown>;
		corrected: Record<string, unknown>;
		reason: string;
		actorId: number | null;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activity_corrections (
      activity_id, lead_id, previous_values, corrected_values,
      reason, corrected_by, corrected_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			activityId,
			leadId,
			JSON.stringify(input.previous),
			JSON.stringify(input.corrected),
			input.reason,
			input.actorId,
			input.recordedAt,
			input.recordedAt,
		]
	);
	return result.insertId;
}

async function insertLegacyReview(
	context: ScenarioContext,
	leadId: number,
	input: {
		recordedAt: string;
		reviewType: string;
		originalValue: string | null;
		resolvedValue: string | null;
		resolvedReference?: number | null;
		reason: string;
		resolutionSource: string;
		reviewerId: number | null;
		reviewerName?: string | null;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_legacy_reviews (
      lead_id, review_type, original_value, original_reference,
      resolved_value, resolved_reference, reason, resolution_source,
      reviewer_user_id, reviewer_name, resolved_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
		[
			leadId,
			input.reviewType,
			input.originalValue,
			input.resolvedValue,
			input.resolvedReference ?? null,
			input.reason,
			input.resolutionSource,
			input.reviewerId,
			input.reviewerName ?? null,
			input.recordedAt,
		]
	);
	return result.insertId;
}

async function snapshotTables(
	context: ScenarioContext,
	leadIds: number[]
): Promise<Record<string, Array<Record<string, unknown>>>> {
	const placeholders = leadIds.map(() => '?').join(', ');
	const tables = [
		'lead_activities',
		'lead_stage_history',
		'lead_ownership_history',
		'lead_activity_corrections',
		'lead_legacy_reviews',
		'lead_conversions',
	];
	const snapshot: Record<string, Array<Record<string, unknown>>> = {};
	for (const table of tables) {
		snapshot[table] = await context.reader.fixtureRows(
			`SELECT * FROM ${table} WHERE lead_id IN (${placeholders}) ORDER BY id ASC`,
			leadIds
		);
	}
	snapshot.leads = await context.reader.fixtureRows(
		`SELECT * FROM leads WHERE id IN (${placeholders}) ORDER BY id ASC`,
		leadIds
	);
	return snapshot;
}

function byType(
	body: { by_type: Array<{ value: string; count: number }> },
	value: string
): number {
	const entry = body.by_type.find((type) => type.value === value);
	assert.ok(entry, `evidence type ${value} is reported`);
	return entry.count;
}

function stat(
	body: { stats: Array<{ code: string; count: number | null }> },
	code: string
): number {
	const entry = body.stats.find((item) => item.code === code);
	assert.ok(entry, `coverage stat ${code} is reported`);
	assert.ok(entry.count !== null, `coverage stat ${code} is a count`);
	return entry.count;
}

function exclusion(
	body: { exclusions: Array<{ metric: string; excluded: number | null }> },
	metric: string
): number {
	const entry = body.exclusions.find((item) => item.metric === metric);
	assert.ok(entry, `exclusion ${metric} is reported`);
	return entry.excluded ?? 0;
}

async function seedPrivilegedReader(context: ScenarioContext): Promise<string> {
	const username = `${context.runTag}-auditpriv`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-');
	const passwordHash = await hashFixturePassword(FIXTURE_PASSWORD);
	await context.reader.fixtureWrite(
		`INSERT INTO users (
      username, password_hash, email, full_name, status, is_active,
      isDelete, permissions, field_permissions, is_super_admin
    ) VALUES (?, ?, ?, ?, 'active', 1, 0, ?, NULL, 0)`,
		[
			username,
			passwordHash,
			`${username}@example.com`,
			`${context.runTag} Audit Privileged`,
			JSON.stringify([
				'leads:read',
				'reports:read',
				'proposals:read',
				'projects:read',
			]),
		]
	);
	const login = await (context.http as unknown as LoginHttpClient).login(
		username,
		FIXTURE_PASSWORD,
		'127.0.0.42'
	);
	return login.sessionToken;
}

export async function reportAuditScenario(
	context: ScenarioContext
): Promise<void> {
	const token = context.reportReader.sessionToken;
	const privilegedToken = await seedPrivilegedReader(context);
	const marker = `${context.runTag}-AUD404`;
	const search = marker;

	// ── Independent fixtures with explicit recording and occurrence times ──
	const leadA = await context.reader.seedReportLead({
		companyName: `${marker} Alpha`,
		recordedAt: '2026-08-20 09:00:00',
		source: 'Website',
		stage: null,
		ownerUserId: context.creator.id,
		enquiryDate: null,
	});
	const leadB = await context.reader.seedReportLead({
		companyName: `${marker} Beta`,
		recordedAt: '2026-08-21 09:00:00',
		source: null,
		stage: 'Converted',
		ownerUserId: null,
		enquiryDate: null,
	});
	const deletedLead = await context.reader.seedReportLead({
		companyName: `${marker} Deleted`,
		recordedAt: '2026-08-05 09:00:00',
		source: 'Event',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
		enquiryDate: '2026-08-04',
		isDeleted: true,
	});

	// Coverage facts that must stay explicit.
	await context.reader.fixtureWrite(
		`UPDATE leads SET legacy_stage = 'Interested', legacy_review_required = 1
     WHERE id = ?`,
		[leadA]
	);
	await context.reader.fixtureWrite(
		`UPDATE leads SET legacy_owner_name = 'Ghost Owner',
        legacy_proposal_conflict = 1, canonical_proposal_id = NULL
     WHERE id = ?`,
		[leadB]
	);
	// A deleted record must never borrow this update timestamp as a deletion
	// time; the report must not expose it.
	await context.reader.fixtureWrite(
		`UPDATE leads SET updated_at = '2030-01-01 00:00:00' WHERE id = ?`,
		[deletedLead]
	);

	// Lead A evidence: in-period activity, undated activity, late-recorded
	// activity (occurrence inside, recording outside), and a tie pair.
	const activityA1 = await insertActivity(context, leadA, {
		recordedAt: '2026-09-16 08:00:00',
		occurredAt: '2026-09-15 10:00:00',
		actorId: context.creator.id,
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		notes: 'Corrected note',
	});
	const activityA2 = await insertActivity(context, leadA, {
		recordedAt: '2026-09-17 09:00:00',
		occurredAt: null,
		actorId: null,
		activityType: 'Email',
		status: 'Completed',
		replyConfirmed: 1,
		notes: 'Undated legacy email',
	});
	const activityA3 = await insertActivity(context, leadA, {
		recordedAt: '2026-10-02 10:00:00',
		occurredAt: '2026-09-10 11:00:00',
		actorId: context.assignee.id,
		activityType: 'Note',
		status: 'Completed',
		notes: 'Recorded later, occurred earlier',
	});
	const activityTie = await insertActivity(context, leadA, {
		recordedAt: '2026-09-29 09:00:00',
		occurredAt: '2026-09-29 09:00:00',
		actorId: context.creator.id,
		activityType: 'Meeting',
		status: 'Completed',
		notes: 'Tie activity',
	});
	const deletedActivity = await insertActivity(context, leadA, {
		recordedAt: '2026-09-23 08:00:00',
		occurredAt: '2026-09-23 08:00:00',
		actorId: context.creator.id,
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'No Answer',
		notes: 'Deleted activity evidence',
		isDeleted: true,
	});
	await insertActivity(context, deletedLead, {
		recordedAt: '2026-08-15 08:00:00',
		occurredAt: null,
		actorId: context.creator.id,
		activityType: 'Call',
		status: 'Completed',
		callOutcome: null,
		notes: 'Deleted Lead activity',
	});

	const stageS1 = await insertStage(context, leadA, {
		recordedAt: '2026-09-18 12:00:00',
		from: 'New',
		to: 'Connected',
		source: 'explicit',
		reason: 'Evidence of qualification',
		actorId: context.assignee.id,
	});
	const stageTie = await insertStage(context, leadA, {
		recordedAt: '2026-09-29 09:00:00',
		from: 'Connected',
		to: 'Qualified',
		source: 'explicit',
		reason: 'Tie stage decision',
		actorId: context.creator.id,
	});
	await insertStage(context, deletedLead, {
		recordedAt: '2026-08-06 12:00:00',
		from: 'New',
		to: 'Connected',
		source: 'automatic',
		reason: null,
		actorId: null,
	});

	const ownerChange = await insertOwnerChange(context, leadA, {
		recordedAt: '2026-09-19 12:00:00',
		priorOwnerId: null,
		ownerId: context.assignee.id,
		actorId: context.creator.id,
	});
	const correction = await insertCorrection(context, leadA, activityA1, {
		recordedAt: '2026-09-20 12:00:00',
		previous: {
			activity_type: 'Call',
			call_outcome: 'No Answer',
			reply_confirmed: null,
			occurred_at: '2026-09-15T10:00:00',
			notes: 'First note',
		},
		corrected: {
			activity_type: 'Call',
			call_outcome: 'Connected',
			reply_confirmed: null,
			occurred_at: '2026-09-15T10:00:00',
			notes: 'Corrected note',
		},
		reason: 'Client confirmed the call',
		actorId: context.assignee.id,
	});
	const legacyReview = await insertLegacyReview(context, leadA, {
		recordedAt: '2026-09-21 12:00:00',
		reviewType: 'stage',
		originalValue: 'Hot Lead',
		resolvedValue: 'Qualified',
		reason: 'Stored label matched the evidence',
		resolutionSource: 'reviewer',
		reviewerId: context.creator.id,
	});
	const automaticReview = await insertLegacyReview(context, leadB, {
		recordedAt: '2026-09-22 12:00:00',
		reviewType: 'owner',
		originalValue: 'Old Owner',
		resolvedValue: null,
		reason: 'No exact user match',
		resolutionSource: 'automatic',
		reviewerId: null,
	});

	// Conversion evidence with permission-controlled downstream context.
	const proposalId = (
		await context.reader.fixtureWrite(
			`INSERT INTO proposals (
        proposal_title, lead_id, status, canonical_lead_id, isDelete,
        created_at, updated_at
      ) VALUES (?, ?, 'DRAFT', ?, 0, NOW(), NOW())`,
			[`${marker} Proposal Title`, leadA, leadA]
		)
	).insertId;
	const projectId = (
		await context.reader.fixtureWrite(
			`INSERT INTO projects (
        project_title, name, status, progress, proposal_id, isDelete,
        created_at, updated_at
      ) VALUES (?, ?, 'NEW', 10, ?, 0, NOW(), NOW())`,
			[`${marker} Project Title`, `${marker} Project`, proposalId]
		)
	).insertId;
	await context.reader.fixtureWrite(
		`UPDATE proposals SET project_id = ? WHERE id = ?`,
		[projectId, proposalId]
	);
	const conversion = (
		await context.reader.fixtureWrite(
			`INSERT INTO lead_conversions (
        lead_id, proposal_id, converted_by, converted_at, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
			[
				leadA,
				proposalId,
				context.creator.id,
				'2026-09-22 12:00:00',
				'2026-09-22 12:00:00',
			]
		)
	).insertId;

	const leadIds = [leadA, leadB, deletedLead];
	const before = await snapshotTables(context, leadIds);

	// ── Audit list: recording time, not occurrence time ────────────────────
	const audit = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			limit: 100,
		},
		token
	);
	assert.equal(audit.scope.from_date, PERIOD_FROM);
	assert.equal(audit.scope.to_date, PERIOD_TO);
	assert.equal(audit.summary.evidence_in_period, 10, 'in-period evidence rows');
	assert.equal(byType(audit.summary, 'activity'), 3);
	assert.equal(byType(audit.summary, 'stage_change'), 2);
	assert.equal(byType(audit.summary, 'owner_change'), 1);
	assert.equal(byType(audit.summary, 'correction'), 1);
	assert.equal(byType(audit.summary, 'legacy_review'), 2);
	assert.equal(byType(audit.summary, 'conversion'), 1);
	assert.equal(
		audit.summary.undated_evidence,
		1,
		'undated activity is explicit'
	);
	assert.equal(
		audit.summary.unknown_actor,
		2,
		'missing author and automatic reviewer'
	);
	assert.ok(
		audit.evidence_filters.date_basis.toLowerCase().includes('recording'),
		'recording-time date basis is disclosed'
	);

	const references = audit.evidence.map((row) => row.reference);
	assert.ok(references.includes(`activity:${activityA1}`));
	assert.ok(references.includes(`activity:${activityA2}`));
	assert.ok(references.includes(`stage_change:${stageS1}`));
	assert.ok(references.includes(`owner_change:${ownerChange}`));
	assert.ok(references.includes(`correction:${correction}`));
	assert.ok(references.includes(`legacy_review:${legacyReview}`));
	assert.ok(references.includes(`legacy_review:${automaticReview}`));
	assert.ok(references.includes(`conversion:${conversion}`));
	assert.ok(
		!references.includes(`activity:${activityA3}`),
		'late recording is outside September'
	);
	assert.ok(
		!references.includes(`activity:${deletedActivity}`),
		'deleted activity is separate'
	);

	const undatedRow = audit.evidence.find(
		(row) => row.evidence_id === activityA2 && row.evidence_type === 'activity'
	);
	assert.ok(undatedRow);
	assert.equal(undatedRow.occurred_at, null);
	assert.equal(undatedRow.occurrence_known, false);
	assert.equal(undatedRow.actor.is_unknown, true);

	const tieActivityIndex = references.indexOf(`activity:${activityTie}`);
	const tieStageIndex = references.indexOf(`stage_change:${stageTie}`);
	assert.ok(
		tieActivityIndex >= 0 && tieStageIndex >= 0,
		'tie rows are present'
	);
	assert.ok(
		tieActivityIndex < tieStageIndex,
		'mixed-type ties order by evidence type'
	);

	// Occurrence dates never select the audit row.
	const october = await readAudit(
		context,
		{
			from_date: OUTSIDE_PERIOD_FROM,
			to_date: '2026-10-31',
			search,
			limit: 100,
		},
		token
	);
	assert.equal(october.summary.evidence_in_period, 1);
	assert.equal(october.evidence[0]?.reference, `activity:${activityA3}`);
	assert.equal(
		october.evidence[0]?.occurred_at?.startsWith('2026-09-10'),
		true,
		'occurrence remains visible outside the recording period'
	);

	// ── Evidence filters and explicit incompatible scope ────────────────────
	const actorUnknown = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: 'unknown',
			limit: 100,
		},
		token
	);
	assert.equal(actorUnknown.summary.evidence_in_period, 2);
	assert.ok(
		actorUnknown.evidence.every((row) => row.actor.is_unknown),
		'unknown actor filter selects only unknown evidence'
	);

	const assigneeOnly = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: context.assignee.id,
			limit: 100,
		},
		token
	);
	assert.equal(assigneeOnly.summary.evidence_in_period, 2);
	assert.equal(
		assigneeOnly.evidence_filters.actor.label,
		context.assignee.fullName
	);

	const callsOnly = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			activity_type: 'Call',
			limit: 100,
		},
		token
	);
	assert.equal(callsOnly.summary.evidence_in_period, 1);
	assert.equal(callsOnly.evidence[0]?.reference, `activity:${activityA1}`);
	assert.equal(
		callsOnly.evidence_filters.activity_type.excludes_other_evidence,
		true
	);
	assert.ok(
		callsOnly.evidence_filters.ignored.some((entry) =>
			entry.filter.includes('Non-activity')
		),
		'non-activity exclusion is disclosed'
	);

	const emailReplied = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			outcome: 'email_replied',
			limit: 100,
		},
		token
	);
	assert.equal(emailReplied.summary.evidence_in_period, 1);
	assert.equal(emailReplied.evidence[0]?.reference, `activity:${activityA2}`);

	const correctionsOnly = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			event_type: 'correction',
			limit: 100,
		},
		token
	);
	assert.equal(correctionsOnly.summary.evidence_in_period, 1);
	assert.equal(
		correctionsOnly.evidence[0]?.reference,
		`correction:${correction}`
	);
	assert.ok(correctionsOnly.evidence[0]?.change_fields.length > 0);
	assert.ok(
		correctionsOnly.evidence[0]?.change_fields.some(
			(field) => field.field === 'call_outcome'
		),
		'correction field names are structured, not raw JSON'
	);

	const undatedOnly = await readAudit(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			undated: 1,
			limit: 100,
		},
		token
	);
	assert.equal(undatedOnly.summary.evidence_in_period, 1);
	assert.equal(undatedOnly.evidence[0]?.reference, `activity:${activityA2}`);
	assert.equal(undatedOnly.evidence_filters.undated.value, true);

	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			activity_type: 'Call',
			event_type: 'conversion',
		})}`,
		token,
		'incompatible_filters'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit${query({
			view: 'audit',
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			activity_type: 'Call',
			event_type: 'conversion',
		})}`,
		token,
		'incompatible_filters'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit${query({ view: 'not_a_view' })}`,
		token,
		'invalid_view'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			event_type: 'deleted_record',
		})}`,
		token,
		'invalid_event_type'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			event_type: 'unknown',
		})}`,
		token,
		'invalid_event_type'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO, actor: 'nobody' })}`,
		token,
		'invalid_actor'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO, outcome: 'Maybe' })}`,
		token,
		'invalid_outcome'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO, activity_type: 'Visit' })}`,
		token,
		'invalid_activity_type'
	);

	// ── Deterministic mixed-type pagination ────────────────────────────────
	const pageOne = await readAudit(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, page: 1, limit: 3 },
		token
	);
	const pageTwo = await readAudit(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, page: 2, limit: 3 },
		token
	);
	const pageTwoRepeat = await readAudit(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, page: 2, limit: 3 },
		token
	);
	assert.equal(pageOne.pagination.total, 10);
	assert.equal(pageOne.pagination.total_pages, 4);
	assert.deepEqual(
		pageTwo.evidence.map((row) => row.reference),
		pageTwoRepeat.evidence.map((row) => row.reference),
		'repeated pages are stable'
	);
	const pagedReferences: string[] = [];
	for (let page = 1; page <= 4; page += 1) {
		const body = await readAudit(
			context,
			{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, page, limit: 3 },
			token
		);
		pagedReferences.push(...body.evidence.map((row) => row.reference));
	}
	assert.equal(new Set(pagedReferences).size, 10, 'pages never repeat a row');
	assert.deepEqual(
		pagedReferences,
		references,
		'paged order matches the complete ordered result'
	);
	for (let index = 1; index < references.length; index += 1) {
		const previous = audit.evidence[index - 1];
		const current = audit.evidence[index];
		assert.ok(previous && current);
		if (previous.recorded_at === current.recorded_at) {
			const typeOrder = previous.evidence_type.localeCompare(
				current.evidence_type
			);
			if (typeOrder === 0) {
				assert.ok(
					previous.evidence_id < current.evidence_id,
					'id tie-break ascends'
				);
			} else {
				assert.ok(typeOrder < 0, 'type tie-break ascends');
			}
		} else {
			assert.ok(
				String(previous.recorded_at) >= String(current.recorded_at),
				'recording time descends'
			);
		}
	}

	// ── Retained deleted evidence is separate and readable ─────────────────
	const deletedSection = audit.deleted;
	assert.equal(deletedSection.summary.deleted_leads, 1);
	assert.equal(deletedSection.summary.deleted_activities, 1);
	assert.equal(deletedSection.summary.evidence_in_view, 3);
	assert.equal(deletedSection.deletion_facts.known, false);
	assert.equal(deletedSection.deletion_facts.actor, null);
	assert.equal(deletedSection.deletion_facts.at, null);
	assert.ok(
		deletedSection.evidence.some(
			(row) =>
				row.evidence_id === deletedActivity && row.deleted_record === 'evidence'
		),
		'deleted activity on a live Lead is retained evidence'
	);
	assert.ok(
		deletedSection.evidence.some((row) => row.deleted_record === 'lead'),
		'deleted Lead evidence is labelled'
	);

	const deletedList = await readDeleted(context, { search, limit: 100 }, token);
	assert.equal(deletedList.summary.evidence_in_view, 3);
	assert.equal(deletedList.pagination.total, 3);
	const deletedResponse = await context.http.get(
		`/api/reports/lead-audit/audit/deleted${query({ search, limit: 100 })}`,
		token
	);
	assert.equal(deletedResponse.status, 200);
	assert.ok(
		!deletedResponse.text.includes('2030-01-01'),
		'deletion facts never borrow the update timestamp'
	);

	// ── On-demand narrative, plain text, corrections stay distinct ─────────
	const correctionNarrative = await readNarrative(
		context,
		'correction',
		correction,
		token
	);
	assert.equal(correctionNarrative.reference, `correction:${correction}`);
	const reasonField = correctionNarrative.fields.find(
		(field) => field.key === 'reason'
	);
	assert.equal(reasonField?.value, 'Client confirmed the call');
	assert.equal(correctionNarrative.actor.id, context.assignee.id);
	const outcomeChange = correctionNarrative.changes.find(
		(change) => change.field === 'call_outcome'
	);
	assert.ok(outcomeChange);
	assert.equal(outcomeChange.from, 'No Answer');
	assert.equal(outcomeChange.to, 'Connected');
	const notesChange = correctionNarrative.changes.find(
		(change) => change.field === 'notes'
	);
	assert.ok(notesChange);
	assert.equal(notesChange.from, 'First note');
	assert.equal(notesChange.to, 'Corrected note');

	const activityNarrative = await readNarrative(
		context,
		'activity',
		activityA1,
		token
	);
	const activityNotes = activityNarrative.fields.find(
		(field) => field.key === 'notes'
	);
	assert.equal(
		activityNotes?.value,
		'Corrected note',
		'the live corrected fact is read'
	);
	assert.equal(activityNarrative.changes.length, 0);

	const legacyNarrative = await readNarrative(
		context,
		'legacy_review',
		legacyReview,
		token
	);
	assert.equal(
		legacyNarrative.fields.find((field) => field.key === 'original_value')
			?.value,
		'Hot Lead'
	);
	assert.equal(
		legacyNarrative.fields.find((field) => field.key === 'resolved_value')
			?.value,
		'Qualified'
	);

	const deletedNarrative = await readNarrative(
		context,
		'activity',
		deletedActivity,
		token
	);
	assert.ok(deletedNarrative.deletion);
	assert.equal(deletedNarrative.deletion?.known, false);

	const notFound = await context.http.get(
		`/api/reports/lead-audit/audit/narrative${query({ type: 'activity', id: 999999 })}`,
		token
	);
	assert.equal(notFound.status, 404);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/audit/narrative${query({ type: 'proposal', id: 1 })}`,
		token,
		'invalid_evidence_type'
	);

	// ── Source-grant redaction, never hidden markup ────────────────────────
	const restrictedAudit = await readAudit(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, limit: 100 },
		token
	);
	const restrictedConversion = restrictedAudit.evidence.find(
		(row) => row.evidence_type === 'conversion'
	);
	assert.ok(restrictedConversion);
	assert.equal(restrictedConversion.downstream?.proposal_state, 'restricted');
	assert.equal(restrictedConversion.downstream?.proposal, null);
	assert.equal(restrictedConversion.downstream?.project_state, 'restricted');
	const restrictedBody = await context.http.get(
		`/api/reports/lead-audit/audit${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			limit: 100,
		})}`,
		token
	);
	assert.ok(
		!restrictedBody.text.includes(`${marker} Proposal Title`),
		'denied Proposal title is absent from the payload'
	);
	assert.ok(
		!restrictedBody.text.includes(`${marker} Project Title`),
		'denied Project title is absent from the payload'
	);

	const restrictedNarrative = await readNarrative(
		context,
		'conversion',
		conversion,
		token
	);
	assert.equal(restrictedNarrative.downstream?.proposal_state, 'restricted');
	assert.equal(restrictedNarrative.downstream?.proposal, null);
	assert.ok(
		restrictedNarrative.fields.some(
			(field) => field.key === 'proposal_state' && field.value === 'Restricted'
		)
	);

	const privilegedAudit = await readAudit(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, limit: 100 },
		privilegedToken
	);
	const privilegedConversion = privilegedAudit.evidence.find(
		(row) => row.evidence_type === 'conversion'
	);
	assert.equal(privilegedConversion?.downstream?.proposal_state, 'available');
	assert.equal(
		privilegedConversion?.downstream?.proposal?.title,
		`${marker} Proposal Title`
	);
	assert.equal(privilegedConversion?.downstream?.project_state, 'available');
	assert.equal(
		privilegedConversion?.downstream?.project?.title,
		`${marker} Project Title`
	);
	const privilegedNarrative = await readNarrative(
		context,
		'conversion',
		conversion,
		privilegedToken
	);
	assert.equal(
		privilegedNarrative.fields.find((field) => field.key === 'proposal_title')
			?.value,
		`${marker} Proposal Title`
	);

	// ── Coverage: unknown facts, exclusions, and history limits ────────────
	const coverage = await readCoverage(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	assert.equal(stat(coverage, 'lead_population'), 2, 'active Leads only');
	assert.equal(stat(coverage, 'unknown_stage'), 1);
	assert.equal(stat(coverage, 'unresolved_legacy_stage'), 1);
	assert.equal(stat(coverage, 'missing_enquiry_date'), 2);
	assert.equal(stat(coverage, 'missing_source'), 1);
	assert.equal(stat(coverage, 'unassigned'), 1);
	assert.equal(stat(coverage, 'unresolved_legacy_owner'), 1);
	assert.equal(stat(coverage, 'proposal_link_conflict'), 1);
	assert.equal(stat(coverage, 'converted_without_date'), 1);
	assert.equal(stat(coverage, 'converted_without_evidence'), 1);
	assert.equal(stat(coverage, 'evidence_in_period'), 10);
	assert.equal(stat(coverage, 'undated_activity_evidence'), 1);
	assert.equal(stat(coverage, 'unknown_activity_author'), 1);
	assert.equal(stat(coverage, 'unknown_call_outcome'), 0);
	assert.equal(stat(coverage, 'unknown_email_reply'), 0);
	assert.equal(stat(coverage, 'automatic_legacy_reviews'), 1);
	assert.equal(byType({ by_type: coverage.evidence_by_type }, 'correction'), 1);
	assert.equal(byType({ by_type: coverage.evidence_by_type }, 'conversion'), 1);
	assert.equal(exclusion(coverage, 'period_work'), 1);
	assert.equal(exclusion(coverage, 'audit_occurrence_totals'), 1);
	assert.equal(exclusion(coverage, 'operational_totals'), 2);
	assert.equal(coverage.deleted_evidence.deleted_leads, 1);
	assert.equal(coverage.deleted_evidence.deleted_activities, 1);
	const historyCodes = coverage.history_limits.map((limit) => limit.code);
	for (const code of [
		'generic_enquiry_edits',
		'rescheduling',
		'stage_history',
		'author_outcome_occurrence',
		'corrections_live',
		'deleted_facts',
		'not_compliance_log',
	]) {
		assert.ok(
			historyCodes.includes(code),
			`history limit ${code} is disclosed`
		);
	}
	assert.ok(
		coverage.disclosures.some(
			(disclosure) => disclosure.code === 'coverage_not_zero'
		),
		'missing facts are never measured zeroes'
	);
	await expectValidationCode(
		context,
		`/api/reports/lead-audit/coverage${query({ from_date: PERIOD_TO, to_date: PERIOD_FROM })}`,
		token,
		'invalid_range'
	);

	// ── Access: both grants, the super-admin bypass, nothing else ──────────
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO })}`,
		undefined,
		401
	);
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO })}`,
		context.reportOnly.sessionToken,
		403
	);
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO })}`,
		context.readOnly.sessionToken,
		403
	);
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/audit${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO })}`,
		context.projectReportOnly.sessionToken,
		403
	);
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/audit/narrative${query({ type: 'activity', id: activityA1 })}`,
		undefined,
		401
	);
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/audit/deleted${query({ search })}`,
		context.reportOnly.sessionToken,
		403
	);
	await expectRefusedStatus(
		context,
		`/api/reports/lead-audit/coverage${query({ from_date: PERIOD_FROM, to_date: PERIOD_TO })}`,
		context.projectReportOnly.sessionToken,
		403
	);
	const superAdminAudit = await readAudit(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, limit: 100 },
		context.superAdmin.sessionToken
	);
	assert.equal(superAdminAudit.summary.evidence_in_period, 10);
	assert.equal(
		superAdminAudit.evidence.find((row) => row.evidence_type === 'conversion')
			?.downstream?.proposal_state,
		'available',
		'an established super admin bypasses the source grants'
	);

	// ── Report reads leave every source row untouched ──────────────────────
	const after = await snapshotTables(context, leadIds);
	assert.deepEqual(
		after,
		before,
		'report reads never mutate evidence or Leads'
	);
}
