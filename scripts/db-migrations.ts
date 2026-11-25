import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { executeMigrationSql, type MigrationDb } from './migration-sql.ts';

const HISTORICAL_MIGRATION_COUNT = 68;
const LEGACY_MIGRATIONS_TABLE = 'knex_migrations';
const LEGACY_MIGRATIONS_LOCK_TABLE = 'knex_migrations_lock';
const HISTORICAL_MIGRATION_NAME = /^\d{14}_.+\.(?:js|ts)$/;

const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';
const DRIZZLE_MIGRATION_LOCK_NAME_SQL =
	"SHA2(CONCAT('accent:drizzle-migrations:', DATABASE()), 256)";
const DRIZZLE_MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

interface DrizzleMigrationStatus {
	ledgerExists: boolean;
	applied: number;
	pending: number;
	legacyApplied: number;
}

interface MigrationLedgerRow extends RowDataPacket {
	hash: string;
	created_at: number | string | null;
}

interface LegacyMigrationRow extends RowDataPacket {
	name: string;
}

interface DatabaseTableRow extends RowDataPacket {
	TABLE_NAME: string;
	TABLE_TYPE: string;
}

interface Migration {
	hash: string;
	createdAt: number;
}

interface HistoricalMigration extends Migration {
	originalFilename: string;
	sourcePath: string;
}

interface NativeMigration extends Migration {
	name: string;
	sql: string[];
}

interface MigrationCatalog {
	historical: HistoricalMigration[];
	native: NativeMigration[];
	all: Migration[];
}

type MigrationState = DrizzleMigrationStatus;

interface DrizzleMigrationOptions {
	before?: string;
	through?: string;
}

const HISTORICAL_MIGRATION_MANIFEST_SCHEMA = z
	.array(z.string().regex(HISTORICAL_MIGRATION_NAME))
	.length(HISTORICAL_MIGRATION_COUNT)
	.refine(
		(filenames) =>
			filenames.every(
				(filename, index) => index === 0 || filename > filenames[index - 1]!
			),
		{ message: 'Historical migration filenames must be strictly sorted' }
	)
	.refine(
		(filenames) =>
			filenames.every(
				(filename) => !filename.includes('/') && !filename.includes('\\')
			),
		{
			message:
				'Historical migration filenames must not contain path separators',
		}
	);

const DRIZZLE_MIGRATION_FOLDER_NAME = /^(\d{14})_(.+)$/;

