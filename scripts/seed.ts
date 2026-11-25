#!/usr/bin/env node
import 'dotenv/config';
import mysql, { type Connection, type ConnectionOptions } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { seed as seedDummyData } from '../seeds/01_dev_dummy_data.js';
import { seed as seedLeadsAndProposals } from '../seeds/02_dev_leads_proposals.js';
import {
	resolveMigrationEnvironment,
	resolveMigrationTarget,
} from './migration-target.ts';
import type { SeedDatabase } from './seed-queries.ts';

function assertSafeDevelopmentTarget(target: ConnectionOptions): void {
	const host = String(target.host || '')
		.trim()
		.toLowerCase();
	if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
		throw new Error(
			`[seed] Refusing non-loopback development seed target ${JSON.stringify(host)}.`
		);
	}

	const database = String(target.database || '');
	const configuredProtectedNames = [
		process.env.STAGING_DB_NAME,
		process.env.PROD_DB_NAME,
	]
		.filter((name): name is string => Boolean(name))
		.map((name) => name.toLowerCase());
	if (
		!database ||
		/prod|stag|crmaccent/i.test(database) ||
		configuredProtectedNames.includes(database.toLowerCase())
	) {
		throw new Error(
			`[seed] Refusing unsafe development seed target ${JSON.stringify(database)}.`
		);
	}
}

async function runSeed(
	connection: Connection,
	db: SeedDatabase,
	name: string,
	seed: (database: SeedDatabase) => Promise<void>
): Promise<void> {
	console.log(`[seed] running ${name}`);
	await connection.beginTransaction();
	try {
		await seed(db);
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	}
}

async function main(): Promise<void> {
	const environment = resolveMigrationEnvironment();
	if (environment !== 'development') {
		throw new Error(
			`[seed] Refusing to seed the ${environment} environment. ` +
				'Development seed data is local-only.'
		);
	}
	const target = resolveMigrationTarget(environment);
	assertSafeDevelopmentTarget(target);

	console.log(
		`[seed] target ${target.host || 'localhost'}:${target.port || 3306}/${target.database}`
	);
	const connection = await mysql.createConnection(target);
	try {
		const db = drizzle({ client: connection });
		await runSeed(connection, db, '01_dev_dummy_data', seedDummyData);
		await runSeed(
			connection,
			db,
			'02_dev_leads_proposals',
			seedLeadsAndProposals
		);
		console.log('[seed] complete');
	} finally {
		await connection.end();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Seed command failed: ${message}`);
	process.exitCode = 1;
});
