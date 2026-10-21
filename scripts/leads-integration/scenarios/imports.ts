import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { csvEscape } from '../support.ts';
import type { ScenarioContext } from '../client.ts';
import { parseLeadDetail, parseLeadListRow } from '../client.ts';

const ImportResponseSchema = z.object({
	success: z.literal(true),
	imported: z.number(),
	needs_review: z.number(),
	errors: z.unknown().nullable(),
});

const DetailEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

function buildCsv(rows: Array<Record<string, string>>): string {
	const headers = Object.keys(rows[0] ?? {});
	const lines = [headers.join(',')];
	for (const row of rows) {
		lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','));
	}
	return lines.join('\n');
}

async function importCsv(
	context: ScenarioContext,
	csv: string,
	fileName: string,
	sessionToken: string,
	extra: Record<string, string> = {}
): Promise<z.infer<typeof ImportResponseSchema>> {
	const form = new FormData();
	form.append('file', new File([csv], fileName, { type: 'text/csv' }));
	for (const [key, value] of Object.entries(extra)) form.append(key, value);
	const response = await context.http.post(
		'/api/leads/import',
		form,
		sessionToken
	);
	assert.equal(response.status, 200, `import status (body: ${response.text})`);
	return ImportResponseSchema.parse(response.json());
}

/**
 * The import request: the CSV file and the owner the rows are saved for.
 * The owner is authority, never a name column of the file.
 */
function importForm(
	csv: string,
	fileName: string,
	ownerUserId: number
): FormData {
	const form = new FormData();
	form.append('file', new File([csv], fileName, { type: 'text/csv' }));
	form.append('owner_user_id', String(ownerUserId));
	return form;
}

async function leadIdByCompany(
	context: ScenarioContext,
	companyName: string,
	sessionToken: string
): Promise<number> {
	const response = await context.http.get(
		`/api/leads/list?search=${encodeURIComponent(companyName)}&limit=20`,
		sessionToken
	);
	assert.equal(response.status, 200, `list status (body: ${response.text})`);
	const body = z
		.object({
			success: z.literal(true),
			data: z.object({ leads: z.array(z.unknown()) }),
		})
		.parse(response.json());
	const rows = body.data.leads.map(parseLeadListRow);
	const match = rows.find((row) => row.company_name === companyName);
	assert.ok(match, `imported lead visible for ${companyName}`);
	context.trackLead(match.id);
	return match.id;
}

