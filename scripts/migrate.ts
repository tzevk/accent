#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql, { type Connection } from 'mysql2/promise';
import { z } from 'zod';
import {
	applyDrizzleMigrations,
	readDrizzleMigrationStatus,
} from './db-migrations.ts';
import {
	resolveMigrationEnvironment,
	resolveMigrationTarget,
	type MigrationEnvironment,
} from './migration-target.ts';

type MigrationCommand = 'apply' | 'status';

interface ParsedMigrationCommand {
	command: MigrationCommand;
	through?: string;
}

const originalMigrationFilenameSchema = z
	.string()
	.regex(/^\d{14}_[A-Za-z0-9_-]+\.(?:js|ts)$/);
const commandSchema = z.union([
	z.tuple([z.literal('apply')]),
	z.tuple([
		z.literal('apply'),
		z.literal('--through'),
		originalMigrationFilenameSchema,
	]),
	z.tuple([z.literal('status')]),
]);

function parseCommand(args: string[]): ParsedMigrationCommand {
	const result = commandSchema.safeParse(args);
	if (!result.success) {
		throw new Error(
			'Usage: node --experimental-strip-types scripts/migrate.ts ' +
				'apply [--through YYYYMMDDHHMMSS_name.js|ts]|status'
		);
	}

	if (result.data[0] === 'status') {
		return { command: 'status' };
	}

	const through = result.data.length === 3 ? result.data[2] : undefined;
	return through === undefined
		? { command: 'apply' }
		: { command: 'apply', through };
}

type MigrationStatus = Awaited<ReturnType<typeof readDrizzleMigrationStatus>>;

function reportMigrationStatus(label: string, status: MigrationStatus): void {
	console.log(
		`${label}: ${String(status.applied)} applied, ${String(status.pending)} pending, ` +
			`${String(status.legacyApplied)} legacy Knex migrations verified for adoption.`
	);
}

async function applyMigrations(
	connection: Connection,
	projectRoot: string,
	through?: string
): Promise<void> {
	const before = await readDrizzleMigrationStatus(connection, projectRoot);
	reportMigrationStatus('Drizzle preflight', before);

	await applyDrizzleMigrations(
		connection,
		projectRoot,
		through === undefined ? undefined : { through }
	);

	const after = await readDrizzleMigrationStatus(connection, projectRoot);
	reportMigrationStatus('Migrations complete', after);
}

async function reportStatus(
	connection: Connection,
	environment: MigrationEnvironment,
	projectRoot: string
): Promise<void> {
	const status = await readDrizzleMigrationStatus(connection, projectRoot);
	console.log(JSON.stringify({ environment, ...status }, null, 2));
}

async function main(): Promise<void> {
	const { command, through } = parseCommand(process.argv.slice(2));
	const environment = resolveMigrationEnvironment();
	const projectRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		'..'
	);
	const configuration = resolveMigrationTarget(environment);

	const connection = await mysql.createConnection(configuration);
	try {
		if (command === 'apply') {
			await applyMigrations(connection, projectRoot, through);
			return;
		}

		await reportStatus(connection, environment, projectRoot);
	} finally {
		await connection.end();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Migration command failed: ${message}`);
	process.exitCode = 1;
});
