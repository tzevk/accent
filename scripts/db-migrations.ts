import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';

const PINNED_LEGACY_MIGRATION = '20261115140000_salary_profile_revisions.ts';
const LEGACY_MIGRATION_NAME = /^\d{14}_.+\.(?:js|ts)$/;
const TIMESTAMPED_FILE_NAME = /^\d+_.+\.[^.]+$/;
const UNSUPPORTED_LEGACY_EXTENSIONS: Record<string, true> = {
	'.cjs': true,
	'.mjs': true,
	'.cts': true,
	'.mts': true,
	'.coffee': true,
	'.litcoffee': true,
	'.ls': true,
	'.eg': true,
	'.jsx': true,
	'.tsx': true,
};

const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';
const DRIZZLE_MIGRATION_LOCK_NAME_SQL =
	"SHA2(CONCAT('accent:drizzle-migrations:', DATABASE()), 256)";
const DRIZZLE_MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

interface DrizzleMigrationStatus {
	ledgerExists: boolean;
	applied: number;
	pending: number;
}

interface MigrationLedgerRow extends RowDataPacket {
	hash: string;
	created_at: number | string | null;
}

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

function readDrizzleMigrations(projectRoot: string) {
	const migrationsFolder = path.resolve(projectRoot, 'drizzle');
	const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
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

	return readMigrationFiles({ migrationsFolder });
}

export function legacyKnexMigrations(projectRoot: string): {
	directory: string;
	loadExtensions: string[];
} {
	const directory = path.resolve(projectRoot, 'migrations');
	const migrationFiles: string[] = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}

		const name = entry.name;

		const extension = path.extname(name).toLowerCase();
		if (extension !== '.js' && extension !== '.ts') {
			if (
				UNSUPPORTED_LEGACY_EXTENSIONS[extension] === true ||
				TIMESTAMPED_FILE_NAME.test(name)
			) {
				throw new Error(
					`Unsupported legacy migration file "${name}" in ${directory}. ` +
						'Only retained .js and .ts migrations are allowed; author new ' +
						'migrations in drizzle/.'
				);
			}
			continue;
		}

		if (!LEGACY_MIGRATION_NAME.test(name)) {
			throw new Error(
				`Invalid legacy migration filename "${name}" in ${directory}. ` +
					'Expected YYYYMMDDHHMMSS_name.js or YYYYMMDDHHMMSS_name.ts.'
			);
		}

		migrationFiles.push(name);
	}

	migrationFiles.sort();
	const latestMigration = migrationFiles[migrationFiles.length - 1];
	if (latestMigration !== PINNED_LEGACY_MIGRATION) {
		throw new Error(
			`Legacy migration history is frozen. Expected latest migration ` +
				`${PINNED_LEGACY_MIGRATION}, found ${latestMigration ?? 'none'} ` +
				`in ${directory}.`
		);
	}

	return { directory, loadExtensions: ['.js', '.ts'] };
}

export async function readDrizzleMigrationStatus(
	connection: Connection,
	projectRoot: string
): Promise<DrizzleMigrationStatus> {
	const migrations = readDrizzleMigrations(projectRoot);
	const [tableRows] = await connection.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS ledger_count
		 FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = '${DRIZZLE_MIGRATIONS_TABLE}'
		   AND TABLE_TYPE = 'BASE TABLE'`
	);
	const ledgerExists = Number(tableRows[0]?.ledger_count) === 1;

	if (!ledgerExists) {
		return {
			ledgerExists: false,
			applied: 0,
			pending: migrations.length,
		};
	}

	const [ledgerRows] = await connection.query<MigrationLedgerRow[]>(
		`SELECT hash, created_at
		 FROM \`${DRIZZLE_MIGRATIONS_TABLE}\`
		 ORDER BY created_at ASC, id ASC`
	);

	if (ledgerRows.length > migrations.length) {
		throw new Error(
			`Drizzle ledger has ${ledgerRows.length} rows; ` +
				`journal has ${migrations.length}.`
		);
	}

	for (const [index, row] of ledgerRows.entries()) {
		const migration = migrations[index];
		const rawCreatedAt = row.created_at;
		const createdAt =
			rawCreatedAt === null || rawCreatedAt === undefined
				? null
				: Number(rawCreatedAt);

		if (
			String(row.hash) !== migration.hash ||
			createdAt === null ||
			!Number.isSafeInteger(createdAt) ||
			createdAt !== migration.folderMillis
		) {
			throw new Error(
				`Drizzle ledger row ${index + 1} mismatch: expected ` +
					`${migration.hash}@${migration.folderMillis}, received ` +
					`${String(row.hash)}@${String(rawCreatedAt)}.`
			);
		}
	}

	return {
		ledgerExists: true,
		applied: ledgerRows.length,
		pending: migrations.length - ledgerRows.length,
	};
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

export async function applyDrizzleMigrations(
	connection: Connection,
	projectRoot: string
): Promise<void> {
	const migrationsFolder = path.resolve(projectRoot, 'drizzle');

	await acquireDrizzleMigrationLock(connection);
	let applySucceeded = false;
	try {
		const before = await readDrizzleMigrationStatus(connection, projectRoot);
		const expectedApplied = before.applied + before.pending;
		const db = drizzle({ client: connection });

		await migrate(db, { migrationsFolder });

		const after = await readDrizzleMigrationStatus(connection, projectRoot);
		if (
			!after.ledgerExists ||
			after.applied !== expectedApplied ||
			after.pending !== 0
		) {
			throw new Error(
				`Drizzle apply verification failed: expected ledger=true, ` +
					`applied=${expectedApplied}, pending=0; received ` +
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