export async function unassignedImportScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Intake Co`;
	const csv = buildCsv([
		{
			Company: companyName,
			'Contact Name': 'Intake Contact',
			Email: 'intake@example.com',
			Phone: '+1-555-0101',
			'Project Description': `${context.runTag} intake project need`,
			Status: 'Totally Unknown Legacy Stage',
		},
	]);
	const result = await importCsv(
		context,
		csv,
		`${context.runTag}-intake.csv`,
		context.creator.sessionToken
	);
	assert.equal(result.imported, 1);
	assert.equal(result.needs_review, 1);

	const leadId = await leadIdByCompany(
		context,
		companyName,
		context.creator.sessionToken
	);
	const detail = await context.http.get(
		`/api/leads/${leadId}`,
		context.creator.sessionToken
	);
	const lead = parseLeadDetail(DetailEnvelopeSchema.parse(detail.json()).data);
	assert.equal(lead.owner_user_id, null);
	assert.equal(lead.owner_name, null);
	assert.equal(lead.enquiry_status, null);
	assert.equal(lead.legacy_stage, 'Totally Unknown Legacy Stage');
	assert.equal(lead.legacy_review_required, true);

	const row = await context.reader.leadRow(leadId);
	assert.ok(row, 'imported lead persists');
	assert.equal(row.owner_user_id, null);
	assert.equal(row.enquiry_status, null);
	assert.equal(row.legacy_stage, 'Totally Unknown Legacy Stage');
	assert.equal(Number(row.legacy_review_required), 1);
}

export async function ownerSelectedImportScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Assigned Co`;
	const csv = buildCsv([
		{
			Company: companyName,
			'Contact Name': 'Assigned Contact',
			Email: 'assigned@example.com',
			Phone: '+1-555-0102',
			'Project Description': `${context.runTag} assigned project need`,
			Status: 'New',
		},
	]);
	const result = await importCsv(
		context,
		csv,
		`${context.runTag}-assigned.csv`,
		context.creator.sessionToken,
		{
			owner_user_id: String(context.assignee.id),
		}
	);
	assert.equal(result.imported, 1);
	assert.equal(result.needs_review, 0);

	const leadId = await leadIdByCompany(
		context,
		companyName,
		context.creator.sessionToken
	);
	const lead = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${leadId}`,
					context.creator.sessionToken
				)
			).json()
		).data
	);
	assert.equal(lead.owner_user_id, context.assignee.id);
	assert.equal(lead.owner_name, context.assignee.fullName);
	assert.equal(lead.enquiry_status, 'New');
	assert.equal(lead.legacy_review_required, false);

	const row = await context.reader.leadRow(leadId);
	assert.ok(row);
	assert.equal(row.owner_user_id, context.assignee.id);
	assert.equal(row.enquiry_status, 'New');
}

export async function importOwnerEvidenceNeverResolvesScenario(
	context: ScenarioContext
): Promise<void> {
	// A CSV owner/assignee column is legacy evidence only: it must never
	// resolve to a user on its own, even when it names a real user exactly.
	const companyName = `${context.runTag} Evidence Co`;
	const csv = buildCsv([
		{
			Company: companyName,
			'Contact Name': 'Evidence Contact',
			Email: 'evidence@example.com',
			Phone: '+1-555-0103',
			'Project Description': `${context.runTag} evidence project need`,
			Status: 'New',
			'Assigned To': context.assignee.fullName,
		},
	]);
	const result = await importCsv(
		context,
		csv,
		`${context.runTag}-evidence.csv`,
		context.creator.sessionToken
	);
	assert.equal(result.imported, 1);

	const leadId = await leadIdByCompany(
		context,
		companyName,
		context.creator.sessionToken
	);
	const lead = parseLeadDetail(
		DetailEnvelopeSchema.parse(
			(
				await context.http.get(
					`/api/leads/${leadId}`,
					context.creator.sessionToken
				)
			).json()
		).data
	);
	assert.equal(lead.owner_user_id, null);
	assert.equal(lead.legacy_owner_name, context.assignee.fullName);
	assert.equal(lead.legacy_review_required, true);

	const row = await context.reader.leadRow(leadId);
	assert.ok(row);
	assert.equal(row.owner_user_id, null);
	assert.equal(row.legacy_owner_name, context.assignee.fullName);
}

export async function rawImportEvidenceScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Raw Evidence Co`;
	const rawStage = `  ${'Unmapped status '.repeat(12)}  `;
	const rawOwner = `  ${'Unknown owner '.repeat(12)}  `;
	const result = await importCsv(
		context,
		buildCsv([
			{
				Company: companyName,
				'Project Description': `${context.runTag} raw evidence need`,
				Status: rawStage,
				'Assigned To': rawOwner,
			},
		]),
		`${context.runTag}-raw.csv`,
		context.creator.sessionToken
	);
	assert.equal(result.imported, 1);
	assert.equal(result.needs_review, 1);
	const id = await leadIdByCompany(
		context,
		companyName,
		context.creator.sessionToken
	);
	const response = await context.http.get(
		`/api/leads/${id}`,
		context.creator.sessionToken
	);
	const lead = parseLeadDetail(
		DetailEnvelopeSchema.parse(response.json()).data
	);
	assert.equal(
		lead.legacy_stage,
		rawStage,
		'HTTP retains whitespace and long stage evidence'
	);
	assert.equal(
		lead.legacy_owner_name,
		rawOwner,
		'HTTP retains the original owner evidence'
	);
	const row = await context.reader.leadRow(id);
	assert.ok(row);
	assert.equal(
		row.legacy_stage,
		rawStage,
		'database retains the full raw stage'
	);
	assert.equal(
		row.legacy_owner_name,
		rawOwner,
		'database retains the full raw owner'
	);
}

