import 'dotenv/config';

// knexfile.js
export default {
	development: {
		client: 'mysql2',
		connection: {
			host: process.env.DB_HOST,
			user: process.env.DEV_DB_USER,
			password: process.env.DEV_DB_PASSWORD,
			database: process.env.DEV_DB_NAME,
		},
		migrations: { directory: './migrations' },
	},
	staging: {
		client: 'mysql2',
		connection: {
			host: process.env.DB_HOST,
			user: process.env.STAGING_DB_USER,
			password: process.env.STAGING_DB_PASSWORD,
			database: process.env.STAGING_DB_NAME,
		},
		migrations: { directory: './migrations' },
	},
	production: {
		client: 'mysql2',
		connection: {
			host: process.env.DB_HOST,
			user: process.env.PROD_DB_USER,
			password: process.env.PROD_DB_PASSWORD,
			database: process.env.PROD_DB_NAME,
		},
		migrations: {
			directory: './migrations',
			stub: './src/lib/migration.stub.mjs',
			extension: 'mjs',
		},
	},
};
