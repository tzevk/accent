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
	DbConversionRow,
	DbCorrectionRow,
	DbLeadRow,
	DbOwnershipRow,
	DbProposalFollowupRow,
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
	scheduledTaskCompletionScenario,
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
import {
	activityCorrectionScenario,
	deniedCorrectionScenario,
	legacyCorrectionProvenanceScenario,
	missingReasonCorrectionScenario,
	noDestructiveActivityPathScenario,
	staleVersionCorrectionScenario,
	unownedCorrectionRefusalScenario,
} from './scenarios/corrections.ts';
import {
	deletedLeadsLeaveTheQueueScenario,
	dueQueueScenario,
	emptyQueueScenario,
	myLeadsQueueScenario,
	noNextActionQueueScenario,
	queueCountersScenario,
	queueFiltersScenario,
	unassignedQueueScenario,
	untouchedQueueScenario,
	type QueueSeeds,
} from './scenarios/queues.ts';
import {
	conversionConcurrentScenario,
	conversionConflictScenario,
	conversionHandoffScenario,
	conversionPermissionsScenario,
	conversionQualificationScenario,
	conversionReadAndQueueScenario,
	conversionRepeatScenario,
	conversionRollbackScenario,
	conversionStageRequiredScenario,
	type ConversionSeeds,
	type FailureInjection,
} from './scenarios/conversion.ts';

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
			converted_at: nullableString(row.converted_at),
			converted_by: nullableNumber(row.converted_by),
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
			canonical_lead_id: nullableNumber(row.canonical_lead_id),
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
			version: nullableNumber(row.version),
			transferred_followup_id: nullableNumber(row.transferred_followup_id),
			transferred_at: nullableString(row.transferred_at),
		};
	}

	function toCorrectionRow(row: Record<string, unknown>): DbCorrectionRow {
		return {
			id: requiredNumber(row.id, 'lead_activity_corrections.id'),
			activity_id: requiredNumber(
				row.activity_id,
				'lead_activity_corrections.activity_id'
			),
			lead_id: requiredNumber(row.lead_id, 'lead_activity_corrections.lead_id'),
			previous_values: String(row.previous_values ?? ''),
			corrected_values: String(row.corrected_values ?? ''),
			reason: String(row.reason ?? ''),
			corrected_by: nullableNumber(row.corrected_by),
			corrected_at: nullableString(row.corrected_at),
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

	function toConversionRow(row: Record<string, unknown>): DbConversionRow {
		return {
			id: requiredNumber(row.id, 'lead_conversions.id'),
			lead_id: requiredNumber(row.lead_id, 'lead_conversions.lead_id'),
			proposal_id: requiredNumber(
				row.proposal_id,
				'lead_conversions.proposal_id'
			),
			converted_by: nullableNumber(row.converted_by),
			converted_at: nullableString(row.converted_at),
		};
	}

	function toProposalFollowupRow(
		row: Record<string, unknown>
	): DbProposalFollowupRow {
		return {
			id: requiredNumber(row.id, 'proposal_followups.id'),
			proposal_id: requiredNumber(
				row.proposal_id,
				'proposal_followups.proposal_id'
			),
			follow_up_date: nullableString(row.follow_up_date),
			follow_up_type: nullableString(row.follow_up_type),
			description: nullableString(row.description),
			status: nullableString(row.status),
			created_by: nullableNumber(row.created_by),
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
				'SELECT id, lead_id, proposal_title, status, canonical_lead_id, isDelete FROM proposals WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toProposalRow);
		},
		proposalRow: async (id) => {
			const row = await firstRow(
				'SELECT id, lead_id, proposal_title, status, canonical_lead_id, isDelete FROM proposals WHERE id = ? LIMIT 1',
				[id]
			);
			return row ? toProposalRow(row) : null;
		},
		conversionRows: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT id, lead_id, proposal_id, converted_by, converted_at FROM lead_conversions WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toConversionRow);
		},
		proposalFollowups: async (proposalId) => {
			const [rows] = await connection.execute(
				'SELECT id, proposal_id, follow_up_date, follow_up_type, description, status, created_by FROM proposal_followups WHERE proposal_id = ? ORDER BY id ASC',
				[proposalId]
			);
			return rows.map(toProposalFollowupRow);
		},
		countProposalFollowups: async () => {
			const row = await firstRow(
				'SELECT COUNT(*) AS total FROM proposal_followups',
				[]
			);
			return Number(row?.total ?? 0);
		},
		activityRows: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toActivityRow);
		},
		correctionRows: async (leadId) => {
			const [rows] = await connection.execute(
				'SELECT * FROM lead_activity_corrections WHERE lead_id = ? ORDER BY id ASC',
				[leadId]
			);
			return rows.map(toCorrectionRow);
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
		databaseToday: async () => {
			const row = await firstRow(
				"SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
				[]
			);
			return String(row?.today ?? '');
		},
		queueCounts: async (search, viewerUserId) => {
			const { clause, params } = leadSearchClause(search);
			const [rows] = await connection.execute(
				`SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN l.owner_user_id = ? THEN 1 ELSE 0 END) AS my_leads,
            SUM(CASE WHEN l.owner_user_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM lead_activities a
              WHERE a.lead_id = l.id AND a.status = 'Scheduled'
                AND a.transferred_followup_id IS NULL
                AND a.scheduled_for IS NOT NULL
                AND (a.isDelete = 0 OR a.isDelete IS NULL)
                AND a.scheduled_for = CURDATE()
            ) THEN 1 ELSE 0 END) AS due_today,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM lead_activities a
              WHERE a.lead_id = l.id AND a.status = 'Scheduled'
                AND a.transferred_followup_id IS NULL
                AND a.scheduled_for IS NOT NULL
                AND (a.isDelete = 0 OR a.isDelete IS NULL)
                AND a.scheduled_for < CURDATE()
            ) THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN NOT EXISTS (
              SELECT 1 FROM lead_activities a
              WHERE a.lead_id = l.id AND a.status = 'Completed'
                AND a.activity_type IN ('Call', 'Email', 'Meeting')
                AND (a.isDelete = 0 OR a.isDelete IS NULL)
            ) THEN 1 ELSE 0 END) AS untouched,
            SUM(CASE WHEN l.enquiry_status IN ('Attempting Contact', 'Connected', 'Qualified', 'Nurture')
              AND NOT EXISTS (
                SELECT 1 FROM lead_activities a
                WHERE a.lead_id = l.id AND a.status = 'Scheduled'
                  AND a.transferred_followup_id IS NULL
                  AND a.scheduled_for IS NOT NULL
                  AND (a.isDelete = 0 OR a.isDelete IS NULL)
              ) THEN 1 ELSE 0 END) AS no_next_action
          FROM leads l
          WHERE (l.isDelete = 0 OR l.isDelete IS NULL) ${clause}`,
				[viewerUserId, ...params]
			);
			const [row] = rows as Array<Record<string, unknown>>;
			return {
				total: Number(row?.total ?? 0),
				my_leads: Number(row?.my_leads ?? 0),
				unassigned: Number(row?.unassigned ?? 0),
				due_today: Number(row?.due_today ?? 0),
				overdue: Number(row?.overdue ?? 0),
				untouched: Number(row?.untouched ?? 0),
				no_next_action: Number(row?.no_next_action ?? 0),
			};
		},
		countActiveLeads: async (search) => {
			const { clause, params } = leadSearchClause(search);
			const row = await firstRow(
				`SELECT COUNT(*) AS total FROM leads l
          WHERE (l.isDelete = 0 OR l.isDelete IS NULL) ${clause}`,
				params
			);
			return Number(row?.total ?? 0);
		},
	};
}

