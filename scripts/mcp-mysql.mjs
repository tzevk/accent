// MCP launcher: bridges OpenCode <-> @benborla29/mcp-server-mysql
//
// OpenCode's {env:VAR} substitution only sees its own process environment,
// while our credentials live in the gitignored .env file. This wrapper loads
// .env with dotenv, maps the DB_* vars to the MYSQL_* names the MCP server
// expects (mirroring src/utils/database.js env branching), and forwards stdio.
//
// Read-only by design: the ALLOW_INSERT/UPDATE/DELETE_OPERATION flags are
// intentionally NOT set, so the server rejects mutating statements.
import 'dotenv/config';
import { spawn } from 'node:child_process';

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

if (!process.env.DB_HOST || !user || !password || !database) {
	console.error(
		'[mcp-mysql] Missing DB credentials. Ensure DB_HOST/DB_PORT and the' +
			` ${env.toUpperCase()}_DB_* variables are set in .env`
	);
	process.exit(1);
}

const child = spawn(
	// single string + shell:true avoids DEP0190 (args-to-shell escaping)
	// --prefer-offline: use the npx cache without a registry round-trip, so a
	// flaky network/DNS can't stall startup past OpenCode's MCP timeout
	'npx -y --prefer-offline @benborla29/mcp-server-mysql',
	{
		stdio: 'inherit', // pass through the MCP stdio transport
		shell: true, // npx needs a shell on Windows
		env: {
			...process.env,
			MYSQL_HOST: process.env.DB_HOST,
			MYSQL_PORT: process.env.DB_PORT || '3306',
			MYSQL_USER: user,
			MYSQL_PASS: password,
			MYSQL_DB: database,
		},
	}
);

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 0);
});