export async function invalidImportOwnerScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Invalid Owner Co`;
	const form = new FormData();
	form.append(
		'file',
		new File(
			[
				buildCsv([
					{
						Company: companyName,
						Status: 'New',
					},
				]),
			],
			'invalid-owner.csv',
			{ type: 'text/csv' }
		)
	);
	form.append('owner_user_id', `${context.assignee.id}garbage`);
	const response = await context.http.post(
		'/api/leads/import',
		form,
		context.creator.sessionToken
	);
	assert.equal(
		response.status,
		400,
		`invalid owner refuses the entire import: ${response.text}`
	);
	assert.equal(await context.reader.countLeadsByCompany(companyName), 0);
}

export async function activeImportRequirementsScenario(
	context: ScenarioContext
): Promise<void> {
	const companyName = `${context.runTag} Active Intake Co`;
	const form = new FormData();
	form.append(
		'file',
		new File(
			[
				buildCsv([
					{
						Company: companyName,
						Status: 'Qualified',
						'Project Description': `${context.runTag} needs an owner and next action`,
					},
				]),
			],
			'active-intake.csv',
			{ type: 'text/csv' }
		)
	);
	const response = await context.http.post(
		'/api/leads/import',
		form,
		context.creator.sessionToken
	);
	assert.equal(
		response.status,
		400,
		`active intake without its required owner must fail: ${response.text}`
	);
	assert.equal(await context.reader.countLeadsByCompany(companyName), 0);
}

/**
 * A CSV row that asks for a stage which depends on the qualification has to
 * carry the same contact and project-need evidence the explicit decision
 * needs. A row without it is a row error, never a saved Lead.
 */
export async function importRowNeedsTheDecisionEvidenceScenario(
	context: ScenarioContext
): Promise<void> {
	const refusedCompany = `${context.runTag} Import Qualified Co`;
	const refused = await context.http.post(
		'/api/leads/import',
		importForm(
			buildCsv([
				{
					Company: refusedCompany,
					'Contact Name': '',
					Email: 'import@example.com',
					'Project Description': `${context.runTag} import need`,
					Status: 'Qualified',
					'Next follow-up date': '2026-12-01',
				},
			]),
			'import-qualified.csv',
			context.assignee.id
		),
		context.creator.sessionToken
	);
	assert.equal(
		refused.status,
		400,
		`a row without the evidence must fail: ${refused.text}`
	);
	const refusedBody = z
		.object({
			success: z.literal(false),
			error: z.string(),
			errors: z.array(z.string()).nullable(),
		})
		.parse(refused.json());
	assert.match(
		(refusedBody.errors ?? []).join(' | '),
		/named contact/,
		'the row error names the missing evidence'
	);
	assert.equal(
		await context.reader.countLeadsByCompany(refusedCompany),
		0,
		'a refused row saves no lead'
	);

	// The same row with the evidence is a Lead.
	const acceptedCompany = `${context.runTag} Import Evidenced Co`;
	const accepted = await context.http.post(
		'/api/leads/import',
		importForm(
			buildCsv([
				{
					Company: acceptedCompany,
					'Contact Name': 'Imported Contact',
					Email: 'import@example.com',
					'Project Description': `${context.runTag} import need`,
					Status: 'Qualified',
					'Next follow-up date': '2026-12-01',
				},
			]),
			'import-evidenced.csv',
			context.assignee.id
		),
		context.creator.sessionToken
	);
	assert.equal(accepted.status, 200, `import body: ${accepted.text}`);
	const acceptedBody = ImportResponseSchema.parse(accepted.json());
	assert.equal(acceptedBody.imported, 1);
	const leadId = await leadIdByCompany(
		context,
		acceptedCompany,
		context.creator.sessionToken
	);
	const row = await context.reader.leadRow(leadId);
	assert.ok(row, 'the imported lead persists');
	assert.equal(row.enquiry_status, 'Qualified');
	assert.equal(row.owner_user_id, context.assignee.id);
}