/**
 * The search of the Lead list, as the API reads it: the search term matches
 * the Lead id, the company, the contact, the contact email, and the project
 * description. The reader uses it to count the same dataset the API counts.
 */
function leadSearchClause(search: string): {
	clause: string;
	params: Array<string | number | null>;
} {
	if (!search) return { clause: '', params: [] };
	const term = `%${search.toLowerCase()}%`;
	return {
		clause:
			' AND (LOWER(l.lead_id) LIKE ? OR LOWER(l.company_name) LIKE ? OR LOWER(l.contact_name) LIKE ? OR LOWER(l.contact_email) LIKE ? OR LOWER(l.project_description) LIKE ?)',
		params: [term, term, term, term, term],
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
		// The Lead-to-Proposal handoff needs the Lead convert right, the
		// Lead update right, and the right to create Proposals.
		'leads:convert',
		// Proposal read access lets the reviewer see the linked Proposals
		// the canonical choice is made between.
		'proposals:read',
		'proposals:create',
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
			// The Lead convert right without the right to create Proposals:
			// the handoff refuses a missing grant.
			permissions: [
				'leads:read',
				'leads:create',
				'leads:update',
				'leads:convert',
			],
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
 * The legacy records the queue scenarios work on: a Lead in an active stage
 * without a dated next action, a Lead whose owner name could not be
 * resolved (and whose stage could not be resolved either), and a Lead whose
 * dated next action the cutover preserved.
 */
function buildQueueSeeds(
	legacySeeds: LegacySeedRow[],
	legacyScheduledLead: { id: number; followUpDate: string } | null
): QueueSeeds {
	const byMarker = (marker: LegacySeedRow['ownerMarker']): LegacySeedRow => {
		const seed = legacySeeds.find(
			(candidate) => candidate.ownerMarker === marker
		);
		if (!seed) fail(`legacy seed present for ${marker}`);
		return seed;
	};
	const unresolved = byMarker('__UNKNOWN_NAME__');
	return {
		activeStageWithoutNextActionLeadId: byMarker('__CLEAN_MAP__').id,
		unresolvedOwnerLeadId: unresolved.id,
		unresolvedStageLeadId: unresolved.id,
		scheduledLegacyLeadId: legacyScheduledLead?.id ?? 0,
	};
}

interface SeededActivity {
	activity_type: string;
	scheduled_for: string;
	next_action: string;
}

interface SeededLeadFacts {
	stage: string;
	contact_name: string | null;
	contact_email: string | null;
	phone: string | null;
	project_description: string | null;
	owner_user_id: number | null;
	scheduled: SeededActivity[];
	completed: Array<{ activity_type: string; occurred_at: string }>;
}

/** A date the scheduled work of the seeded enquiries carries. */
async function seededDate(
	connection: Connection,
	daysAhead: number
): Promise<string> {
	const [rows] = await connection.execute(
		`SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), '%Y-%m-%d') AS date`,
		[daysAhead]
	);
	const [row] = rows as Array<Record<string, unknown>>;
	const value = row?.date;
	if (typeof value !== 'string' || value === '') {
		fail('the seeded date could not be read');
	}
	return value;
}

async function seedConversionLead(
	connection: Connection,
	runTag: string,
	key: string,
	facts: SeededLeadFacts
): Promise<number> {
	const companyName = `${runTag} ${key} Co`;
	await connection.execute(
		`INSERT INTO leads (company_name, contact_name, contact_email, phone,
        project_description, enquiry_status, owner_user_id, follow_up_date,
        isDelete, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
		[
			companyName,
			facts.contact_name,
			facts.contact_email,
			facts.phone,
			facts.project_description,
			facts.stage,
			facts.owner_user_id,
			facts.scheduled[0]?.scheduled_for ?? null,
		]
	);
	const [rows] = await connection.execute(
		'SELECT id FROM leads WHERE company_name = ? ORDER BY id DESC LIMIT 1',
		[companyName]
	);
	const [created] = rows;
	if (!created) fail(`conversion seed ${companyName} missing after insert`);
	const leadId = requiredNumber(created.id, 'leads.id');
	for (const task of facts.scheduled) {
		await connection.execute(
			`INSERT INTO lead_activities (lead_id, activity_type, status,
          scheduled_for, next_action, notes, created_by, recorded_at,
          created_at, updated_at, isDelete)
         VALUES (?, ?, 'Scheduled', ?, ?, NULL, NULL, NOW(), NOW(), NOW(), 0)`,
			[leadId, task.activity_type, task.scheduled_for, task.next_action]
		);
	}
	for (const done of facts.completed) {
		await connection.execute(
			`INSERT INTO lead_activities (lead_id, activity_type, status,
          occurred_at, completed_at, notes, created_by, recorded_at,
          created_at, updated_at, isDelete)
         VALUES (?, ?, 'Completed', ?, ?, NULL, NULL, NOW(), NOW(), NOW(), 0)`,
			[leadId, done.activity_type, done.occurred_at, done.occurred_at]
		);
	}
	return leadId;
}

async function seedConversionFixtures(
	connection: Connection,
	runTag: string,
	ownerUsername: string
): Promise<ConversionSeeds> {
	const [userRows] = await connection.execute(
		'SELECT id FROM users WHERE username = ? LIMIT 1',
		[ownerUsername]
	);
	const [owner] = userRows;
	if (!owner) fail(`fixture user ${ownerUsername} missing before seeding`);
	const ownerUserId = Number(owner.id);
	const taskDate = await seededDate(connection, 5);
	const secondTaskDate = await seededDate(connection, 9);
	const overdueDate = await seededDate(connection, -1);
	const completedAt = await seededDate(connection, 3);

	const qualified = {
		stage: 'Qualified',
		contact_name: 'Cleo Client',
		contact_email: 'cleo@example.com',
		phone: '+91 98765 43210',
		project_description: 'A plant extension for the Chakan unit',
		owner_user_id: ownerUserId,
		scheduled: [
			{
				activity_type: 'Call',
				scheduled_for: taskDate,
				next_action: 'Call about the tender',
			},
		],
		completed: [
			{ activity_type: 'Meeting', occurred_at: `${completedAt} 10:00:00` },
		],
	};

	const qualifiedLeadId = await seedConversionLead(
		connection,
		runTag,
		'Convertible',
		qualified
	);
	const repeatLeadId = await seedConversionLead(
		connection,
		runTag,
		'Repeatable',
		qualified
	);
	const concurrentLeadId = await seedConversionLead(
		connection,
		runTag,
		'Concurrent',
		qualified
	);
	const queueLeadId = await seedConversionLead(connection, runTag, 'Queued', {
		...qualified,
		// The oldest outstanding task, so it is the first entry of the
		// Lead work queue the queue proof reads.
		scheduled: [
			{
				activity_type: 'Call',
				scheduled_for: overdueDate,
				next_action: 'Call about the tender',
			},
		],
	});
	const rollbackLeadId = await seedConversionLead(
		connection,
		runTag,
		'Rollback',
		{
			...qualified,
			scheduled: [
				{
					activity_type: 'Call',
					scheduled_for: taskDate,
					next_action: 'Call about the tender',
				},
				{
					activity_type: 'Email',
					scheduled_for: secondTaskDate,
					next_action: 'Send the revised quotation',
				},
			],
		}
	);
	const noContactLeadId = await seedConversionLead(
		connection,
		runTag,
		'No Contact',
		{ ...qualified, contact_name: null }
	);
	const noDetailsLeadId = await seedConversionLead(
		connection,
		runTag,
		'No Details',
		{ ...qualified, contact_email: null, phone: null }
	);
	const noNeedLeadId = await seedConversionLead(connection, runTag, 'No Need', {
		...qualified,
		project_description: null,
	});
	const noOwnerLeadId = await seedConversionLead(
		connection,
		runTag,
		'No Owner',
		{ ...qualified, owner_user_id: null }
	);
	const notQualifiedLeadId = await seedConversionLead(
		connection,
		runTag,
		'Not Qualified',
		{ ...qualified, stage: 'Connected' }
	);

	// The unresolved legacy link: two Proposals point at the enquiry and no
	// canonical choice was made.
	const conflictLeadId = await seedConversionLead(
		connection,
		runTag,
		'Conflict',
		qualified
	);
	const conflictProposalIds: number[] = [];
	for (const title of ['one', 'two']) {
		await connection.execute(
			`INSERT INTO proposals (proposal_title, lead_id, status, isDelete)
         VALUES (?, ?, 'DRAFT', 0)`,
			[`${runTag} legacy proposal ${title}`, conflictLeadId]
		);
		const [rows] = await connection.execute(
			'SELECT id FROM proposals WHERE lead_id = ? ORDER BY id DESC LIMIT 1',
			[conflictLeadId]
		);
		const [created] = rows;
		if (!created) fail(`legacy proposal ${title} missing after insert`);
		conflictProposalIds.push(requiredNumber(created.id, 'proposals.id'));
	}
	await connection.execute(
		`UPDATE leads SET legacy_proposal_conflict = 1, legacy_proposal_reviewed = 0
       WHERE id = ?`,
		[conflictLeadId]
	);

	return {
		qualifiedLeadId,
		repeatLeadId,
		concurrentLeadId,
		rollbackLeadId,
		queueLeadId,
		noContactLeadId,
		noDetailsLeadId,
		noNeedLeadId,
		noOwnerLeadId,
		notQualifiedLeadId,
		conflictLeadId,
		conflictProposalIds,
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

/**
 * The deterministic database failure of the conversion proof.
 *
 * The trigger lives in the disposable integration database only and is
 * armed by the harness, never by the application: the production code has
 * no control that can fail a conversion on purpose. The trigger refuses
 * the second Proposal follow-up of a Proposal, so the handoff fails after
 * the first task was already written: the rollback has to undo a task that
 * was inserted inside the failed transaction.
 */
const FAILURE_TRIGGER = 'trg_leads_conversion_failure';

function createFailureInjection(connection: Connection): FailureInjection {
	return {
		install: async () => {
			await connection.query(`DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER}`);
			await connection.query(
				`CREATE TRIGGER ${FAILURE_TRIGGER} BEFORE INSERT ON proposal_followups
         FOR EACH ROW
         BEGIN
           IF (SELECT COUNT(*) FROM proposal_followups WHERE proposal_id = NEW.proposal_id) >= 1 THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected conversion failure';
           END IF;
         END`
			);
		},
		remove: async () => {
			await connection.query(`DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER}`);
		},
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
		let conversionSeeds: ConversionSeeds = {
			qualifiedLeadId: 0,
			repeatLeadId: 0,
			concurrentLeadId: 0,
			rollbackLeadId: 0,
			queueLeadId: 0,
			noContactLeadId: 0,
			noDetailsLeadId: 0,
			noNeedLeadId: 0,
			noOwnerLeadId: 0,
			notQualifiedLeadId: 0,
			conflictLeadId: 0,
			conflictProposalIds: [],
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
			conversionSeeds = await seedConversionFixtures(
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
			'scheduled-task-completion',
			scheduledTaskCompletionScenario,
			context
		);
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
			'activity-correction',
			activityCorrectionScenario,
			context
		);
		await runScenario('denied-correction', deniedCorrectionScenario, context);
		await runScenario(
			'missing-reason-correction',
			missingReasonCorrectionScenario,
			context
		);
		await runScenario(
			'stale-version-correction',
			staleVersionCorrectionScenario,
			context
		);
		await runScenario(
			'unowned-correction-refusal',
			unownedCorrectionRefusalScenario,
			context
		);
		await runScenario(
			'legacy-correction-provenance',
			(ctx) =>
				legacyCorrectionProvenanceScenario(
					ctx,
					legacyScheduledLead ?? { id: 0, followUpDate: '' }
				),
			context
		);
		await runScenario(
			'no-destructive-activity-path',
			noDestructiveActivityPathScenario,
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
		const queueSeeds = buildQueueSeeds(legacySeeds, legacyScheduledLead);
		await runScenario('my-leads-queue', myLeadsQueueScenario, context);
		await runScenario(
			'unassigned-queue',
			(ctx) => unassignedQueueScenario(ctx, queueSeeds),
			context
		);
		await runScenario('due-queue', dueQueueScenario, context);
		await runScenario('untouched-queue', untouchedQueueScenario, context);
		await runScenario(
			'no-next-action-queue',
			(ctx) => noNextActionQueueScenario(ctx, queueSeeds),
			context
		);
		await runScenario('queue-counters', queueCountersScenario, context);
		await runScenario('empty-queue', emptyQueueScenario, context);
		await runScenario('queue-filters', queueFiltersScenario, context);
		await runScenario(
			'deleted-leads-leave-the-queue',
			deletedLeadsLeaveTheQueueScenario,
			context
		);
		const failureInjection: FailureInjection = createFailureInjection(reader);
		await runScenario(
			'conversion-permissions',
			(ctx) => conversionPermissionsScenario(ctx, conversionSeeds),
			context
		);
		await runScenario(
			'conversion-qualification',
			(ctx) => conversionQualificationScenario(ctx, conversionSeeds),
			context
		);
		await runScenario(
			'conversion-stage-required',
			(ctx) => conversionStageRequiredScenario(ctx, conversionSeeds),
			context
		);
		await runScenario('conversion-handoff', conversionHandoffScenario, context);
		await runScenario(
			'conversion-repeat',
			(ctx) => conversionRepeatScenario(ctx, conversionSeeds),
			context
		);
		await runScenario(
			'conversion-concurrent',
			(ctx) => conversionConcurrentScenario(ctx, conversionSeeds),
			context
		);
		await runScenario(
			'conversion-legacy-conflict',
			(ctx) => conversionConflictScenario(ctx, conversionSeeds),
			context
		);
		await runScenario(
			'conversion-rollback',
			(ctx) =>
				conversionRollbackScenario(ctx, conversionSeeds, failureInjection),
			context
		);
		await runScenario(
			'conversion-read-and-queue',
			(ctx) => conversionReadAndQueueScenario(ctx, conversionSeeds),
			context
		);
		log(IBAND);
		log(`PASS all 65 scenarios (${trackedLeads.length} leads created)`);
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
