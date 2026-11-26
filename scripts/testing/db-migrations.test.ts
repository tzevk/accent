// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { readDrizzleMigrationStatus } from '../db-migrations.ts';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'drizzle/history/manifest.json');
const canonical: string[] = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const presence = '20261027120000_user_presence_last_active_seen.js';
const linkRepairs = '20261028110000_user_account_link_repairs.ts';
const employeeLinks = '20261028120000_user_account_employee_links.ts';
const exceptionStart = canonical.indexOf(presence);
const knownProductionOrder = [...canonical];
knownProductionOrder.splice(
	exceptionStart,
	3,
	linkRepairs,
	employeeLinks,
	presence
);

interface FakeLedgerRow extends RowDataPacket {
	hash: string;
	created_at: number;
}

function statusConnection({
	legacyNames,
	ledgerRows = [],
	ledgerExists = false,
}: {
	legacyNames: string[];
	ledgerRows?: FakeLedgerRow[];
	ledgerExists?: boolean;
}) {
	const tables: RowDataPacket[] = [
		{ TABLE_NAME: 'knex_migrations', TABLE_TYPE: 'BASE TABLE' },
	];
	if (ledgerExists) {
		tables.push({
			TABLE_NAME: '__drizzle_migrations',
			TABLE_TYPE: 'BASE TABLE',
		});
	}
	let call = 0;
	const query = vi.fn(async () => {
		call += 1;
		if (call === 1) return [tables] as [RowDataPacket[], unknown];
		if (ledgerExists && call === 2)
			return [ledgerRows] as [RowDataPacket[], unknown];
		return [legacyNames.map((name) => ({ name }))] as [
			RowDataPacket[],
			unknown,
		];
	});
	return { connection: { query } as unknown as Connection, query };
}

function firstHistoricalLedgerRow(): FakeLedgerRow {
	const sourceName = canonical[0].replace(/\.(?:js|ts)$/, '.ts');
	const source = readFileSync(
		path.join(PROJECT_ROOT, 'drizzle/history', sourceName)
	);
	return {
		hash: createHash('sha256').update(source).digest('hex'),
		created_at: 1,
	};
}

describe('readDrizzleMigrationStatus legacy adoption', () => {
	it('accepts a canonical partial prefix', async () => {
		const legacyNames = canonical.slice(0, 12);
		const { connection } = statusConnection({ legacyNames });

		await expect(
			readDrizzleMigrationStatus(connection, PROJECT_ROOT)
		).resolves.toMatchObject({
			ledgerExists: false,
			applied: 0,
			legacyApplied: 12,
		});
	});

	it('accepts only the known complete production permutation', async () => {
		const { connection } = statusConnection({
			legacyNames: knownProductionOrder,
		});

		await expect(
			readDrizzleMigrationStatus(connection, PROJECT_ROOT)
		).resolves.toMatchObject({
			ledgerExists: false,
			applied: 0,
			legacyApplied: 68,
		});
	});

	it.each([
		{
			label: 'another full-ledger permutation',
			names: (() => {
				const names = [...canonical];
				[names[0], names[1]] = [names[1], names[0]];
				return names;
			})(),
		},
		{
			label: 'the known permutation with another row moved',
			names: (() => {
				const names = [...knownProductionOrder];
				[names[0], names[1]] = [names[1], names[0]];
				return names;
			})(),
		},
		{
			label: 'a partial ledger ending inside the exception',
			names: knownProductionOrder.slice(0, 61),
		},
		{
			label: 'a duplicate row',
			names: (() => {
				const names = [...canonical];
				names[1] = names[0];
				return names;
			})(),
		},
		{
			label: 'a gap followed by an unknown row',
			names: (() => {
				const names = [...canonical];
				names.splice(5, 1);
				names.push('20990101000000_unknown.js');
				return names;
			})(),
		},
	])('rejects $label', async ({ names }) => {
		const { connection } = statusConnection({ legacyNames: names });

		await expect(
			readDrizzleMigrationStatus(connection, PROJECT_ROOT)
		).rejects.toThrow(/Legacy Knex ledger row \d+ mismatch/);
	});

	it('keeps exact canonical Drizzle hashes and positions', async () => {
		const { connection } = statusConnection({
			legacyNames: canonical,
			ledgerExists: true,
			ledgerRows: [firstHistoricalLedgerRow()],
		});

		await expect(
			readDrizzleMigrationStatus(connection, PROJECT_ROOT)
		).resolves.toMatchObject({
			ledgerExists: true,
			applied: 1,
			legacyApplied: 68,
		});
	});

	it('rejects a noncanonical Drizzle hash even when the legacy order exception applies', async () => {
		const { connection } = statusConnection({
			legacyNames: knownProductionOrder,
			ledgerExists: true,
			ledgerRows: [{ hash: '0'.repeat(64), created_at: 1 }],
		});

		await expect(
			readDrizzleMigrationStatus(connection, PROJECT_ROOT)
		).rejects.toThrow(/Drizzle ledger row 1 mismatch/);
	});
});
