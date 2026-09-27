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

const dbName = process.env.E2E_DB_NAME || process.env.DEV_DB_NAME;

if (!dbName || !/^[A-Za-z0-9_]+$/.test(dbName)) {
	console.error(`Invalid database name: ${JSON.stringify(dbName)}`);
	process.exit(1);
}

const host = process.env.DB_HOST;
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.E2E_DB_USER || process.env.DEV_DB_USER;
const password = process.env.E2E_DB_PASSWORD || process.env.DEV_DB_PASSWORD;

if (dbName !== process.env.DEV_DB_NAME) {
	const connection = await mysql.createConnection({ host, port, user, password });
	try {
		await connection.query(
			`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
		);
		console.log(`[e2e:db] database ${dbName} ready`);
	} catch (error) {
		console.error(
			`[e2e:db] cannot create ${dbName} (${error.code || error.message}). ` +
				'Grant CREATE to the user or point E2E_DB_NAME at an existing database.'
		);
		process.exit(1);
	} finally {
		await connection.end();
	}
}

const knexInstance = knex({
	...config.development,
	connection: { ...config.development.connection, database: dbName },
});

try {
	const [batch, migrations] = await knexInstance.migrate.latest();
	console.log(
		`[e2e:db] ${dbName}: schema up to date (batch ${batch}, ${migrations.length} migration(s) applied)`
	);
} finally {
	await knexInstance.destroy();
}