function utcMillisFromMigrationFolder(name: string): number | null {
	const match = DRIZZLE_MIGRATION_FOLDER_NAME.exec(name);
	if (match === null) {
		return null;
	}

	const timestamp = match[1]!;
	const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}.000Z`;
	const millis = Date.parse(iso);
	return Number.isFinite(millis) && new Date(millis).toISOString() === iso
		? millis
		: null;
}

const DRIZZLE_MIGRATION_FOLDER_SCHEMA = z
	.string()
	.regex(DRIZZLE_MIGRATION_FOLDER_NAME)
	.refine((name) => utcMillisFromMigrationFolder(name) !== null, {
		message: 'Migration folders must start with a valid UTC timestamp',
	})
	.refine((name) => !name.includes('/') && !name.includes('\\'), {
		message: 'Migration folder names must not contain path separators',
	});

const DRIZZLE_NATIVE_MIGRATION_SCHEMA = z
	.strictObject({
		sql: z.array(z.string()).min(1),
		bps: z.literal(true),
		folderMillis: z.int().positive(),
		hash: z.string().regex(/^[a-f0-9]{64}$/),
		name: DRIZZLE_MIGRATION_FOLDER_SCHEMA,
	})
	.refine(
		(migration) =>
			migration.folderMillis === utcMillisFromMigrationFolder(migration.name) &&
			migration.folderMillis > HISTORICAL_MIGRATION_COUNT,
		{
			message:
				'Migration metadata must match its UTC folder timestamp and follow historical migrations',
		}
	);

function readNativeMigrationFolders(migrationsFolder: string): string[] {
	const entries = readdirSync(migrationsFolder, { withFileTypes: true });
	const names: string[] = [];
	for (const entry of entries) {
		if (entry.name === 'history') {
			if (!entry.isDirectory()) {
				throw new Error(
					`Drizzle history path must be a directory: ${entry.name}`
				);
			}
			continue;
		}

		if (entry.name === 'meta') {
			const metaPath = path.join(migrationsFolder, entry.name);
			// Deleting the old journal can leave an empty local directory.
			if (!entry.isDirectory() || readdirSync(metaPath).length > 0) {
				throw new Error(
					`Unsupported Drizzle metadata at ${metaPath}; only an empty legacy directory is allowed.`
				);
			}
			continue;
		}

		if (!entry.isDirectory()) {
			throw new Error(
				`Unexpected file in Drizzle migration folder: ${entry.name}. ` +
					'v3 migrations use <UTC timestamp>_<name>/migration.sql.'
			);
		}

		const result = DRIZZLE_MIGRATION_FOLDER_SCHEMA.safeParse(entry.name);
		if (!result.success) {
			throw new Error(
				`Invalid Drizzle v3 migration folder ${entry.name}: ${result.error.message}`
			);
		}

		names.push(entry.name);
	}

	return names;
}

function hashNativeMigration(name: string, sqlHash: string): string {
	return createHash('sha256')
		.update(name)
		.update('\0')
		.update(sqlHash)
		.digest('hex');
}

function readNativeMigrations(migrationsFolder: string): NativeMigration[] {
	const folderNames = readNativeMigrationFolders(migrationsFolder);
	let migrationFiles: MigrationMeta[];
	try {
		migrationFiles = readMigrationFiles({ migrationsFolder });
	} catch (error) {
		throw new Error(
			`Could not read Drizzle v3 migrations at ${migrationsFolder}: ` +
				(error instanceof Error ? error.message : String(error)),
			{ cause: error }
		);
	}

	const result = z
		.array(DRIZZLE_NATIVE_MIGRATION_SCHEMA)
		.safeParse(migrationFiles);
	if (!result.success) {
		throw new Error(
			`Invalid Drizzle v3 migration metadata at ${migrationsFolder}: ` +
				result.error.message
		);
	}

	const metadataNames = new Set(result.data.map((migration) => migration.name));
	const missingSql = folderNames.filter((name) => !metadataNames.has(name));
	if (missingSql.length > 0) {
		throw new Error(
			`Drizzle migration folders have no migration.sql: ${missingSql.join(', ')}.`
		);
	}

	const folderNameSet = new Set(folderNames);
	if (
		result.data.length !== folderNames.length ||
		metadataNames.size !== result.data.length ||
		result.data.some((migration) => !folderNameSet.has(migration.name))
	) {
		throw new Error(
			'Drizzle migration folders do not match readMigrationFiles metadata.'
		);
	}

	// Keep every folder in reader order, including distinct names in one UTC second.
	return result.data.map((migration) => ({
		name: migration.name,
		sql: migration.sql,
		hash: hashNativeMigration(migration.name, migration.hash),
		createdAt: migration.folderMillis,
	}));
}

function readDrizzleMigrations(projectRoot: string): MigrationCatalog {
	const migrationsFolder = path.resolve(projectRoot, 'drizzle');
	const historyFolder = path.join(migrationsFolder, 'history');
	const manifestPath = path.join(historyFolder, 'manifest.json');
	let manifest: unknown;

	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (error) {
		throw new Error(
			`Could not read historical migration manifest at ${manifestPath}: ` +
				(error instanceof Error ? error.message : String(error))
		);
	}

	const manifestResult =
		HISTORICAL_MIGRATION_MANIFEST_SCHEMA.safeParse(manifest);
	if (!manifestResult.success) {
		throw new Error(
			`Invalid historical migration manifest at ${manifestPath}: ` +
				manifestResult.error.message
		);
	}

	const historical = manifestResult.data.map(
		(originalFilename, index): HistoricalMigration => {
			const sourceFilename = originalFilename.replace(/\.(?:js|ts)$/, '.ts');
			const sourcePath = path.join(historyFolder, sourceFilename);
			let source: Buffer;
			try {
				source = readFileSync(sourcePath);
			} catch (error) {
				throw new Error(
					`Could not read translated historical migration at ${sourcePath}: ` +
						(error instanceof Error ? error.message : String(error))
				);
			}

			return {
				originalFilename,
				sourcePath,
				hash: createHash('sha256').update(source).digest('hex'),
				createdAt: index + 1,
			};
		}
	);
	const native = readNativeMigrations(migrationsFolder);

	return { historical, native, all: [...historical, ...native] };
}

async function readMigrationState(
	connection: Connection,
	catalog: MigrationCatalog
): Promise<MigrationState> {
	const [tableRows] = await connection.query<DatabaseTableRow[]>(
		`SELECT TABLE_NAME, TABLE_TYPE
		 FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = DATABASE()`
	);
	const baseTableNames = new Set(
		tableRows
			.filter((row) => row.TABLE_TYPE === 'BASE TABLE')
			.map((row) => String(row.TABLE_NAME))
	);
	const ledgerExists = baseTableNames.has(DRIZZLE_MIGRATIONS_TABLE);
	const legacyExists = baseTableNames.has(LEGACY_MIGRATIONS_TABLE);
	const ledgerRows = ledgerExists
		? (
				await connection.query<MigrationLedgerRow[]>(
					`SELECT hash, created_at
					 FROM \`${DRIZZLE_MIGRATIONS_TABLE}\`
					 ORDER BY created_at ASC, id ASC`
				)
			)[0]
		: [];
	const legacyRows = legacyExists
		? (
				await connection.query<LegacyMigrationRow[]>(
					`SELECT name FROM \`${LEGACY_MIGRATIONS_TABLE}\` ORDER BY id ASC`
				)
			)[0]
		: [];
	const legacyNames = legacyRows.map((row) => String(row.name));

	if (legacyNames.length > catalog.historical.length) {
		throw new Error(
			`Legacy Knex ledger has ${legacyNames.length} rows; ` +
				`historical manifest has ${catalog.historical.length}.`
		);
	}

	for (const [index, name] of legacyNames.entries()) {
		const expected = catalog.historical[index]?.originalFilename;
		if (name !== expected) {
			throw new Error(
				`Legacy Knex ledger row ${index + 1} mismatch: expected ` +
					`${String(expected)}, received ${name}.`
			);
		}
	}

	if (ledgerRows.length > catalog.all.length) {
		throw new Error(
			`Drizzle ledger has ${ledgerRows.length} rows; ` +
				`native migrations and history have ${catalog.all.length}.`
		);
	}

	for (const [index, row] of ledgerRows.entries()) {
		const migration = catalog.all[index];
		const rawCreatedAt = row.created_at;
		const createdAt =
			rawCreatedAt === null || rawCreatedAt === undefined
				? null
				: Number(rawCreatedAt);

		if (
			migration === undefined ||
			String(row.hash) !== migration.hash ||
			createdAt === null ||
			!Number.isSafeInteger(createdAt) ||
			createdAt !== migration.createdAt
		) {
			throw new Error(
				`Drizzle ledger row ${index + 1} mismatch: expected ` +
					`${migration?.hash ?? 'no migration'}@${String(migration?.createdAt)}, ` +
					`received ${String(row.hash)}@${String(rawCreatedAt)}.`
			);
		}
	}

	if (ledgerRows.length === 0 && legacyNames.length === 0) {
		const untrackedTables = tableRows
			.filter((row) => {
				const name = String(row.TABLE_NAME);
				return (
					row.TABLE_TYPE !== 'BASE TABLE' ||
					(name !== DRIZZLE_MIGRATIONS_TABLE &&
						name !== LEGACY_MIGRATIONS_TABLE &&
						name !== LEGACY_MIGRATIONS_LOCK_TABLE)
				);
			})
			.map((row) => String(row.TABLE_NAME))
			.sort();
		if (untrackedTables.length > 0) {
			throw new Error(
				'Untracked database state: no applied Drizzle or legacy Knex ' +
					`migrations, but existing tables include ${untrackedTables.join(', ')}.`
			);
		}
	}

	return {
		ledgerExists,
		applied: ledgerRows.length,
		pending: catalog.all.length - ledgerRows.length,
		legacyApplied: legacyNames.length,
	};
}

