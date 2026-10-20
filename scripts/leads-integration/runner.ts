import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Connection, ResolvedSafety } from './support.ts';
import {
	connectReader,
	connectServer,
	hashFixturePassword,
	runIdFromDate,
} from './support.ts';
import type {
	DbActivityRow,
	DbLeadRow,
	DbOwnershipRow,
	DbProposalRow,
	DbReviewRow,
	DbStageHistoryRow,
	FixtureIdentity,
	HttpResponse,
	LoginHttpClient,
	Reader,
	Scenario,
	ScenarioContext,
} from './client.ts';
import { extractSessionCookie } from './client.ts';
import { creatorAssignmentScenario } from './scenarios/creator-assignment.ts';
import {
	deniedAssignmentPersistsNothingScenario,
	permittedAssignmentScenario,
} from './scenarios/assignment.ts';
import {
	importOwnerEvidenceNeverResolvesScenario,
	ownerSelectedImportScenario,
	unassignedImportScenario,
	rawImportEvidenceScenario,
	invalidImportOwnerScenario,
	activeImportRequirementsScenario,
} from './scenarios/imports.ts';
import {
	duplicateReviewScenario,
	durableReadsScenario,
	separateEnquiriesScenario,
} from './scenarios/reads.ts';
import {
	emailReplyVersusSentScenario,
	lastOpenTaskCloseScenario,
	leadWorkQueueScenario,
	legacyActivityEvidenceScenario,
	noteOnlyLoggingScenario,
	noRegressionScenario,
	outreachOutcomesScenario,
	ownerAndDateRefusalScenario,
	timelinePersistenceScenario,
	type LifecycleSeeds,
} from './scenarios/activities.ts';
import {
	convertedLeadTakesNoDecisionScenario,
	disqualifyCancelsOutstandingWorkScenario,
	disqualifyWithoutReasonScenario,
	genericPathsCannotDecideTheLifecycleScenario,
	lifecycleUnauthorizedScenario,
	nurtureWithNextActionScenario,
	nurtureWithoutNextActionScenario,
	qualificationMissingFieldsScenario,
	qualificationWithoutBudgetOrTimingScenario,
	reopenMissingFieldsScenario,
	reopenWithRequiredFieldsScenario,
} from './scenarios/lifecycle.ts';
import {
	legacyEvidenceScenario,
	type LegacySeedRow,
} from './scenarios/legacy.ts';
import {
	legacyReviewDeniedScenario,
	legacyReviewInvalidScenario,
	legacyReviewQueueScenario,
	legacyReviewResolutionScenario,
	proposalLinkEditScenario,
	proposalLinkGuardScenario,
	type LegacyReviewSeeds,
} from './scenarios/legacy-review.ts';

const require = createRequire(import.meta.url);

interface KnexMigrateApi {
	up: (config?: { name?: string }) => Promise<unknown>;
	latest: () => Promise<unknown>;
}

interface KnexInstance {
	migrate: KnexMigrateApi;
	destroy: () => Promise<void>;
}

type KnexFactory = (config: Record<string, unknown>) => KnexInstance;

// knex is CommonJS; require keeps the in-process migration driver loading
// identically under type-stripping with no loader indirection.
const knexFactory = require('knex') as KnexFactory;

const FIXTURE_PASSWORD = 'Lit369-pass!';
const IBAND = '='.repeat(72);
const NEXT_PORT = Number(process.env.LEADS_INTEGRATION_PORT ?? 31369);
const MIGRATIONS_DIR = join(process.cwd(), 'migrations');
// Explicit ticket-369 cutover point: every earlier file migrates first, legacy
// evidence is seeded, then this file maps it. Never rediscovered by pattern.
const LEAD_MIGRATION_FILE = '20261019120000_lead_owner_stable_reference.ts';
// Second cutover point: the legacy review migration inventories the stored
// values, auto-resolves the evidence-backed cases, and leaves the ambiguous
// ones for a reviewer. Never rediscovered by pattern.
const LEGACY_REVIEW_MIGRATION_FILE = '20261019130000_lead_legacy_review.ts';

function log(message: string): void {
	process.stdout.write(`[leads-integration] ${message}\n`);
}

function fail(message: string): never {
	throw new Error(`[leads-integration] ${message}`);
}

function nullableNumber(value: unknown): number | null {
	return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === 'string' ? value : String(value);
}

function nullableFlag(value: unknown): number | boolean | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	return null;
}

function requiredNumber(value: unknown, what: string): number {
	if (typeof value !== 'number' && typeof value !== 'string')
		fail(`expected numeric ${what}`);
	return Number(value);
}

