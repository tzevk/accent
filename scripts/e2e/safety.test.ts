import { describe, expect, it } from 'vitest';
import { resolveE2ETarget } from './safety.ts';

const RUN_ID = '20261112_085327_0a1b2c';

function baseEnv(): NodeJS.ProcessEnv {
	return {
		INTEGRATION_DB_HOST: '127.0.0.1',
		INTEGRATION_DB_PORT: '33369',
		INTEGRATION_DB_NAME: 'accent_integration_e2e',
		INTEGRATION_DB_USER: 'root',
		INTEGRATION_DB_PASSWORD: '',
		DEV_DB_NAME: 'accent_crm_dev',
		DEV_DB_USER: 'dev_user',
		DEV_DB_PASSWORD: 'dev_pass',
		STAGING_DB_NAME: 'accent_crm_staging',
		PROD_DB_NAME: 'accent_crm',
	};
}

describe('E2E disposable target', () => {
	it('pins every app branch to the unique disposable database', () => {
		const resolved = resolveE2ETarget(baseEnv(), RUN_ID);
		expect(resolved.name).toBe(`accent_integration_e2e_e2e_${RUN_ID}`);
		expect(resolved.serverEnv).toMatchObject({
			NODE_ENV: 'development',
			DB_HOST: '127.0.0.1',
			DB_PORT: '33369',
			DEV_DB_NAME: resolved.name,
			STAGING_DB_NAME: resolved.name,
			PROD_DB_NAME: resolved.name,
			DB_SSL_MODE: 'off',
		});
		expect(resolved.serverEnv.DEV_DB_USER).toBe('root');
		expect(resolved.serverEnv.PROD_DB_USER).toBe('root');
		expect(resolved.reader.database).toBe(resolved.name);
	});

	it('never produces the same name for two invocations', () => {
		const first = resolveE2ETarget(baseEnv(), `${RUN_ID}_a`);
		const second = resolveE2ETarget(baseEnv(), `${RUN_ID}_b`);
		expect(first.name).not.toBe(second.name);
	});

	it('refuses a non-loopback integration host', () => {
		const env = { ...baseEnv(), INTEGRATION_DB_HOST: '10.0.0.5' };
		expect(() => resolveE2ETarget(env, RUN_ID)).toThrow(/loopback/);
	});

	it('refuses an operational-looking integration name', () => {
		const env = {
			...baseEnv(),
			INTEGRATION_DB_NAME: 'accent_prod_integration',
		};
		expect(() => resolveE2ETarget(env, RUN_ID)).toThrow(/production/);
	});
});