export async function readDrizzleMigrationStatus(
	connection: Connection,
	projectRoot: string
): Promise<DrizzleMigrationStatus> {
	const catalog = readDrizzleMigrations(projectRoot);
	return readMigrationState(connection, catalog);
}

async function acquireDrizzleMigrationLock(
	connection: Connection
): Promise<void> {
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT GET_LOCK(${DRIZZLE_MIGRATION_LOCK_NAME_SQL}, ?) AS acquired`,
		[DRIZZLE_MIGRATION_LOCK_TIMEOUT_SECONDS]
	);

	if (Number(rows[0]?.acquired) !== 1) {
		throw new Error(
			`Could not acquire Drizzle migration lock within ` +
				`${DRIZZLE_MIGRATION_LOCK_TIMEOUT_SECONDS}s.`
		);
	}
}

async function releaseDrizzleMigrationLock(
	connection: Connection
): Promise<void> {
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT RELEASE_LOCK(${DRIZZLE_MIGRATION_LOCK_NAME_SQL}) AS released`
	);

	if (Number(rows[0]?.released) !== 1) {
		throw new Error('Drizzle migration lock release failed.');
	}
}

async function ensureMigrationLedger(connection: Connection): Promise<void> {
	await connection.query(
		`CREATE TABLE IF NOT EXISTS \`${DRIZZLE_MIGRATIONS_TABLE}\` (
			id serial primary key,
			hash text not null,
			created_at bigint
		)`
	);
}

async function recordMigration(
	db: MigrationDb,
	migration: Migration
): Promise<void> {
	await executeMigrationSql(
		db,
		`INSERT INTO \`${DRIZZLE_MIGRATIONS_TABLE}\` (hash, created_at)
		 VALUES (?, ?)`,
		[migration.hash, migration.createdAt]
	);
}

