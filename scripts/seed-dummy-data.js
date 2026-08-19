#!/usr/bin/env node
/**
 * Seed dummy users + projects for an empty DB (or for local dev).
 * Run: node scripts/seed-dummy-data.js
 * Uses same payload as migration 20260819120000_seed_dummy_data.js but via direct mysql2 pool.
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function main() {
	const env = process.env.NODE_ENV || 'development';
	let database, user, password;
	if (env === 'production') {
		database = process.env.PROD_DB_NAME;
		user = process.env.PROD_DB_USER;
		password = process.env.PROD_DB_PASSWORD;
	} else if (env === 'staging') {
		database = process.env.STAGING_DB_NAME;
		user = process.env.STAGING_DB_USER;
		password = process.env.STAGING_DB_PASSWORD;
	} else {
		database = process.env.DEV_DB_NAME;
		user = process.env.DEV_DB_USER;
		password = process.env.DEV_DB_PASSWORD;
	}
	const host = process.env.DB_HOST;
	const port = Number(process.env.DB_PORT) || 3306;

	console.log(
		`Connecting to ${host}:${port}/${database} as ${user} (env=${env})`
	);
	const conn = await mysql.createConnection({
		host,
		port,
		database,
		user,
		password,
		dateStrings: true,
	});

	try {
		const [users] = await conn.execute('SELECT COUNT(*) as cnt FROM users');
		if (Number(users[0].cnt) > 0) {
			console.log('Users already exist, skipping seed. Count=', users[0].cnt);
			const [projects] = await conn.execute(
				'SELECT COUNT(*) as cnt FROM projects WHERE isDelete=0'
			);
			console.log('Projects count:', projects[0].cnt);
			await conn.end();
			return;
		}
		console.log(
			'Empty DB detected — seeding via knex migration is preferred. Running: npx knex migrate:latest'
		);
		console.log(
			'If you want this standalone seeder to insert, set ALLOW_STANDALONE_SEED=1'
		);
		if (process.env.ALLOW_STANDALONE_SEED !== '1') {
			console.log(
				'Skipping standalone insert. Run: ALLOW_STANDALONE_SEED=1 node scripts/seed-dummy-data.js to force'
			);
			await conn.end();
			return;
		}

		// Force seed (same logic as migration but direct)
		const { execSync } = await import('child_process');
		execSync('npx knex migrate:latest', { stdio: 'inherit' });
		console.log('Seed complete via migration');
		await conn.end();
	} catch (e) {
		console.error('Seed failed:', e.message);
		console.error(e.stack);
		process.exit(1);
	}
}

main();
