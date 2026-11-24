import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
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

interface MigrationCatalog {
	historical: HistoricalMigration[];
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

const DRIZZLE_MIGRATION_TAG = /^[A-Za-z0-9_-]+$/;
const DRIZZLE_JOURNAL_SCHEMA = z.strictObject({
	version: z.literal('7'),
	dialect: z.literal('mysql'),
	entries: z
		.array(
			z.strictObject({
				idx: z.int().nonnegative(),
				version: z.literal('5'),
				when: z.int().positive(),
				tag: z.string().min(1).max(251).regex(DRIZZLE_MIGRATION_TAG),
				breakpoints: z.boolean(),
			})
		)
		.refine(
			(entries) =>
				entries.every(
					(entry, index) =>
						entry.idx === index && entry.when > HISTORICAL_MIGRATION_COUNT
				),
			{
				message:
					'Entry indexes must be sequential and timestamps must follow historical migrations',
			}
		)
		.refine(
			(entries) =>
				entries.every(
					(entry, index) => index === 0 || entry.when > entries[index - 1].when
				),
			{ message: 'Entry timestamps must be strictly increasing' }
		)
		.refine(
			(entries) =>
				new Set(entries.map((entry) => entry.tag)).size === entries.length,
			{ message: 'Entry tags must be unique' }
		),
});

function readDrizzleMigrations(projectRoot: string): MigrationCatalog {
	const migrationsFolder = path.resolve(projectRoot, 'drizzle');
	const historyFolder = path.join(migrationsFolder, 'history');
	const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
	const manifestPath = path.join(historyFolder, 'manifest.json');
	let manifest: unknown;
	let journal: unknown;

	try {
		journal = JSON.parse(readFileSync(journalPath, 'utf8'));
	} catch (error) {
		throw new Error(
			`Could not read Drizzle migration journal at ${journalPath}: ` +
				(error instanceof Error ? error.message : String(error))
		);
	}

	const result = DRIZZLE_JOURNAL_SCHEMA.safeParse(journal);
	if (!result.success) {
		throw new Error(
			`Invalid Drizzle migration journal at ${journalPath}: ` +
				result.error.message
		);
	}

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
	const nativeFiles = readMigrationFiles({ migrationsFolder });
	const native = result.data.entries.map((entry, index): Migration => {
		const migration = nativeFiles[index];
		if (migration === undefined) {
			throw new Error(
				`Drizzle journal entry ${entry.tag} has no migration metadata.`
			);
		}

		return {
			hash: migration.hash,
			createdAt: migration.folderMillis,
		};
	});

	return { historical, all: [...historical, ...native] };
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
				`journal and history have ${catalog.all.length}.`
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

export async function applyDrizzleMigrations(
	connection: Connection,
	projectRoot: string,
	options: DrizzleMigrationOptions = {}
): Promise<void> {
	const catalog = readDrizzleMigrations(projectRoot);
	const historyTarget = historicalLimit(catalog, options);
	const migrationsFolder = path.resolve(projectRoot, 'drizzle');

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
			await migrate(db, { migrationsFolder });
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