async function adoptLegacyMigrations(
	db: MigrationDb,
	catalog: MigrationCatalog,
	state: MigrationState
): Promise<number> {
	let applied = state.applied;
	for (let index = applied; index < state.legacyApplied; index += 1) {
		const migration = catalog.historical[index];
		if (migration === undefined) {
			throw new Error('Legacy Knex migration adoption exceeds history.');
		}
		await recordMigration(db, migration);
		applied += 1;
	}
	return applied;
}

function historicalLimit(
	catalog: MigrationCatalog,
	options: DrizzleMigrationOptions
): number {
	if (options.before !== undefined && options.through !== undefined) {
		throw new Error(
			'Migration limits before and through are mutually exclusive.'
		);
	}

	const filename = options.before ?? options.through;
	if (filename === undefined) {
		return catalog.historical.length;
	}

	const index = catalog.historical.findIndex(
		(migration) => migration.originalFilename === filename
	);
	if (index === -1) {
		throw new Error(
			`Unknown historical migration limit ${filename}. Use an original ` +
				'filename from the historical manifest.'
		);
	}

	return options.before === undefined ? index + 1 : index;
}

async function runHistoricalMigration(
	db: MigrationDb,
	migration: HistoricalMigration
): Promise<void> {
	// Select historical modules at runtime so adopted and applied entries are
	// never loaded.
	const historicalModule: unknown = await import(
		pathToFileURL(migration.sourcePath).href
	);
	const up =
		typeof historicalModule === 'object' &&
		historicalModule !== null &&
		'up' in historicalModule
			? historicalModule.up
			: undefined;
	if (typeof up !== 'function') {
		throw new Error(
			`Historical migration ${migration.originalFilename} does not export up(db).`
		);
	}

	try {
		await (up as (db: MigrationDb) => Promise<void>)(db);
	} catch (error) {
		throw new Error(
			`Historical migration ${migration.originalFilename} failed: ` +
				(error instanceof Error ? error.message : String(error)),
			{ cause: error }
		);
	}
}

async function runNativeMigration(
	db: MigrationDb,
	migration: NativeMigration
): Promise<void> {
	try {
		for (const statement of migration.sql) {
			await db.execute(sql.raw(statement));
		}
	} catch (error) {
		throw new Error(
			`Drizzle migration ${migration.name} failed: ` +
				(error instanceof Error ? error.message : String(error)),
			{ cause: error }
		);
	}
}

export async function applyDrizzleMigrations(
	connection: Connection,
	projectRoot: string,
	options: DrizzleMigrationOptions = {}
): Promise<void> {
	const catalog = readDrizzleMigrations(projectRoot);
	const historyTarget = historicalLimit(catalog, options);

	await acquireDrizzleMigrationLock(connection);
	let applySucceeded = false;
	try {
		const before = await readMigrationState(connection, catalog);
		const db = drizzle({ client: connection });
		await ensureMigrationLedger(connection);
		let applied = await adoptLegacyMigrations(db, catalog, before);

		for (let index = applied; index < historyTarget; index += 1) {
			const migration = catalog.historical[index];
			if (migration === undefined) {
				throw new Error('Historical migration execution exceeds history.');
			}
			await db.transaction(async (tx) => {
				await runHistoricalMigration(tx, migration);
				await recordMigration(tx, migration);
			});
			applied += 1;
		}

		if (options.before === undefined && options.through === undefined) {
			for (let index = applied; index < catalog.all.length; index += 1) {
				const migration = catalog.native[index - catalog.historical.length];
				if (migration === undefined) {
					throw new Error('Native migration execution exceeds catalog.');
				}
				await db.transaction(async (tx) => {
					await runNativeMigration(tx, migration);
					await recordMigration(tx, migration);
				});
				applied += 1;
			}
		}

		const expectedApplied =
			options.before === undefined && options.through === undefined
				? catalog.all.length
				: Math.max(applied, historyTarget);
		const after = await readMigrationState(connection, catalog);
		if (
			!after.ledgerExists ||
			after.applied !== expectedApplied ||
			after.pending !== catalog.all.length - expectedApplied
		) {
			throw new Error(
				`Drizzle apply verification failed: expected ledger=true, ` +
					`applied=${expectedApplied}, ` +
					`pending=${catalog.all.length - expectedApplied}; received ` +
					`ledger=${after.ledgerExists}, applied=${after.applied}, ` +
					`pending=${after.pending}.`
			);
		}
		applySucceeded = true;
	} finally {
		try {
			await releaseDrizzleMigrationLock(connection);
		} catch (error) {
			if (applySucceeded) {
				throw error;
			}
		}
	}
}
