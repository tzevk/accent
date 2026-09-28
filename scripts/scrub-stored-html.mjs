#!/usr/bin/env node
/**
 * B4 — one-off scrub of stored rich-text rows (ADR-0012; plan §B2/B4).
 *
 * Rich text was stored verbatim until B2 moved the sanitizer to the write
 * paths, so rows written earlier may still carry what the old regex denylist
 * let through (`<svg/onload=…>`, `javascript:` links, …). This script re-runs
 * the same `sanitizeRichText` the B2 write paths apply over the existing rows.
 *
 * Idempotent: `sanitizeRichText` is stable under re-application and rows whose
 * sanitized value equals the stored value are skipped, so a second run reports
 * zero changes. Dry-run by default; nothing is written without `--apply`.
 *
 * Note: `sanitizeRichText` also entity-encodes bare `&`, `<` and `>` in
 * text-only values (`AT&T` → `AT&amp;T`) — that is the same output the B2 write
 * paths store, and the dry-run preview shows it per row before anything runs.
 *
 * Usage (run from the repo root; `.env` supplies the credentials):
 *   node scripts/scrub-stored-html.mjs                            # dry-run, dev
 *   node scripts/scrub-stored-html.mjs --apply                    # dev write
 *   node scripts/scrub-stored-html.mjs --apply --backup dump.json # backup first
 *   node scripts/scrub-stored-html.mjs --target=prod              # PROD_DB_*
 *   node scripts/scrub-stored-html.mjs --artifact e2e/artifacts/security-scrub-dry-run.json
 *                                                    # record the run summary
 *
 * Columns — enumerated from the code on 2026-09-28 (rich text only):
 *   messages.body                        rendered at messages/page.jsx:1488
 *   proposals.description                proposals/[id]/edit/page.jsx:1244 (RichTextEditor)
 *   proposals.discipline_descriptions    JSON map { discipline: html } (proposals/route.js:244)
 *   projects.description                 projects/[id]/route.js:813
 *   projects.additional_scope            projects/[id]/route.js:814
 *   projects.scope_of_work               projects/[id]/route.js:867 (html in seed data)
 *   projects.discipline_descriptions     JSON map { discipline: html } (projects/route.js:303)
 *   quotations.subject, quotations.notes, quotations.terms
 *   quotations.terms_and_conditions      admin/quotation/[id]/edit/page.jsx:987 (RichTextEditor)
 *   quotations.items, quotations.scope_items
 *                                        JSON rows; `description` is rich text
 *                                        (admin/quotation/[id]/edit/page.jsx:731)
 *   quotations.annexure_* (16 columns)   RichTextEditor, admin/quotation/[id]/edit/page.jsx:1011+
 *   project_quotations.scope_of_work, project_quotations.terms_and_conditions
 *   project_quotations.scope_items       JSON rows; `description` is rich text
 *   project_quotations.annexure_* (16)   same annexure set as `quotations`
 *
 * Deliberately excluded: plain-text columns that only pass through HTML
 * templates (escaped at the sink by workstream D), non-rich JSON columns
 * (`projects.activities`/`assignments`, `proposals.activities`), and
 * `quotations.work_items` (no reader or writer in the codebase).
 *
 * Soft-deleted rows are left untouched (`isDelete = 0`, repo convention).
 * No DDL: the script only SELECTs and UPDATEs.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { sanitizeRichText } from '../src/lib/sanitize.js';
import { getDbSslConfig } from '../src/utils/database.js';

/** All `annexure_*` rich-text columns; `quotations` and `project_quotations` share the set. */
const ANNEXURE_COLUMNS = [
	'annexure_scope_of_work',
	'annexure_input_document',
	'annexure_deliverables',
	'annexure_software',
	'annexure_duration',
	'annexure_site_visit',
	'annexure_quotation_validity',
	'annexure_mode_of_delivery',
	'annexure_revision',
	'annexure_exclusions',
	'annexure_billing_payment_terms',
	'annexure_confidentiality',
	'annexure_codes_standards',
	'annexure_dispute_resolution',
	'annexure_taxation',
	'annexure_payment_milestone',
];

