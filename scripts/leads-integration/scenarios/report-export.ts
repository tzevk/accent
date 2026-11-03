import { strict as assert } from 'node:assert';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { hashFixturePassword } from '../support.ts';
import type { ScenarioContext } from '../client.ts';

// The Lead Audit complete Excel export (#405). The workbook is proved through
// the authenticated download operation only: independently seeded Leads,
// activities, decisions, corrections, and handoffs carry explicit times, and
// every expected figure below is derived from those known values rather than
// from the report's own aggregates or SQL. Both the default and the detailed
// workbooks are parsed cell by cell.

const PERIOD_FROM = '2026-08-01';
const PERIOD_TO = '2026-08-31';
const FIXTURE_PASSWORD = 'Lit369-pass!';
const XLSX_TYPE =
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PaginationSchema = z
	.object({
		pagination: z
			.object({
				total: z.number(),
				page: z.number(),
				limit: z.number(),
			})
			.passthrough(),
	})
	.passthrough();

const RegisterEnvelopeSchema = z.object({
	success: z.literal(true),
	data: PaginationSchema.extend({
		leads: z.array(z.object({ company_name: z.string() }).passthrough()),
	}),
});

const WorkEvidenceEnvelopeSchema = z.object({
	success: z.literal(true),
	data: PaginationSchema.extend({
		activities: z.array(z.object({ id: z.number() }).passthrough()),
	}),
});

const AuditEnvelopeSchema = z.object({
	success: z.literal(true),
	data: PaginationSchema.extend({
		evidence: z.array(z.object({ reference: z.string() }).passthrough()),
	}),
});

const ErrorEnvelopeSchema = z
	.object({ success: z.literal(false), error: z.string(), code: z.string() })
	.passthrough();

const RefusalEnvelopeSchema = z
	.object({ success: z.literal(false), error: z.string() })
	.passthrough();

function searchParams(extra: Record<string, string>): string {
	const params = new URLSearchParams({
		from_date: PERIOD_FROM,
		to_date: PERIOD_TO,
		...extra,
	});
	return params.toString();
}

function cellText(cell: ExcelJS.Cell): string {
	const value = cell.value;
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (typeof value === 'object') {
		const rich = value as {
			richText?: Array<{ text: string }>;
			text?: string;
			result?: unknown;
		};
		if (Array.isArray(rich.richText)) {
			return rich.richText.map((part) => part.text).join('');
		}
		if (typeof rich.text === 'string') return rich.text;
		if ('result' in rich) return String(rich.result ?? '');
	}
	return '';
}

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(Buffer.from(bytes));
	return workbook;
}

function workbookSheet(
	workbook: ExcelJS.Workbook,
	name: string
): ExcelJS.Worksheet {
	const sheet = workbook.getWorksheet(name);
	assert.ok(sheet, `workbook sheet ${name} exists`);
	return sheet as ExcelJS.Worksheet;
}

function sheetStrings(sheet: ExcelJS.Worksheet): string[] {
	const values: string[] = [];
	sheet.eachRow({ includeEmpty: false }, (row) => {
		row.eachCell({ includeEmpty: false }, (cell) => {
			const text = cellText(cell);
			if (text !== '') values.push(text);
		});
	});
	return values;
}

function workbookStrings(workbook: ExcelJS.Workbook): string[] {
	return workbook.worksheets.flatMap((sheet) => sheetStrings(sheet));
}

/** The non-empty rows after the first row whose first cell is `header`. */
function rowsAfterHeader(
	sheet: ExcelJS.Worksheet,
	header: string
): ExcelJS.Row[] {
	const rows: ExcelJS.Row[] = [];
	let started = false;
	for (let number = 1; number <= sheet.rowCount; number += 1) {
		const row = sheet.getRow(number);
		const first = cellText(row.getCell(1));
		if (!started) {
			if (first === header) started = true;
			continue;
		}
		let hasContent = false;
		row.eachCell({ includeEmpty: false }, () => {
			hasContent = true;
		});
		if (hasContent) rows.push(row);
	}
	return rows;
}

