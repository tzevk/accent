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

export interface LegacySeedRow {
	id: number;
	company: string;
	originalStatus: string | null;
	originalOwner: string | null;
	ownerMarker:
		| '__CLEAN_MAP__'
		| '__UNKNOWN_NAME__'
		| '__DUPLICATE_NAME__'
		| '__LABEL__';
}

async function detailLead(context: ScenarioContext, leadId: number) {
	const response = await context.http.get(
		`/api/leads/${leadId}`,
		context.creator.sessionToken
	);
	assert.equal(response.status, 200, `detail status (body: ${response.text})`);
	return parseLeadDetail(DetailEnvelopeSchema.parse(response.json()).data);
}

function requireSeed(
	seeds: LegacySeedRow[],
	marker: LegacySeedRow['ownerMarker']
): LegacySeedRow {
	const seed = seeds.find((candidate) => candidate.ownerMarker === marker);
	assert.ok(seed, `legacy seed present for ${marker}`);
	return seed;
}

export async function legacyEvidenceScenario(
	context: ScenarioContext,
	seeds: LegacySeedRow[]
): Promise<void> {
	assert.ok(seeds.length >= 4, 'legacy seed covers the four evidence cases');

	const clean = requireSeed(seeds, '__CLEAN_MAP__');
	const unknownName = requireSeed(seeds, '__UNKNOWN_NAME__');
	const duplicateName = requireSeed(seeds, '__DUPLICATE_NAME__');
	const label = requireSeed(seeds, '__LABEL__');

	const cleanLead = await detailLead(context, clean.id);
	assert.equal(cleanLead.owner_user_id, context.assignee.id);
	assert.equal(cleanLead.owner_name, context.assignee.fullName);
	assert.equal(cleanLead.enquiry_status, 'Qualified');
	assert.equal(cleanLead.legacy_stage, clean.originalStatus);
	assert.equal(cleanLead.legacy_owner_name, context.assignee.fullName);
	assert.equal(cleanLead.legacy_review_required, false);
	assert.deepEqual(
		cleanLead.ownership_history,
		[],
		'migration writes no history'
	);

	const unknownLead = await detailLead(context, unknownName.id);
	assert.equal(unknownLead.owner_user_id, null);
	assert.equal(unknownLead.enquiry_status, null);
	assert.equal(unknownLead.legacy_stage, unknownName.originalStatus);
	assert.equal(unknownLead.legacy_owner_name, unknownName.originalOwner);
	assert.equal(unknownLead.legacy_review_required, true);
	assert.ok(
		unknownLead.duplicate_candidates !== undefined,
		'legacy detail keeps the duplicate field'
	);

	const duplicateLead = await detailLead(context, duplicateName.id);
	assert.equal(
		duplicateLead.owner_user_id,
		null,
		'duplicate-name evidence stays unassigned'
	);
	assert.equal(duplicateLead.legacy_owner_name, duplicateName.originalOwner);
	assert.equal(
		duplicateLead.enquiry_status,
		null,
		'lowercase stage stays unresolved'
	);
	assert.equal(duplicateLead.legacy_review_required, true);

	const labelLead = await detailLead(context, label.id);
	assert.equal(
		labelLead.enquiry_status,
		null,
		'Converted label never maps to Converted'
	);
	assert.equal(labelLead.legacy_stage, 'Converted to Proposal');
	assert.equal(labelLead.legacy_review_required, true);

	const review = await context.http.get(
		`/api/leads/list?search=${encodeURIComponent(context.runTag)}&review=1&limit=100`,
		context.creator.sessionToken
	);
	assert.equal(review.status, 200, `review list status (body: ${review.text})`);
	const reviewIds = ListEnvelopeSchema.parse(review.json())
		.data.leads.map(parseLeadListRow)
		.map((row) => row.id);
	assert.ok(
		reviewIds.includes(unknownName.id),
		'unknown legacy row appears in review'
	);
	assert.ok(
		reviewIds.includes(duplicateName.id),
		'duplicate-name row appears in review'
	);
	assert.ok(
		reviewIds.includes(label.id),
		'converted-label row appears in review'
	);
	assert.ok(
		!reviewIds.includes(clean.id),
		'clean mapped row leaves the review queue'
	);

	const expectations: Array<{ seed: LegacySeedRow; status: string | null }> = [
		{ seed: clean, status: 'Qualified' },
		{ seed: unknownName, status: null },
		{ seed: duplicateName, status: null },
		{ seed: label, status: null },
	];
	for (const { seed, status } of expectations) {
		const row = await context.reader.leadRow(seed.id);
		assert.ok(row, `legacy row persists for ${seed.company}`);
		assert.equal(row.enquiry_status, status);
		assert.equal(row.legacy_stage, seed.originalStatus);
		assert.equal(row.legacy_owner_name, seed.originalOwner);
	}
}