function makeHttp(baseUrl: string): LoginHttpClient {
	async function request(
		path: string,
		init: RequestInit,
		sessionToken?: string
	): Promise<HttpResponse> {
		const headers = new Headers(init.headers);
		if (sessionToken) headers.set('Cookie', `session=${sessionToken}`);
		const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
		const text = await response.text();
		return {
			status: response.status,
			text,
			json: () => JSON.parse(text) as unknown,
		};
	}

	const LoginResponseSchema = z.object({
		success: z.literal(true),
		user: z.object({ id: z.number() }).passthrough(),
	});

	return {
		get: (path, sessionToken) => request(path, { method: 'GET' }, sessionToken),
		post: (path, body, sessionToken) => {
			if (typeof FormData !== 'undefined' && body instanceof FormData) {
				return request(path, { method: 'POST', body }, sessionToken);
			}
			return request(
				path,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				},
				sessionToken
			);
		},
		put: (path, body, sessionToken) =>
			request(
				path,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				},
				sessionToken
			),
		patch: (path, body, sessionToken) =>
			request(
				path,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				},
				sessionToken
			),
		delete: (path, sessionToken) =>
			request(path, { method: 'DELETE' }, sessionToken),
		login: async (username, password) => {
			const response = await fetch(`${baseUrl}/api/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password }),
			});
			const text = await response.text();
			assert.equal(
				response.status,
				200,
				`login status for ${username} (body: ${text})`
			);
			const parsed = LoginResponseSchema.parse(JSON.parse(text) as unknown);
			const sessionToken = extractSessionCookie(
				response.headers.get('set-cookie')
			);
			assert.ok(sessionToken, `login sets a session cookie for ${username}`);
			return { id: parsed.user.id, sessionToken };
		},
	};
}

function makeReader(connection: Connection): Reader {
	async function firstRow(
		sql: string,
		params: Array<string | number | null>
	): Promise<Record<string, unknown> | null> {
		const [rows] = await connection.execute(sql, params);
		const [first] = rows;
		return first ?? null;
	}

	function toLeadRow(row: Record<string, unknown>): DbLeadRow {
		return {
			id: requiredNumber(row.id, 'leads.id'),
			lead_id: nullableString(row.lead_id),
			company_name: String(row.company_name),
			project_description: nullableString(row.project_description),
			enquiry_status: nullableString(row.enquiry_status),
			owner_user_id: nullableNumber(row.owner_user_id),
			legacy_stage: nullableString(row.legacy_stage),
			legacy_owner_name: nullableString(row.legacy_owner_name),
			legacy_review_required: nullableFlag(row.legacy_review_required),
			legacy_stage_reviewed: nullableFlag(row.legacy_stage_reviewed),
			legacy_owner_reviewed: nullableFlag(row.legacy_owner_reviewed),
			legacy_proposal_reviewed: nullableFlag(row.legacy_proposal_reviewed),
			legacy_proposal_conflict: nullableFlag(row.legacy_proposal_conflict),
			canonical_proposal_id: nullableNumber(row.canonical_proposal_id),
			follow_up_date: nullableString(row.follow_up_date),
			isDelete: nullableNumber(row.isDelete),
		};
	}

	function toReviewRow(row: Record<string, unknown>): DbReviewRow {
		return {
			id: requiredNumber(row.id, 'lead_legacy_reviews.id'),
			lead_id: requiredNumber(row.lead_id, 'lead_legacy_reviews.lead_id'),
			review_type: String(row.review_type),
			original_value: nullableString(row.original_value),
			resolved_value: nullableString(row.resolved_value),
			resolved_reference: nullableNumber(row.resolved_reference),
			reason: String(row.reason),
			resolution_source: String(row.resolution_source),
			reviewer_user_id: nullableNumber(row.reviewer_user_id),
			resolved_at: String(row.resolved_at),
		};
	}

	function toProposalRow(row: Record<string, unknown>): DbProposalRow {
		return {
			id: requiredNumber(row.id, 'proposals.id'),
			lead_id: nullableNumber(row.lead_id),
			proposal_title: nullableString(row.proposal_title),
			status: nullableString(row.status),
			isDelete: nullableNumber(row.isDelete),
		};
	}

	function toActivityRow(row: Record<string, unknown>): DbActivityRow {
		return {
			id: requiredNumber(row.id, 'lead_activities.id'),
			lead_id: requiredNumber(row.lead_id, 'lead_activities.lead_id'),
			activity_type: nullableString(row.activity_type),
			status: nullableString(row.status),
			call_outcome: nullableString(row.call_outcome),
			reply_confirmed: nullableNumber(row.reply_confirmed),
			scheduled_for: nullableString(row.scheduled_for),
			occurred_at: nullableString(row.occurred_at),
			completed_at: nullableString(row.completed_at),
			next_action: nullableString(row.next_action),
			notes: nullableString(row.notes),
			created_by: nullableNumber(row.created_by),
			recorded_at: nullableString(row.recorded_at),
			isDelete: nullableNumber(row.isDelete),
		};
	}

	function toStageHistoryRow(row: Record<string, unknown>): DbStageHistoryRow {
		return {
			id: requiredNumber(row.id, 'lead_stage_history.id'),
			lead_id: requiredNumber(row.lead_id, 'lead_stage_history.lead_id'),
			from_stage: nullableString(row.from_stage),
			to_stage: nullableString(row.to_stage),
			change_source: nullableString(row.change_source),
			reason: nullableString(row.reason),
			actor_user_id: nullableNumber(row.actor_user_id),
			recorded_at: nullableString(row.recorded_at),
		};
	}

	function toOwnershipRow(row: Record<string, unknown>): DbOwnershipRow {
		return {
			id: requiredNumber(row.id, 'lead_ownership_history.id'),
			lead_id: requiredNumber(row.lead_id, 'lead_ownership_history.lead_id'),
			prior_owner_user_id: nullableNumber(row.prior_owner_user_id),
			owner_user_id: nullableNumber(row.owner_user_id),
			actor_user_id: nullableNumber(row.actor_user_id),
			created_at: String(row.created_at),
		};
	}

	return {
		leadRow: async (id) => {
			const row = await firstRow('SELECT * FROM leads WHERE id = ? LIMIT 1', [
				id,
			]);
			return row ? toLeadRow(row) : null;
		},
		ownershipHistory: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT * FROM lead_ownership_history WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toOwnershipRow);
		},
		reviewRows: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT * FROM lead_legacy_reviews WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toReviewRow);
		},
		proposalRows: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT id, lead_id, proposal_title, status, isDelete FROM proposals WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toProposalRow);
		},
		activityRows: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toActivityRow);
		},
		stageHistory: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT * FROM lead_stage_history WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toStageHistoryRow);
		},
		userByUsername: async (username) =>
			firstRow('SELECT * FROM users WHERE username = ? LIMIT 1', [username]),
		countLeadsByCompany: async (companyName) => {
			const row = await firstRow(
				'SELECT COUNT(*) AS total FROM leads WHERE company_name = ?',
				[companyName]
			);
			return Number(row?.total ?? 0);
		},
	};
}

interface FixtureSpec {
	key: string;
	fullName: string;
	permissions: string[];
}

function fixtureUsername(runTag: string, key: string): string {
	return `${runTag}-${key}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

async function seedFixtureUser(
	connection: Connection,
	runTag: string,
	spec: FixtureSpec,
	passwordHash: string
): Promise<{ id: number; username: string; email: string }> {
	const username = fixtureUsername(runTag, spec.key);
	const email = `${username}@example.com`;
	await connection.execute(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, isDelete, permissions, is_super_admin)
		 VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 0)`,
		[
			username,
			passwordHash,
			email,
			spec.fullName,
			JSON.stringify(spec.permissions),
		]
	);
	const [rows] = await connection.execute(
		'SELECT id FROM users WHERE username = ? LIMIT 1',
		[username]
	);
	const [created] = rows;
	if (!created) fail(`fixture user ${username} missing after insert`);
	return { id: requiredNumber(created.id, 'users.id'), username, email };
}

function createKnex(resolved: ResolvedSafety): KnexInstance {
	return knexFactory({
		client: 'mysql2',
		connection: {
			host: resolved.host,
			port: resolved.port,
			user: resolved.user,
			password: resolved.password,
			database: resolved.name,
		},
		migrations: { directory: MIGRATIONS_DIR },
	});
}

/** Every migration file ordered before the explicit ticket-369 cutover. */
function preLeadMigrationFiles(): string[] {
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((file) => /\.(js|mjs|cjs|ts)$/.test(file))
		.sort();
	const leadIndex = files.indexOf(LEAD_MIGRATION_FILE);
	if (leadIndex < 0) {
		fail(
			`ticket-369 lead migration ${LEAD_MIGRATION_FILE} missing from migrations/`
		);
	}
	return files.slice(0, leadIndex);
}

function isDatabaseExistsError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	if (!('errno' in error)) return false;
	return error.errno === 1007;
}

async function dropDatabase(resolved: ResolvedSafety): Promise<void> {
	const connection = await connectServer(resolved);
	try {
		await connection.execute(
			`DROP DATABASE IF EXISTS \`${resolved.name}\``,
			[]
		);
		log(`dropped disposable database ${resolved.name}`);
	} finally {
		await connection.end();
	}
}

