import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { hashFixturePassword } from '../support.ts';
import type { ScenarioContext } from '../client.ts';

// The Lead Audit work and accountability slice (#400). The report is proved
// through its authenticated HTTP reads only: independently seeded Leads and
// activity rows carry explicit occurrence times, authors, outcomes, and
// statuses, and every expected figure below is derived from those known
// values, never from the report's own aggregates.

const TypeCountsSchema = z.object({
	call: z.number(),
	email: z.number(),
	meeting: z.number(),
	note: z.number(),
	unknown: z.number(),
});

const SummarySchema = z.object({
	completed_total: z.number(),
	by_type: TypeCountsSchema,
	outreach_total: z.number(),
	distinct_leads_worked: z.number(),
	distinct_leads_with_outreach: z.number(),
	successful_contact: z.number(),
	distinct_leads_with_successful_contact: z.number(),
	calls_connected: z.number(),
	calls_failed: z.number(),
	calls_outcome_unknown: z.number(),
	emails_confirmed_reply: z.number(),
	emails_unconfirmed: z.number(),
	corrected_activities: z.number(),
});

const CoverageSchema = z.object({
	unknown_occurrence_date: z.number(),
	unknown_activity_type: z.number(),
	unknown_author: z.number(),
	inactive_author: z.number(),
	missing_call_outcome: z.number(),
	unrecognized_call_outcome: z.number(),
	missing_email_reply_evidence: z.number(),
	cancelled_in_period: z.number(),
	deleted_activity_rows: z.number(),
});

const AuthorSchema = z.object({
	author: z.object({
		id: z.number().nullable(),
		name: z.string().nullable(),
		is_unknown: z.boolean(),
		is_inactive: z.boolean(),
	}),
	completed_total: z.number(),
	by_type: TypeCountsSchema,
	outreach_total: z.number(),
	successful_contact: z.number(),
	distinct_leads: z.number(),
});

const AppliedFilterSchema = z.object({
	key: z.enum(['actor', 'activity_type', 'outcome', 'event_type', 'undated']),
	label: z.string(),
	value: z.string().nullable(),
	display: z.string(),
	state: z.enum(['effective', 'all', 'ignored']),
	reason: z.string(),
});

const WorkSectionSchema = z
	.object({
		scope: z
			.object({
				preset: z.string(),
				from_date: z.string(),
				to_date: z.string(),
				date_basis: z.string(),
				effective_filters: z
					.object({
						owner: z.object({
							value: z.string().nullable(),
							label: z.string(),
						}),
						source: z.object({
							value: z.string().nullable(),
							label: z.string(),
							is_unknown: z.boolean(),
						}),
						stage: z.object({
							value: z.string().nullable(),
							label: z.string(),
						}),
						priority: z.string().nullable(),
						search: z.string(),
					})
					.passthrough(),
			})
			.passthrough(),
		meta: z
			.object({
				generated_at: z.string(),
				today: z.string(),
				time_zone: z.object({ label: z.string() }).passthrough(),
			})
			.passthrough(),
		work_date_basis: z.string(),
		summary: SummarySchema,
		coverage: CoverageSchema,
		authors: z.array(AuthorSchema),
		work_filters: z.object({
			effective: z.object({
				actor: z.object({
					value: z.string().nullable(),
					label: z.string(),
					is_unknown: z.boolean(),
				}),
				activity_type: z.object({
					value: z.string().nullable(),
					label: z.string(),
					is_unknown: z.boolean(),
				}),
				outcome: z.object({
					value: z.string().nullable(),
					label: z.string(),
					is_unknown: z.boolean(),
				}),
				event_type: z.object({
					value: z.string().nullable(),
					label: z.string(),
					is_unknown: z.boolean(),
				}),
			}),
			applied: z.array(AppliedFilterSchema),
			lead_filters: z.record(z.string(), z.unknown()),
		}),
		filter_options: z.object({
			actors: z.array(
				z.object({
					id: z.number(),
					name: z.string().nullable(),
					is_active: z.boolean(),
				})
			),
			activity_types: z.array(
				z.object({ value: z.string(), label: z.string() })
			),
			outcomes: z.array(z.object({ value: z.string(), label: z.string() })),
			event_types: z.array(z.object({ value: z.string(), label: z.string() })),
		}),
		disclosures: z.array(z.object({ code: z.string(), text: z.string() })),
	})
	.passthrough();

const ReportSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				scope: z
					.object({
						effective_filters: z.record(z.string(), z.unknown()),
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
				trends: z.object({
					intake: z.array(
						z.object({ date: z.string(), count: z.number() }).passthrough()
					),
					enquiry_date: z.array(
						z.object({ date: z.string(), count: z.number() }).passthrough()
					),
				}),
				work: WorkSectionSchema,
			})
			.passthrough(),
	})
	.passthrough();

type ReportBody = z.infer<typeof ReportSchema>['data'];
type WorkSection = z.infer<typeof WorkSectionSchema>;

