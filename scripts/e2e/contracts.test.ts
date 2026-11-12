import { describe, expect, it } from 'vitest';
import {
	buildRunTag,
	createRunId,
	deriveE2EDatabaseName,
	fitIdentifier,
	fixtureNamespace,
	parseDatabaseVersion,
	parseE2ERuntime,
} from './contracts.ts';

const RUN_ID = '20261112_085327_0a1b2c';

describe('run identity', () => {
	it('formats a deterministic, database-safe run id', () => {
		expect(
			createRunId(new Date('2026-11-12T08:53:27.000Z'), '0A1B2C')
		).toBe(RUN_ID);
	});

	it('prefixes every run tag with the ticket issue', () => {
		expect(buildRunTag(426, RUN_ID)).toBe(`E2E-426-${RUN_ID}`);
		expect(() => buildRunTag(Number.NaN, RUN_ID)).toThrow(/issue/i);
	});
});

describe('disposable database name', () => {
	it('appends the unique run suffix and keeps the integration token', () => {
		const first = deriveE2EDatabaseName(
			'accent_integration_e2e',
			'20261112_085327_aaaaaa'
		);
		const second = deriveE2EDatabaseName(
			'accent_integration_e2e',
			'20261112_085327_bbbbbb'
		);
		expect(first).toBe('accent_integration_e2e_e2e_20261112_085327_aaaaaa');
		expect(first).not.toBe(second);
		expect(first).toMatch(/integration/);
	});

	it('shortens a long base name without dropping the integration token', () => {
		const name = deriveE2EDatabaseName(
			`accent_integration_${'x'.repeat(80)}`,
			RUN_ID
		);
		expect(name.length).toBeLessThanOrEqual(64);
		expect(name).toContain('integration');
		expect(name.endsWith(`_e2e_${RUN_ID}`)).toBe(true);
	});

	it('refuses a base name that is not a disposable integration target', () => {
		expect(() => deriveE2EDatabaseName('accent_crm_dev', RUN_ID)).toThrow(
			/integration/
		);
	});
});

describe('fixture namespaces', () => {
	it('includes the issue, run, worker, and optional suffix', () => {
		const runTag = buildRunTag(426, RUN_ID);
		expect(fixtureNamespace(runTag, 2, 'salary')).toBe(
			`E2E-426-${RUN_ID}-2-salary`
		);
	});

	it('fits a namespaced value into a narrow database column', () => {
		const value = `${buildRunTag(426, RUN_ID)}-0-employee-code`;
		const fitted = fitIdentifier(value, 20);
		expect(fitted).toHaveLength(20);
		expect(fitted.startsWith('E2E-426-')).toBe(true);
		expect(fitIdentifier(value, 20)).toBe(fitted);
		expect(fitIdentifier(`${value}-other`, 20)).not.toBe(fitted);
	});
});

describe('supported MariaDB version', () => {
	it('accepts the supported MariaDB 10.11 line', () => {
		expect(parseDatabaseVersion('10.11.15-MariaDB-0+deb12u1')).toEqual({
			major: 10,
			minor: 11,
			patch: 15,
		});
		expect(() =>
			parseDatabaseVersion('10.11.15-MariaDB-0+deb12u1')
		).not.toThrow();
	});

	it('rejects MySQL 8 and unsupported MariaDB lines', () => {
		expect(() => parseDatabaseVersion('8.0.36')).toThrow(/only MariaDB 10\.11/);
		expect(() => parseDatabaseVersion('10.6.18-MariaDB')).toThrow(
			/only MariaDB 10\.11/
		);
		expect(() => parseDatabaseVersion('nonsense')).toThrow(/version/i);
	});
});

describe('Playwright runtime contract', () => {
	it('reads every required value and converts the database port', () => {
		const runtime = parseE2ERuntime({
			E2E_BASE_URL: 'http://127.0.0.1:31370',
			E2E_RUN_TAG: `E2E-426-${RUN_ID}`,
			E2E_ISSUE: '426',
			E2E_DB_HOST: '127.0.0.1',
			E2E_DB_PORT: '33369',
			E2E_DB_NAME: 'accent_integration_e2e_x',
			E2E_DB_USER: 'root',
			E2E_DB_PASSWORD: '',
			E2E_ARTIFACTS_DIR: 'C:/repo/e2e/artifacts',
		});
		expect(runtime.baseUrl).toBe('http://127.0.0.1:31370');
		expect(runtime.database.port).toBe(33369);
		expect(runtime.issue).toBe(426);
	});

	it('fails with an actionable message when a value is missing', () => {
		expect(() => parseE2ERuntime({ E2E_BASE_URL: 'http://127.0.0.1:1' })).toThrow(
			/npm run test:e2e/
		);
	});
});