interface FixtureIdentities {
	creator: FixtureIdentity;
	assignee: FixtureIdentity;
	readOnly: FixtureIdentity;
	noAssign: FixtureIdentity;
	proposer: FixtureIdentity;
}

function fixtureSpecs(runTag: string): FixtureSpec[] {
	const fullPermissions = [
		'leads:read',
		'leads:create',
		'leads:update',
		'leads:delete',
		'leads:import',
		'leads:assign',
		// Proposal read access lets the reviewer see the linked Proposals
		// the canonical choice is made between.
		'proposals:read',
	];
	return [
		{
			key: 'creator',
			fullName: `${runTag} Creator`,
			permissions: fullPermissions,
		},
		{
			key: 'assignee',
			fullName: `${runTag} Assignee`,
			permissions: fullPermissions,
		},
		{
			key: 'readonly',
			fullName: `${runTag} Reader`,
			permissions: ['leads:read'],
		},
		{
			key: 'noassign',
			fullName: `${runTag} Editor`,
			permissions: ['leads:read', 'leads:create', 'leads:update'],
		},
		{
			key: 'proposer',
			fullName: `${runTag} Proposer`,
			permissions: [
				'leads:read',
				'proposals:read',
				'proposals:create',
				'proposals:update',
				'proposals:delete',
			],
		},
	];
}