const WorkEvidenceRowSchema = z
	.object({
		id: z.number(),
		lead: z
			.object({
				id: z.number(),
				lead_id: z.string().nullable(),
				company_name: z.string(),
				current_owner: z
					.object({ id: z.number(), name: z.string().nullable() })
					.nullable(),
			})
			.passthrough(),
		activity_type: z.object({
			value: z.string().nullable(),
			label: z.string(),
			is_unknown: z.boolean(),
		}),
		status: z.string(),
		call_outcome: z.string().nullable(),
		reply_confirmed: z.boolean().nullable(),
		occurred_at: z.string().nullable(),
		recorded_at: z.string().nullable(),
		author: z.object({
			id: z.number().nullable(),
			name: z.string().nullable(),
			is_unknown: z.boolean(),
			is_inactive: z.boolean(),
		}),
		is_outreach: z.boolean(),
		is_successful_contact: z.boolean(),
		corrected: z.boolean(),
	})
	.passthrough();

const WorkEvidenceSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				metric: z.object({
					key: z.string(),
					label: z.string(),
					definition: z.string(),
				}),
				activities: z.array(WorkEvidenceRowSchema),
				pagination: z.object({
					page: z.number(),
					limit: z.number(),
					total: z.number(),
					total_pages: z.number(),
				}),
				work_filters: z.object({
					applied: z.array(AppliedFilterSchema),
				}),
				disclosures: z.array(z.object({ code: z.string(), text: z.string() })),
			})
			.passthrough(),
	})
	.passthrough();

type WorkEvidenceBody = z.infer<typeof WorkEvidenceSchema>['data'];

const ErrorEnvelopeSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
		code: z.string().optional(),
	})
	.passthrough();

const PREFIX = 'ReportWork';
const PERIOD_FROM = '2026-05-01';
const PERIOD_TO = '2026-05-31';

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
): Promise<ReportBody> {
	const response = await context.http.get(
		`/api/reports/lead-audit${query(values)}`,
		token
	);
	assert.equal(response.status, 200, `report status (body: ${response.text})`);
	return ReportSchema.parse(response.json()).data;
}

