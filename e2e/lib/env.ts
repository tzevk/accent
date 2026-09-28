import 'dotenv/config';

/**
 * Resolved E2E settings. E2E_DB_NAME is optional: when unset the harness runs
 * against the dev database with an isolated fixture namespace (users named
 * e2e_*, employees E2E-EMP-*, an E2E-owned holiday and deliverables), all of
 * which `cleanupFixtures()` removes before each run.
 */

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`Missing required env var ${name}; E2E needs the same .env as the app`
		);
	}
	return value;
}

const port = Number(process.env.E2E_PORT || 3100);

export const E2E_ENV = {
	port,
	baseURL: `http://localhost:${port}`,
	db: {
		host: required('DB_HOST'),
		port: Number(process.env.DB_PORT || 3306),
		name: process.env.E2E_DB_NAME || required('DEV_DB_NAME'),
		user: process.env.E2E_DB_USER || required('DEV_DB_USER'),
		password: process.env.E2E_DB_PASSWORD || required('DEV_DB_PASSWORD'),
	},
};
