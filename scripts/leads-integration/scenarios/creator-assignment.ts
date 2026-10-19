// Red-first HTTP scenario: manual creation defaults its owner to the
// authenticated creator and starts at New (issue #369, acceptance 1).
// Saved before the backend slice lands so the first run must fail on the
// old implementation (owner_user_id missing vs creator id).
import { strict as assert } from 'node:assert';
import type { ScenarioContext } from '../client.ts';
import { z } from 'zod';
import { parseLeadDetail } from '../client.ts';

const CreateResponseSchema = z.object({
	success: z.literal(true),
	data: z.object({ id: z.number() }).passthrough(),
});

export async function creatorAssignmentScenario(
	context: ScenarioContext
): Promise<void> {
	const runTag = context.runTag;
	const companyName = `${runTag} Creator Co`;
	const projectDescription = `${runTag} creator project need`;

	const created = await context.http.post(
		'/api/leads',
		{
			company_name: companyName,
			contact_name: 'Creator Contact',
			contact_email: 'creator@example.com',
			phone: '+1-555-0100',
			project_description: projectDescription,
		},
		context.creator.sessionToken
	);
	assert.equal(
		created.status,
		200,
		`create lead status (body: ${created.text})`
	);
	const createdData = CreateResponseSchema.parse(created.json()).data;
	context.trackLead(createdData.id);

	const detail = await context.http.get(
		`/api/leads/${createdData.id}`,
		context.creator.sessionToken
	);
	assert.equal(detail.status, 200, `detail status (body: ${detail.text})`);
	const detailBody = z
		.object({ success: z.literal(true), data: z.unknown() })
		.parse(detail.json());
	const lead = parseLeadDetail(detailBody.data);
	assert.equal(lead.owner_user_id, context.creator.id);
	assert.equal(lead.owner_name, context.creator.fullName);
	assert.equal(lead.enquiry_status, 'New');
	assert.equal(lead.company_name, companyName);
	assert.equal(lead.project_description, projectDescription);

	const row = await context.reader.leadRow(createdData.id);
	assert.ok(row, 'created lead persists');
	assert.equal(
		row.owner_user_id,
		context.creator.id,
		'persisted owner matches creator'
	);
	assert.equal(row.enquiry_status, 'New');
	assert.equal(row.company_name, companyName);
}