async function loginFixtureIdentities(
	reader: Connection,
	http: LoginHttpClient,
	runTag: string
): Promise<FixtureIdentities> {
	// Users already exist (seeded before the lead mapping). Login over real
	// HTTP proves authentication; the reader resolves stable ids.
	const identities: FixtureIdentity[] = [];
	for (const spec of fixtureSpecs(runTag)) {
		const username = fixtureUsername(runTag, spec.key);
		const login = await http.login(username, FIXTURE_PASSWORD);
		const [rows] = await reader.execute(
			'SELECT id, email, full_name FROM users WHERE username = ? LIMIT 1',
			[username]
		);
		const [found] = rows;
		if (!found) fail(`fixture user ${username} missing after login`);
		assert.equal(login.id, Number(found.id), `login resolves ${username}`);
		identities.push({
			id: Number(found.id),
			username,
			email: String(found.email),
			fullName: String(found.full_name),
			password: FIXTURE_PASSWORD,
			sessionToken: login.sessionToken,
			permissions: spec.permissions,
		});
	}
	const [creator, assignee, readOnly, noAssign, proposer] = identities;
	if (!creator || !assignee || !readOnly || !noAssign || !proposer)
		fail('fixture login incomplete');
	return { creator, assignee, readOnly, noAssign, proposer };
}

async function seedDuplicateNameTie(
	connection: Connection,
	runTag: string,
	passwordHash: string
): Promise<string> {
	// Two active users share one full_name, so legacy evidence with that name
	// cannot resolve uniquely and must stay in review.
	const sharedName = `${runTag} Duplicate Owner`;
	for (const suffix of ['a', 'b']) {
		const username = fixtureUsername(runTag, `dupe-${suffix}`);
		await connection.execute(
			`INSERT INTO users (username, password_hash, email, full_name, status, is_active, isDelete, permissions, is_super_admin)
			 VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 0)`,
			[
				username,
				passwordHash,
				`${username}@example.com`,
				sharedName,
				JSON.stringify(['leads:read']),
			]
		);
	}
	return sharedName;
}

async function seedLegacyRows(
	connection: Connection,
	runTag: string,
	assigneeFullName: string
): Promise<LegacySeedRow[]> {
	// Representative pre-migration rows: raw assigned_to/old status evidence
	// only. Inserted before the ticket-369 lead migration runs, so the real
	// mapping classifies them.
	const duplicateName = `${runTag} Duplicate Owner`;
	const rows: Array<{
		company: string;
		status: string;
		owner: string;
		marker: LegacySeedRow['ownerMarker'];
	}> = [
		{
			company: `${runTag} Legacy Clean Co`,
			status: 'Qualified',
			owner: assigneeFullName,
			marker: '__CLEAN_MAP__',
		},
		{
			company: `${runTag} Legacy Unknown Co`,
			status: 'Circa-2019 Custom Stage',
			owner: `Nobody ${runTag}`,
			marker: '__UNKNOWN_NAME__',
		},
		{
			company: `${runTag} Legacy Dupe Co`,
			status: 'attempting contact',
			owner: duplicateName,
			marker: '__DUPLICATE_NAME__',
		},
		{
			company: `${runTag} Legacy Label Co`,
			status: 'Converted to Proposal',
			owner: `Nobody ${runTag}`,
			marker: '__LABEL__',
		},
	];
	const seeds: LegacySeedRow[] = [];
	for (const row of rows) {
		await connection.execute(
			`INSERT INTO leads (company_name, contact_name, project_description, enquiry_status, assigned_to, isDelete)
			 VALUES (?, 'Legacy Contact', ?, ?, ?, 0)`,
			[row.company, `${runTag} legacy need`, row.status, row.owner]
		);
		const [found] = await connection.execute(
			'SELECT id FROM leads WHERE company_name = ? ORDER BY id DESC LIMIT 1',
			[row.company]
		);
		const [created] = found;
		if (!created) fail(`legacy seed ${row.company} missing after insert`);
		seeds.push({
			id: requiredNumber(created.id, 'leads.id'),
			company: row.company,
			originalStatus: row.status,
			originalOwner: row.owner,
			ownerMarker: row.marker,
		});
	}
	return seeds;
}

interface LegacyProposalSeed {
	leadId: number;
	proposalIds: number[];
}

/**
 * Legacy Proposals linked to the seeded legacy Leads, inserted before the
 * legacy review migration runs. One enquiry carries two Proposals (the
 * duplicate case that needs a reviewer) and one carries a single Proposal
 * (the evidence-backed case the cutover may resolve on its own).
 */
/**
 * A legacy Lead that carried a dated next action before the activity log
 * existed. The cutover turns that date into real scheduled work whose
 * author and outcome are unknown, and the timeline has to say so.
 */
