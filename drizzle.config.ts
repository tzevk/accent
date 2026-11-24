import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'mysql',
	schema: './src/server/**/db-schema.ts',
	out: './drizzle',
});