/** A heading table: heading row, header row, then rows until a blank row. */
function tableRows(
	sheet: ExcelJS.Worksheet,
	heading: string
): Array<Array<string>> {
	let headerRow = -1;
	for (let number = 1; number <= sheet.rowCount; number += 1) {
		if (cellText(sheet.getRow(number).getCell(1)) === heading) {
			headerRow = number + 1;
			break;
		}
	}
	if (headerRow === -1) return [];
	const rows: Array<Array<string>> = [];
	for (let number = headerRow + 1; number <= sheet.rowCount; number += 1) {
		const row = sheet.getRow(number);
		if (cellText(row.getCell(1)) === '') break;
		rows.push(
			Array.from({ length: 6 }, (_unused, index) =>
				cellText(row.getCell(index + 1))
			)
		);
	}
	return rows;
}

function tableValues(
	sheet: ExcelJS.Worksheet,
	heading: string
): Map<string, string> {
	const values = new Map<string, string>();
	for (const row of tableRows(sheet, heading)) {
		values.set(row[0], row[1]);
	}
	return values;
}

function rowByFirstCell(
	sheet: ExcelJS.Worksheet,
	firstCell: string
): ExcelJS.Row | null {
	for (let number = 1; number <= sheet.rowCount; number += 1) {
		const row = sheet.getRow(number);
		if (cellText(row.getCell(1)) === firstCell) return row;
	}
	return null;
}

function assertContains(
	workbook: ExcelJS.Workbook,
	text: string,
	message: string
): void {
	assert.ok(workbookStrings(workbook).includes(text), message);
}

function assertAbsentFragment(
	workbook: ExcelJS.Workbook,
	fragment: string,
	message: string
): void {
	const hit = workbookStrings(workbook).some((value) =>
		value.includes(fragment)
	);
	assert.equal(hit, false, message);
}

async function seedUser(
	context: ScenarioContext,
	key: string,
	permissions: string[]
): Promise<string> {
	const username = `${context.runTag}-${key}`
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
			`${context.runTag} ${key}`,
			JSON.stringify(permissions),
		]
	);
	const login = await context.http.login(
		username,
		FIXTURE_PASSWORD,
		key === 'exportreader' ? '127.0.0.61' : '127.0.0.62'
	);
	return login.sessionToken;
}

