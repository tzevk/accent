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
	DbLeadRow,
	DbOwnershipRow,
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
	legacyEvidenceScenario,
	type LegacySeedRow,
} from './scenarios/legacy.ts';

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
			follow_up_date: nullableString(row.follow_up_date),
			isDelete: nullableNumber(row.isDelete),
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
}

function fixtureSpecs(runTag: string): FixtureSpec[] {
	const fullPermissions = [
		'leads:read',
		'leads:create',
		'leads:update',
		'leads:delete',
		'leads:import',
		'leads:assign',
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
	const [creator, assignee, readOnly, noAssign] = identities;
	if (!creator || !assignee || !readOnly || !noAssign)
		fail('fixture login incomplete');
	return { creator, assignee, readOnly, noAssign };
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
		try {
			const passwordHash = await hashFixturePassword(FIXTURE_PASSWORD);
			await seedPreMigrationFixtures(seeder, runTag, passwordHash);
			legacySeeds = await seedLegacyRows(seeder, runTag, `${runTag} Assignee`);
		} finally {
			await seeder.end();
		}

		log(
			`applying ticket-369 lead migration ${LEAD_MIGRATION_FILE} over seeded legacy evidence`
		);
		await knex.migrate.up({ name: LEAD_MIGRATION_FILE });
		await knex.migrate.latest();

		reader = await connectReader(resolved);
		const [appliedRows] = await reader.execute(
			'SELECT COUNT(*) AS total FROM knex_migrations WHERE name = ?',
			[LEAD_MIGRATION_FILE]
		);
		const [applied] = appliedRows;
		if (Number(applied?.total ?? 0) !== 1)
			fail(`lead migration ${LEAD_MIGRATION_FILE} not recorded applied`);

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
		log(IBAND);
		log(`PASS all 13 scenarios (${trackedLeads.length} leads created)`);
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