// Column handling: `html` = the cell is rich-text HTML; `html-map` = a JSON
// document whose string values are rich-text HTML; `json-rows` = a JSON array
// of rows whose `description` field is rich-text HTML.
const HTML = 'html';
const HTML_MAP = 'html-map';
const JSON_ROWS = 'json-rows';

const TARGETS = [
	{ table: 'messages', pk: 'id', columns: [['body', HTML]] },
	{
		table: 'proposals',
		pk: 'id',
		columns: [
			['description', HTML],
			['discipline_descriptions', HTML_MAP],
		],
	},
	{
		table: 'projects',
		pk: 'project_id',
		columns: [
			['description', HTML],
			['additional_scope', HTML],
			['scope_of_work', HTML],
			['discipline_descriptions', HTML_MAP],
		],
	},
	{
		table: 'quotations',
		pk: 'id',
		columns: [
			['subject', HTML],
			['notes', HTML],
			['terms', HTML],
			['terms_and_conditions', HTML],
			['items', JSON_ROWS],
			['scope_items', JSON_ROWS],
			...ANNEXURE_COLUMNS.map((column) => [column, HTML]),
		],
	},
	{
		table: 'project_quotations',
		pk: 'id',
		columns: [
			['scope_of_work', HTML],
			['terms_and_conditions', HTML],
			['scope_items', JSON_ROWS],
			...ANNEXURE_COLUMNS.map((column) => [column, HTML]),
		],
	},
];

const ENV_PREFIX_BY_TARGET = {
	dev: 'DEV_DB',
	staging: 'STAGING_DB',
	prod: 'PROD_DB',
};

/** Recursively sanitizes string leaves; `keys === null` visits every string. */
function scrubTree(node, keys, state) {
	if (typeof node === 'string') {
		const next = sanitizeRichText(node);
		if (next !== node) state.changed = true;
		return next;
	}
	if (Array.isArray(node)) {
		return node.map((child) => scrubTree(child, keys, state));
	}
	if (node && typeof node === 'object') {
		for (const key of Object.keys(node)) {
			if (keys !== null && !keys.includes(key)) continue;
			node[key] = scrubTree(node[key], keys, state);
		}
		return node;
	}
	return node;
}

function scrubHtmlCell(value) {
	const next = sanitizeRichText(value);
	return {
		status: next === value ? 'unchanged' : 'changed',
		next,
		note: null,
	};
}

function scrubJsonCell(value, keys) {
	let data;
	try {
		data = JSON.parse(value);
	} catch {
		// Defensive: this schema enforces `json_valid()` CHECK constraints on the
		// JSON columns, so a non-JSON blob should not exist. If one does (older
		// schema, other database), treat it as HTML text so a script payload is
		// still removed; flagged for the operator.
		const fallback = scrubHtmlCell(value);
		return { ...fallback, note: 'not-json (sanitized as html)' };
	}
	const state = { changed: false };
	const next = scrubTree(data, keys, state);
	if (!state.changed) return { status: 'unchanged', next: value, note: null };
	return { status: 'changed', next: JSON.stringify(next), note: null };
}

function scrubCell(kind, value) {
	// `jsonStrings: true` makes every selected cell a string; anything else is
	// a driver shape we did not expect, and we never overwrite what we cannot
	// read back.
	if (typeof value !== 'string') {
		return {
			status: 'skipped',
			next: value,
			note: `skipped: driver returned ${typeof value}`,
		};
	}
	if (kind === HTML) return scrubHtmlCell(value);
	if (kind === HTML_MAP) return scrubJsonCell(value, null);
	if (kind === JSON_ROWS) return scrubJsonCell(value, ['description']);
	throw new Error(`unknown column kind: ${kind}`);
}