async function insertActivity(
	context: ScenarioContext,
	leadId: number,
	input: {
		recordedAt: string;
		occurredAt: string;
		actorId: number | null;
		activityType: string;
		status: string;
		callOutcome?: string | null;
		replyConfirmed?: number | null;
		notes?: string | null;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_activities (
      lead_id, activity_type, status, call_outcome, reply_confirmed,
      scheduled_for, occurred_at, next_action, notes, created_by,
      recorded_at, created_at, updated_at, isDelete
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, 0)`,
		[
			leadId,
			input.activityType,
			input.status,
			input.callOutcome ?? null,
			input.replyConfirmed ?? null,
			input.occurredAt,
			input.notes ?? null,
			input.actorId,
			input.recordedAt,
			input.recordedAt,
			input.recordedAt,
		]
	);
	return result.insertId;
}

async function insertStage(
	context: ScenarioContext,
	leadId: number,
	input: {
		recordedAt: string;
		from: string;
		to: string;
		reason: string;
		actorId: number;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_stage_history (
      lead_id, from_stage, to_stage, change_source, reason,
      actor_user_id, recorded_at, created_at
    ) VALUES (?, ?, ?, 'lead_update', ?, ?, ?, ?)`,
		[
			leadId,
			input.from,
			input.to,
			input.reason,
			input.actorId,
			input.recordedAt,
			input.recordedAt,
		]
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
		actorId: number;
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

async function insertProposal(
	context: ScenarioContext,
	input: {
		title: string;
		status: string;
		progress: number;
		leadId: number;
	}
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO proposals (
       proposal_title, status, progress, lead_id, canonical_lead_id,
       isDelete, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, '2026-08-14 09:00:00', '2026-08-14 09:00:00')`,
		[input.title, input.status, input.progress, input.leadId, input.leadId]
	);
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
     ) VALUES (?, ?, ?, ?, 0, '2026-08-14 09:00:00', '2026-08-14 09:00:00')`,
		[input.title, input.status, input.progress, input.proposalId]
	);
	return result.insertId;
}

async function insertConversion(
	context: ScenarioContext,
	input: { leadId: number; proposalId: number; convertedAt: string }
): Promise<number> {
	const result = await context.reader.fixtureWrite(
		`INSERT INTO lead_conversions (
       lead_id, proposal_id, converted_by, converted_at, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
		[
			input.leadId,
			input.proposalId,
			context.creator.id,
			input.convertedAt,
			input.convertedAt,
		]
	);
	return result.insertId;
}

async function sourceSnapshot(
	context: ScenarioContext,
	leadIds: number[]
): Promise<Record<string, Array<Record<string, unknown>>>> {
	const placeholders = leadIds.map(() => '?').join(', ');
	const snapshot: Record<string, Array<Record<string, unknown>>> = {};
	for (const table of [
		'lead_activities',
		'lead_stage_history',
		'lead_activity_corrections',
		'lead_conversions',
	]) {
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

export async function leadAuditExportScenario(
	context: ScenarioContext
): Promise<void> {
	const exportToken = await seedUser(context, 'exportreader', [
		'leads:read',
		'reports:read',
		'reports:export',
	]);
	const privilegedToken = await seedUser(context, 'exportpriv', [
		'leads:read',
		'reports:read',
		'reports:export',
		'proposals:read',
		'projects:read',
	]);

	const marker = `${context.runTag}-EXP405`;
	const search = marker;
	const proposalTitle = `${marker} Proposal`;
	const projectTitle = `${marker} Project`;
	const deltaProposalTitle = `${marker} Delta Proposal`;

	// ── Independent fixtures with explicit entry and occurrence times ─────
	const leadA = await context.reader.seedReportLead({
		companyName: `${marker} Alpha`,
		recordedAt: '2026-08-05 09:00:00',
		enquiryDate: '2026-08-04',
		source: 'Website',
		stage: 'Qualified',
		ownerUserId: context.creator.id,
	});
	// Formula-like user text must stay a text cell in every workbook.
	const leadB = await context.reader.seedReportLead({
		companyName: `=1+1 ${marker} Beta`,
		recordedAt: '2026-08-06 09:00:00',
		enquiryDate: null,
		source: null,
		stage: 'Attempting Contact',
		ownerUserId: context.assignee.id,
	});
	const leadC = await context.reader.seedReportLead({
		companyName: `${marker} Gamma`,
		recordedAt: '2026-08-07 09:00:00',
		enquiryDate: '2026-08-07',
		source: 'Event',
		stage: 'Converted',
		ownerUserId: null,
	});
	// Recorded before the period: period work on an older Lead never increases
	// period intake, while its dated handoff still counts in the period.
	const leadD = await context.reader.seedReportLead({
		companyName: `${marker} Delta`,
		recordedAt: '2026-07-20 09:00:00',
		enquiryDate: null,
		source: 'Website',
		stage: 'Converted',
		ownerUserId: context.creator.id,
	});
	const deletedLead = await context.reader.seedReportLead({
		companyName: `${marker} Deleted`,
		recordedAt: '2026-08-10 09:00:00',
		enquiryDate: null,
		source: 'Event',
		stage: 'Connected',
		ownerUserId: context.assignee.id,
		isDeleted: true,
	});

	const activityA1 = await insertActivity(context, leadA, {
		recordedAt: '2026-08-08 10:00:00',
		occurredAt: '2026-08-08 09:00:00',
		actorId: context.creator.id,
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		notes: 'Alpha confidential note =2+2',
	});
	await insertActivity(context, leadB, {
		recordedAt: '2026-08-09 10:00:00',
		occurredAt: '2026-08-09 09:00:00',
		actorId: null,
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'No Answer',
	});
	const activityA3 = await insertActivity(context, leadC, {
		recordedAt: '2026-08-10 10:00:00',
		occurredAt: '2026-08-10 09:00:00',
		actorId: context.assignee.id,
		activityType: 'Email',
		status: 'Completed',
		replyConfirmed: 0,
	});
	await insertActivity(context, leadD, {
		recordedAt: '2026-08-11 10:00:00',
		occurredAt: '2026-08-11 09:00:00',
		actorId: context.creator.id,
		activityType: 'Note',
		status: 'Completed',
		notes: 'Older lead note',
	});
	await insertActivity(context, deletedLead, {
		recordedAt: '2026-08-12 10:00:00',
		occurredAt: '2026-08-12 09:00:00',
		actorId: context.creator.id,
		activityType: 'Call',
		status: 'Completed',
		callOutcome: 'Connected',
		notes: 'Deleted record note',
	});

	await insertStage(context, leadA, {
		recordedAt: '2026-08-21 09:00:00',
		from: 'New',
		to: 'Qualified',
		reason: 'Qualified after call',
		actorId: context.creator.id,
	});
	await insertCorrection(context, leadC, activityA3, {
		recordedAt: '2026-08-20 09:00:00',
		previous: { reply_confirmed: null, notes: 'Original reply note' },
		corrected: {
			reply_confirmed: 0,
			notes: 'Corrected reply note =1+1',
		},
		reason: '=SUM(A1) reply flag corrected',
		actorId: context.creator.id,
	});

	const proposal = await insertProposal(context, {
		title: proposalTitle,
		status: 'DRAFT',
		progress: 40,
		leadId: leadC,
	});
	const project = await insertProject(context, {
		title: projectTitle,
		status: 'ONGOING',
		progress: 10,
		proposalId: proposal,
	});
	await context.reader.fixtureWrite(
		'UPDATE proposals SET project_id = ? WHERE id = ?',
		[project, proposal]
	);
	const deltaProposal = await insertProposal(context, {
		title: deltaProposalTitle,
		status: 'SENT',
		progress: 20,
		leadId: leadD,
	});
	await insertConversion(context, {
		leadId: leadC,
		proposalId: proposal,
		convertedAt: '2026-08-15 12:00:00',
	});
	await insertConversion(context, {
		leadId: leadD,
		proposalId: deltaProposal,
		convertedAt: '2026-08-16 12:00:00',
	});

	const leadIds = [leadA, leadB, leadC, leadD, deletedLead];
	const before = await sourceSnapshot(context, leadIds);

	// ── Paginated endpoints: the export is not limited to one page ────────
	const registerPageOne = RegisterEnvelopeSchema.parse(
		(
			await context.http.get(
				`/api/reports/lead-audit/register?${searchParams({
					metric: 'recorded',
					search,
					page: '1',
					limit: '2',
				})}`,
				context.reportReader.sessionToken
			)
		).json()
	);
	const registerPageTwo = RegisterEnvelopeSchema.parse(
		(
			await context.http.get(
				`/api/reports/lead-audit/register?${searchParams({
					metric: 'recorded',
					search,
					page: '2',
					limit: '2',
				})}`,
				context.reportReader.sessionToken
			)
		).json()
	);
	assert.equal(registerPageOne.data.pagination.total, 3);
	assert.equal(registerPageOne.data.leads.length, 2);
	assert.equal(registerPageTwo.data.leads.length, 1);

	const workPageOne = WorkEvidenceEnvelopeSchema.parse(
		(
			await context.http.get(
				`/api/reports/lead-audit/work/evidence?${searchParams({
					metric: 'completed',
					search,
					page: '1',
					limit: '2',
				})}`,
				context.reportReader.sessionToken
			)
		).json()
	);
	const workPageTwo = WorkEvidenceEnvelopeSchema.parse(
		(
			await context.http.get(
				`/api/reports/lead-audit/work/evidence?${searchParams({
					metric: 'completed',
					search,
					page: '2',
					limit: '2',
				})}`,
				context.reportReader.sessionToken
			)
		).json()
	);
	assert.equal(workPageOne.data.pagination.total, 4);
	assert.equal(
		workPageOne.data.activities.length + workPageTwo.data.activities.length,
		4
	);

	const auditPageOne = AuditEnvelopeSchema.parse(
		(
			await context.http.get(
				`/api/reports/lead-audit/audit?${searchParams({
					search,
					page: '1',
					limit: '2',
				})}`,
				context.reportReader.sessionToken
			)
		).json()
	);
	const auditPageTwo = AuditEnvelopeSchema.parse(
		(
			await context.http.get(
				`/api/reports/lead-audit/audit?${searchParams({
					search,
					page: '2',
					limit: '2',
				})}`,
				context.reportReader.sessionToken
			)
		).json()
	);
	assert.equal(auditPageOne.data.pagination.total, 8);

	// ── Authorization: view permission is not export permission ───────────
	const downloadPath = (extra: Record<string, string> = {}): string =>
		`/api/reports/lead-audit/download?${searchParams({ search, ...extra })}`;

	const refusedGet = await context.http.get(
		downloadPath(),
		context.reportReader.sessionToken
	);
	assert.equal(refusedGet.status, 403);
	assert.match(
		RefusalEnvelopeSchema.parse(refusedGet.json()).error,
		/reports:export/,
		'the refusal names the missing export grant'
	);
	assert.equal((await context.http.get(downloadPath())).status, 401);

	const invalid = await context.http.get(
		`/api/reports/lead-audit/download?${searchParams({
			search,
			from_date: PERIOD_TO,
			to_date: PERIOD_FROM,
		})}`,
		exportToken
	);
	assert.equal(invalid.status, 422);
	assert.equal(ErrorEnvelopeSchema.parse(invalid.json()).code, 'invalid_range');

	// ── Default workbook: complete detail, no narrative ──────────────────
	const defaultDownload = await context.http.download(
		downloadPath(),
		exportToken
	);
	assert.equal(defaultDownload.status, 200);
	assert.match(defaultDownload.contentType ?? '', /spreadsheetml\.sheet/);
	assert.match(defaultDownload.contentDisposition ?? '', /attachment/);
	assert.match(defaultDownload.contentDisposition ?? '', /\.xlsx/);
	const defaultWorkbook = await loadWorkbook(defaultDownload.bytes);

	const defaultRegister = rowsAfterHeader(
		workbookSheet(defaultWorkbook, 'Lead intake register'),
		'Lead reference'
	);
	assert.equal(defaultRegister.length, 3);
	const registeredCompanies = defaultRegister.map((row) =>
		cellText(row.getCell(3))
	);
	assert.deepEqual(
		registeredCompanies.sort(),
		[`=1+1 ${marker} Beta`, `${marker} Alpha`, `${marker} Gamma`].sort()
	);

	// The exported register must cover every page of the paginated read.
	for (const page of [registerPageOne, registerPageTwo]) {
		for (const lead of page.data.leads) {
			assert.ok(
				workbookStrings(defaultWorkbook).includes(lead.company_name),
				`export contains paginated register row ${lead.company_name}`
			);
		}
	}

	const defaultWorkRows = rowsAfterHeader(
		workbookSheet(defaultWorkbook, 'Completed work'),
		'Activity'
	);
	assert.equal(defaultWorkRows.length, 4);
	const exportedActivityIds = defaultWorkRows.map((row) =>
		Number(cellText(row.getCell(1)))
	);
	for (const page of [workPageOne, workPageTwo]) {
		for (const activity of page.data.activities) {
			assert.ok(
				exportedActivityIds.includes(activity.id),
				`export contains paginated activity ${activity.id}`
			);
		}
	}

	const defaultAuditRows = rowsAfterHeader(
		workbookSheet(defaultWorkbook, 'Audit evidence'),
		'Evidence type'
	);
	assert.equal(defaultAuditRows.length, auditPageOne.data.pagination.total);
	for (const page of [auditPageOne, auditPageTwo]) {
		for (const evidence of page.data.evidence) {
			assert.ok(
				workbookStrings(defaultWorkbook).includes(evidence.reference),
				`export contains paginated evidence ${evidence.reference}`
			);
		}
	}

	const defaultDeletedRows = rowsAfterHeader(
		workbookSheet(defaultWorkbook, 'Deleted evidence'),
		'Deleted record'
	);
	assert.equal(defaultDeletedRows.length, 1);
	assertContains(
		defaultWorkbook,
		`${marker} Deleted`,
		'retained deleted evidence is separately exported'
	);

	// Literal figures, independently derived from the fixtures.
	const summarySheet = workbookSheet(
		defaultWorkbook,
		'Summary and methodology'
	);
	const figures = tableValues(summarySheet, 'Figures at this observation');
	assert.equal(figures.get('Leads recorded'), '3');
	assert.equal(figures.get('Enquiries dated in period'), '2');
	assert.equal(figures.get('Missing Enquiry Dates'), '1');
	assert.equal(figures.get('Completed work'), '4');
	assert.equal(figures.get('Completed calls'), '2');
	assert.equal(figures.get('Completed emails'), '1');
	assert.equal(figures.get('Completed notes'), '1');
	assert.equal(figures.get('Lead Outreach'), '3');
	assert.equal(figures.get('Distinct Leads worked'), '4');
	assert.equal(figures.get('Distinct Leads with outreach'), '3');
	assert.equal(figures.get('Successful contact'), '1');
	assert.equal(figures.get('Lead Intake Cohort'), '3');
	assert.equal(figures.get('Handoffs evidenced'), '1');
	assert.equal(figures.get('Lead Cohort Conversion Rate'), '33.33%');
	assert.equal(figures.get('Period handoffs (dated)'), '2');
	assert.equal(figures.get('Median seconds'), '259200');
	assert.equal(figures.get('90th percentile seconds'), '259200');
	assert.equal(figures.get('Valid timing samples'), '3');
	assert.equal(figures.get('Audit evidence in period'), '8');
	assert.equal(figures.get('Undated canonical links (period)'), '0');

	// Every section summary reconciles with its own detail rows.
	const reconciliation = tableRows(
		summarySheet,
		'Reconciliation with detail rows'
	);
	assert.ok(reconciliation.length >= 15, 'reconciliation covers every section');
	for (const row of reconciliation) {
		assert.equal(row[4], 'Yes', `reconciled: ${row[0]} — ${row[1]}`);
	}
	const completedCheck = reconciliation.find(
		(row) => row[1] === 'Completed work vs completed activity rows'
	);
	assert.deepEqual(completedCheck?.slice(2, 4), ['4', '4']);

	// Unknown facts keep their meaning rather than becoming empty or zero.
	const registerB = defaultRegister.find(
		(row) => cellText(row.getCell(3)) === `=1+1 ${marker} Beta`
	);
	assert.ok(registerB, 'the unknown-source Lead is registered');
	assert.equal(cellText(registerB.getCell(5)), 'Unknown source');
	assert.equal(cellText(registerB.getCell(9)), 'Unknown');

	const workB = defaultWorkRows.find((row) =>
		cellText(row.getCell(3)) === `=1+1 ${marker} Beta`
	);
	assert.ok(workB, 'the unknown-author activity is exported');
	assert.equal(cellText(workB.getCell(11)), 'Unknown author');
	assert.equal(cellText(workB.getCell(12)), 'Unknown author');

	const coverageSheet = workbookSheet(defaultWorkbook, 'Coverage and exclusions');
	const missingSource = rowByFirstCell(coverageSheet, 'missing_source');
	assert.ok(missingSource, 'coverage reports the missing source fact');
	assert.equal(cellText(missingSource.getCell(3)), '1');
	const unknownAuthor = rowByFirstCell(
		coverageSheet,
		'unknown_activity_author'
	);
	assert.ok(unknownAuthor, 'coverage reports the unknown author fact');
	assert.equal(cellText(unknownAuthor.getCell(3)), '1');

	// Formula-like user text is a text cell, never an executable formula.
	const formulaCell = registerB.getCell(3);
	assert.equal(typeof formulaCell.value, 'string');
	assert.equal(formulaCell.formula, undefined);
	assert.equal(cellText(formulaCell), `=1+1 ${marker} Beta`);

	// Restricted downstream context is labelled, never blank or disclosed.
	assertAbsentFragment(
		defaultWorkbook,
		proposalTitle,
		'restricted Proposal title is absent from the workbook'
	);
	assertAbsentFragment(
		defaultWorkbook,
		projectTitle,
		'restricted Project title is absent from the workbook'
	);
	assertAbsentFragment(
		defaultWorkbook,
		deltaProposalTitle,
		'restricted period-handoff Proposal title is absent'
	);
	assertContains(
		defaultWorkbook,
		'Restricted',
		'restricted downstream context is stated as Restricted'
	);
	const downstreamSheet = workbookSheet(defaultWorkbook, 'Downstream context');
	const restrictedRow = rowsAfterHeader(downstreamSheet, 'Lead reference').find(
		(row) => cellText(row.getCell(2)) === `${marker} Gamma`
	);
	assert.ok(restrictedRow, 'the cohort handoff has a downstream row');
	assert.equal(cellText(restrictedRow.getCell(5)), 'Restricted');
	assert.equal(cellText(restrictedRow.getCell(6)), '');
	assert.equal(cellText(restrictedRow.getCell(7)), '');
	assert.equal(
		cellText(restrictedRow.getCell(10)),
		'Restricted',
		'a denied Project stays Restricted rather than implying none'
	);
	assert.equal(cellText(restrictedRow.getCell(11)), '');
	assert.equal(cellText(restrictedRow.getCell(12)), '');

	// ── Default export carries no narrative anywhere ─────────────────────
	const narrativeFragments = [
		'Alpha confidential note',
		'Original reply note',
		'Corrected reply note',
		'=SUM(A1) reply flag corrected',
		'Qualified after call',
		'Older lead note',
		'Deleted record note',
	];
	for (const fragment of narrativeFragments) {
		assertAbsentFragment(
			defaultWorkbook,
			fragment,
			`default export withholds narrative: ${fragment}`
		);
	}

	// Detailed evidence is opt-in and uses the same export grant.
	const offDownload = await context.http.download(
		downloadPath({ include_narrative: '0' }),
		privilegedToken
	);
	assert.equal(offDownload.status, 200);
	const offWorkbook = await loadWorkbook(offDownload.bytes);
	assertAbsentFragment(
		offWorkbook,
		'Alpha confidential note',
		'an explicit off choice withholds narrative'
	);

	const detailedDownload = await context.http.download(
		downloadPath({ include_narrative: '1' }),
		privilegedToken
	);
	assert.equal(detailedDownload.status, 200);
	const detailedWorkbook = await loadWorkbook(detailedDownload.bytes);
	for (const fragment of narrativeFragments) {
		assertContains(
			detailedWorkbook,
			fragment,
			`detailed export includes narrative: ${fragment}`
		);
	}
	assertContains(
		detailedWorkbook,
		proposalTitle,
		'a permitted Proposal title is exported'
	);
	assertContains(
		detailedWorkbook,
		projectTitle,
		'a permitted Project title is exported'
	);
	const detailedReasonCell = (() => {
		const sheet = workbookSheet(detailedWorkbook, 'Corrections');
		for (let number = 1; number <= sheet.rowCount; number += 1) {
			const row = sheet.getRow(number);
			for (let column = 1; column <= 12; column += 1) {
				const cell = row.getCell(column);
				if (cellText(cell).includes('=SUM(A1) reply flag corrected')) {
					return cell;
				}
			}
		}
		return null;
	})();
	assert.ok(detailedReasonCell, 'the correction reason is exported');
	assert.equal(detailedReasonCell.formula, undefined);
	assert.equal(typeof detailedReasonCell.value, 'string');

	// Detailed evidence does not bypass the downstream grants.
	const restrictedDetailed = await context.http.download(
		downloadPath({ include_narrative: '1' }),
		exportToken
	);
	assert.equal(restrictedDetailed.status, 200);
	const restrictedDetailedWorkbook = await loadWorkbook(
		restrictedDetailed.bytes
	);
	assertAbsentFragment(
		restrictedDetailedWorkbook,
		proposalTitle,
		'detailed evidence still withholds a denied Proposal title'
	);
	assertContains(
		restrictedDetailedWorkbook,
		'Alpha confidential note =2+2',
		'detailed evidence is available without downstream grants'
	);

	// ── The export leaves every source row untouched ─────────────────────
	const after = await sourceSnapshot(context, leadIds);
	assert.deepEqual(
		after,
		before,
		'workbook exports never mutate Leads or their evidence'
	);
}
