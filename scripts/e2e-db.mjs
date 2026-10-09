import 'dotenv/config';
import knex from 'knex';
import mysql from 'mysql2/promise';
import config from '../knexfile.js';

/**
 * E2E database bootstrap: create the dedicated database when E2E_DB_NAME points
 * somewhere new (CI), then bring the schema up to date with the same Knex
 * migrations the app uses.
 *
 * Local dev: E2E_DB_NAME is unset, so the fixture-isolated E2E run targets the
 * dev database (the dev MySQL user has no global CREATE privilege).
 */

import { getDbSslConfig } from '../src/utils/database.js';

const dbName = process.env.E2E_DB_NAME || process.env.DEV_DB_NAME;

if (!dbName || !/^[A-Za-z0-9_]+$/.test(dbName)) {
	console.error(`Invalid database name: ${JSON.stringify(dbName)}`);
	process.exit(1);
}

const host = process.env.E2E_DB_HOST || process.env.DB_HOST;
const port = Number(process.env.E2E_DB_PORT || process.env.DB_PORT || 3306);
const user = process.env.E2E_DB_USER ?? process.env.DEV_DB_USER;
const password = process.env.E2E_DB_PASSWORD ?? process.env.DEV_DB_PASSWORD;
const e2eSslMode =
	process.env.E2E_DB_SSL_MODE ||
	process.env.DB_SSL_MODE ||
	(host?.includes('.aivencloud.com') ? 'require' : 'off');
const ssl =
	e2eSslMode === 'require' ? { rejectUnauthorized: false } : getDbSslConfig();

async function connectWithRetry(connConfig, retries = 60, delayMs = 5000) {
	let attempt = 0;
	while (attempt < retries) {
		try {
			return await mysql.createConnection(connConfig);
		} catch (error) {
			attempt++;
			console.log(
				`[e2e:db] waiting for database ready (${connConfig.host}:${connConfig.port})... ` +
					`attempt ${attempt}/${retries} (${error.code || error.message})`
			);
			if (attempt >= retries) {
				throw error;
			}
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
}

if (dbName !== process.env.DEV_DB_NAME) {
	try {
		const connection = await connectWithRetry({
			host,
			port,
			user,
			password,
			ssl,
		});
		try {
			await connection.query(
				`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
			);
			console.log(`[e2e:db] database ${dbName} ready`);
		} finally {
			await connection.end();
		}
	} catch (error) {
		// On cloud MySQL (e.g. Aiven), connecting without a db or CREATE DATABASE might be restricted,
		// or defaultdb already exists. Verify connection to dbName directly:
		try {
			const connection = await connectWithRetry({
				host,
				port,
				user,
				password,
				database: dbName,
				ssl,
			});
			console.log(`[e2e:db] connected to database ${dbName}`);
			await connection.end();
		} catch (innerError) {
			console.error(
				`[e2e:db] cannot connect to ${dbName} (${innerError.code || innerError.message}).`
			);
			process.exit(1);
		}
	}
}

const knexInstance = knex({
	...config.development,
	connection: {
		...config.development.connection,
		host,
		port,
		user,
		password,
		database: dbName,
		ssl,
	},
});

try {
	const [batch, migrations] = await knexInstance.migrate.latest();
	console.log(
		`[e2e:db] ${dbName}: schema up to date (batch ${batch}, ${migrations.length} migration(s) applied)`
	);
} finally {
	await knexInstance.destroy();
}
