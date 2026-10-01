import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from '@playwright/test';
import { readArtifact, writeArtifact } from '../../lib/artifacts';
import { exec, rows } from '../../lib/db';
import { EMPLOYEE_USER } from '../../lib/fixtures';

/**
 * Stored XSS (plan B2/B3/B4, ADR-0012).
 *
 * Every HTML-bound write path stores the two audit payloads (`<svg/onload=…>`,
 * `<img src=x onerror=…>`) plus a legitimate rich-text control, and the spec
 * then reads the stored value back through three channels — the write response
 * where the route echoes it, the row in MySQL (`rows()`), and the resource's
 * own GET — before rendering the two pages that feed a
 * `dangerouslySetInnerHTML` sink (messages, project scope) and asserting the
 * DOM carries no executable attribute.
 *
 * Reuse: the sanitizer's bypass corpus (both engines: slash-delimited
 * handlers, srcdoc, data: URLs, mXSS, the allowlist-preserving cases) is
 * already pinned in `src/lib/sanitize.test.ts`. This spec adds no second
 * copy of it; it asserts the write boundary and the rendered page, which the
 * unit suite cannot reach.
 *
 * Residual: everything this spec creates through the API is deleted in
 * `afterAll` — messages, the direct conversation plus its members, proposals,
 * projects, quotations, project-quotation rows and the activity row a project
 * POST logs. The only rows that outlive the run are the presence/screen-time
 * rows the app itself writes while the two pages are rendered, which every
 * browser-driven spec produces for its fixture user.
 */

const ARTIFACT = 'security-stored-xss';

const SVG_PAYLOAD = '<svg/onload=alert(1)>';
const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';
const LEGIT_HTML = '<p>Hello <strong>world</strong></p>';
const LEGIT_MARKUP = '<strong>world</strong>';

/** The substrings plan B2/B3 forbid in stored or rendered rich text. */
const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
	{ name: '<svg', pattern: /<svg/i },
	{ name: '<script', pattern: /<script/i },
	{ name: 'onload', pattern: /onload/i },
	{ name: 'onerror', pattern: /onerror/i },
	{ name: 'javascript:', pattern: /javascript:/i },
];

const RUN_ID = Date.now().toString(36);
let sequence = 0;

/** Unique `E2E-XSS-…` business key for this run — never collides with data. */
function marker(label: string): string {
	sequence += 1;
	return `E2E-XSS-${RUN_ID}-${sequence}-${label}`;
}