async function seedLegacyScheduledLead(
	connection: Connection,
	runTag: string,
	assigneeFullName: string
): Promise<{ id: number; followUpDate: string }> {
	const followUpDate = '2026-11-16';
	const companyName = `${runTag} Legacy Scheduled Co`;
	await connection.execute(
		`INSERT INTO leads (company_name, contact_name, project_description, enquiry_status, assigned_to, follow_up_date, isDelete)
		 VALUES (?, 'Legacy Contact', ?, 'Qualified', ?, ?, 0)`,
		[
			companyName,
			`${runTag} legacy scheduled need`,
			assigneeFullName,
			followUpDate,
		]
	);
	const [rows] = await connection.execute(
		'SELECT id FROM leads WHERE company_name = ? ORDER BY id DESC LIMIT 1',
		[companyName]
	);
	const [created] = rows;
	if (!created)
		fail(`legacy scheduled seed ${companyName} missing after insert`);
	return {
		id: requiredNumber(created.id, 'leads.id'),
		followUpDate,
	};
}

async function seedLegacyProposals(
	connection: Connection,
	runTag: string,
	seeds: LegacySeedRow[]
): Promise<LegacyProposalSeed[]> {
	const findSeed = (marker: LegacySeedRow['ownerMarker']): LegacySeedRow => {
		const seed = seeds.find((candidate) => candidate.ownerMarker === marker);
		if (!seed) fail(`legacy seed present for ${marker}`);
		return seed;
	};
	const plan: Array<{
		marker: LegacySeedRow['ownerMarker'];
		titles: string[];
	}> = [
		{
			marker: '__LABEL__',
			titles: [
				`${runTag} legacy proposal one`,
				`${runTag} legacy proposal two`,
			],
		},
		{
			marker: '__UNKNOWN_NAME__',
			titles: [`${runTag} legacy proposal single`],
		},
	];
	const seeded: LegacyProposalSeed[] = [];
	for (const entry of plan) {
		const seed = findSeed(entry.marker);
		const proposalIds: number[] = [];
		for (const title of entry.titles) {
			await connection.execute(
				`INSERT INTO proposals (proposal_title, lead_id, status, isDelete)
				 VALUES (?, ?, 'DRAFT', 0)`,
				[title, seed.id]
			);
			const [rows] = await connection.execute(
				'SELECT id FROM proposals WHERE lead_id = ? ORDER BY id DESC LIMIT 1',
				[seed.id]
			);
			const [created] = rows;
			if (!created) fail(`legacy proposal ${title} missing after insert`);
			proposalIds.push(requiredNumber(created.id, 'proposals.id'));
		}
		seeded.push({ leadId: seed.id, proposalIds });
	}
	return seeded;
}

/**
 * The legacy records the review scenarios work on: an evidence-backed
 * mapping, an ambiguous owner name, an enquiry with two linked Proposals,
 * and an enquiry with exactly one linked Proposal.
 */
function buildLegacyReviewSeeds(
	legacySeeds: LegacySeedRow[],
	legacyProposals: LegacyProposalSeed[]
): LegacyReviewSeeds {
	const byMarker = (marker: LegacySeedRow['ownerMarker']): LegacySeedRow => {
		const seed = legacySeeds.find(
			(candidate) => candidate.ownerMarker === marker
		);
		if (!seed) fail(`legacy seed present for ${marker}`);
		return seed;
	};
	const proposalIdsFor = (leadId: number): number[] => {
		const seeded = legacyProposals.find(
			(candidate) => candidate.leadId === leadId
		);
		if (!seeded) fail(`legacy proposals seeded for lead ${leadId}`);
		return seeded.proposalIds;
	};
	const conflict = byMarker('__LABEL__');
	const single = byMarker('__UNKNOWN_NAME__');
	const singleProposalIds = proposalIdsFor(single.id);
	if (singleProposalIds.length !== 1)
		fail('the single-link legacy lead carries exactly one Proposal');
	return {
		cleanLeadId: byMarker('__CLEAN_MAP__').id,
		ambiguousOwnerLeadId: byMarker('__DUPLICATE_NAME__').id,
		conflictLeadId: conflict.id,
		conflictProposalIds: proposalIdsFor(conflict.id),
		singleLinkLeadId: single.id,
		singleLinkProposalId: singleProposalIds[0],
	};
}

/**
 * Two Leads in the stages the Lead API cannot create yet: a disqualified
 * and a converted Lead. The workflow must leave both alone, so the
 * scenarios need them as a starting point.
 */
