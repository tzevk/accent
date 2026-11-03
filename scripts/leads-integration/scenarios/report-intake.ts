import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { csvEscape } from '../support.ts';
import type { ScenarioContext } from '../client.ts';

// The Lead Audit intake slice (#399). The report is proved through its
// authenticated HTTP reads only: independent fixture Leads go into the
// disposable database with explicit record times, and every expected figure
// is derived from those known values, never from the report's own aggregates.

const ReportEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				available_views: z.array(
					z.object({ key: z.string(), label: z.string() })
				),
				scope: z
					.object({
						preset: z.string(),
						from_date: z.string(),
						to_date: z.string(),
						date_basis: z.string(),
						effective_filters: z
							.object({
								owner: z.object({ value: z.string().nullable(), label: z.string() }),
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
						time_zone: z
							.object({
								session: z.string(),
								system: z.string(),
								utc_offset: z.string(),
								label: z.string(),
							})
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
				trends: z.object({
					intake: z.array(
						z.object({ date: z.string(), count: z.number() }).passthrough()
					),
					enquiry_date: z.array(
						z.object({ date: z.string(), count: z.number() }).passthrough()
					),
				}),
				sources: z.array(
					z
						.object({
							label: z.string().nullable(),
							is_unknown: z.boolean(),
							count: z.number(),
						})
						.passthrough()
				),
				filter_options: z
					.object({
						owners: z.array(
							z
								.object({
									id: z.number(),
									full_name: z.string(),
									is_active: z.boolean(),
								})
								.passthrough()
						),
						sources: z.array(
							z
								.object({
									label: z.string().nullable(),
									is_unknown: z.boolean(),
									count: z.number(),
								})
								.passthrough()
						),
						stages: z.array(z.object({ value: z.string(), label: z.string() })),
						priorities: z.array(z.string()),
					})
					.passthrough(),
				disclosures: z.array(
					z.object({ code: z.string(), text: z.string() }).passthrough()
				),
			})
			.passthrough(),
	})
	.passthrough();

type ReportBody = z.infer<typeof ReportEnvelopeSchema>['data'];

const RegisterEnvelopeSchema = z
	.object({
		success: z.literal(true),
		data: z
			.object({
				metric: z.object({
					key: z.string(),
					label: z.string(),
					definition: z.string(),
				}),
				leads: z.array(
					z
						.object({
							id: z.number(),
							lead_id: z.string().nullable(),
							company_name: z.string(),
							contact_name: z.string().nullable(),
							source: z.object({
								label: z.string().nullable(),
								is_unknown: z.boolean(),
							}),
							priority: z.string().nullable(),
							stage: z.object({
								value: z.string().nullable(),
								label: z.string(),
							}),
							owner: z
								.object({ id: z.number(), name: z.string().nullable() })
								.nullable(),
							enquiry_date: z.string().nullable(),
							recorded_at: z.string(),
						})
						.passthrough()
				),
				pagination: z.object({
					page: z.number(),
					limit: z.number(),
					total: z.number(),
					total_pages: z.number(),
				}),
				disclosures: z.array(
					z.object({ code: z.string(), text: z.string() }).passthrough()
				),
			})
			.passthrough(),
	})
	.passthrough();

type RegisterBody = z.infer<typeof RegisterEnvelopeSchema>['data'];

const ErrorEnvelopeSchema = z
	.object({
		success: z.literal(false),
		error: z.string(),
		code: z.string().optional(),
	})
	.passthrough();

const PREFIX = 'ReportIntake';
const PERIOD_FROM = '2026-05-01';
const PERIOD_TO = '2026-05-31';
const OUTSIDE_BEFORE = '2026-04-30 23:59:59';
const OUTSIDE_AFTER = '2026-06-01 00:00:00';

function withPrefix(context: ScenarioContext, suffix: string): string {
	return `${context.runTag} ${PREFIX} ${suffix}`;
}

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
	return ReportEnvelopeSchema.parse(response.json()).data;
}