function parseArgs(argv) {
	let apply = false;
	let target = 'dev';
	let backupPath = null;
	let artifactPath = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--apply') {
			apply = true;
		} else if (
			arg === '--backup' ||
			arg === '--target' ||
			arg === '--artifact'
		) {
			const value = argv[index + 1];
			if (!value || value.startsWith('--')) {
				throw new Error(`${arg} needs a value`);
			}
			if (arg === '--backup') backupPath = value;
			else if (arg === '--target') target = value;
			else artifactPath = value;
			index += 1;
		} else if (arg.startsWith('--target=')) {
			target = arg.slice('--target='.length);
		} else if (arg.startsWith('--backup=')) {
			backupPath = arg.slice('--backup='.length);
			if (!backupPath) throw new Error('--backup needs a value');
		} else if (arg.startsWith('--artifact=')) {
			artifactPath = arg.slice('--artifact='.length);
			if (!artifactPath) throw new Error('--artifact needs a value');
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (!Object.hasOwn(ENV_PREFIX_BY_TARGET, target)) {
		throw new Error(
			`unknown --target ${JSON.stringify(target)} (dev|staging|prod)`
		);
	}
	return { apply, target, backupPath, artifactPath };
}

function truncate(value, length = 160) {
	const text = String(value ?? '');
	return text.length > length ? `${text.slice(0, length)}…` : text;
}

const { apply, target, backupPath, artifactPath } = parseArgs(
	process.argv.slice(2)
);
const envPrefix = ENV_PREFIX_BY_TARGET[target];
const database = process.env[`${envPrefix}_NAME`];
const user = process.env[`${envPrefix}_USER`];
const password = process.env[`${envPrefix}_PASSWORD`];

if (!database || !user) {
	throw new Error(
		`missing ${envPrefix}_NAME / ${envPrefix}_USER in the environment (.env)`
	);
}

const ssl = getDbSslConfig();
if (!ssl && target === 'prod') {
	console.warn(
		'[scrub] WARNING: DB_SSL_MODE is off for a production target — SEC-20 expects verify.'
	);
}

const connection = await mysql.createConnection({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT) || 3306,
	database,
	user,
	password,
	dateStrings: true,
	// MariaDB reports JSON columns as LONGTEXT+BINARY, which mysql2 otherwise
	// hands back as parsed objects/arrays. This script compares and writes the
	// stored *text*, so ask the driver for the raw string.
	jsonStrings: true,
	// Same TLS source of truth as `knexfile.js` / the app pool (SEC-20).
	...(ssl ? { ssl } : {}),
});

const report = [];
const changes = [];
let written = 0;
let skipped = 0;
let failed = 0;