/** Serialized text of any value, for pattern assertions. */
function textOf(value: unknown): string {
	if (value === null || value === undefined) return '';
	return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Assert no executable markup survived; returns the inspected text. */
function assertClean(label: string, value: unknown): string {
	const text = textOf(value);
	const hits = FORBIDDEN.filter((entry) => entry.pattern.test(text)).map(
		(entry) => entry.name
	);
	expect(hits, `${label} leaked ${hits.join(', ')} in: ${text}`).toEqual([]);
	return text;
}

/** Assert the legitimate control markup survived the write boundary. */
function assertControl(label: string, value: unknown): void {
	const text = textOf(value);
	expect(
		text.includes(LEGIT_MARKUP),
		`${label} lost the legit control ${LEGIT_MARKUP}: ${text}`
	).toBe(true);
}

// --- row bookkeeping -------------------------------------------------------

interface TrackedRows {
	table: string;
	key: string;
	ids: number[];
}

const created: Record<string, TrackedRows> = {};

/** Direct conversations a message POST created (or reused) this run. */
const createdConversations: number[] = [];

/** Remember a row this spec created so `afterAll` can delete it. */
function track(table: string, key: string, id: unknown): void {
	const value = Number(id);
	if (!Number.isInteger(value) || value <= 0) return;
	const group = `${table}.${key}`;
	const entry = created[group] ?? { table, key, ids: [] };
	entry.ids.push(value);
	created[group] = entry;
}

/**
 * Remember the conversation a message POST landed in so `afterAll` can drop
 * the members and the conversation itself.
 */
function trackConversation(written: WriteResult): void {
	const id = Number(written.data.conversation_id);
	if (Number.isInteger(id) && id > 0) createdConversations.push(id);
}

test.afterAll(async () => {
	for (const { table, key, ids } of Object.values(created)) {
		const placeholders = ids.map(() => '?').join(', ');
		await exec(`DELETE FROM ${table} WHERE ${key} IN (${placeholders})`, ids);
	}

	if (createdConversations.length > 0) {
		const placeholders = createdConversations.map(() => '?').join(', ');
		// Members first: the FK direction is not guaranteed to cascade.
		await exec(
			`DELETE FROM conversation_members WHERE conversation_id IN (${placeholders})`,
			createdConversations
		);
		await exec(
			`DELETE FROM conversations WHERE id IN (${placeholders})`,
			createdConversations
		);
	}

	// `POST /api/projects` also logs an activity row naming the project. The
	// rows are inert but reference a deleted id, so drop the ones this run
	// wrote (the unique run id appears in the logged description/details).
	for (const table of ['user_activity_logs']) {
		try {
			await exec(`DELETE FROM ${table} WHERE details LIKE ?`, [`%${RUN_ID}%`]);
		} catch {
			// Optional table — the log schema has drifted across deployments.
		}
	}
});

// --- request helpers -------------------------------------------------------

interface WriteResult {
	status: number;
	json: Record<string, unknown>;
	data: Record<string, unknown>;
}

async function writeAndCheck(
	request: APIRequestContext,
	method: 'post' | 'put',
	url: string,
	payload: unknown,
	expectedStatus = 200
): Promise<WriteResult> {
	const response = await request[method](url, { data: payload });
	const text = await response.text();
	expect(
		response.status(),
		`${method.toUpperCase()} ${url} failed: ${text}`
	).toBe(expectedStatus);
	const json = JSON.parse(text) as Record<string, unknown>;
	return {
		status: response.status(),
		json,
		data: (json.data ?? {}) as Record<string, unknown>,
	};
}

async function getJson(
	request: APIRequestContext,
	url: string
): Promise<Record<string, unknown>> {
	const response = await request.get(url);
	const text = await response.text();
	expect(response.status(), `GET ${url} failed: ${text}`).toBe(200);
	return JSON.parse(text) as Record<string, unknown>;
}

async function dbRow(
	table: string,
	columns: string[],
	key: string,
	id: number
): Promise<Record<string, unknown>> {
	const [row] = await rows<Record<string, unknown>>(
		`SELECT ${columns.join(', ')} FROM ${table} WHERE ${key} = ?`,
		[id]
	);
	expect(row, `${table} row ${key}=${id} must exist`).toBeTruthy();
	return row;
}

/** Admin-context API helper used by the browser tests. */
async function createProject(
	request: APIRequestContext,
	name: string
): Promise<number> {
	const res = await writeAndCheck(
		request,
		'post',
		'/api/projects',
		{ name },
		201
	);
	const projectId = Number(res.data.project_id);
	track('projects', 'project_id', projectId);
	return projectId;
}

async function employeeUserId(): Promise<number> {
	const employee = await rows<{ id: number }>(
		'SELECT id FROM users WHERE username = ? AND isDelete = 0',
		[EMPLOYEE_USER.username]
	);
	expect(employee, 'employee fixture must exist').toHaveLength(1);
	return employee[0].id;
}

// --- path result bookkeeping ----------------------------------------------

interface Probe {
	path: string;
	responses: WriteResult[];
	db: Array<[string, unknown]>;
	api: Array<[string, unknown]>;
	control?: Array<[string, unknown]>;
	render?: string;
	note?: string;
}

const pathResults: Array<Record<string, unknown>> = [];
const renderChecks: Array<Record<string, unknown>> = [];

function finish(probe: Probe): void {
	const label = (channel: string, field: string) =>
		`${probe.path} ${channel} ${field}`;

	for (const [index, response] of probe.responses.entries()) {
		assertClean(label('write-response', `#${index + 1}`), response.json);
	}
	for (const [field, value] of probe.db) {
		assertClean(label('db', field), value);
	}
	for (const [field, value] of probe.api) {
		assertClean(label('GET', field), value);
	}
	for (const [field, value] of probe.control ?? []) {
		assertControl(label('control', field), value);
	}

	// The inspected values are the artifact's evidence: they show what the
	// write boundary actually stored, not just that it passed a pattern test.
	const observed: Record<string, string> = {};
	for (const [field, value] of probe.db) {
		observed[`db:${field}`] = textOf(value);
	}
	for (const [field, value] of probe.api) {
		observed[`get:${field}`] = textOf(value);
	}

	pathResults.push({
		path: probe.path,
		statuses: probe.responses.map((response) => response.status),
		responseChecked: probe.responses.length > 0,
		observed,
		controlKept: (probe.control ?? []).length > 0,
		render: probe.render ?? null,
		note: probe.note ?? null,
	});
}

// --- write paths -----------------------------------------------------------

test('messages POST sanitizes the body on write', async ({ request }) => {
	const subject = marker('messages');
	const receiverId = await employeeUserId();
	const responses: WriteResult[] = [];
	const db: Array<[string, unknown]> = [];
	const api: Array<[string, unknown]> = [];
	const control: Array<[string, unknown]> = [];

	for (const body of [SVG_PAYLOAD, IMG_PAYLOAD, LEGIT_HTML]) {
		const written = await writeAndCheck(request, 'post', '/api/messages', {
			receiver_id: receiverId,
			subject,
			body,
		});
		responses.push(written);

		const messageId = Number(written.data.message_id);
		expect(messageId, 'message_id must be returned').toBeGreaterThan(0);
		track('messages', 'id', messageId);
		trackConversation(written);

		const row = await dbRow('messages', ['body'], 'id', messageId);
		expect(
			row.body,
			'the sanitized body must have been written'
		).not.toBeNull();
		db.push([`messages.body(${messageId})`, row.body]);

		const read = await getJson(request, `/api/messages/${messageId}`);
		const data = read.data as Record<string, unknown>;
		api.push([`messages.body(${messageId})`, data.body]);

		if (body === LEGIT_HTML) {
			control.push([`messages.body(${messageId})`, row.body]);
		}
	}

	finish({
		path: 'POST /api/messages',
		responses,
		db,
		api,
		control,
		note: 'body is the only HTML-bound column and the write response is id-only by contract, so the stored body is proven by the row and the GET',
	});
});

test('proposals POST sanitizes description and discipline descriptions', async ({
	request,
}) => {
	const written = await writeAndCheck(request, 'post', '/api/proposals', {
		proposal_title: marker('proposal-post'),
		description: SVG_PAYLOAD,
		discipline_descriptions: { civil: IMG_PAYLOAD, mechanical: LEGIT_HTML },
	});
	const proposalId = Number(written.data.id);
	expect(proposalId, 'proposal id must be returned').toBeGreaterThan(0);
	track('proposals', 'id', proposalId);

	const row = await dbRow(
		'proposals',
		['description', 'discipline_descriptions'],
		'id',
		proposalId
	);
	expect(row.description, 'description must have been written').not.toBeNull();
	expect(
		row.discipline_descriptions,
		'discipline_descriptions must have been written'
	).not.toBeNull();
	const read = await getJson(request, `/api/proposals/${proposalId}`);
	const data = read.data as Record<string, unknown>;

	finish({
		path: 'POST /api/proposals',
		responses: [written],
		db: [
			['proposals.description', row.description],
			['proposals.discipline_descriptions', row.discipline_descriptions],
		],
		api: [
			['proposals.description', data.description],
			['proposals.discipline_descriptions', data.discipline_descriptions],
		],
		control: [
			['proposals.discipline_descriptions', row.discipline_descriptions],
		],
	});
});

test('proposals PUT sanitizes description and project_description', async ({
	request,
}) => {
	const created = await writeAndCheck(request, 'post', '/api/proposals', {
		proposal_title: marker('proposal-put'),
	});
	const proposalId = Number(created.data.id);
	track('proposals', 'id', proposalId);

	const base = { proposal_title: marker('proposal-put-title') };

	// Control pass first: the payload pass overwrites the same columns.
	await writeAndCheck(request, 'put', `/api/proposals/${proposalId}`, {
		...base,
		description: LEGIT_HTML,
		project_description: LEGIT_HTML,
	});
	const controlRow = await dbRow(
		'proposals',
		['description', 'project_description'],
		'id',
		proposalId
	);

	const written = await writeAndCheck(
		request,
		'put',
		`/api/proposals/${proposalId}`,
		{
			...base,
			description: SVG_PAYLOAD,
			project_description: IMG_PAYLOAD,
		}
	);

	const row = await dbRow(
		'proposals',
		['description', 'project_description'],
		'id',
		proposalId
	);
	expect(row.description, 'description must have been written').not.toBeNull();
	expect(
		row.project_description,
		'project_description must have been written'
	).not.toBeNull();
	const read = await getJson(request, `/api/proposals/${proposalId}`);
	const data = read.data as Record<string, unknown>;

	finish({
		path: 'PUT /api/proposals/[id]',
		responses: [written],
		db: [
			['proposals.description', row.description],
			['proposals.project_description', row.project_description],
		],
		api: [
			['proposals.description', data.description],
			['proposals.project_description', data.project_description],
		],
		control: [
			['proposals.description (control pass)', controlRow.description],
			[
				'proposals.project_description (control pass)',
				controlRow.project_description,
			],
		],
		note: 'PUT returns { success, message } only — value comes from the row and the GET',
	});
});

test('projects POST sanitizes description and discipline descriptions', async ({
	request,
}) => {
	const name = marker('project-post');
	const written = await writeAndCheck(
		request,
		'post',
		'/api/projects',
		{
			name,
			description: SVG_PAYLOAD,
			discipline_descriptions: { civil: IMG_PAYLOAD, mechanical: LEGIT_HTML },
		},
		201
	);
	const projectId = Number(written.data.project_id);
	track('projects', 'project_id', projectId);

	const row = await dbRow(
		'projects',
		['description', 'discipline_descriptions'],
		'project_id',
		projectId
	);
	expect(row.description, 'description must have been written').not.toBeNull();
	expect(
		row.discipline_descriptions,
		'discipline_descriptions must have been written'
	).not.toBeNull();
	const read = await getJson(request, `/api/projects/${projectId}`);
	const data = read.data as Record<string, unknown>;

	finish({
		path: 'POST /api/projects',
		responses: [written],
		db: [
			['projects.description', row.description],
			['projects.discipline_descriptions', row.discipline_descriptions],
		],
		api: [
			['projects.description', data.description],
			['projects.discipline_descriptions', data.discipline_descriptions],
		],
		control: [
			['projects.discipline_descriptions', row.discipline_descriptions],
		],
	});
});

test('projects PUT sanitizes description, additional_scope and scope_of_work', async ({
	request,
}) => {
	const projectId = await createProject(request, marker('project-put'));
	const base = { name: marker('project-put-name'), priority: 'MEDIUM' };

	// Control pass first: payload pass overwrites the same columns.
	const controlWrite = await writeAndCheck(
		request,
		'put',
		`/api/projects/${projectId}`,
		{
			...base,
			description: LEGIT_HTML,
			additional_scope: LEGIT_HTML,
			scope_of_work: LEGIT_HTML,
		}
	);
	const controlRow = await dbRow(
		'projects',
		['description', 'additional_scope', 'scope_of_work'],
		'project_id',
		projectId
	);

	const written = await writeAndCheck(
		request,
		'put',
		`/api/projects/${projectId}`,
		{
			...base,
			description: SVG_PAYLOAD,
			additional_scope: IMG_PAYLOAD,
			scope_of_work: SVG_PAYLOAD,
			discipline_descriptions: { civil: IMG_PAYLOAD },
		}
	);
	const row = await dbRow(
		'projects',
		[
			'description',
			'additional_scope',
			'scope_of_work',
			'discipline_descriptions',
		],
		'project_id',
		projectId
	);
	for (const column of [
		'description',
		'additional_scope',
		'scope_of_work',
		'discipline_descriptions',
	]) {
		expect(
			row[column],
			`projects.${column} must have been written by the payload pass`
		).not.toBeNull();
	}
	const read = await getJson(request, `/api/projects/${projectId}`);
	const data = read.data as Record<string, unknown>;

	finish({
		path: 'PUT /api/projects/[id]',
		responses: [controlWrite, written],
		db: [
			['projects.description', row.description],
			['projects.additional_scope', row.additional_scope],
			['projects.scope_of_work', row.scope_of_work],
			['projects.discipline_descriptions', row.discipline_descriptions],
		],
		api: [
			['projects.description', data.description],
			['projects.additional_scope', data.additional_scope],
			['projects.scope_of_work', data.scope_of_work],
		],
		control: [
			['projects.description (control pass)', controlRow.description],
			['projects.additional_scope (control pass)', controlRow.additional_scope],
			['projects.scope_of_work (control pass)', controlRow.scope_of_work],
		],
		note: 'PUT returns { success, message } only — value comes from the row and the GET',
	});
});

/**
 * The collection POST and PUT of `quotations` sanitize the same columns, so
 * both paths read the row and the GET back through one helper.
 */
async function finishQuotationsPath(
	request: APIRequestContext,
	path: string,
	quotationId: number,
	written: WriteResult
): Promise<void> {
	const row = await dbRow(
		'quotations',
		['subject', 'notes', 'terms', 'items'],
		'id',
		quotationId
	);
	expect(
		row.items,
		'the sanitized items JSON must have been written'
	).not.toBeNull();
	// subject/notes hold the stripped payloads, so `sanitize(x) || null` lands
	// them as NULL (or ''); either way no payload text may survive.
	expect(textOf(row.subject)).toBe('');
	expect(textOf(row.notes)).toBe('');

	const read = await getJson(
		request,
		`/api/admin/quotations/${quotationId}?source=quotations`
	);
	const data = read.data as Record<string, unknown>;

	finish({
		path,
		responses: [written],
		db: [
			['quotations.subject', row.subject],
			['quotations.notes', row.notes],
			['quotations.terms', row.terms],
			['quotations.items', row.items],
		],
		api: [
			['quotations.subject', data.subject],
			['quotations.terms', data.terms],
			['quotations.items', data.items],
		],
		control: [
			['quotations.terms', row.terms],
			['quotations.items', row.items],
		],
	});
}

test('admin quotations POST sanitizes subject, notes, terms and item leaves', async ({
	request,
}) => {
	const written = await writeAndCheck(
		request,
		'post',
		'/api/admin/quotations',
		{
			client_name: marker('quotation-post'),
			subject: SVG_PAYLOAD,
			notes: IMG_PAYLOAD,
			terms: LEGIT_HTML,
			items: [{ description: SVG_PAYLOAD }, { description: LEGIT_HTML }],
		}
	);
	const quotationId = Number(written.json.id);
	expect(quotationId, 'quotation id must be returned').toBeGreaterThan(0);
	track('quotations', 'id', quotationId);

	await finishQuotationsPath(
		request,
		'POST /api/admin/quotations',
		quotationId,
		written
	);
});

test('admin quotations PUT sanitizes the same columns by body id', async ({
	request,
}) => {
	const created = await writeAndCheck(
		request,
		'post',
		'/api/admin/quotations',
		{
			client_name: marker('quotation-put'),
		}
	);
	const quotationId = Number(created.json.id);
	expect(quotationId, 'parent quotation id must be returned').toBeGreaterThan(
		0
	);
	track('quotations', 'id', quotationId);

	const written = await writeAndCheck(request, 'put', '/api/admin/quotations', {
		id: quotationId,
		client_name: marker('quotation-put-client'),
		quotation_number: marker('quotation-put-number'),
		subject: SVG_PAYLOAD,
		notes: IMG_PAYLOAD,
		terms: LEGIT_HTML,
		items: [{ description: IMG_PAYLOAD }, { description: LEGIT_HTML }],
	});

	await finishQuotationsPath(
		request,
		'PUT /api/admin/quotations',
		quotationId,
		written
	);
});

test('admin quotations/[id] PUT sanitizes scope items, terms and annexures', async ({
	request,
}) => {
	const projectId = await createProject(request, marker('quotation-project'));
	const parent = await exec(
		`INSERT INTO project_quotations
			(project_id, quotation_number, client_name, scope_of_work, isDelete)
		 VALUES (?, ?, ?, ?, 0)`,
		[projectId, marker('pq-parent'), 'E2E parent', '<p>parent</p>']
	);
	const quotationId = Number(parent.insertId);
	expect(quotationId).toBeGreaterThan(0);
	track('project_quotations', 'id', quotationId);

	const written = await writeAndCheck(
		request,
		'put',
		`/api/admin/quotations/${quotationId}`,
		{
			// quotation_number is bound raw by the project branch, so omitting it
			// would 500 on an undefined bind parameter.
			quotation_number: marker('pq-number'),
			client_name: marker('pq-client'),
			// First item is the control: it lands on scope_of_work, the second
			// item carries the payload as a sanitized JSON leaf.
			scope_items: [{ description: LEGIT_HTML }, { description: SVG_PAYLOAD }],
			terms_and_conditions: LEGIT_HTML,
			annexure_scope_of_work: IMG_PAYLOAD,
		}
	);

	const row = await dbRow(
		'project_quotations',
		[
			'scope_of_work',
			'scope_items',
			'terms_and_conditions',
			'annexure_scope_of_work',
		],
		'id',
		quotationId
	);
	expect(
		row.scope_items,
		'the sanitized scope_items JSON must have been written'
	).not.toBeNull();
	// annexure_scope_of_work got the stripped payload, so `sanitize(x) || null`
	// lands it as NULL (or ''); no payload text may survive either way.
	expect(textOf(row.annexure_scope_of_work)).toBe('');
	const read = await getJson(
		request,
		`/api/admin/quotations/${quotationId}?source=project`
	);
	const data = read.data as Record<string, unknown>;

	finish({
		path: 'PUT /api/admin/quotations/[id]',
		responses: [written],
		db: [
			['project_quotations.scope_of_work', row.scope_of_work],
			['project_quotations.scope_items', row.scope_items],
			['project_quotations.terms_and_conditions', row.terms_and_conditions],
			['project_quotations.annexure_scope_of_work', row.annexure_scope_of_work],
		],
		api: [
			['project_quotations.scope_items', data.scope_items],
			[
				'project_quotations.annexure_scope_of_work',
				data.annexure_scope_of_work,
			],
		],
		control: [
			['project_quotations.scope_of_work', row.scope_of_work],
			['project_quotations.terms_and_conditions', row.terms_and_conditions],
			['project_quotations.scope_items', row.scope_items],
		],
		note: 'default source=project targets project_quotations; this GET rewrites scope_of_work from the linked project, so that column is asserted from the row only',
	});
});

test('admin standalone-quotations POST sanitizes scope items, terms and annexures', async ({
	request,
}) => {
	const written = await writeAndCheck(
		request,
		'post',
		'/api/admin/standalone-quotations',
		{
			client_name: marker('standalone'),
			// First item is the control (it lands on `subject`), the second
			// carries the payload as a sanitized JSON leaf.
			scope_items: [{ description: LEGIT_HTML }, { description: SVG_PAYLOAD }],
			terms_and_conditions: LEGIT_HTML,
			annexure_scope_of_work: IMG_PAYLOAD,
		}
	);
	const quotationId = Number(written.json.id);
	expect(
		quotationId,
		'standalone quotation id must be returned'
	).toBeGreaterThan(0);
	track('quotations', 'id', quotationId);

	const row = await dbRow(
		'quotations',
		[
			'subject',
			'items',
			'scope_items',
			'terms_and_conditions',
			'annexure_scope_of_work',
		],
		'id',
		quotationId
	);
	expect(
		row.items,
		'the sanitized items JSON must have been written'
	).not.toBeNull();
	expect(row.scope_items).not.toBeNull();
	// annexure_scope_of_work got the stripped payload, so `sanitize(x) || null`
	// lands it as NULL (or ''); no payload text may survive either way.
	expect(textOf(row.annexure_scope_of_work)).toBe('');
	const read = await getJson(
		request,
		`/api/admin/standalone-quotations/${quotationId}`
	);
	const data = read.data as Record<string, unknown>;

	finish({
		path: 'POST /api/admin/standalone-quotations',
		responses: [written],
		db: [
			['quotations.subject', row.subject],
			['quotations.items', row.items],
			['quotations.scope_items', row.scope_items],
			['quotations.terms_and_conditions', row.terms_and_conditions],
			['quotations.annexure_scope_of_work', row.annexure_scope_of_work],
		],
		api: [
			['quotations.subject', data.subject],
			['quotations.items', data.items],
			['quotations.annexure_scope_of_work', data.annexure_scope_of_work],
		],
		control: [
			['quotations.subject', row.subject],
			['quotations.terms_and_conditions', row.terms_and_conditions],
			['quotations.items', row.items],
		],
		note: 'subject stores the sanitized first scope-item description',
	});
});

test('project quotation POST sanitizes scope_of_work on create and update', async ({
	request,
}) => {
	const projectId = await createProject(request, marker('pq-project'));
	const responses: WriteResult[] = [];
	const db: Array<[string, unknown]> = [];
	const api: Array<[string, unknown]> = [];
	const control: Array<[string, unknown]> = [];

	for (const scope of [SVG_PAYLOAD, IMG_PAYLOAD, LEGIT_HTML]) {
		const written = await writeAndCheck(
			request,
			'post',
			`/api/projects/${projectId}/quotation`,
			{ client_name: marker('pq-client'), scope_of_work: scope }
		);
		responses.push(written);
		track('project_quotations', 'id', written.data.id);

		const row = await dbRow(
			'project_quotations',
			['scope_of_work'],
			'project_id',
			projectId
		);
		expect(
			row.scope_of_work,
			'scope_of_work must have been written'
		).not.toBeNull();
		db.push(['project_quotations.scope_of_work', row.scope_of_work]);

		const read = await getJson(request, `/api/projects/${projectId}/quotation`);
		const data = read.data as Record<string, unknown>;
		api.push(['project_quotations.scope_of_work', data.scope_of_work]);

		if (scope === LEGIT_HTML) {
			control.push(['project_quotations.scope_of_work', row.scope_of_work]);
		}
	}

	finish({
		path: 'POST /api/projects/[id]/quotation',
		responses,
		db,
		api,
		control,
		note: 'the route has no PUT; POST is an upsert and its create + update branches are both exercised',
	});
});

// --- rendered DOM ----------------------------------------------------------

/** Assert the rendered document carries no executable handler attribute. */
async function assertRenderInert(page: Page, label: string): Promise<string> {
	const html = await page.evaluate(() => document.documentElement.innerHTML);
	expect(html, `${label}: document contains onload=`).not.toMatch(/onload=/i);
	expect(html, `${label}: document contains onerror=`).not.toMatch(/onerror=/i);
	const handlerElements = await page.locator('[onload], [onerror]').count();
	expect(handlerElements, `${label}: elements carrying onload/onerror`).toBe(0);
	return html;
}

test('messages page renders a stored payload inert', async ({
	page,
	request,
}) => {
	const subject = marker('messages-render');
	const receiverId = await employeeUserId();
	const bodies = [SVG_PAYLOAD, IMG_PAYLOAD, LEGIT_HTML];

	for (const body of bodies) {
		const written = await writeAndCheck(request, 'post', '/api/messages', {
			receiver_id: receiverId,
			subject,
			body,
		});
		// The write + response are asserted by the messages POST test above;
		// this test owns the rendered DOM.
		track('messages', 'id', Number(written.data.message_id));
		trackConversation(written);
	}

	await page.goto('/messages');
	await page.getByRole('listitem', { name: 'Sent Items' }).first().click();
	await page.getByRole('option', { name: new RegExp(subject) }).click();

	// The message list can render more than one article carrying the control
	// text (older runs' conversations stay in the DOM), so pin the first.
	const controlBody = page
		.locator('[role="article"]', { hasText: 'Hello' })
		.first();
	await expect(controlBody).toBeVisible();

	await assertRenderInert(page, 'messages page');

	const controlHtml = await controlBody.innerHTML();
	expect(controlHtml, 'legit control must render as markup').toContain(
		LEGIT_MARKUP
	);

	renderChecks.push({
		page: '/messages',
		conversation: subject,
		documentClean: true,
		controlRendered: controlHtml.includes(LEGIT_MARKUP),
	});
	pathResults.push({
		path: 'render /messages',
		statuses: [200],
		responseChecked: false,
		observed: {
			document: 'no onload/onerror attribute anywhere in the DOM',
			control: controlHtml,
		},
		controlKept: true,
		render: 'documentElement has no onload/onerror, no handler element',
		note: subject,
	});
});

test('project scope page renders a stored payload inert', async ({
	page,
	request,
}) => {
	const projectId = await createProject(request, marker('project-render'));
	const base = { name: marker('project-render-name'), priority: 'MEDIUM' };

	// Control first: the payload pass is the state the DOM assertion inspects.
	await writeAndCheck(request, 'put', `/api/projects/${projectId}`, {
		...base,
		description: LEGIT_HTML,
		additional_scope: LEGIT_HTML,
		scope_of_work: LEGIT_HTML,
	});

	await page.goto(`/projects/${projectId}`);
	await page.getByRole('tab', { name: 'Scope' }).click();
	await expect(page.getByText('Hello world').first()).toBeVisible();
	await assertRenderInert(page, 'project scope page (control)');
	expect(
		await page.locator('strong', { hasText: 'world' }).count(),
		'legit control must render as a <strong> node'
	).toBeGreaterThan(0);

	const written = await writeAndCheck(
		request,
		'put',
		`/api/projects/${projectId}`,
		{
			...base,
			description: SVG_PAYLOAD,
			additional_scope: IMG_PAYLOAD,
			scope_of_work: SVG_PAYLOAD,
		}
	);
	assertClean('PUT /api/projects/[id] (render case)', written.json);

	await page.reload();
	await page.getByRole('tab', { name: 'Scope' }).click();
	await expect(page.getByRole('tab', { name: 'Scope' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await assertRenderInert(page, 'project scope page (payload)');

	renderChecks.push({
		page: `/projects/${projectId}`,
		tab: 'scope',
		documentClean: true,
		controlRendered: true,
	});
	pathResults.push({
		path: 'render /projects/[id]',
		statuses: [200],
		responseChecked: false,
		observed: {
			document: 'no onload/onerror attribute anywhere in the DOM',
			control: 'scope panel rendered <strong>world</strong>',
		},
		controlKept: true,
		render: 'documentElement has no onload/onerror, no handler element',
		note: `project ${projectId}`,
	});
});

// --- artifact --------------------------------------------------------------

const EXPECTED_PATHS = [
	'POST /api/messages',
	'POST /api/proposals',
	'PUT /api/proposals/[id]',
	'POST /api/projects',
	'PUT /api/projects/[id]',
	'POST /api/admin/quotations',
	'PUT /api/admin/quotations',
	'PUT /api/admin/quotations/[id]',
	'POST /api/admin/standalone-quotations',
	'POST /api/projects/[id]/quotation',
	'render /messages',
	'render /projects/[id]',
];

test('artifact records every HTML-bound write path', async () => {
	const covered = pathResults.map((entry) => entry.path);
	const missing = EXPECTED_PATHS.filter((path) => !covered.includes(path));
	expect(
		missing,
		`paths without a recorded result: ${missing.join(', ')}`
	).toEqual([]);

	writeArtifact(ARTIFACT, {
		payloads: { svg: SVG_PAYLOAD, img: IMG_PAYLOAD, control: LEGIT_HTML },
		paths: pathResults,
		renderChecks,
		skippedPaths: [
			{
				path: 'PUT /api/projects/[id]/quotation',
				reason:
					'src/app/api/projects/[id]/quotation/route.js exports only GET and POST; the POST is an upsert whose create and update branches are both asserted above',
			},
		],
		expectedPathCount: EXPECTED_PATHS.length,
		recordedPathCount: covered.length,
		ok: missing.length === 0,
	});

	const artifact = readArtifact(ARTIFACT);
	expect(artifact).toMatchObject({
		ok: true,
		recordedPathCount: EXPECTED_PATHS.length,
	});
	expect(
		(artifact.paths as unknown[]) ?? [],
		'every expected path must be recorded in the artifact'
	).toHaveLength(EXPECTED_PATHS.length);
});
