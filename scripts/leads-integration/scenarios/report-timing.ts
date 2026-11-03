import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

// The Lead Audit timing slice (#403). Time to first outreach is proved
// through the authenticated HTTP reads only: fixture Leads and activities go
// into the disposable database with explicit record and occurrence times, and
// every expected duration, median, and percentile is calculated here from
// those known values, never from the report's own aggregates.

const FilterScopeSchema = z
	.object({
		applied: z.array(z.object({ key: z.string(), label: z.string() })),
		ignored: z.array(
			z
				.object({
					filter: z.string(),
					label: z.string(),
					value: z.string(),
					reason: z.string(),
				})
				.passthrough()
		),
	})
	.passthrough();

const TimingSectionSchema = z
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
		metric: z
			.object({
				key: z.literal('time_to_first_outreach'),
				label: z.literal('Time to first outreach'),
				definition: z.string(),
				clock: z.string(),
				observation: z.string(),
				unit: z.literal('seconds'),
			})
			.passthrough(),
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
		filter_scope: FilterScopeSchema,
		disclosures: z.array(
			z.object({ code: z.string(), text: z.string() }).passthrough()
		),
	})
	.passthrough();

const TimingEvidenceSchema = z
	.object({
		scope: z.object({ from_date: z.string(), to_date: z.string() }).passthrough(),
		meta: z.object({ generated_at: z.string() }).passthrough(),
		metric: z.object({
			key: z.string(),
			label: z.string(),
			definition: z.string(),
		}),
		rows: z.array(
			z
				.object({
					lead_id: z.number(),
					lead_reference: z.string().nullable(),
					company_name: z.string(),
					contact_name: z.string().nullable(),
					recorded_at: z.string(),
					status: z.enum([
						'sampled',
						'no_outreach',
						'missing_timestamp',
						'incomplete_earlier',
						'negative',
					]),
					duration_seconds: z.number().nullable(),
					first_outreach_at: z.string().nullable(),
					first_outreach_type: z.string().nullable(),
					first_outreach_id: z.number().nullable(),
					completed_outreach_count: z.number(),
					unknown_occurrence_count: z.number(),
					exclusion_reason: z.string().nullable(),
				})
				.passthrough()
		),
		pagination: z.object({
			page: z.number(),
			limit: z.number(),
			total: z.number(),
			total_pages: z.number(),
		}),
		filter_scope: FilterScopeSchema,
		disclosures: z.array(
			z.object({ code: z.string(), text: z.string() }).passthrough()
		),
	})
	.passthrough();

type TimingSection = z.infer<typeof TimingSectionSchema>;
type TimingEvidence = z.infer<typeof TimingEvidenceSchema>;

const ErrorEnvelopeSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
		code: z.string().optional(),
	})
	.passthrough();

const PREFIX = 'ReportTiming';
const ODD = { from: '2026-03-01', to: '2026-03-31' };
const EVEN = { from: '2026-04-01', to: '2026-04-30' };
const ONE = { from: '2026-05-01', to: '2026-05-31' };
const EMPTY = { from: '2026-06-01', to: '2026-06-30' };
const MIXED = { from: '2026-07-01', to: '2026-07-31' };
const BOUNDARY = { from: '2026-09-01', to: '2026-09-30' };

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