async function seedLifecycleFixtures(
	connection: Connection,
	runTag: string,
	ownerUsername: string
): Promise<LifecycleSeeds> {
	const [userRows] = await connection.execute(
		'SELECT id FROM users WHERE username = ? LIMIT 1',
		[ownerUsername]
	);
	const [owner] = userRows;
	if (!owner) fail(`fixture user ${ownerUsername} missing before seeding`);
	const ownerUserId = Number(owner.id);
	const stages: Array<[string, string]> = [
		['Disqualified', 'disqualified'],
		['Converted', 'converted'],
	];
	const seeded: Record<string, number> = {};
	for (const [stage, key] of stages) {
		const companyName = `${runTag} ${stage} Co`;
		await connection.execute(
			`INSERT INTO leads (company_name, enquiry_status, owner_user_id, isDelete, created_at, updated_at)
			 VALUES (?, ?, ?, 0, NOW(), NOW())`,
			[companyName, stage, ownerUserId]
		);
		const [rows] = await connection.execute(
			'SELECT id FROM leads WHERE company_name = ? ORDER BY id DESC LIMIT 1',
			[companyName]
		);
		const [created] = rows;
		if (!created) fail(`lifecycle seed ${companyName} missing after insert`);
		seeded[key] = requiredNumber(created.id, 'leads.id');
	}
	return {
		disqualifiedLeadId: seeded.disqualified ?? 0,
		convertedLeadId: seeded.converted ?? 0,
	};
}

async function waitForHealth(
	baseUrl: string,
	server: ChildProcess,
	timeoutMs: number
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError = 'unknown';
	while (Date.now() < deadline) {
		if (server.exitCode !== null || server.signalCode !== null) {
			fail(
				`server process exited (code ${String(server.exitCode)}) before becoming healthy: ` +
					`port ${String(NEXT_PORT)} is likely held by another process; set LEADS_INTEGRATION_PORT.`
			);
		}
		try {
			const response = await fetch(`${baseUrl}/api/health`);
			if (response.ok) {
				const payload: unknown = await response.json();
				const healthy =
					typeof payload === 'object' &&
					payload !== null &&
					'status' in payload &&
					payload.status === 'ok';
				if (healthy) return;
				lastError = `unexpected body ${JSON.stringify(payload)}`;
			} else {
				lastError = `status ${response.status}`;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		const tick = Promise.withResolvers<void>();
		setTimeout(tick.resolve, 1000);
		await tick.promise;
	}
	fail(`server at ${baseUrl} never became healthy: ${lastError}`);
}

function startAppServer(resolved: ResolvedSafety, port: number): ChildProcess {
	const nextBin = join(
		process.cwd(),
		'node_modules',
		'next',
		'dist',
		'bin',
		'next'
	);
	const child = spawn(
		process.execPath,
		[nextBin, 'dev', '--port', String(port), '--hostname', '127.0.0.1'],
		{
			env: { ...process.env, ...resolved.serverEnv, PORT: String(port) },
			cwd: process.cwd(),
			stdio: 'inherit',
			shell: false,
		}
	);
	child.on('error', (error) => {
		log(`server process error: ${error.message}`);
	});
	return child;
}

async function stopTaskkillTree(pid: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
		stdio: 'ignore',
		shell: false,
	});
	killer.on('error', () => resolve());
	killer.on('close', () => resolve());
	await promise;
}

async function stopAppServer(server: ChildProcess | null): Promise<void> {
	if (!server || server.exitCode !== null || server.signalCode !== null) return;
	// On Windows the dev server is a CMD-spawned tree; killing only the
	// parent orphans children that keep the port and .next/dev lock. Kill
	// the whole tree first and await it — never SIGTERM the parent alone.
	if (process.platform === 'win32' && server.pid !== undefined) {
		await stopTaskkillTree(server.pid);
	}
	const { promise, resolve } = Promise.withResolvers<void>();
	const timer = setTimeout(() => {
		try {
			server.kill('SIGKILL');
		} catch {}
		resolve();
	}, 10000);
	server.once('exit', () => {
		clearTimeout(timer);
		resolve();
	});
	if (process.platform !== 'win32') {
		try {
			server.kill('SIGTERM');
		} catch {
			clearTimeout(timer);
			resolve();
		}
	} else if (server.exitCode !== null || server.signalCode !== null) {
		clearTimeout(timer);
		resolve();
	}
	await promise;
}

async function runScenario(
	name: string,
	scenario: Scenario,
	context: ScenarioContext
): Promise<void> {
	const started = Date.now();
	try {
		await scenario(context);
		log(`PASS ${name} (${Date.now() - started}ms)`);
	} catch (error) {
		const detail =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		fail(`FAIL ${name}\n${detail}`);
	}
}

