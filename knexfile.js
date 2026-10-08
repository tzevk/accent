import 'dotenv/config';
import { getDbSslConfig } from './src/utils/database.js';

// TLS options come from the shared helper (SEC-20): DB_SSL_MODE off|require|verify
// plus DB_SSL_CA_PATH; 'off' is the default so local dev/E2E keep working.
// Importing src/utils/database.js is safe here — it only loads dotenv and
// defines functions; the app pool is created lazily on the first dbConnect().
const ssl = getDbSslConfig();
if (!ssl && process.env.NODE_ENV === 'production') {
	console.warn(
		'[knex] DB_SSL_MODE is off in production — SEC-20 requires DB_SSL_MODE=verify once the server requires TLS.'
	);
}

// knexfile.js
export default {
	development: {
		client: 'mysql2',
		connection: {
			host: process.env.DB_HOST,
			port: Number(process.env.DB_PORT || 3306),
			user: process.env.DEV_DB_USER,
			password: process.env.DEV_DB_PASSWORD,
			database: process.env.DEV_DB_NAME,
			ssl,
		},
		migrations: { directory: './migrations' },
		seeds: { directory: './seeds' },
	},
	staging: {
		client: 'mysql2',
		connection: {
			host: process.env.DB_HOST,
			port: Number(process.env.DB_PORT || 3306),
			user: process.env.STAGING_DB_USER,
			password: process.env.STAGING_DB_PASSWORD,
			database: process.env.STAGING_DB_NAME,
			ssl,
		},
		migrations: { directory: './migrations' },
		seeds: { directory: './seeds' },
	},
	production: {
		client: 'mysql2',
		connection: {
			host: process.env.DB_HOST,
			port: Number(process.env.DB_PORT || 3306),
			user: process.env.PROD_DB_USER,
			password: process.env.PROD_DB_PASSWORD,
			database: process.env.PROD_DB_NAME,
			ssl,
		},
		migrations: {
			directory: './migrations',
			stub: './src/lib/migration.stub.mjs',
			extension: 'mjs',
		},
		seeds: { directory: './seeds' },
	},
};
