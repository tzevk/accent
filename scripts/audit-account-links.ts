import 'dotenv/config';
import mysql from 'mysql2/promise';
import { getDbSslConfig } from '../src/utils/database.js';
import {
	auditAccountLinks,
	type AccountLinkQueryExecutor,
} from '../src/utils/account-link-audit.ts';

type EnvironmentName = 'development' | 'production';

function parseEnvironment(args: string[]): EnvironmentName {
	let selected: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--environment') {
			if (selected !== undefined || !args[index + 1]) {
				throw new Error(
					'Use --environment development|production exactly once.'
				);
			}
			selected = args[index + 1];
			index += 1;
		} else if (argument.startsWith('--environment=')) {
			if (selected !== undefined) {
				throw new Error(
					'Use --environment development|production exactly once.'
				);
			}
			selected = argument.slice('--environment='.length);
		} else {
			throw new Error('Use --environment development|production.');
		}
	}
	if (selected !== 'development' && selected !== 'production') {
		throw new Error('Use --environment development|production.');
	}
	return selected;
}

function resolveTarget(environment: EnvironmentName) {
	const prefix = environment === 'production' ? 'PROD' : 'DEV';
	const database = process.env[`${prefix}_DB_NAME`];
	const user = process.env[`${prefix}_DB_USER`];
	const password = process.env[`${prefix}_DB_PASSWORD`];
	const host = process.env.DB_HOST;
	if (!host || !database || !user) {
		throw new Error(
			`Set DB_HOST and ${prefix}_DB_NAME/${prefix}_DB_USER for the selected environment.`
		);
	}
	return {
		host,
		port: Number(process.env.DB_PORT || 3306),
		database,
		user,
		password,
		ssl: getDbSslConfig(),
		dateStrings: true,
		multipleStatements: false,
	};
}

async function main(): Promise<void> {
	const environment = parseEnvironment(process.argv.slice(2));
	const connection = await mysql.createConnection(resolveTarget(environment));
	let transactionStarted = false;
	try {
		await connection.query('START TRANSACTION READ ONLY');
		transactionStarted = true;
		const execute: AccountLinkQueryExecutor = async (sql, bindings = []) =>
			connection.query(sql, [...bindings]);
		const audit = await auditAccountLinks(execute);
		process.stdout.write(
			`${JSON.stringify({ environment, ...audit }, null, 2)}\n`
		);
	} finally {
		if (transactionStarted) await connection.rollback();
		await connection.end();
	}
}

main().catch((error: unknown) => {
	const details = error instanceof Error ? error.message : '';
	const safeMessage =
		details.startsWith('Use --environment') ||
		details.startsWith('Set DB_HOST') ||
		details.startsWith('Account-link audit requires')
			? details
			: 'Database operation failed; driver details are suppressed to protect connection information.';
	console.error(`Account-link audit failed: ${safeMessage}`);
	process.exitCode = 1;
});