async function readRegister(
	context: ScenarioContext,
	values: Record<string, string | number | null | undefined>,
	token: string
): Promise<RegisterBody> {
	const response = await context.http.get(
		`/api/reports/lead-audit/register${query(values)}`,
		token
	);
	assert.equal(
		response.status,
		200,
		`register status (body: ${response.text})`
	);
	return RegisterEnvelopeSchema.parse(response.json()).data;
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

function sourceGroup(
	body: ReportBody,
	label: string | null
): { label: string | null; is_unknown: boolean; count: number } {
	const group = body.sources.find((entry) =>
		label === null ? entry.is_unknown : entry.label === label
	);
	assert.ok(group, `source group ${JSON.stringify(label)} is reported`);
	return group;
}

function monthStart(today: string): string {
	return `${today.slice(0, 7)}-01`;
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	const value = new Date(Date.UTC(year, month - 1, day + days));
	return value.toISOString().slice(0, 10);
}

function previousMonth(today: string): { from: string; to: string } {
	const [year, month] = today.split('-').map(Number);
	const start = new Date(Date.UTC(year, month - 2, 1));
	const end = new Date(Date.UTC(year, month - 1, 0));
	return {
		from: start.toISOString().slice(0, 10),
		to: end.toISOString().slice(0, 10),
	};
}

interface Seeded {
	id: number;
	company: string;
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

export async function leadAuditIntakeScenario(
	context: ScenarioContext
): Promise<void> {
	const today = await context.reader.databaseToday();
	assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'the database calendar day');

	// ── Known fixture evidence, entirely independent of the report ─────────
	const a = await seedLead(context, 'A Boundary Start', {
		recordedAt: '2026-05-01 00:00:00',
		enquiryDate: '2026-05-01',
		source: 'Website',
		stage: 'New',
	});
	const b = await seedLead(context, 'B Referral', {
		recordedAt: '2026-05-15 10:30:00',
		enquiryDate: '2026-04-20',
		source: 'Referral',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
		priority: 'Low',
	});
	const c = await seedLead(context, 'C Boundary End', {
		recordedAt: '2026-05-31 23:59:59',
		enquiryDate: '2026-05-31',
		source: 'website',
		stage: 'Qualified',
		ownerUserId: context.assignee.id,
		priority: 'High',
	});
	const d = await seedLead(context, 'D Next Day', {
		recordedAt: OUTSIDE_AFTER,
		enquiryDate: '2026-06-01',
		source: 'Website',
		stage: 'New',
	});
	const e = await seedLead(context, 'E Earlier Intake', {
		recordedAt: OUTSIDE_BEFORE,
		enquiryDate: '2026-05-10',
		source: 'Website',
		stage: 'New',
	});
	const f = await seedLead(context, 'F No Enquiry Date', {
		recordedAt: '2026-05-20 09:00:00',
		enquiryDate: null,
		source: null,
		stage: 'Attempting Contact',
		ownerUserId: context.assignee.id,
	});
	const g = await seedLead(context, 'G Deleted', {
		recordedAt: '2026-05-21 09:00:00',
		enquiryDate: '2026-05-21',
		source: 'Website',
		stage: 'New',
		isDeleted: true,
	});
	const h = await seedLead(context, 'H Unresolved', {
		recordedAt: '2026-05-22 09:00:00',
		enquiryDate: '2026-05-22',
		source: '',
		stage: null,
		priority: 'High',
	});
	const i = await seedLead(context, 'I Whitespace Source', {
		recordedAt: '2026-05-23 09:00:00',
		enquiryDate: '2026-05-23',
		source: '  Website  ',
		stage: 'New',
		ownerUserId: context.assignee.id,
	});
	const j = await seedLead(context, 'J Website', {
		recordedAt: '2026-05-24 09:00:00',
		enquiryDate: '2026-05-24',
		source: 'Website',
		stage: 'Nurture',
		ownerUserId: context.assignee.id,
	});
	const k = await seedLead(context, 'K Event', {
		recordedAt: '2026-05-25 09:00:00',
		enquiryDate: '2026-05-25',
		source: 'Event',
		stage: 'Connected',
	});
	const search = `${context.runTag} ${PREFIX}`;
	const token = context.reportReader.sessionToken;

	// ── Defaults and metadata ────────────────────────────────────────────────
	const defaults = await readReport(context, { search }, token);
	assert.equal(defaults.scope.preset, 'current_month');
	assert.equal(defaults.scope.from_date, monthStart(today));
	assert.equal(defaults.scope.to_date, today);
	assert.match(defaults.scope.date_basis, /inclusive|calendar/i);
	assert.match(defaults.meta.generated_at, /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/);
	assert.equal(defaults.meta.today, today);
	assert.ok(defaults.meta.time_zone.label.length > 0, 'time zone is disclosed');
	assert.match(
		defaults.meta.time_zone.utc_offset,
		/^[+-]?\d{2}:\d{2}(?::\d{2})?$/,
		'the actual reporting offset is disclosed'
	);
	assert.ok(defaults.meta.live_data_warning.length > 0);
	assert.deepEqual(
		defaults.available_views.map((view) => view.key),
		['overview', 'intake'],
		'later views stay absent until implemented'
	);

	// ── Presets are calculated from the database calendar ───────────────────
	const previous = previousMonth(today);
	const previousReport = await readReport(
		context,
		{ preset: 'previous_month', search },
		token
	);
	assert.equal(previousReport.scope.from_date, previous.from);
	assert.equal(previousReport.scope.to_date, previous.to);
	const lastSeven = await readReport(
		context,
		{ preset: 'last_7_days', search },
		token
	);
	assert.equal(lastSeven.scope.from_date, addDays(today, -6));
	assert.equal(lastSeven.scope.to_date, today);

	// ── System entry and Enquiry Date are separate populations ──────────────
	const may = await readReport(
		context,
		{ from_date: PERIOD_FROM, to_date: PERIOD_TO, search },
		token
	);
	assert.equal(may.summary.leads_recorded, 8, 'recorded Leads in May');
	assert.equal(
		may.summary.enquiries_dated,
		7,
		'Enquiry Dates in May include an earlier-recorded Lead'
	);
	assert.equal(
		may.summary.missing_enquiry_date,
		1,
		'missing Enquiry Dates are disclosed, not substituted'
	);
	assert.equal(may.summary.distinct_sources, 6);
	assert.equal(may.scope.effective_filters.search, search);

	const intakeByDate = new Map(
		may.trends.intake.map((entry) => [entry.date, entry.count])
	);
	assert.equal(intakeByDate.get('2026-05-01'), 1, 'start boundary included');
	assert.equal(intakeByDate.get('2026-05-31'), 1, 'end day 23:59:59 included');
	assert.equal(intakeByDate.get('2026-06-01'), undefined, 'next day excluded');
	assert.equal(intakeByDate.get('2026-04-30'), undefined, 'day before excluded');
	assert.equal(
		[...intakeByDate.values()].reduce((sum, value) => sum + value, 0),
		8
	);
	const enquiryByDate = new Map(
		may.trends.enquiry_date.map((entry) => [entry.date, entry.count])
	);
	assert.equal(enquiryByDate.get('2026-05-10'), 1, 'earlier Lead enquiry counted');
	assert.equal(enquiryByDate.get('2026-05-31'), 1);
	assert.equal(enquiryByDate.get('2026-04-20'), undefined, 'outside enquiry excluded');
	assert.equal(
		[...enquiryByDate.values()].reduce((sum, value) => sum + value, 0),
		7
	);

	// ── Source labels are preserved, never merged ───────────────────────────
	assert.equal(sourceGroup(may, 'Website').count, 2, 'deleted Lead excluded');
	assert.equal(sourceGroup(may, 'website').count, 1, 'case stays a separate label');
	assert.equal(
		sourceGroup(may, '  Website  ').count,
		1,
		'surrounding whitespace is preserved'
	);
	assert.equal(sourceGroup(may, 'Referral').count, 1);
	assert.equal(sourceGroup(may, 'Event').count, 1);
	assert.equal(
		sourceGroup(may, null).count,
		2,
		'missing source labels are grouped as Unknown source'
	);
	assert.ok(
		may.sources.find((entry) => entry.is_unknown)?.is_unknown,
		'Unknown source is explicit'
	);

	// ── Closed-vocabulary filters and their effective labels ────────────────
	const ownerFiltered = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			owner: context.assignee.id,
		},
		token
	);
	assert.equal(ownerFiltered.summary.leads_recorded, 5);
	assert.equal(
		ownerFiltered.scope.effective_filters.owner.value,
		String(context.assignee.id)
	);
	assert.equal(
		ownerFiltered.scope.effective_filters.owner.label,
		context.assignee.fullName
	);

	const unassigned = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			owner: 'unassigned',
		},
		token
	);
	assert.equal(unassigned.summary.leads_recorded, 3);

	const website = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			source: 'Website',
		},
		token
	);
	assert.equal(website.summary.leads_recorded, 2);
	assert.equal(website.scope.effective_filters.source.label, 'Website');
	assert.equal(website.scope.effective_filters.source.is_unknown, false);

	const missingSource = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			source_missing: '1',
		},
		token
	);
	assert.equal(missingSource.summary.leads_recorded, 2);
	assert.equal(missingSource.scope.effective_filters.source.is_unknown, true);

	const connected = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			stage: 'Connected',
		},
		token
	);
	assert.equal(connected.summary.leads_recorded, 2);
	assert.equal(connected.scope.effective_filters.stage.value, 'Connected');

	const unresolved = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			stage: 'unresolved',
		},
		token
	);
	assert.equal(unresolved.summary.leads_recorded, 1);
	assert.equal(unresolved.scope.effective_filters.stage.value, 'unresolved');

	const high = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			priority: 'High',
		},
		token
	);
	assert.equal(high.summary.leads_recorded, 2);

	const combined = await readReport(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			stage: 'Connected',
			owner: context.assignee.id,
		},
		token
	);
	assert.equal(combined.summary.leads_recorded, 1);

	// Filter options keep every search-matching label and the referenced owner,
	// whether or not that owner currently passes the record filters.
	assert.ok(
		may.filter_options.sources.some((entry) => entry.label === 'website'),
		'filter options preserve the stored source vocabulary'
	);
	assert.ok(
		may.filter_options.sources.some((entry) => entry.is_unknown),
		'Unknown source is an option'
	);
	assert.deepEqual(
		may.filter_options.owners.map((owner) => owner.id),
		[context.assignee.id],
		'the current-owner filter names the referenced owner'
	);
	assert.ok(
		may.filter_options.stages.some((entry) => entry.value === 'unresolved'),
		'unresolved legacy stage is an explicit option'
	);
	assert.deepEqual(may.filter_options.priorities, ['Low', 'Medium', 'High']);

	// ── Invalid requests are explicit, never silent empty reports ───────────
	for (const [values, code] of [
		[{ from_date: '2026-02-30', to_date: '2026-03-01' }, 'invalid_date'],
		[{ from_date: '2026-05-31', to_date: '2026-05-01' }, 'invalid_range'],
		[{ preset: 'not_a_preset' }, 'invalid_preset'],
		[{ stage: 'Not A Stage' }, 'invalid_stage'],
		[{ priority: 'Urgent' }, 'invalid_priority'],
		[{ owner: 'abc' }, 'invalid_owner'],
	] as const) {
		const response = await context.http.get(
			`/api/reports/lead-audit${query({ ...values, search })}`,
			token
		);
		assert.equal(response.status, 422, `invalid filter ${String(code)} status`);
		const body = ErrorEnvelopeSchema.parse(response.json());
		assert.equal(body.code, code);
	}

	// ── Permission contract ─────────────────────────────────────────────────
	await expectRefused(context, '/api/reports/lead-audit', undefined, 401);
	await expectRefused(
		context,
		'/api/reports/lead-audit/register',
		undefined,
		401
	);
	for (const identity of [
		context.readOnly,
		context.reportOnly,
		context.projectReportOnly,
	]) {
		assert.equal(
			(
				await context.http.get(
					`/api/reports/lead-audit${query({ search })}`,
					identity.sessionToken
				)
			).status,
			403,
			`${identity.username} lacks a required read grant`
		);
	}
	await readReport(context, { search }, context.superAdmin.sessionToken);
	await readRegister(
		context,
		{ search, page: 1, limit: 2 },
		context.superAdmin.sessionToken
	);

	// ── Paginated register, with full-result distinct totals ────────────────
	const pageOne = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'recorded',
			page: 1,
			limit: 3,
		},
		token
	);
	assert.equal(pageOne.metric.key, 'recorded');
	assert.equal(pageOne.leads.length, 3);
	assert.equal(pageOne.pagination.total, 8);
	assert.equal(pageOne.pagination.total_pages, 3);
	assert.deepEqual(
		pageOne.leads.map((lead) => lead.company_name),
		[c.company, k.company, j.company],
		'deterministic newest-first ordering'
	);

	const pageTwo = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'recorded',
			page: 2,
			limit: 3,
		},
		token
	);
	const pageThree = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'recorded',
			page: 3,
			limit: 3,
		},
		token
	);
	assert.equal(pageThree.leads.length, 2);
	const allIds = [
		...pageOne.leads,
		...pageTwo.leads,
		...pageThree.leads,
	].map((lead) => lead.id);
	assert.equal(new Set(allIds).size, 8, 'each Lead appears once across pages');
	assert.equal(allIds.includes(g.id), false, 'a deleted Lead stays out');
	assert.equal(allIds.includes(d.id), false, 'a next-day Lead stays out');
	assert.equal(allIds.includes(e.id), false, 'an earlier Lead stays out');

	const beyond = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'recorded',
			page: 99,
			limit: 3,
		},
		token
	);
	assert.equal(beyond.leads.length, 0);
	assert.equal(beyond.pagination.total, 8, 'the total covers the full result');

	const enquiryPage = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'enquired',
			page: 1,
			limit: 2,
		},
		token
	);
	assert.equal(enquiryPage.pagination.total, 7);
	assert.deepEqual(
		enquiryPage.leads.map((lead) => lead.company_name),
		[c.company, k.company]
	);
	assert.ok(
		enquiryPage.leads.every((lead) => lead.enquiry_date !== null),
		'the Enquiry Date evidence never substitutes system entry'
	);

	const missingPage = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'missing_enquiry_date',
			page: 1,
			limit: 10,
		},
		token
	);
	assert.equal(missingPage.pagination.total, 1);
	assert.equal(missingPage.leads[0]?.id, f.id);
	assert.equal(missingPage.leads[0]?.enquiry_date, null);
	assert.equal(missingPage.leads[0]?.source.is_unknown, true);
	assert.equal(missingPage.leads[0]?.source.label, null);
	assert.equal(missingPage.leads[0]?.stage.label, 'Attempting Contact');
	assert.equal(missingPage.leads[0]?.owner?.id, context.assignee.id);

	const filteredRegister = await readRegister(
		context,
		{
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			owner: context.assignee.id,
			stage: 'Connected',
			metric: 'recorded',
			page: 1,
			limit: 10,
		},
		token
	);
	assert.equal(filteredRegister.pagination.total, 1);
	assert.equal(filteredRegister.leads[0]?.id, b.id);

	const invalidMetric = await context.http.get(
		`/api/reports/lead-audit/register${query({
			from_date: PERIOD_FROM,
			to_date: PERIOD_TO,
			search,
			metric: 'not_a_metric',
		})}`,
		token
	);
	assert.equal(invalidMetric.status, 422);
	assert.equal(ErrorEnvelopeSchema.parse(invalidMetric.json()).code, 'invalid_metric');

	// ── Imports count when recorded, not by their Enquiry Date ──────────────
	const importedCompany = withPrefix(context, 'L Imported');
	const csv = [
		['Company', 'Contact Name', 'Email', 'Project Description', 'Enquiry Date', 'Source'],
		[
			importedCompany,
			'Imported Contact',
			'imported@example.com',
			`${context.runTag} ${PREFIX} imported need`,
			'2026-04-01',
			'Import Batch',
		],
	]
		.map((row) => row.map(csvEscape).join(','))
		.join('\n');
	const form = new FormData();
	form.append(
		'file',
		new File([csv], `${context.runTag}-report-intake.csv`, {
			type: 'text/csv',
		})
	);
	const imported = await context.http.post(
		'/api/leads/import',
		form,
		context.creator.sessionToken
	);
	assert.equal(imported.status, 200, `import status (body: ${imported.text})`);
	const importedBody = z
		.object({ success: z.literal(true), imported: z.number() })
		.passthrough()
		.parse(imported.json());
	assert.equal(importedBody.imported, 1);

	const todayReport = await readReport(
		context,
		{ from_date: today, to_date: today, search },
		token
	);
	assert.equal(todayReport.summary.leads_recorded, 1, 'import counted at entry');
	assert.equal(
		todayReport.summary.enquiries_dated,
		0,
		'the import Enquiry Date is outside the selected day'
	);
	assert.equal(
		todayReport.summary.missing_enquiry_date,
		0,
		'the import carries a stated Enquiry Date'
	);
	assert.equal(
		sourceGroup(todayReport, 'Import Batch').count,
		1,
		'import source volume is preserved'
	);
	assert.equal(
		(
			await readRegister(
				context,
				{ from_date: today, to_date: today, search, metric: 'recorded' },
				token
			)
		).pagination.total,
		1
	);

	// The report is a read: the fixture rows and their facts are unchanged.
	for (const fixture of [a, b, c, d, e, f, g, h, i, j, k]) {
		const row = await context.reader.leadRow(fixture.id);
		assert.ok(row, `fixture Lead ${fixture.company} persists`);
		assert.equal(row.company_name, fixture.company);
	}
	assert.equal((await context.reader.leadRow(g.id))?.isDelete, 1);
	assert.equal((await context.reader.leadRow(f.id))?.enquiry_status, 'Attempting Contact');
}
