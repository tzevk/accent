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

/**
 * Which database the harness will actually drive.
 *
 * An unset `E2E_DB_NAME` silently falls back to `DEV_DB_NAME`, which points the
 * whole suite at the development database — real business rows, real payroll.
 * The per-spec safety gates then fail deep inside a run (e.g. "allocation fixture
 * month holds 1 Payroll Slip of non-fixture employees") after fixtures have
 * already been written there. CI deliberately runs this way, so this is a loud
 * warning rather than an error: locally, set `E2E_DB_NAME` to a dedicated
 * database in `.env`.
 */
const dbName = process.env.E2E_DB_NAME || required('DEV_DB_NAME');
if (!process.env.E2E_DB_NAME) {
	console.warn(
		`\n[e2e] WARNING: E2E_DB_NAME is unset — running against the DEV database ` +
			`"${dbName}". Fixtures will be written to real development data.\n` +
			'[e2e] Set E2E_DB_NAME in .env to a dedicated database to avoid this.\n'
	);
}

const e2eHost = process.env.E2E_DB_HOST || required('DB_HOST');
const e2ePort = Number(process.env.E2E_DB_PORT || process.env.DB_PORT || 3306);
const e2eSslMode =
	process.env.E2E_DB_SSL_MODE ||
	process.env.DB_SSL_MODE ||
	(e2eHost.includes('.aivencloud.com') ? 'require' : 'off');
const ssl =
	e2eSslMode === 'require' ? { rejectUnauthorized: false } : undefined;

export const E2E_ENV = {
	port,
	baseURL: `http://localhost:${port}`,
	db: {
		host: e2eHost,
		port: e2ePort,
		name: dbName,
		user: process.env.E2E_DB_USER ?? required('DEV_DB_USER'),
		password: process.env.E2E_DB_PASSWORD ?? required('DEV_DB_PASSWORD'),
		ssl,
	},
};
