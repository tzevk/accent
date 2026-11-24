#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import knexConfigurations from '../knexfile.js';
import {
	applyDrizzleMigrations,
	legacyKnexMigrations,
	readDrizzleMigrationStatus,
} from './db-migrations.ts';

const ENVIRONMENTS = ['development', 'staging', 'production'] as const;
type EnvironmentName = (typeof ENVIRONMENTS)[number];
type MigrationCommand = 'apply' | 'status';
type DatabaseConfiguration = (typeof knexConfigurations)[EnvironmentName];
interface LegacyMigrationConfiguration {
	directory: string;
	loadExtensions: string[];
}

interface LegacyLedgerRow extends RowDataPacket {
	name: unknown;
}

interface LegacyMigrationStatus {
	ledgerExists: boolean;
	files: number;
	applied: number;
	pending: number;
	pendingMigrations: string[];
}

const commandSchema = z.tuple([z.enum(['apply', 'status'])]);
const environmentSchema = z.enum(ENVIRONMENTS);

function parseCommand(args: string[]): MigrationCommand {
	const result = commandSchema.safeParse(args);
	if (!result.success) {
		throw new Error(
			'Usage: node --experimental-strip-types scripts/migrate.ts apply|status'
		);
	}
	return result.data[0];
}

function resolveEnvironment(): EnvironmentName {
	const result = environmentSchema.safeParse(
		process.env.NODE_ENV || 'development'
	);
	if (!result.success) {
		throw new Error('NODE_ENV must be development, staging, or production.');
	}
	return result.data;
}

function readLegacyInventory(
	migrations: LegacyMigrationConfiguration
): string[] {
	const extensions = new Set(
		migrations.loadExtensions.map((extension) => extension.toLowerCase())
	);
	return readdirSync(migrations.directory, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())
		)
		.map((entry) => entry.name)
		.sort();
}

async function hasLegacyLedger(connection: Connection): Promise<boolean> {
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS ledger_count
		 FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = 'knex_migrations'
		   AND TABLE_TYPE = 'BASE TABLE'`
	);
	return Number(rows[0]?.ledger_count) === 1;
}

async function readLegacyStatus(
	connection: Connection,
	inventory: string[]
): Promise<LegacyMigrationStatus> {
	if (!(await hasLegacyLedger(connection))) {
		return {
			ledgerExists: false,
			files: inventory.length,
			applied: 0,
			pending: inventory.length,
			pendingMigrations: inventory,
		};
	}

	const [ledgerRows] = await connection.query<LegacyLedgerRow[]>(
		'SELECT name FROM `knex_migrations` ORDER BY id ASC'
	);
	const inventoryNames = new Set(inventory);
	const appliedNames = new Set<string>();
	for (const row of ledgerRows) {
		const name = row.name;
		if (typeof name !== 'string' || !inventoryNames.has(name)) {
			throw new Error(
				`Legacy migration ledger contains unexpected migration ${String(name)}.`
			);
		}
		if (appliedNames.has(name)) {
			throw new Error(
				`Legacy migration ledger contains duplicate migration ${name}.`
			);
		}
		appliedNames.add(name);
	}

	const pendingMigrations = inventory.filter((name) => !appliedNames.has(name));
	return {
		ledgerExists: true,
		files: inventory.length,
		applied: appliedNames.size,
		pending: pendingMigrations.length,
		pendingMigrations,
	};
}

async function applyMigrations(
	connection: Connection,
	configuration: DatabaseConfiguration,
	projectRoot: string,
	migrations: LegacyMigrationConfiguration,
	inventory: string[]
): Promise<void> {
	const drizzleBefore = await readDrizzleMigrationStatus(
		connection,
		projectRoot
	);
	console.log(
		`Drizzle preflight: ${String(drizzleBefore.applied)} applied, ${String(drizzleBefore.pending)} pending.`
	);

	const knex = knexFactory({ ...configuration, migrations });
	try {
		await knex.migrate.latest(migrations);
	} finally {
		await knex.destroy();
	}

	await applyDrizzleMigrations(connection, projectRoot);
	console.log(
		`Migrations complete: ${String(inventory.length)} frozen Knex files, ${String(drizzleBefore.pending)} pending Drizzle migrations processed.`
	);
}

async function reportStatus(
	connection: Connection,
	environment: EnvironmentName,
	projectRoot: string,
	inventory: string[]
): Promise<void> {
	const drizzleStatus = await readDrizzleMigrationStatus(
		connection,
		projectRoot
	);
	const legacyStatus = await readLegacyStatus(connection, inventory);
	console.log(
		JSON.stringify(
			{
				environment,
				legacy: legacyStatus,
				drizzle: drizzleStatus,
				totalPending: legacyStatus.pending + drizzleStatus.pending,
			},
			null,
			2
		)
	);
}

async function main(): Promise<void> {
	const command = parseCommand(process.argv.slice(2));
	const environment = resolveEnvironment();
	const projectRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		'..'
	);
	const configuration = knexConfigurations[environment];

	// This validates the frozen cutoff and rejects new Knex files before either
	// command opens a database connection.
	const migrations = legacyKnexMigrations(projectRoot);
	const inventory = readLegacyInventory(migrations);

	const connection = await mysql.createConnection(configuration.connection);
	try {
		if (command === 'apply') {
			await applyMigrations(
				connection,
				configuration,
				projectRoot,
				migrations,
				inventory
			);
			return;
		}

		await reportStatus(connection, environment, projectRoot, inventory);
	} finally {
		await connection.end();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Migration command failed: ${message}`);
	process.exitCode = 1;
});
