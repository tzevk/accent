import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';
import { parseLeadDetail, parseLeadListRow } from '../client.ts';

const DetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const ListEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		leads: z.array(z.unknown()),
		stats: z.unknown().optional(),
		pagination: z.unknown().optional(),
	}),
});

const IdEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({ id: z.number() }).passthrough(),
});

const LEAD_STATS_KEYS = [
	'total_leads',
	'unassigned_leads',
	'needs_review_leads',
	'stage_new',
	'stage_attempting_contact',
	'stage_connected',
	'stage_qualified',
	'stage_nurture',
	'stage_disqualified',
	'stage_converted',
	'stage_unresolved',
] as const;

async function createEnquiry(
	context: ScenarioContext,
	companyName: string,
	projectDescription: string
): Promise<number> {
	const response = await context.http.post(
		'/api/leads',
		{
			company_name: companyName,
			contact_name: 'Enquiry Contact',
			contact_email: 'enquiry@example.com',
			phone: '+1-555-0120',
			project_description: projectDescription,
		},
		context.creator.sessionToken
	);
	assert.equal(response.status, 200, `create status (body: ${response.text})`);
	const id = IdEnvelopeSchema.parse(response.json()).data.id;
	context.trackLead(id);
	return id;
}

export async function separateEnquiriesScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Shared Context Co`;
	const firstId = await createEnquiry(
		context,
		companyName,
		`${context.runTag} warehouse need`
	);
	const secondId = await createEnquiry(
		context,
		companyName,
		`${context.runTag} office need`
	);
	assert.notEqual(
		firstId,
		secondId,
		'separate enquiries keep separate identity'
	);

	const first = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${firstId}`,
					context.creator.sessionToken
				)
			).json()
		).data
	);
	const second = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${secondId}`,
					context.creator.sessionToken
				)
			).json()
		).data
	);
	assert.equal(first.company_name, companyName);
	assert.equal(second.company_name, companyName);
	assert.deepEqual(
		first.duplicate_candidates,
		[],
		'distinct needs are not duplicates'
	);
	assert.deepEqual(second.duplicate_candidates, []);

	const listed = await context.http.get(
		`/api/leads/list?search=${encodeURIComponent(companyName)}&limit=20`,
		context.creator.sessionToken
	);
	const rows = ListEnvelopeSchema.parse(listed.json()).data.leads.map(
		parseLeadListRow
	);
	const matches = rows.filter((row) => row.company_name === companyName);
	assert.ok(matches.length >= 2, 'both enquiries stay listed separately');
}

export async function duplicateReviewScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Duplicate Co`;
	const projectDescription = `${context.runTag} duplicated project need`;
	const firstId = await createEnquiry(context, companyName, projectDescription);
	const secondId = await createEnquiry(
		context,
		companyName,
		projectDescription
	);

	const first = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${firstId}`,
					context.creator.sessionToken
				)
			).json()
		).data
	);
	const second = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${secondId}`,
					context.creator.sessionToken
				)
			).json()
		).data
	);
	assert.ok(first.duplicate_candidates, 'detail surfaces duplicates');
	assert.ok(second.duplicate_candidates, 'detail surfaces duplicates');
	assert.deepEqual(
		first.duplicate_candidates.map((candidate) => candidate.id),
		[secondId],
		'first lead flags the second as a duplicate candidate'
	);
	assert.deepEqual(
		second.duplicate_candidates.map((candidate) => candidate.id),
		[firstId]
	);
	assert.equal(
		second.duplicate_candidates[0].project_description,
		projectDescription
	);
	assert.ok(
		typeof first.duplicate_candidates[0].lead_id === 'string' ||
			first.duplicate_candidates[0].lead_id === null
	);

	assert.equal((await context.reader.leadRow(firstId))?.isDelete, 0);
	assert.equal((await context.reader.leadRow(secondId))?.isDelete, 0);
}

export async function durableReadsScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Durable Co`;
	const leadId = await createEnquiry(
		context,
		companyName,
		`${context.runTag} durable need`
	);
	const updatedNeed = `${context.runTag} revised need`;

	const updated = await context.http.put(
		`/api/leads/${leadId}`,
		{
			contact_name: 'Durable Contact',
			notes: `${context.runTag} durable note`,
			project_description: updatedNeed,
		},
		context.noAssign.sessionToken
	);
	assert.equal(updated.status, 200, `update status (body: ${updated.text})`);

	for (const path of ['/api/leads', '/api/leads/list']) {
		const response = await context.http.get(
			`${path}?search=${encodeURIComponent(companyName)}&limit=20`,
			context.readOnly.sessionToken
		);
		assert.equal(
			response.status,
			200,
			`${path} status (body: ${response.text})`
		);
		const body = ListEnvelopeSchema.parse(response.json());
		const rows = body.data.leads.map(parseLeadListRow);
		const match = rows.find((row) => row.id === leadId);
		assert.ok(match, `${path} returns the edited lead`);
		assert.equal(match.company_name, companyName);
		assert.equal(match.owner_user_id, context.creator.id);
		assert.equal(match.owner_name, context.creator.fullName);
		assert.equal(match.enquiry_status, 'New');
		assert.equal(match.project_description, updatedNeed);
	}

	const unassigned = await context.http.get(
		`/api/leads/list?search=${encodeURIComponent(context.runTag)}&owner=unassigned&limit=100`,
		context.readOnly.sessionToken
	);
	const unassignedBody = ListEnvelopeSchema.parse(unassigned.json());
	for (const raw of unassignedBody.data.leads) {
		assert.equal(parseLeadListRow(raw).owner_user_id, null);
	}

	const statsResponse = await context.http.get(
		'/api/leads/list?limit=1',
		context.readOnly.sessionToken
	);
	const statsBody = ListEnvelopeSchema.parse(statsResponse.json());
	assert.ok(statsBody.data.stats, 'list exposes canonical stats');
	const stats = statsBody.data.stats as Record<string, unknown>;
	for (const key of LEAD_STATS_KEYS) {
		assert.equal(typeof stats[key], 'number', `stats carry ${key}`);
	}

	const detail = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${leadId}`,
					context.readOnly.sessionToken
				)
			).json()
		).data
	);
	const row = await context.reader.leadRow(leadId);
	assert.ok(row);
	assert.equal(detail.company_name, row.company_name);
	assert.equal(detail.enquiry_status, row.enquiry_status);
	assert.equal(detail.owner_user_id, row.owner_user_id);
	assert.equal(
		row.project_description,
		updatedNeed,
		'a permitted non-owner can edit the enquiry'
	);
}