try {
	console.log(
		`[scrub] target=${target} database=${database} mode=${apply ? 'apply' : 'dry-run'}`
	);

	const [schemaRows] = await connection.query(
		'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'
	);
	const existing = new Set(
		schemaRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`)
	);
	const softDeleteTables = new Set(
		schemaRows
			.filter((row) => row.COLUMN_NAME === 'isDelete')
			.map((row) => row.TABLE_NAME)
	);

	for (const { table, pk, columns } of TARGETS) {
		for (const [column, kind] of columns) {
			if (!existing.has(`${table}.${column}`)) {
				console.warn(
					`[scrub] skip ${table}.${column}: column missing in ${database}`
				);
				continue;
			}
			const conditions = [
				`\`${column}\` IS NOT NULL`,
				`\`${column}\` <> ''`,
			];
			if (softDeleteTables.has(table)) conditions.push('isDelete = 0');
			const [rows] = await connection.query(
				`SELECT \`${pk}\` AS id, \`${column}\` AS value FROM \`${table}\` WHERE ${conditions.join(' AND ')}`
			);
			let changed = 0;
			let skippedCells = 0;
			let previewed = 0;
			for (const row of rows) {
				const result = scrubCell(kind, row.value);
				if (result.status === 'skipped') {
					skippedCells += 1;
					console.warn(
						`[scrub]   ${table}.${column} id=${row.id}: ${result.note}`
					);
					continue;
				}
				if (result.note) {
					// e.g. a JSON column that holds something else: report it even
					// when sanitizing changes nothing, so the operator can look.
					console.warn(
						`[scrub]   ${table}.${column} id=${row.id}: ${result.note}`
					);
				}
				if (result.status === 'unchanged') continue;
				changed += 1;
				changes.push({
					table,
					pk,
					column,
					id: row.id,
					before: row.value,
					after: result.next,
					note: result.note,
				});
				if (previewed < 3) {
					previewed += 1;
					console.log(
						`[scrub]   ${table}.${column} id=${row.id}${result.note ? ` (${result.note})` : ''}\n` +
							`[scrub]     before: ${truncate(row.value)}\n` +
							`[scrub]     after:  ${truncate(result.next)}`
					);
				}
			}
			report.push({ table, column, scanned: rows.length, changed, skippedCells });
			console.log(
				`[scrub] ${table}.${column} scanned=${rows.length} changed=${changed}` +
					(skippedCells > 0 ? ` skipped=${skippedCells}` : '')
			);
		}
	}

	if (apply && changes.length > 0) {
		if (backupPath) {
			await writeFile(
				backupPath,
				JSON.stringify(
					{
						generatedAt: new Date().toISOString(),
						target,
						database,
						changes,
					},
					null,
					'\t'
				)
			);
			console.log(
				`[scrub] backup written: ${backupPath} (${changes.length} row(s))`
			);
		} else {
			console.warn(
				'[scrub] WARNING: --apply without --backup — no restore artifact is being written'
			);
		}
		for (const change of changes) {
			const guard = softDeleteTables.has(change.table)
				? ' AND isDelete = 0'
				: '';
			// Compare-and-swap on the read value: a row edited after the SELECT
			// is reported as skipped instead of being overwritten blind.
			try {
				const [result] = await connection.execute(
					`UPDATE \`${change.table}\` SET \`${change.column}\` = ? WHERE \`${change.pk}\` = ?${guard} AND BINARY \`${change.column}\` = BINARY ?`,
					[change.after, change.id, change.before]
				);
				if (result.affectedRows === 1) written += 1;
				else skipped += 1;
			} catch (error) {
				// Keep going: one bad row must not leave the rest unscanned, and
				// the failure is reported (and makes the exit code non-zero).
				failed += 1;
				console.error(
					`[scrub] UPDATE failed for ${change.table}.${change.column} id=${change.id}: ${error.code || error.message}`
				);
			}
		}
		console.log(
			`[scrub] updated=${written} skipped=${skipped} failed=${failed}`
		);
	} else if (apply) {
		console.log('[scrub] nothing to do — every stored value is already clean');
	}

	const summary = {
		target,
		database,
		mode: apply ? 'apply' : 'dry-run',
		scanned: report.reduce((total, entry) => total + entry.scanned, 0),
		changed: report.reduce((total, entry) => total + entry.changed, 0),
		skippedCells: report.reduce(
			(total, entry) => total + entry.skippedCells,
			0
		),
		written,
		skipped,
		failed,
		columns: report,
	};
	console.log(`[scrub] summary ${JSON.stringify(summary)}`);
	if (artifactPath) {
		await mkdir(path.dirname(artifactPath), { recursive: true });
		await writeFile(
			artifactPath,
			`${JSON.stringify(
				{
					flow: 'security-scrub',
					generatedAt: new Date().toISOString(),
					...summary,
				},
				null,
				2
			)}\n`
		);
		console.log(`[scrub] artifact written to ${artifactPath}`);
	}
	if (failed > 0) process.exitCode = 1;
} finally {
	await connection.end();
}