async function readTiming(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<TimingSection> {
	const response = await context.http.get(
		`/api/reports/lead-audit/timing${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`timing status (body: ${response.text})`
	);
	return TimingSectionSchema.parse(response.json());
}

async function readEvidence(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<TimingEvidence> {
	const response = await context.http.get(
		`/api/reports/lead-audit/timing/evidence${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`timing evidence status (body: ${response.text})`
	);
	return TimingEvidenceSchema.parse(response.json());
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

function disclosureCodes(section: TimingSection): string[] {
	return section.disclosures.map((entry) => entry.code);
}

function withPrefix(context: ScenarioContext, suffix: string): string {
	return `${context.runTag} ${PREFIX} ${suffix}`;
}

interface Seeded {
	id: number;
	company: string;
}

interface LeadInput {
	recordedAt: string;
	enquiryDate?: string | null;
	source?: string | null;
	stage?: string | null;
	priority?: 'Low' | 'Medium' | 'High' | null;
	ownerUserId?: number | null;
	isDeleted?: boolean;
}

async function seedLead(
	context: ScenarioContext,
	suffix: string,
	input: LeadInput
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

interface ActivityInput {
	activityType: string | null;
	status: 'Completed' | 'Scheduled' | 'Cancelled';
	occurredAt?: string | null;
	scheduledFor?: string | null;
	isDeleted?: boolean;
	notes?: string | null;
}

async function seedActivity(
	context: ScenarioContext,
	leadId: number,
	input: ActivityInput
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activities (
       lead_id, activity_type, status, scheduled_for, occurred_at,
       completed_at, notes, created_by, isDelete
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
		[
			leadId,
			input.activityType,
			input.status,
			input.scheduledFor ?? null,
			input.occurredAt ?? null,
			input.status === 'Completed' ? (input.occurredAt ?? null) : null,
			input.notes ?? null,
			input.isDeleted ? 1 : 0,
		]
	);
	return result.insertId;
}

function hours(value: number): number {
	return value * 3600;
}

function durationByLead(evidence: TimingEvidence): Map<number, number | null> {
	return new Map(
		evidence.rows.map((row) => [row.lead_id, row.duration_seconds])
	);
}

export async function leadAuditTimingScenario(
	context: ScenarioContext
): Promise<void> {
	const token = context.reportReader.sessionToken;
	const search = `${context.runTag} ${PREFIX}`;

	// ── Odd sample: five valid durations and one untouched Lead ─────────────
	const odd1 = await seedLead(context, 'Odd 1 Boundary Start', {
		recordedAt: '2026-03-01 00:00:00',
		source: 'Timing Web',
		stage: 'Connected',
		priority: 'High',
		ownerUserId: context.assignee.id,
	});
	await seedActivity(context, odd1.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-03-01 01:00:00',
	});
	const odd2 = await seedLead(context, 'Odd 2', {
		recordedAt: '2026-03-10 09:00:00',
		source: 'Timing Web',
	});
	await seedActivity(context, odd2.id, {
		activityType: 'Email',
		status: 'Completed',
		occurredAt: '2026-03-10 11:00:00',
	});
	const odd3 = await seedLead(context, 'Odd 3', {
		recordedAt: '2026-03-15 12:00:00',
		source: 'Timing Referral',
	});
	await seedActivity(context, odd3.id, {
		activityType: 'Meeting',
		status: 'Completed',
		occurredAt: '2026-03-15 15:00:00',
	});
	const odd4 = await seedLead(context, 'Odd 4', {
		recordedAt: '2026-03-20 08:00:00',
		source: 'Timing Referral',
	});
	await seedActivity(context, odd4.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-03-20 12:00:00',
	});
	const odd5 = await seedLead(context, 'Odd 5 Boundary End', {
		recordedAt: '2026-03-31 23:59:59',
		source: 'Timing Event',
	});
	await seedActivity(context, odd5.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-04-01 04:59:59',
	});
	const oddNote = await seedLead(context, 'Odd 6 Note Only', {
		recordedAt: '2026-03-05 09:00:00',
		source: 'Timing Web',
	});
	await seedActivity(context, oddNote.id, {
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-03-05 10:00:00',
	});

	// A Lead recorded before the period is never part of the March cohort,
	// even though its work is close to the period boundary.
	const before = await seedLead(context, 'Before Period', {
		recordedAt: '2026-02-28 23:59:59',
	});
	await seedActivity(context, before.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-03-01 00:30:00',
	});

	// ── Even sample ─────────────────────────────────────────────────────────
	const even1 = await seedLead(context, 'Even 1', {
		recordedAt: '2026-04-02 09:00:00',
	});
	await seedActivity(context, even1.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-04-02 11:00:00',
	});
	const even2 = await seedLead(context, 'Even 2', {
		recordedAt: '2026-04-03 09:00:00',
	});
	await seedActivity(context, even2.id, {
		activityType: 'Email',
		status: 'Completed',
		occurredAt: '2026-04-03 13:00:00',
	});
	const even3 = await seedLead(context, 'Even 3', {
		recordedAt: '2026-04-04 09:00:00',
	});
	await seedActivity(context, even3.id, {
		activityType: 'Meeting',
		status: 'Completed',
		occurredAt: '2026-04-04 15:00:00',
	});
	const even4 = await seedLead(context, 'Even 4', {
		recordedAt: '2026-04-05 09:00:00',
	});
	await seedActivity(context, even4.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-04-05 17:00:00',
	});

	// ── One-item sample ─────────────────────────────────────────────────────
	const single = await seedLead(context, 'Single Sample', {
		recordedAt: '2026-05-05 09:00:00',
	});
	await seedActivity(context, single.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-05-05 10:00:00',
	});

	// ── July: every exclusion path, one zero interval, and two-row evidence ─
	const sampled = await seedLead(context, 'Mixed 1 Sampled', {
		recordedAt: '2026-07-02 09:00:00',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
	});
	await seedActivity(context, sampled.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-02 11:00:00',
	});
	const unknownTime = await seedLead(context, 'Mixed 2 Unknown Time', {
		recordedAt: '2026-07-03 09:00:00',
		ownerUserId: context.assignee.id,
	});
	await seedActivity(context, unknownTime.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: null,
	});
	const prehistory = await seedLead(context, 'Mixed 3 Prehistory', {
		recordedAt: '2026-07-10 12:00:00',
	});
	await seedActivity(context, prehistory.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-01 09:00:00',
	});
	const incomplete = await seedLead(context, 'Mixed 4 Incomplete', {
		recordedAt: '2026-07-04 09:00:00',
	});
	await seedActivity(context, incomplete.id, {
		activityType: 'Email',
		status: 'Completed',
		occurredAt: null,
	});
	await seedActivity(context, incomplete.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-20 09:00:00',
	});
	const noteOnly = await seedLead(context, 'Mixed 5 Notes', {
		recordedAt: '2026-07-05 09:00:00',
	});
	await seedActivity(context, noteOnly.id, {
		activityType: 'Note',
		status: 'Completed',
		occurredAt: '2026-07-05 10:00:00',
	});
	const scheduled = await seedLead(context, 'Mixed 6 Scheduled', {
		recordedAt: '2026-07-06 09:00:00',
	});
	await seedActivity(context, scheduled.id, {
		activityType: 'Call',
		status: 'Scheduled',
		scheduledFor: '2026-07-07',
	});
	await seedActivity(context, scheduled.id, {
		activityType: 'Email',
		status: 'Cancelled',
	});
	const deletedActivity = await seedLead(context, 'Mixed 7 Deleted Activity', {
		recordedAt: '2026-07-07 09:00:00',
	});
	await seedActivity(context, deletedActivity.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-07 10:00:00',
		isDeleted: true,
	});
	const deletedLead = await seedLead(context, 'Mixed 8 Deleted Lead', {
		recordedAt: '2026-07-11 09:00:00',
		isDeleted: true,
	});
	await seedActivity(context, deletedLead.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-11 10:00:00',
	});
	const zero = await seedLead(context, 'Mixed 9 Zero', {
		recordedAt: '2026-07-01 00:00:00',
	});
	await seedActivity(context, zero.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-01 00:00:00',
	});
	const twoRows = await seedLead(context, 'Mixed 10 Two Outreach', {
		recordedAt: '2026-07-08 09:00:00',
	});
	await seedActivity(context, twoRows.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-07-08 10:00:00',
	});
	await seedActivity(context, twoRows.id, {
		activityType: 'Email',
		status: 'Completed',
		occurredAt: '2026-07-08 10:00:00',
	});

	// A corrected call: the real correction endpoint moves the occurrence
	// time of the one activity row and keeps its history.
	const corrected = await seedLead(context, 'Mixed 11 Corrected', {
		recordedAt: '2026-07-09 09:00:00',
		ownerUserId: context.assignee.id,
	});
	const logged = await context.http.post(
		`/api/leads/${corrected.id}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'No Answer',
			notes: 'The first record of this call.',
		},
		context.assignee.sessionToken
	);
	assert.equal(logged.status, 200, `logged call status (body: ${logged.text})`);
	const loggedActivityId = z
		.object({ data: z.object({ activity_id: z.number() }) })
		.parse(logged.json()).data.activity_id;
	const correctedResponse = await context.http.post(
		`/api/leads/${corrected.id}/activities/${loggedActivityId}/corrections`,
		{
			version: 1,
			reason: 'The occurrence time was recorded wrongly.',
			occurred_at: '2026-07-09T12:00:00',
		},
		context.assignee.sessionToken
	);
	assert.equal(
		correctedResponse.status,
		200,
		`correction status (body: ${correctedResponse.text})`
	);
	const correctedActivity = (await context.reader.activityRows(corrected.id)).find(
		(row) => row.id === loggedActivityId
	);
	assert.ok(correctedActivity, 'the corrected activity keeps one row');
	assert.equal(correctedActivity.version, 2, 'the correction moves the version');
	assert.equal(correctedActivity.occurred_at, '2026-07-09 12:00:00');
	const correctionCount = await context.reader.fixtureRows(
		'SELECT COUNT(*) AS total FROM lead_activity_corrections WHERE activity_id = ?',
		[loggedActivityId]
	);
	assert.equal(Number(correctionCount[0]?.total), 1);

	// ── Boundary cohort: both ends included, adjacent days excluded ─────────
	const boundaryStart = await seedLead(context, 'Boundary Start', {
		recordedAt: '2026-09-01 00:00:00',
	});
	await seedActivity(context, boundaryStart.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-09-01 01:00:00',
	});
	const boundaryEnd = await seedLead(context, 'Boundary End', {
		recordedAt: '2026-09-30 23:59:59',
	});
	await seedActivity(context, boundaryEnd.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-10-01 01:59:59',
	});
	const boundaryBefore = await seedLead(context, 'Boundary Before', {
		recordedAt: '2026-08-31 23:59:59',
	});
	await seedActivity(context, boundaryBefore.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-09-01 00:30:00',
	});
	const boundaryAfter = await seedLead(context, 'Boundary After', {
		recordedAt: '2026-10-01 00:00:00',
	});
	await seedActivity(context, boundaryAfter.id, {
		activityType: 'Call',
		status: 'Completed',
		occurredAt: '2026-10-01 01:00:00',
	});

	// Snapshot the fixture sources before any report read: every timing read
	// below must leave Leads, activities, and stored labels unchanged.
	const allIds = [
		odd1,
		odd2,
		odd3,
		odd4,
		odd5,
		oddNote,
		before,
		even1,
		even2,
		even3,
		even4,
		single,
		sampled,
		unknownTime,
		prehistory,
		incomplete,
		noteOnly,
		scheduled,
		deletedActivity,
		deletedLead,
		zero,
		twoRows,
		corrected,
		boundaryStart,
		boundaryEnd,
		boundaryBefore,
		boundaryAfter,
	].map((fixture) => fixture.id);
	const placeholders = allIds.map(() => '?').join(', ');
	const readLeads = () =>
		context.reader.fixtureRows(
			`SELECT id, company_name, lead_source, enquiry_status, priority,
              owner_user_id, created_at, updated_at, isDelete
         FROM leads WHERE id IN (${placeholders}) ORDER BY id ASC`,
			allIds
		);
	const readActivities = () =>
		context.reader.fixtureRows(
			`SELECT id, lead_id, activity_type, status, occurred_at, isDelete, version
         FROM lead_activities WHERE lead_id IN (${placeholders}) ORDER BY id ASC`,
			allIds
		);
	const readSources = () =>
		context.reader.fixtureRows(
			'SELECT id, lead_source FROM leads WHERE id = ? ORDER BY id ASC',
			[deletedLead.id]
		);
	const leadsBefore = await readLeads();
	const activitiesBefore = await readActivities();
	const sourcesBefore = await readSources();

	// ── The observation is measured from system entry, with coverage ────────
	const odd = await readTiming(
		context,
		{ from_date: ODD.from, to_date: ODD.to, search },
		token
	);
	assert.equal(odd.metric.label, 'Time to first outreach');
	assert.match(odd.metric.definition, /earliest evidenced completed/i);
	assert.match(odd.metric.clock, /created_at|system entry/i);
	assert.match(odd.metric.observation, /generation time|observation/i);
	assert.ok(odd.meta.generated_at.length > 0);
	assert.ok(odd.meta.time_zone.label.length > 0);
	assert.equal(odd.available, true);
	assert.equal(odd.cohort_leads, 6, 'the March cohort');
	assert.equal(odd.valid_samples, 5);
	assert.equal(odd.median_seconds, hours(3), 'odd median is the middle item');
	assert.equal(odd.p90_seconds, hours(5), 'nearest-rank 90th of five items');
	assert.equal(odd.without_outreach, 1, 'the note-only Lead stays unworked');
	assert.ok(
		Math.abs((odd.without_outreach_share ?? -1) - 1 / 6) < 1e-9,
		'the without-outreach share is beside the durations'
	);
	assert.equal(odd.exclusions.total, 0);
	assert.deepEqual(disclosureCodes(odd), [
		'timing_clock',
		'outreach_definition',
		'without_outreach',
		'scope_limits',
	]);

	const oddEvidence = await readEvidence(
		context,
		{ from_date: ODD.from, to_date: ODD.to, search, metric: 'sampled' },
		token
	);
	assert.equal(oddEvidence.pagination.total, 5);
	assert.deepEqual(
		oddEvidence.rows.map((row) => row.duration_seconds),
		[hours(1), hours(2), hours(3), hours(4), hours(5)],
		'evidence keeps the measured durations in cohort order'
	);
	assert.deepEqual(
		oddEvidence.rows.map((row) => row.status),
		['sampled', 'sampled', 'sampled', 'sampled', 'sampled']
	);

	const oddNoOutreach = await readEvidence(
		context,
		{ from_date: ODD.from, to_date: ODD.to, search, metric: 'no_outreach' },
		token
	);
	assert.equal(oddNoOutreach.pagination.total, 1);
	assert.equal(oddNoOutreach.rows[0]?.lead_id, oddNote.id);
	assert.equal(oddNoOutreach.rows[0]?.duration_seconds, null);
	assert.equal(oddNoOutreach.rows[0]?.completed_outreach_count, 0);

	// ── Even sample: the median averages the two middle observations ────────
	const even = await readTiming(
		context,
		{ from_date: EVEN.from, to_date: EVEN.to, search },
		token
	);
	assert.equal(even.cohort_leads, 4);
	assert.equal(even.valid_samples, 4);
	assert.equal(
		even.median_seconds,
		(hours(4) + hours(6)) / 2,
		'an even sample averages the two middle durations'
	);
	assert.equal(even.p90_seconds, hours(8), 'nearest-rank 90th of four items');
	assert.equal(even.without_outreach, 0);
	assert.equal(even.without_outreach_share, 0);

	// ── A one-item sample is its own median and 90th percentile ─────────────
	const one = await readTiming(
		context,
		{ from_date: ONE.from, to_date: ONE.to, search },
		token
	);
	assert.equal(one.cohort_leads, 1);
	assert.equal(one.valid_samples, 1);
	assert.equal(one.median_seconds, hours(1));
	assert.equal(one.p90_seconds, hours(1));

	// ── An empty cohort is unavailable, never a zero duration ───────────────
	const empty = await readTiming(
		context,
		{ from_date: EMPTY.from, to_date: EMPTY.to, search },
		token
	);
	assert.equal(empty.cohort_leads, 0);
	assert.equal(empty.available, false);
	assert.equal(empty.median_seconds, null);
	assert.equal(empty.p90_seconds, null);
	assert.equal(empty.valid_samples, 0);
	assert.equal(empty.without_outreach, 0);
	assert.equal(empty.without_outreach_share, null);
	assert.ok(disclosureCodes(empty).includes('empty_cohort'));
	const emptyEvidence = await readEvidence(
		context,
		{ from_date: EMPTY.from, to_date: EMPTY.to, search, metric: 'sampled' },
		token
	);
	assert.equal(emptyEvidence.rows.length, 0);
	assert.equal(emptyEvidence.pagination.total, 0);
	assert.equal(emptyEvidence.pagination.total_pages, 0);

	// ── Exclusions, zero, duplicate evidence, deleted rows, correction ──────
	const mixed = await readTiming(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search },
		token
	);
	assert.equal(mixed.cohort_leads, 10, 'the deleted Lead stays out of the cohort');
	assert.equal(mixed.valid_samples, 4);
	assert.equal(mixed.median_seconds, (hours(1) + hours(2)) / 2);
	assert.equal(mixed.p90_seconds, hours(3));
	assert.equal(mixed.without_outreach, 3, 'notes, scheduled, and deleted work');
	assert.equal(mixed.without_outreach_share, 0.3);
	assert.deepEqual(mixed.exclusions, {
		missing_timestamp: 1,
		incomplete_earlier: 1,
		negative: 1,
		total: 3,
	});
	assert.deepEqual(disclosureCodes(mixed), [
		'timing_clock',
		'outreach_definition',
		'without_outreach',
		'missing_timestamp',
		'incomplete_earlier',
		'negative_interval',
		'scope_limits',
	]);

	const mixedEvidence = await readEvidence(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search, metric: 'all' },
		token
	);
	const durations = durationByLead(mixedEvidence);
	assert.equal(mixedEvidence.pagination.total, 10);
	assert.equal(durations.get(sampled.id), hours(2));
	assert.equal(durations.get(unknownTime.id), null);
	assert.equal(durations.get(prehistory.id), -788400, 'the interval is negative, never clamped');
	assert.equal(durations.get(incomplete.id), 1382400);
	assert.equal(durations.get(zero.id), 0, 'a same-instant interval is a measured zero');
	assert.equal(durations.get(twoRows.id), hours(1));
	assert.equal(durations.get(corrected.id), hours(3));
	assert.equal(durations.has(noteOnly.id), true);
	assert.equal(durations.get(noteOnly.id), null);
	assert.equal(durations.has(deletedLead.id), false, 'a deleted Lead is outside the cohort');

	const statuses = new Map(
		mixedEvidence.rows.map((row) => [row.lead_id, row.status])
	);
	assert.equal(statuses.get(unknownTime.id), 'missing_timestamp');
	assert.equal(statuses.get(prehistory.id), 'negative');
	assert.equal(statuses.get(incomplete.id), 'incomplete_earlier');
	assert.equal(statuses.get(noteOnly.id), 'no_outreach');
	assert.equal(statuses.get(scheduled.id), 'no_outreach');
	assert.equal(statuses.get(deletedActivity.id), 'no_outreach');
	assert.equal(statuses.get(zero.id), 'sampled');

	const twoRow = mixedEvidence.rows.find((row) => row.lead_id === twoRows.id);
	assert.ok(twoRow);
	assert.equal(twoRow.completed_outreach_count, 2, 'two rows are counted once');
	assert.equal(twoRow.first_outreach_type, 'Call', 'the earliest row wins the tie');
	assert.equal(twoRow.first_outreach_at, '2026-07-08 10:00:00');

	const missing = await readEvidence(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search, metric: 'missing_timestamp' },
		token
	);
	assert.equal(missing.pagination.total, 1);
	assert.equal(missing.rows[0]?.lead_id, unknownTime.id);
	assert.equal(missing.rows[0]?.first_outreach_at, null);

	const negative = await readEvidence(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search, metric: 'negative' },
		token
	);
	assert.equal(negative.pagination.total, 1);
	assert.equal(negative.rows[0]?.lead_id, prehistory.id);
	assert.equal(negative.rows[0]?.duration_seconds, -788400);
	assert.match(negative.rows[0]?.exclusion_reason ?? '', /before system entry/i);

	const incompleteEvidence = await readEvidence(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search, metric: 'incomplete_earlier' },
		token
	);
	assert.equal(incompleteEvidence.pagination.total, 1);
	assert.equal(incompleteEvidence.rows[0]?.lead_id, incomplete.id);
	assert.equal(incompleteEvidence.rows[0]?.unknown_occurrence_count, 1);
	assert.match(
		incompleteEvidence.rows[0]?.exclusion_reason ?? '',
		/earliest|incomplete/i
	);

	// ── Full-result pagination is deterministic and independent of the page ─
	const firstPage = await readEvidence(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search, metric: 'all', page: 1, limit: 3 },
		token
	);
	assert.equal(firstPage.rows.length, 3);
	assert.equal(firstPage.pagination.total, 10);
	assert.equal(firstPage.pagination.total_pages, 4);
	assert.deepEqual(
		firstPage.rows.map((row) => row.lead_id),
		[zero.id, sampled.id, unknownTime.id],
		'cohort order is system entry, then id'
	);
	const seen = new Set<number>();
	for (const page of [1, 2, 3, 4]) {
		const body = await readEvidence(
			context,
			{
				from_date: MIXED.from,
				to_date: MIXED.to,
				search,
				metric: 'all',
				page,
				limit: 3,
			},
			token
		);
		for (const row of body.rows) seen.add(row.lead_id);
	}
	assert.equal(seen.size, 10, 'every Lead appears once across ordered pages');
	assert.equal(seen.has(deletedLead.id), false);

	// ── Cohort filters are retained by the evidence drill-down ──────────────
	const owned = await readTiming(
		context,
		{
			from_date: MIXED.from,
			to_date: MIXED.to,
			search,
			owner: context.assignee.id,
		},
		token
	);
	assert.equal(owned.cohort_leads, 3);
	assert.equal(owned.valid_samples, 2);
	assert.equal(owned.exclusions.missing_timestamp, 1);
	const ownedEvidence = await readEvidence(
		context,
		{
			from_date: MIXED.from,
			to_date: MIXED.to,
			search,
			owner: context.assignee.id,
			metric: 'all',
		},
		token
	);
	assert.deepEqual(
		ownedEvidence.rows.map((row) => row.lead_id),
		[sampled.id, unknownTime.id, corrected.id],
		'the drill-down keeps the applied owner filter'
	);

	const connected = await readTiming(
		context,
		{
			from_date: MIXED.from,
			to_date: MIXED.to,
			search,
			stage: 'Connected',
		},
		token
	);
	assert.equal(connected.cohort_leads, 1);
	assert.equal(connected.median_seconds, hours(2));
	const connectedEvidence = await readEvidence(
		context,
		{
			from_date: MIXED.from,
			to_date: MIXED.to,
			search,
			stage: 'Connected',
			metric: 'sampled',
		},
		token
	);
	assert.deepEqual(
		connectedEvidence.rows.map((row) => row.lead_id),
		[sampled.id]
	);

	const web = await readTiming(
		context,
		{ from_date: ODD.from, to_date: ODD.to, search, source: 'Timing Web' },
		token
	);
	assert.equal(web.cohort_leads, 3);
	assert.equal(web.valid_samples, 2);
	assert.equal(web.median_seconds, (hours(1) + hours(2)) / 2);
	assert.equal(web.p90_seconds, hours(2));
	assert.equal(web.scope.effective_filters.source.label, 'Timing Web');
	const webEvidence = await readEvidence(
		context,
		{
			from_date: ODD.from,
			to_date: ODD.to,
			search,
			source: 'Timing Web',
			metric: 'all',
		},
		token
	);
	assert.deepEqual(
		webEvidence.rows.map((row) => row.lead_id).sort((left, right) => left - right),
		[odd1.id, odd2.id, oddNote.id].sort((left, right) => left - right)
	);

	// ── Boundary days are included; adjacent days are not ───────────────────
	const boundary = await readTiming(
		context,
		{ from_date: BOUNDARY.from, to_date: BOUNDARY.to, search },
		token
	);
	assert.equal(boundary.cohort_leads, 2);
	assert.equal(boundary.valid_samples, 2);
	assert.equal(boundary.median_seconds, (hours(1) + hours(2)) / 2);
	assert.equal(boundary.p90_seconds, hours(2));
	const boundaryEvidence = await readEvidence(
		context,
		{ from_date: BOUNDARY.from, to_date: BOUNDARY.to, search, metric: 'all' },
		token
	);
	assert.deepEqual(
		boundaryEvidence.rows.map((row) => row.lead_id),
		[boundaryStart.id, boundaryEnd.id]
	);

	// ── Activity filters do not narrow a timing metric; they are disclosed ──
	const ignored = await readTiming(
		context,
		{
			from_date: MIXED.from,
			to_date: MIXED.to,
			search,
			actor: 'unknown',
			activity_type: 'Call',
			outcome: 'email_replied',
			event_type: 'conversion',
		},
		token
	);
	assert.deepEqual(
		ignored.filter_scope.ignored.map((entry) => entry.filter),
		['actor', 'activity_type', 'outcome', 'event_type']
	);
	assert.ok(
		ignored.filter_scope.ignored.every((entry) => entry.reason.length > 0),
		'each ignored filter states why it does not apply'
	);
	assert.equal(ignored.cohort_leads, mixed.cohort_leads);
	assert.equal(ignored.median_seconds, mixed.median_seconds);
	assert.equal(ignored.valid_samples, mixed.valid_samples);
	const ignoredEvidence = await readEvidence(
		context,
		{
			from_date: MIXED.from,
			to_date: MIXED.to,
			search,
			actor: 'unknown',
			metric: 'all',
		},
		token
	);
	assert.equal(
		ignoredEvidence.filter_scope.ignored[0]?.filter,
		'actor',
		'the evidence read states the same ignored scope'
	);
	assert.equal(ignoredEvidence.pagination.total, 10);

	// ── Invalid requests are explicit ───────────────────────────────────────
	for (const [path, values, code] of [
		['/api/reports/lead-audit/timing', { stage: 'Not A Stage' }, 'invalid_stage'],
		['/api/reports/lead-audit/timing', { from_date: '2026-02-30', to_date: '2026-03-01' }, 'invalid_date'],
		[
			'/api/reports/lead-audit/timing/evidence',
			{ metric: 'not_a_population' },
			'invalid_timing_metric',
		],
	] as const) {
		const response = await context.http.get(`${path}${query(values)}`, token);
		assert.equal(response.status, 422, `${String(code)} status`);
		assert.equal(ErrorEnvelopeSchema.parse(response.json()).code, code);
	}

	// ── Authorization contract ──────────────────────────────────────────────
	await expectRefused(context, '/api/reports/lead-audit/timing', undefined, 401);
	await expectRefused(
		context,
		'/api/reports/lead-audit/timing/evidence',
		undefined,
		401
	);
	for (const identity of [
		context.readOnly,
		context.reportOnly,
		context.projectReportOnly,
	]) {
		await expectRefused(
			context,
			`/api/reports/lead-audit/timing${query({ search })}`,
			identity.sessionToken,
			403
		);
		await expectRefused(
			context,
			`/api/reports/lead-audit/timing/evidence${query({ search })}`,
			identity.sessionToken,
			403
		);
	}
	const superAdminTiming = await readTiming(
		context,
		{ from_date: MIXED.from, to_date: MIXED.to, search },
		context.superAdmin.sessionToken
	);
	assert.equal(superAdminTiming.cohort_leads, 10);

	// ── The composed report carries the same timing section ────────────────
	const composed = await context.http.get(
		`/api/reports/lead-audit${query({
			from_date: ODD.from,
			to_date: ODD.to,
			search,
		})}`,
		token
	);
	assert.equal(composed.status, 200, `composed report status (${composed.text})`);
	const composedBody = z
		.object({
			success: z.literal(true),
			data: z
				.object({ timing: TimingSectionSchema })
				.passthrough(),
		})
		.passthrough()
		.parse(composed.json()).data;
	assert.equal(composedBody.timing.valid_samples, odd.valid_samples);
	assert.equal(composedBody.timing.median_seconds, odd.median_seconds);
	assert.equal(composedBody.timing.p90_seconds, odd.p90_seconds);

	// ── Reads leave the fixture sources untouched ───────────────────────────
	assert.deepEqual(await readLeads(), leadsBefore, 'Lead rows are unchanged');
	assert.deepEqual(
		await readActivities(),
		activitiesBefore,
		'activity rows are unchanged, including the corrected row'
	);
	assert.deepEqual(
		await context.reader.fixtureRows(
			'SELECT id, lead_source FROM leads WHERE id IN (?) ORDER BY id ASC',
			[deletedLead.id]
		),
		sourcesBefore,
		'stored source labels are unchanged'
	);
}
