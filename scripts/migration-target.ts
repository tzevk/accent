import type { ConnectionOptions } from 'mysql2/promise';
import { z } from 'zod';
import { getDbSslConfig } from '../src/utils/database.js';

const ENVIRONMENTS = ['development', 'staging', 'production'] as const;
const environmentSchema = z.enum(ENVIRONMENTS);

export type MigrationEnvironment = (typeof ENVIRONMENTS)[number];

const CREDENTIAL_PREFIXES = {
	development: 'DEV',
	staging: 'STAGING',
	production: 'PROD',
} as const satisfies Record<MigrationEnvironment, string>;

const portSchema = z.coerce.number().int().min(1).max(65535);

function requiredEnvironmentValue(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') {
		throw new Error(
			`${name} is required for the migration database connection.`
		);
	}
	return value;
}

export function resolveMigrationEnvironment(
	value: string | undefined = process.env.NODE_ENV
): MigrationEnvironment {
	const result = environmentSchema.safeParse(value || 'development');
	if (!result.success) {
		throw new Error('NODE_ENV must be development, staging, or production.');
	}
	return result.data;
}

export function resolveMigrationTarget(
	environment: MigrationEnvironment
): ConnectionOptions {
	const result = environmentSchema.safeParse(environment);
	if (!result.success) {
		throw new Error(
			'Migration environment must be development, staging, or production.'
		);
	}

	const resolvedEnvironment = result.data;
	const prefix = CREDENTIAL_PREFIXES[resolvedEnvironment];
	const port = portSchema.safeParse(process.env.DB_PORT || 3306);
	if (!port.success) {
		throw new Error('DB_PORT must be an integer between 1 and 65535.');
	}

	const ssl = getDbSslConfig();
	if (!ssl && resolvedEnvironment === 'production') {
		console.warn(
			'[migration] DB_SSL_MODE is off in production — SEC-20 requires DB_SSL_MODE=verify once the server requires TLS.'
		);
	}

	return {
		host: requiredEnvironmentValue('DB_HOST'),
		port: port.data,
		user: requiredEnvironmentValue(`${prefix}_DB_USER`),
		password: process.env[`${prefix}_DB_PASSWORD`],
		database: requiredEnvironmentValue(`${prefix}_DB_NAME`),
		ssl,
	};
}