export async function runLeadsIntegration(
	getResolved: () => ResolvedSafety
): Promise<void> {
	const resolved = getResolved();
	const keep =
		process.argv.includes('--keep') ||
		process.env.LEADS_INTEGRATION_KEEP === '1';
	const port = NEXT_PORT;
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		fail('LEADS_INTEGRATION_PORT must be a TCP port');
	const baseUrl = `http://127.0.0.1:${port}`;
	const runTag = `LIT369-${runIdFromDate()}`;
	const database = resolved.name;

	let reader: Connection | null = null;
	let server: ChildProcess | null = null;
	let knex: KnexInstance | null = null;
	let identities: FixtureIdentities | null = null;
	let databaseCreated = false;
	let scenariosPassed = false;

	try {
		const serverConnection = await connectServer(resolved);
		try {
			try {
				await serverConnection.execute(
					`CREATE DATABASE \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
					[]
				);
			} catch (error) {
				if (isDatabaseExistsError(error)) {
					fail(
						`refusing to reuse existing database ${JSON.stringify(database)}: ` +
							`drop it manually or pick a fresh INTEGRATION_DB_NAME.`
					);
				}
				throw error;
			}
			databaseCreated = true;
		} finally {
			await serverConnection.end();
		}

		knex = createKnex(resolved);
		const preLead = preLeadMigrationFiles();
		log(
			`migrating disposable database ${database} to pre-369 (${preLead.length} files; expect ~2 minutes)`
		);
		for (const file of preLead) {
			await knex.migrate.up({ name: file });
		}

		const seeder = await connectReader(resolved);
		let legacySeeds: LegacySeedRow[] = [];
		let legacyProposals: LegacyProposalSeed[] = [];
		let legacyScheduledLead: { id: number; followUpDate: string } | null = null;
		let lifecycleSeeds: LifecycleSeeds = {
			disqualifiedLeadId: 0,
			convertedLeadId: 0,
		};
		try {
			const passwordHash = await hashFixturePassword(FIXTURE_PASSWORD);
			await seedPreMigrationFixtures(seeder, runTag, passwordHash);
			legacySeeds = await seedLegacyRows(seeder, runTag, `${runTag} Assignee`);
			legacyScheduledLead = await seedLegacyScheduledLead(
				seeder,
				runTag,
				`${runTag} Assignee`
			);

			log(
				`applying ticket-369 lead migration ${LEAD_MIGRATION_FILE} over seeded legacy evidence`
			);
			await knex.migrate.up({ name: LEAD_MIGRATION_FILE });

			// The legacy Proposals exist before the review migration runs, so
			// the cutover sees the duplicate links it has to keep visible.
			legacyProposals = await seedLegacyProposals(seeder, runTag, legacySeeds);
			log(
				`applying legacy review migration ${LEGACY_REVIEW_MIGRATION_FILE} over the seeded legacy Proposals`
			);
			await knex.migrate.up({ name: LEGACY_REVIEW_MIGRATION_FILE });
			await knex.migrate.latest();
			lifecycleSeeds = await seedLifecycleFixtures(
				seeder,
				runTag,
				fixtureUsername(runTag, 'assignee')
			);
		} finally {
			await seeder.end();
		}

		reader = await connectReader(resolved);
		for (const migration of [
			LEAD_MIGRATION_FILE,
			LEGACY_REVIEW_MIGRATION_FILE,
		]) {
			const [appliedRows] = await reader.execute(
				'SELECT COUNT(*) AS total FROM knex_migrations WHERE name = ?',
				[migration]
			);
			const [applied] = appliedRows;
			if (Number(applied?.total ?? 0) !== 1)
				fail(`migration ${migration} not recorded applied`);
		}

		const http = makeHttp(baseUrl);
		server = startAppServer(resolved, port);
		const trackedLeads: number[] = [];
		await waitForHealth(baseUrl, server, 180000);
		identities = await loginFixtureIdentities(reader, http, runTag);
		const context: ScenarioContext = {
			http,
			reader: makeReader(reader),
			runTag,
			...identities,
			trackLead: (id) => {
				trackedLeads.push(id);
			},
		};

		log(IBAND);
		log(`run ${runTag} against ${baseUrl} db=${database}`);
		await runScenario('creator-assignment', creatorAssignmentScenario, context);
		await runScenario(
			'permitted-assignment',
			permittedAssignmentScenario,
			context
		);
		await runScenario(
			'denied-assignment-no-mutation',
			deniedAssignmentPersistsNothingScenario,
			context
		);
		await runScenario('unassigned-import', unassignedImportScenario, context);
		await runScenario(
			'owner-selected-import',
			ownerSelectedImportScenario,
			context
		);
		await runScenario(
			'import-owner-evidence-never-resolves',
			importOwnerEvidenceNeverResolvesScenario,
			context
		);
		await runScenario(
			'raw-import-evidence',
			rawImportEvidenceScenario,
			context
		);
		await runScenario(
			'invalid-import-owner',
			invalidImportOwnerScenario,
			context
		);
		await runScenario(
			'active-import-requirements',
			activeImportRequirementsScenario,
			context
		);
		await runScenario('separate-enquiries', separateEnquiriesScenario, context);
		await runScenario('duplicate-review', duplicateReviewScenario, context);
		await runScenario('durable-reads', durableReadsScenario, context);
		await runScenario(
			'legacy-evidence',
			(ctx) => legacyEvidenceScenario(ctx, legacySeeds),
			context
		);
		const reviewSeeds = buildLegacyReviewSeeds(legacySeeds, legacyProposals);
		await runScenario(
			'legacy-review-queue',
			(ctx) => legacyReviewQueueScenario(ctx, reviewSeeds),
			context
		);
		await runScenario(
			'legacy-review-denied',
			(ctx) => legacyReviewDeniedScenario(ctx, reviewSeeds),
			context
		);
		await runScenario(
			'legacy-review-invalid',
			(ctx) => legacyReviewInvalidScenario(ctx, reviewSeeds),
			context
		);
		await runScenario(
			'legacy-review-resolution',
			(ctx) => legacyReviewResolutionScenario(ctx, reviewSeeds),
			context
		);
		await runScenario(
			'proposal-link-guard',
			(ctx) => proposalLinkGuardScenario(ctx, reviewSeeds),
			context
		);
		await runScenario(
			'proposal-link-edit',
			(ctx) => proposalLinkEditScenario(ctx, reviewSeeds),
			context
		);
		await runScenario('outreach-outcomes', outreachOutcomesScenario, context);
		await runScenario(
			'email-reply-versus-sent',
			emailReplyVersusSentScenario,
			context
		);
		await runScenario('note-only-logging', noteOnlyLoggingScenario, context);
		await runScenario(
			'owner-and-date-refusals',
			ownerAndDateRefusalScenario,
			context
		);
		await runScenario(
			'last-open-task-close',
			lastOpenTaskCloseScenario,
			context
		);
		await runScenario(
			'no-regression',
			(ctx) => noRegressionScenario(ctx, lifecycleSeeds),
			context
		);
		await runScenario(
			'timeline-persistence',
			timelinePersistenceScenario,
			context
		);
		await runScenario('lead-work-queue', leadWorkQueueScenario, context);
		await runScenario(
			'legacy-activity-evidence',
			(ctx) =>
				legacyActivityEvidenceScenario(
					ctx,
					legacyScheduledLead ?? { id: 0, followUpDate: '' }
				),
			context
		);
		await runScenario(
			'qualification-missing-fields',
			qualificationMissingFieldsScenario,
			context
		);
		await runScenario(
			'qualification-without-budget-or-timing',
			qualificationWithoutBudgetOrTimingScenario,
			context
		);
		await runScenario(
			'nurture-with-next-action',
			nurtureWithNextActionScenario,
			context
		);
		await runScenario(
			'nurture-without-next-action',
			nurtureWithoutNextActionScenario,
			context
		);
		await runScenario(
			'disqualify-without-reason',
			disqualifyWithoutReasonScenario,
			context
		);
		await runScenario(
			'disqualify-cancels-outstanding-work',
			disqualifyCancelsOutstandingWorkScenario,
			context
		);
		await runScenario(
			'reopen-with-required-fields',
			reopenWithRequiredFieldsScenario,
			context
		);
		await runScenario(
			'reopen-missing-fields',
			reopenMissingFieldsScenario,
			context
		);
		await runScenario(
			'converted-lead-takes-no-decision',
			(ctx) => convertedLeadTakesNoDecisionScenario(ctx, lifecycleSeeds),
			context
		);
		await runScenario(
			'generic-paths-cannot-decide-the-lifecycle',
			genericPathsCannotDecideTheLifecycleScenario,
			context
		);
		await runScenario(
			'lifecycle-unauthorized',
			lifecycleUnauthorizedScenario,
			context
		);
		log(IBAND);
		log(`PASS all 39 scenarios (${trackedLeads.length} leads created)`);
		scenariosPassed = true;
	} finally {
		// --keep retains the database only after a full pass; every other
		// path stops the server and drops the disposable database. A failed
		// drop is fatal: the run must never PASS while leaving data behind.
		if (!(keep && scenariosPassed)) {
			await stopAppServer(server);
			if (knex !== null) {
				try {
					await knex.destroy();
				} catch {}
			}
			if (reader !== null) {
				try {
					await reader.end();
				} catch {}
			}
			if (databaseCreated) {
				try {
					await dropDatabase(resolved);
				} catch (error) {
					fail(
						`cleanup: could not drop ${database}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}
		}
	}

	if (keep && scenariosPassed && identities !== null) {
		log(IBAND);
		log(
			`KEEP: server still running at ${baseUrl}; database ${database} retained.`
		);
		log(`creator login: ${identities.creator.username} / ${FIXTURE_PASSWORD}`);
		log(
			`assignee login: ${identities.assignee.username} / ${FIXTURE_PASSWORD}`
		);
		log(
			'Stop the server with Ctrl+C when finished; drop the database manually.'
		);
		log(IBAND);
		const keepAlive = Promise.withResolvers<void>();
		await keepAlive.promise;
	}
}

async function seedPreMigrationFixtures(
	connection: Connection,
	runTag: string,
	passwordHash: string
): Promise<void> {
	// Users referenced by legacy evidence must exist before the lead mapping
	// runs. Sessions happen later over real HTTP login after the server starts.
	for (const spec of fixtureSpecs(runTag)) {
		await seedFixtureUser(connection, runTag, spec, passwordHash);
	}
	await seedDuplicateNameTie(connection, runTag, passwordHash);
}
