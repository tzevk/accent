import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';
import { parseLeadDetail, parseOwnerDirectory } from '../client.ts';

const DetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const OwnersEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: z.string().optional(),
	code: z.string().optional(),
});

async function createLead(
	context: ScenarioContext,
	companyName: string,
	sessionToken: string
): Promise<number> {
	const response = await context.http.post(
		'/api/leads',
		{
			company_name: companyName,
			contact_name: 'Assignment Contact',
			contact_email: 'assignment@example.com',
			phone: '+1-555-0110',
			project_description: `${context.runTag} assignment project need`,
		},
		sessionToken
	);
	assert.equal(response.status, 200, `create status (body: ${response.text})`);
	const body = z
		.object({
			success: z.literal(true),
			data: z.object({ id: z.number() }).passthrough(),
		})
		.parse(response.json());
	context.trackLead(body.data.id);
	return body.data.id;
}

export async function permittedAssignmentScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		`${context.runTag} Assign Co`,
		context.creator.sessionToken
	);

	const owners = await context.http.get(
		'/api/leads/owners',
		context.creator.sessionToken
	);
	assert.equal(owners.status, 200, `owners status (body: ${owners.text})`);
	const directory = parseOwnerDirectory(
		OwnersEnvelopeSchema.parse(owners.json()).data
	);
	assert.ok(
		directory.some(
			(entry) =>
				entry.id === context.assignee.id &&
				entry.full_name === context.assignee.fullName
		),
		'assignee appears in the assignment directory'
	);

	const assigned = await context.http.put(
		`/api/leads/${leadId}`,
		{ owner_user_id: context.assignee.id },
		context.creator.sessionToken
	);
	assert.equal(assigned.status, 200, `assign status (body: ${assigned.text})`);

	const detail = await context.http.get(
		`/api/leads/${leadId}`,
		context.creator.sessionToken
	);
	const lead = parseLeadDetail(DetailEnvelopeSchema.parse(detail.json()).data);
	assert.equal(lead.owner_user_id, context.assignee.id);
	assert.equal(lead.owner_name, context.assignee.fullName);
	assert.ok(lead.ownership_history, 'detail exposes ownership history');
	const changes = lead.ownership_history.filter(
		(entry) =>
			entry.prior_owner_user_id === context.creator.id &&
			entry.owner_user_id === context.assignee.id
	);
	assert.equal(changes.length, 1, 'reassignment appears once in the audit');
	assert.equal(changes[0].actor_user_id, context.creator.id);
	assert.ok(Number.isFinite(Date.parse(changes[0].created_at ?? '')));

	const history = await context.reader.ownershipHistory(leadId);
	const persisted = history.filter(
		(entry) =>
			entry.prior_owner_user_id === context.creator.id &&
			entry.owner_user_id === context.assignee.id
	);
	assert.equal(persisted.length, 1, 'one reassignment persists');
	assert.equal(persisted[0].actor_user_id, context.creator.id);
	assert.equal(persisted[0].created_at, changes[0].created_at);

	const row = await context.reader.leadRow(leadId);
	assert.ok(row);
	assert.equal(row.owner_user_id, context.assignee.id);
}

export async function deniedAssignmentPersistsNothingScenario(
	context: ScenarioContext
): Promise<void> {
	const leadId = await createLead(
		context,
		`${context.runTag} Denied Co`,
		context.creator.sessionToken
	);
	const historyBefore = await context.reader.ownershipHistory(leadId);

	const denied = await context.http.put(
		`/api/leads/${leadId}`,
		{ owner_user_id: context.assignee.id },
		context.noAssign.sessionToken
	);
	assert.equal(
		denied.status,
		403,
		`denied assign status (body: ${denied.text})`
	);
	ErrorEnvelopeSchema.parse(denied.json());

	const row = await context.reader.leadRow(leadId);
	assert.ok(row);
	assert.equal(
		row.owner_user_id,
		context.creator.id,
		'owner unchanged after denial'
	);
	assert.deepEqual(
		await context.reader.ownershipHistory(leadId),
		historyBefore
	);

	const owners = await context.http.get(
		'/api/leads/owners',
		context.noAssign.sessionToken
	);
	assert.equal(
		owners.status,
		403,
		`denied owners status (body: ${owners.text})`
	);

	const anonymous = await context.http.put(`/api/leads/${leadId}`, {
		owner_user_id: context.assignee.id,
	});
	assert.equal(
		anonymous.status,
		401,
		`anonymous assign status (body: ${anonymous.text})`
	);
	assert.equal(
		(await context.reader.leadRow(leadId))?.owner_user_id,
		context.creator.id
	);
	assert.deepEqual(
		await context.reader.ownershipHistory(leadId),
		historyBefore
	);
}