async function readWorkEvidence(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<WorkEvidenceBody> {
	const response = await context.http.get(
		`/api/reports/lead-audit/work/evidence${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`work evidence status (body: ${response.text})`
	);
	return WorkEvidenceSchema.parse(response.json()).data;
}

async function expectRefused(
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

function appliedFilter(
	work: WorkSection,
	key: 'actor' | 'activity_type' | 'outcome' | 'event_type' | 'undated'
): z.infer<typeof AppliedFilterSchema> {
	const entry = work.work_filters.applied.find((item) => item.key === key);
	assert.ok(entry, `applied filter ${key} is reported`);
	return entry;
}

async function seedLead(
	context: ScenarioContext,
	suffix: string,
	input: {
		recordedAt: string;
		stage?: string | null;
		ownerUserId?: number | null;
		isDeleted?: boolean;
	}
): Promise<{ id: number; company: string }> {
	const company = `${context.runTag} ${PREFIX} ${suffix}`;
	const id = await context.reader.seedReportLead({
		companyName: company,
		contactName: `${context.runTag} Contact ${suffix}`,
		projectDescription: `${context.runTag} ${PREFIX} need ${suffix}`,
		recordedAt: input.recordedAt,
		enquiryDate: null,
		source: null,
		stage: input.stage ?? null,
		priority: 'Medium',
		ownerUserId: input.ownerUserId ?? null,
		isDeleted: input.isDeleted ?? false,
	});
	context.trackLead(id);
	return { id, company };
}

interface SeedActivityInput {
	leadId: number;
	activityType: string | null;
	status: 'Completed' | 'Scheduled' | 'Cancelled';
	occurredAt?: string | null;
	scheduledFor?: string | null;
	callOutcome?: string | null;
	replyConfirmed?: 0 | 1 | null;
	createdBy?: number | null;
	recordedAt?: string;
	isDeleted?: boolean;
	sourceActivityId?: number | null;
	legacyType?: string | null;
}

async function seedActivity(
	context: ScenarioContext,
	input: SeedActivityInput
): Promise<number> {
	const occurredAt = input.occurredAt ?? null;
	const recordedAt = input.recordedAt ?? occurredAt ?? '2026-05-01 00:00:00';
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activities (
       lead_id, activity_type, status, call_outcome, reply_confirmed,
       scheduled_for, occurred_at, completed_at, created_by, recorded_at,
       created_at, updated_at, isDelete, legacy_type, source_activity_id, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		[
			input.leadId,
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
			input.isDeleted ? 1 : 0,
			input.legacyType ?? null,
			input.sourceActivityId ?? null,
		]
	);
	return result.insertId;
}

async function activitySnapshot(
	context: ScenarioContext,
	leadIds: number[]
): Promise<unknown> {
	const placeholders = leadIds.map(() => '?').join(', ');
	return context.reader.fixtureRows(
		`SELECT id, lead_id, activity_type, status, call_outcome, reply_confirmed,
            occurred_at, completed_at, recorded_at, created_by, isDelete,
            source_activity_id, legacy_type, version
     FROM lead_activities
     WHERE lead_id IN (${placeholders})
     ORDER BY id ASC`,
		leadIds
	);
}

export async function leadAuditWorkScenario(
	context: ScenarioContext
): Promise<void> {
	const today = await context.reader.databaseToday();
	assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'the database calendar day');

	// ── A recorded author who has since become inactive ────────────────────
	const inactiveUsername = `${context.runTag}-${PREFIX}-inactive`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-');
	const inactiveUserId = (
		await context.reader.fixtureWrite(
			`INSERT INTO users (username, password_hash, email, full_name, status, is_active, isDelete, permissions, field_permissions, is_super_admin)
       VALUES (?, ?, ?, ?, 'active', 0, 0, '[]', NULL, 0)`,
			[
				inactiveUsername,
				await hashFixturePassword('report-work-inactive'),
				`${inactiveUsername}@example.com`,
				`${context.runTag} ${PREFIX} Inactive`,
			]
		)
	).insertId;

	// A soft-deleted account keeps is_active = 1; only isDelete marks it gone.
	// Its recorded work must still be attributed and labelled inactive.
	const deletedUsername = `${context.runTag}-${PREFIX}-deleted`
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-');
	const deletedAuthorId = (
		await context.reader.fixtureWrite(
			`INSERT INTO users (username, password_hash, email, full_name, status, is_active, isDelete, permissions, field_permissions, is_super_admin)
       VALUES (?, ?, ?, ?, 'active', 1, 1, '[]', NULL, 0)`,
			[
				deletedUsername,
				await hashFixturePassword('report-work-deleted'),
				`${deletedUsername}@example.com`,
				`${context.runTag} ${PREFIX} Deleted Author`,
			]
		)
	).insertId;

	// ── Known fixture evidence (occurrence times are the work dates) ───────
	const a = await seedLead(context, 'A Older Lead', {
		recordedAt: '2026-03-01 09:00:00',
		stage: 'Nurture',
		ownerUserId: context.assignee.id,
	});
	const aNoAnswer = await seedActivity(context, {
		leadId: a.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-01 00:00:00',
		callOutcome: 'No Answer',
		createdBy: context.creator.id,
	});
	const aConnected = await seedActivity(context, {
		leadId: a.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-31 23:59:59',
		callOutcome: 'Connected',
		createdBy: context.creator.id,
	});
	await seedActivity(context, {
		leadId: a.id,
		activityType: 'Email',
		status: 'Completed',
		occurredAt: '2026-05-04 10:00:00',
		replyConfirmed: 1,
		createdBy: context.creator.id,
	});
	await seedActivity(context, {
		leadId: a.id,
		activityType: 'Email',
		status: 'Completed',
		occurredAt: '2026-05-05 10:00:00',
		replyConfirmed: null,
		createdBy: context.creator.id,
	});

	const b = await seedLead(context, 'B Notes Only', {
		recordedAt: '2026-04-15 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: b.id,
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-05-06 11:00:00',
		createdBy: null,
	});
	await seedActivity(context, {
		leadId: b.id,
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-05-06 12:00:00',
		createdBy: context.assignee.id,
	});

	const c = await seedLead(context, 'C Repeated Outreach', {
		recordedAt: '2026-05-12 09:00:00',
		stage: 'Attempting Contact',
		ownerUserId: context.assignee.id,
	});
	for (const [index, callOutcome] of [
		'Busy',
		'No Answer',
		'Wrong Number',
	].entries()) {
		await seedActivity(context, {
			leadId: c.id,
			activityType: 'Call',
			status: 'Completed',
			occurredAt: `2026-05-0${7 + index} 09:00:00`,
			callOutcome,
			createdBy: context.creator.id,
		});
	}

	const d = await seedLead(context, 'D Meeting', {
		recordedAt: '2026-05-13 09:00:00',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
	});
	await seedActivity(context, {
		leadId: d.id,
		activityType: 'Meeting',
		status: 'Completed',
		occurredAt: '2026-05-14 09:00:00',
		createdBy: context.creator.id,
	});

	const n = await seedLead(context, 'N Unknown Outcome', {
		recordedAt: '2026-05-11 09:00:00',
		stage: 'Attempting Contact',
	});
	await seedActivity(context, {
		leadId: n.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-11 10:00:00',
		callOutcome: null,
		createdBy: context.creator.id,
	});
	await seedActivity(context, {
		leadId: n.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-11 11:00:00',
		callOutcome: 'Answered',
		createdBy: context.creator.id,
	});

	const e = await seedLead(context, 'E Undated', {
		recordedAt: '2026-05-15 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: e.id,
		activityType: 'Note',
		status: 'Completed',
		occurredAt: null,
		recordedAt: '2026-05-16 09:00:00',
		createdBy: context.creator.id,
	});

	const f = await seedLead(context, 'F Unknown Type', {
		recordedAt: '2026-05-17 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: f.id,
		activityType: null,
		status: 'Completed',
		occurredAt: '2026-05-18 09:00:00',
		legacyType: 'Follow Up',
		createdBy: context.creator.id,
	});

	const g = await seedLead(context, 'G Not Completed', {
		recordedAt: '2026-05-19 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: g.id,
		activityType: 'Call',
		status: 'Cancelled',
		occurredAt: '2026-05-20 09:00:00',
		createdBy: context.creator.id,
	});
	await seedActivity(context, {
		leadId: g.id,
		activityType: 'Call',
		status: 'Scheduled',
		scheduledFor: '2026-05-21',
		createdBy: context.creator.id,
	});

	const h = await seedLead(context, 'H Deleted Activity', {
		recordedAt: '2026-05-22 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: h.id,
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-05-23 09:00:00',
		createdBy: context.creator.id,
		isDeleted: true,
	});

	const i = await seedLead(context, 'I Deleted Lead', {
		recordedAt: '2026-05-24 09:00:00',
		stage: 'New',
		isDeleted: true,
	});
	await seedActivity(context, {
		leadId: i.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-25 09:00:00',
		callOutcome: 'Connected',
		createdBy: context.creator.id,
	});

	const j = await seedLead(context, 'J Inactive Author', {
		recordedAt: '2026-05-26 09:00:00',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
	});
	await seedActivity(context, {
		leadId: j.id,
		activityType: 'Email',
		status: 'Completed',
		occurredAt: '2026-05-27 09:00:00',
		replyConfirmed: 0,
		createdBy: inactiveUserId,
	});
	await seedActivity(context, {
		leadId: j.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-28 09:00:00',
		callOutcome: 'Connected',
		createdBy: inactiveUserId,
	});
	await seedActivity(context, {
		leadId: j.id,
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-05-29 09:00:00',
		createdBy: deletedAuthorId,
	});

	const k = await seedLead(context, 'K Boundary Occurrence', {
		recordedAt: '2026-05-29 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: k.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-04-30 23:59:59',
		callOutcome: 'Connected',
		recordedAt: '2026-05-30 09:00:00',
		createdBy: context.creator.id,
	});
	await seedActivity(context, {
		leadId: k.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-06-01 00:00:00',
		callOutcome: 'Connected',
		recordedAt: '2026-05-30 10:00:00',
		createdBy: context.creator.id,
	});

	const l = await seedLead(context, 'L Transfer Copy', {
		recordedAt: '2026-05-30 09:00:00',
		stage: 'New',
	});
	await seedActivity(context, {
		leadId: l.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-31 09:00:00',
		callOutcome: 'Connected',
		createdBy: context.creator.id,
		sourceActivityId: aConnected,
	});

	const m = await seedLead(context, 'M Corrected', {
		recordedAt: '2026-04-20 09:00:00',
		stage: 'Nurture',
		ownerUserId: context.creator.id,
	});

	const search = `${context.runTag} ${PREFIX}`;
	const token = context.reportReader.sessionToken;
	const fixtures = [a, b, c, d, e, f, g, h, i, j, k, l, m, n].map(
		(fixture) => fixture.id
	);
	const beforeReads = await activitySnapshot(context, fixtures);

	// ── Authorization ───────────────────────────────────────────────────────
	const evidencePath = `/api/reports/lead-audit/work/evidence${query({
		from_date: PERIOD_FROM,
		to_date: PERIOD_TO,
		search,
	})}`;
	await expectRefused(context, evidencePath, undefined, 401);
	await expectRefused(
		context,
		evidencePath,
		context.reportOnly.sessionToken,
		403
	);
	await expectRefused(
		context,
		evidencePath,
		context.projectReportOnly.sessionToken,
		403
	);
	await expectRefused(
		context,
		`/api/reports/lead-audit${query({ search })}`,
		context.reportOnly.sessionToken,
		403
	);
	assert.equal(
		(await context.http.get(evidencePath, context.reportReader.sessionToken))
			.status,
		200
	);
	assert.equal(
		(await context.http.get(evidencePath, context.superAdmin.sessionToken))
			.status,
		200
	);

	// ── Period work, authorship, and coverage ──────────────────────────────
	const may = await readReport(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	const work = may.work;
	assert.match(work.work_date_basis, /occurrence/i);
	assert.equal(work.scope.from_date, PERIOD_FROM);
	assert.equal(work.scope.to_date, PERIOD_TO);
	assert.equal(work.scope.effective_filters.search, search);

	assert.equal(
		may.summary.leads_recorded,
		10,
		'the intake figure counts only Leads recorded in May'
	);
	assert.equal(
		Object.prototype.hasOwnProperty.call(may.scope.effective_filters, 'actor'),
		false,
		'an evidence filter never leaks into the intake scope'
	);

	assert.deepEqual(work.summary.by_type, {
		call: 8,
		email: 3,
		meeting: 1,
		note: 3,
		unknown: 1,
	});
	const byType = work.summary.by_type;
	assert.equal(
		byType.call + byType.email + byType.meeting + byType.note + byType.unknown,
		work.summary.completed_total,
		'the type breakdown sums to the completed total'
	);
	assert.equal(work.summary.completed_total, 16);
	assert.equal(work.summary.outreach_total, 12, 'notes are not outreach');
	assert.equal(work.summary.distinct_leads_worked, 7);
	assert.equal(
		work.summary.distinct_leads_with_outreach,
		5,
		'repeated attempts do not inflate distinct Leads'
	);
	assert.equal(
		work.summary.successful_contact,
		3,
		'connected calls and confirmed replies only'
	);
	assert.equal(work.summary.distinct_leads_with_successful_contact, 2);
	assert.equal(work.summary.calls_connected, 2);
	assert.equal(
		work.summary.calls_failed,
		4,
		'No Answer, Busy, and Wrong Number'
	);
	assert.equal(work.summary.calls_outcome_unknown, 2);
	assert.equal(work.summary.emails_confirmed_reply, 1);
	assert.equal(work.summary.emails_unconfirmed, 2);
	assert.equal(work.summary.corrected_activities, 0);
	assert.equal(
		work.summary.calls_connected +
			work.summary.calls_failed +
			work.summary.calls_outcome_unknown,
		work.summary.by_type.call,
		'every completed call is connected, failed, or unknown'
	);
	assert.equal(
		work.summary.emails_confirmed_reply + work.summary.emails_unconfirmed,
		work.summary.by_type.email,
		'every completed email is confirmed or unconfirmed'
	);

	assert.deepEqual(work.coverage, {
		unknown_occurrence_date: 1,
		unknown_activity_type: 1,
		unknown_author: 1,
		inactive_author: 3,
		missing_call_outcome: 1,
		unrecognized_call_outcome: 1,
		missing_email_reply_evidence: 1,
		cancelled_in_period: 1,
		deleted_activity_rows: 1,
	});

	const authorOf = (id: number | null) =>
		work.authors.find((row) => row.author.id === id);
	const unknownAuthor = work.authors.find((row) => row.author.is_unknown);
	assert.ok(unknownAuthor, 'the Unknown author group is preserved');
	const creatorAuthor = authorOf(context.creator.id);
	const assigneeAuthor = authorOf(context.assignee.id);
	const inactiveAuthor = authorOf(inactiveUserId);
	assert.ok(creatorAuthor && assigneeAuthor && inactiveAuthor);
	assert.equal(creatorAuthor.completed_total, 11);
	assert.equal(creatorAuthor.outreach_total, 10);
	assert.equal(creatorAuthor.successful_contact, 2);
	assert.equal(creatorAuthor.distinct_leads, 5);
	assert.equal(unknownAuthor.completed_total, 1);
	assert.equal(unknownAuthor.by_type.note, 1);
	assert.equal(assigneeAuthor.completed_total, 1);
	assert.equal(inactiveAuthor.completed_total, 2);
	assert.equal(inactiveAuthor.successful_contact, 1);
	assert.equal(inactiveAuthor.author.is_inactive, true);
	assert.equal(inactiveAuthor.author.is_unknown, false);
	const deletedAuthor = authorOf(deletedAuthorId);
	assert.ok(deletedAuthor, 'a soft-deleted author keeps its work');
	assert.equal(deletedAuthor.author.is_inactive, true);
	assert.equal(deletedAuthor.completed_total, 1);
	assert.equal(deletedAuthor.by_type.note, 1);
	assert.equal(deletedAuthor.outreach_total, 0);
	assert.equal(
		work.authors.reduce((sum, row) => sum + row.completed_total, 0),
		16,
		'author groups reconcile with the completed total'
	);
	const optionForInactive = work.filter_options.actors.find(
		(option) => option.id === inactiveUserId
	);
	assert.ok(optionForInactive, 'an inactive author stays selectable');
	assert.equal(optionForInactive.is_active, false);
	const optionForDeleted = work.filter_options.actors.find(
		(option) => option.id === deletedAuthorId
	);
	assert.ok(optionForDeleted, 'a soft-deleted author stays selectable');
	assert.equal(optionForDeleted.is_active, false);
	assert.ok(
		work.filter_options.outcomes.some(
			(option) => option.value === 'email_replied'
		)
	);
	assert.ok(
		work.filter_options.activity_types.some(
			(option) => option.value === 'unknown'
		)
	);

	assert.equal(appliedFilter(work, 'actor').state, 'all');
	assert.equal(appliedFilter(work, 'activity_type').state, 'all');
	assert.equal(appliedFilter(work, 'outcome').state, 'all');
	assert.equal(
		appliedFilter(work, 'event_type').state,
		'ignored',
		'event type is explicitly ignored by work'
	);
	assert.ok(appliedFilter(work, 'event_type').reason.length > 0);
	assert.ok(
		work.disclosures.some((entry) => entry.code === 'authorship'),
		'authorship limits are disclosed'
	);
	assert.ok(
		work.disclosures.some((entry) => entry.code === 'undated_work'),
		'excluded undated work is disclosed'
	);

	// ── Occurrence time, not recording time ────────────────────────────────
	const april = await readReport(
		context,
		{ from_date: '2026-04-01', to_date: '2026-04-30', search },
		token
	);
	assert.equal(
		april.work.summary.completed_total,
		1,
		'the activity recorded in May but occurring in April stays in April'
	);
	assert.equal(april.work.summary.calls_connected, 1);
	const aprilEvidence = await readWorkEvidence(
		context,
		{
			from_date: '2026-04-01',
			to_date: '2026-04-30',
			search,
			metric: 'call',
			limit: 100,
		},
		token
	);
	assert.equal(aprilEvidence.pagination.total, 1);
	assert.equal(aprilEvidence.activities[0]?.lead.id, k.id);
	assert.equal(aprilEvidence.activities[0]?.occurred_at, '2026-04-30 23:59:59');

	const june = await readReport(
		context,
		{ from_date: '2026-06-01', to_date: '2026-06-30', search },
		token
	);
	assert.equal(
		june.work.summary.completed_total,
		1,
		'the exclusive next-day bound keeps 2026-06-01 in June'
	);

	// ── Evidence filters narrow work, never intake ─────────────────────────
	const actorFiltered = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: context.creator.id,
		},
		token
	);
	assert.equal(actorFiltered.work.summary.completed_total, 11);
	assert.equal(actorFiltered.work.summary.outreach_total, 10);
	assert.equal(actorFiltered.work.summary.by_type.note, 0);
	assert.equal(actorFiltered.work.summary.distinct_leads_worked, 5);
	assert.equal(
		actorFiltered.work.work_filters.effective.actor.value,
		String(context.creator.id)
	);
	assert.equal(appliedFilter(actorFiltered.work, 'actor').state, 'effective');
	assert.deepEqual(
		actorFiltered.summary,
		may.summary,
		'an actor filter does not change the intake population'
	);
	assert.deepEqual(
		actorFiltered.trends,
		may.trends,
		'an actor filter does not change the intake trend'
	);

	const unknownActor = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: 'unknown',
		},
		token
	);
	assert.equal(unknownActor.work.summary.completed_total, 1);
	assert.equal(unknownActor.work.summary.outreach_total, 0);
	assert.equal(unknownActor.work.coverage.unknown_author, 1);
	assert.equal(unknownActor.work.work_filters.effective.actor.is_unknown, true);

	const inactiveFiltered = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: inactiveUserId,
		},
		token
	);
	assert.equal(inactiveFiltered.work.summary.completed_total, 2);
	assert.equal(inactiveFiltered.work.summary.successful_contact, 1);

	const notesOnly = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			activity_type: 'Note',
		},
		token
	);
	assert.equal(notesOnly.work.summary.completed_total, 3);
	assert.equal(notesOnly.work.summary.outreach_total, 0);

	const unknownType = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			activity_type: 'unknown',
		},
		token
	);
	assert.equal(unknownType.work.summary.completed_total, 1);
	assert.equal(unknownType.work.summary.by_type.unknown, 1);

	const connected = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			outcome: 'Connected',
		},
		token
	);
	assert.equal(connected.work.summary.completed_total, 2);
	assert.equal(connected.work.summary.successful_contact, 2);
	assert.equal(appliedFilter(connected.work, 'outcome').display, 'Connected');

	const noAnswer = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			outcome: 'No Answer',
		},
		token
	);
	assert.equal(noAnswer.work.summary.completed_total, 2);
	assert.equal(noAnswer.work.summary.successful_contact, 0);

	const replied = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			outcome: 'email_replied',
		},
		token
	);
	assert.equal(replied.work.summary.completed_total, 1);
	assert.equal(replied.work.summary.successful_contact, 1);

	const sent = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			outcome: 'email_sent',
		},
		token
	);
	assert.equal(sent.work.summary.completed_total, 2);
	assert.equal(sent.work.summary.successful_contact, 0);

	const unknownOutcome = await readReport(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search, outcome: 'unknown' },
		token
	);
	assert.equal(unknownOutcome.work.summary.completed_total, 2);

	const eventIgnored = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			event_type: 'correction',
		},
		token
	);
	assert.equal(
		eventIgnored.work.summary.completed_total,
		may.work.summary.completed_total,
		'the ignored event filter changes no work figure'
	);
	assert.equal(appliedFilter(eventIgnored.work, 'event_type').state, 'ignored');

	const undatedIgnored = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			undated: '1',
		},
		token
	);
	assert.equal(
		undatedIgnored.work.summary.completed_total,
		may.work.summary.completed_total,
		'the audit undated toggle changes no work figure'
	);
	assert.equal(
		appliedFilter(undatedIgnored.work, 'undated').state,
		'ignored',
		'the undated toggle is listed as ignored in the work scope'
	);
	assert.equal(
		appliedFilter(undatedIgnored.work, 'undated').value,
		'1',
		'the ignored toggle still reports the applied value'
	);

	const combined = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			actor: context.creator.id,
			activity_type: 'Call',
		},
		token
	);
	assert.equal(combined.work.summary.completed_total, 7);

	const invalidFilterCases: Array<[Record<string, string>, string]> = [
		[{ actor: 'someone' }, 'invalid_actor'],
		[{ activity_type: 'Message' }, 'invalid_activity_type'],
		[{ outcome: 'Answered' }, 'invalid_outcome'],
		[{ event_type: 'telepathy' }, 'invalid_event_type'],
	];
	for (const [values, code] of invalidFilterCases) {
		const refused = await context.http.get(
			`/api/reports/lead-audit/work/evidence${query({
				from_date: PERIOD_FROM,
				to_date: PERIOD_TO,
				search,
				...values,
			})}`,
			token
		);
		assert.equal(refused.status, 422, `${code} is a refusal`);
		assert.equal(ErrorEnvelopeSchema.parse(refused.json()).code, code);
	}
	const invalidMetric = await context.http.get(
		`/api/reports/lead-audit/work/evidence${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'everything',
		})}`,
		token
	);
	assert.equal(invalidMetric.status, 422);
	assert.equal(
		ErrorEnvelopeSchema.parse(invalidMetric.json()).code,
		'invalid_work_metric'
	);

	// ── Paginated evidence retains filters and reconciles ──────────────────
	const baseEvidence = {
		from_date: PERIOD_FROM,
		to_date: PERIOD_TO,
		search,
	};
	const firstPage = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'completed', page: 1, limit: 5 },
		token
	);
	assert.equal(firstPage.pagination.total, 16);
	assert.equal(firstPage.pagination.limit, 5);
	assert.equal(firstPage.pagination.total_pages, 4);
	assert.equal(firstPage.activities.length, 5);
	const collected: number[] = [];
	for (let page = 1; page <= 4; page += 1) {
		const evidence = await readWorkEvidence(
			context,
			{ ...baseEvidence, metric: 'completed', page, limit: 5 },
			token
		);
		collected.push(...evidence.activities.map((row) => row.id));
	}
	assert.equal(collected.length, 16, 'every page is reachable');
	assert.equal(new Set(collected).size, 16, 'no activity appears twice');
	for (let index = 1; index < firstPage.activities.length; index += 1) {
		const previous = firstPage.activities[index - 1];
		const current = firstPage.activities[index];
		assert.ok(previous && current);
		assert.ok(
			(previous.occurred_at ?? '') >= (current.occurred_at ?? ''),
			'evidence is ordered by occurrence time, newest first'
		);
	}

	const metricTotals: Array<[string, number]> = [
		['outreach', 12],
		['successful_contact', 3],
		['call', 8],
		['email', 3],
		['meeting', 1],
		['note', 3],
		['unknown_type', 1],
		['undated', 1],
		['cancelled', 1],
	];
	for (const [metric, total] of metricTotals) {
		const evidence = await readWorkEvidence(
			context,
			{ ...baseEvidence, metric, limit: 100 },
			token
		);
		assert.equal(evidence.pagination.total, total, `metric ${metric} total`);
		assert.equal(evidence.activities.length, total, `metric ${metric} rows`);
	}

	const undated = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'undated' },
		token
	);
	assert.equal(undated.activities[0]?.occurred_at, null);
	assert.equal(undated.activities[0]?.lead.id, e.id);

	const cancelled = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'cancelled' },
		token
	);
	assert.equal(cancelled.activities[0]?.status, 'Cancelled');
	assert.equal(cancelled.activities[0]?.lead.id, g.id);

	const unknownTypeEvidence = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'unknown_type' },
		token
	);
	assert.equal(unknownTypeEvidence.activities[0]?.lead.id, f.id);
	assert.equal(
		unknownTypeEvidence.activities[0]?.activity_type.is_unknown,
		true
	);

	const meetingEvidence = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'meeting' },
		token
	);
	assert.equal(meetingEvidence.activities[0]?.lead.id, d.id);
	assert.equal(
		meetingEvidence.activities[0]?.is_outreach,
		true,
		'a meeting is outreach'
	);
	assert.equal(
		meetingEvidence.activities[0]?.is_successful_contact,
		false,
		'a meeting alone is not successful contact'
	);

	const callsEvidence = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'call', limit: 100 },
		token
	);
	assert.equal(
		callsEvidence.activities.filter((row) => row.lead.id === a.id).length,
		2,
		'work on a Lead recorded before the period is still period work'
	);
	assert.ok(
		callsEvidence.activities.some(
			(row) => row.id === aNoAnswer && row.occurred_at === '2026-05-01 00:00:00'
		),
		'the inclusive start day includes midnight'
	);
	assert.ok(
		!callsEvidence.activities.some((row) => row.lead.id === l.id),
		'a transferred copy is not another completed activity'
	);
	assert.ok(
		!callsEvidence.activities.some((row) => row.lead.id === k.id),
		'an activity occurring outside the period stays outside it'
	);

	const notesEvidence = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'note', limit: 100 },
		token
	);
	assert.equal(
		notesEvidence.activities.filter((row) => row.lead.id === b.id).length,
		2,
		'a notes-only Lead keeps both notes'
	);
	assert.ok(
		notesEvidence.activities.every((row) => row.is_outreach === false),
		'notes are never outreach'
	);

	const afterBaselineReads = await activitySnapshot(context, fixtures);
	assert.deepEqual(
		afterBaselineReads,
		beforeReads,
		'report reads mutate no source row'
	);

	const filteredEvidence = await readWorkEvidence(
		context,
		{
			...baseEvidence,
			metric: 'completed',
			actor: 'unknown',
			limit: 100,
		},
		token
	);
	assert.equal(filteredEvidence.pagination.total, 1);
	assert.equal(filteredEvidence.activities[0]?.author.is_unknown, true);
	assert.equal(filteredEvidence.activities[0]?.is_outreach, false);

	const inactiveEvidence = await readWorkEvidence(
		context,
		{
			...baseEvidence,
			metric: 'completed',
			actor: inactiveUserId,
			limit: 100,
		},
		token
	);
	assert.equal(inactiveEvidence.pagination.total, 2);
	assert.ok(
		inactiveEvidence.activities.every(
			(row) =>
				row.author.id === inactiveUserId &&
				row.author.is_inactive === true &&
				row.lead.id === j.id
		)
	);
	assert.equal(
		inactiveEvidence.activities.filter((row) => row.is_successful_contact)
			.length,
		1
	);
	assert.equal(
		inactiveEvidence.activities.find(
			(row) => row.activity_type.value === 'Email'
		)?.reply_confirmed,
		false
	);

	// ── A correction changes current facts without adding an activity ──────
	const correctedActivity = await seedActivity(context, {
		leadId: m.id,
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-10 09:00:00',
		callOutcome: 'No Answer',
		createdBy: context.creator.id,
	});
	const beforeCorrection = await readReport(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	assert.equal(beforeCorrection.work.summary.completed_total, 17);
	assert.equal(beforeCorrection.work.summary.calls_failed, 5);
	assert.equal(beforeCorrection.work.summary.successful_contact, 3);

	const correction = await context.http.post(
		`/api/leads/${m.id}/activities/${correctedActivity}/corrections`,
		{
			version: 1,
			reason: 'The client did connect; the call outcome was recorded wrongly.',
			call_outcome: 'Connected',
		},
		context.creator.sessionToken
	);
	assert.equal(
		correction.status,
		200,
		`correction status (body: ${correction.text})`
	);
	const correctionBody = z
		.object({
			success: z.literal(true),
			data: z.object({ version: z.number() }).passthrough(),
		})
		.passthrough()
		.parse(correction.json());
	assert.equal(correctionBody.data.version, 2);
	const afterCorrectionWrite = await activitySnapshot(context, fixtures);

	const afterCorrection = await readReport(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	assert.equal(
		afterCorrection.work.summary.completed_total,
		17,
		'a correction never adds another completed activity'
	);
	assert.equal(afterCorrection.work.summary.calls_failed, 4);
	assert.equal(afterCorrection.work.summary.calls_connected, 3);
	assert.equal(afterCorrection.work.summary.successful_contact, 4);
	assert.equal(afterCorrection.work.summary.corrected_activities, 1);
	assert.equal(
		afterCorrection.work.authors.find(
			(row) => row.author.id === context.creator.id
		)?.successful_contact,
		3,
		'the correction credits the recorded author, once'
	);
	const correctedEvidence = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'completed', limit: 100 },
		token
	);
	const correctedRow = correctedEvidence.activities.find(
		(row) => row.id === correctedActivity
	);
	assert.ok(correctedRow);
	assert.equal(correctedRow.call_outcome, 'Connected');
	assert.equal(correctedRow.corrected, true);
	assert.equal(correctedRow.is_successful_contact, true);
	assert.deepEqual(
		await activitySnapshot(context, fixtures),
		afterCorrectionWrite,
		'reading the correction changes no stored activity'
	);

	// ── Reassignment does not reattribute authorship ───────────────────────
	await context.reader.fixtureWrite(
		'UPDATE leads SET owner_user_id = ?, updated_at = NOW() WHERE id = ?',
		[context.assignee.id, c.id]
	);
	const afterReassignmentWrite = await activitySnapshot(context, fixtures);
	const reassigned = await readReport(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	const reassignedAuthor = reassigned.work.authors.find(
		(row) => row.author.id === context.creator.id
	);
	assert.equal(reassignedAuthor?.completed_total, 12);
	assert.equal(
		reassigned.work.authors.find((row) => row.author.id === context.assignee.id)
			?.completed_total,
		1,
		'the new owner receives no credit for work recorded by someone else'
	);
	const reassignedEvidence = await readWorkEvidence(
		context,
		{ ...baseEvidence, metric: 'call', actor: context.creator.id, limit: 100 },
		token
	);
	const movedRows = reassignedEvidence.activities.filter(
		(row) => row.lead.id === c.id
	);
	assert.equal(movedRows.length, 3);
	assert.ok(
		movedRows.every(
			(row) =>
				row.author.id === context.creator.id &&
				row.lead.current_owner?.id === context.assignee.id
		),
		'the evidence keeps the author and shows the current owner separately'
	);

	// ── The report is a read: source evidence is unchanged ─────────────────
	assert.deepEqual(
		await activitySnapshot(context, fixtures),
		afterReassignmentWrite,
		'report reads mutate no source row'
	);
	assert.equal((await context.reader.leadRow(i.id))?.isDelete, 1);
	assert.equal((await context.reader.leadRow(h.id))?.isDelete ?? 0, 0);
	assert.equal(
		(await context.reader.leadRow(c.id))?.owner_user_id,
		context.assignee.id
	);
}
