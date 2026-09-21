/**
 * SmartOffice → Accent CRM attendance bridge.
 *
 * Designed to run on an always-on Windows machine on the office LAN,
 * where alone the SmartOfficeDb SQL Server (ATS-PC-026\SQLEXPRESS,
 * 172.16.1.40) is reachable. Each pass:
 *
 *   1. Resolve the SQLEXPRESS dynamic port (SQL Browser UDP 1434) unless
 *      MSSQL_PORT is pinned — the port drifts when SQL Server restarts.
 *   2. SELECT raw punches newer than (last position - LOOKBACK_MINUTES)
 *      from this month's and last month's `DeviceLogs_M_YYYY` shards.
 *   3. Map DeviceId → Devices.SerialNumber, skipping SmartOffice's
 *      virtual devices (Leave/Special Off/Absent/… — blank or shared
 *      '12345678' serials, never real punches).
 *   4. POST batches to the CRM webhook, which upserts into
 *      `attendance_logs` keyed by (employee_code, log_date, serial_number)
 *      — so re-pushed punches are free and passes are idempotent.
 *
 * Direction: only `AttDirection` is forwarded (trimmed). It is blank on
 * every real device today, so the webhook stores NULL and the Attendance
 * Report infers in/out from punch order. The sibling `Direction` column is
 * deliberately NOT sent — SmartOffice fills it with a constant 'in' on
 * these units, which would poison the report.
 *
 * Modes:
 *   node sync.mjs            loop (default, POLL_SECONDS cadence)
 *   node sync.mjs --once     single pass (for Task Scheduler)
 *   node sync.mjs --once --dry-run   fetch + transform, print, no POST
 *   node sync.mjs --backfill-days=N  force the window to the last N days,
 *                            ignoring state.json (webhook upserts, so safe)
 *   node sync.mjs --help     usage
 *
 * State (state.json) only advances when every batch was accepted, so a
 * failed pass naturally retries the same window next time.
 *
 * Exit codes: 0 ok, 1 a --once pass failed (Task Scheduler "Last Result" /
 * config incomplete), 2 unknown argument. Every run appends to LOG_FILE
 * (default: sync.log next to this script) — a Task Scheduler pass has no
 * console, so that file is the only record of what it did.
 */

import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────

function loadEnv() {
	const file = path.join(HERE, '.env');
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!m || line.trim().startsWith('#')) continue;
		if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
	}
}
loadEnv();

const cfg = {
	host: process.env.MSSQL_HOST || '172.16.1.40',
	port: parseInt(process.env.MSSQL_PORT || '', 10) || 0,
	instance: process.env.MSSQL_INSTANCE || 'SQLEXPRESS',
	database: process.env.MSSQL_DATABASE || 'SmartOfficedb',
	user: process.env.MSSQL_USER,
	password: process.env.MSSQL_PASSWORD,
	webhookUrl: process.env.WEBHOOK_URL || '',
	webhookSecret: process.env.WEBHOOK_SECRET || '',
	pollSeconds: parseInt(process.env.POLL_SECONDS || '300', 10),
	lookbackMinutes: parseInt(process.env.LOOKBACK_MINUTES || '120', 10),
	backfillDays: parseInt(process.env.BACKFILL_DAYS || '3', 10),
	batchSize: parseInt(process.env.BATCH_SIZE || '400', 10),
	stateFile: path.join(HERE, process.env.STATE_FILE || 'state.json'),
	// Default on: a Task Scheduler pass has no console, so this file is the
	// only record of what a scheduled run did. A relative path lands next to
	// the script (HERE), independent of the process working directory.
	logFile: path.join(HERE, process.env.LOG_FILE || 'sync.log'),
	// Optional allowlist: comma-separated device serials. Empty = all real devices.
	deviceSerials: new Set(
		String(process.env.DEVICE_SERIALS || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	),
};

// ─── Logging ─────────────────────────────────────────────────────────

function log(level, msg) {
	const line = `${new Date().toISOString()} [${level}] ${msg}`;
	console.log(line);
	if (cfg.logFile) {
		try {
			fs.appendFileSync(cfg.logFile, line + '\n');
		} catch {
			/* logging must never kill the pass */
		}
	}
}

// ─── Arguments ───────────────────────────────────────────────────────

const USAGE =
	'Usage: node sync.mjs [--once] [--dry-run] [--backfill-days=N] [--help]';
const ARGS = process.argv.slice(2);
const BACKFILL_FLAG = /^--backfill-days=(\d+)$/;
const backfillArg = ARGS.find((a) => BACKFILL_FLAG.test(a));

// A typo'd flag (e.g. --run-once) must fail loudly: ignoring it would start
// an endless loop-mode process under Task Scheduler, and the default
// IgnoreNew policy then skips every later trigger while it hangs around.
const unknownArgs = ARGS.filter(
	(a) =>
		!['--once', '--dry-run', '--help'].includes(a) && !BACKFILL_FLAG.test(a)
);
if (unknownArgs.length > 0) {
	log('error', `Unknown argument(s): ${unknownArgs.join(' ')}`);
	log('error', USAGE);
	process.exit(2);
}
if (ARGS.includes('--help')) {
	log('info', USAGE);
	process.exit(0);
}

const ONCE = ARGS.includes('--once');
const DRY_RUN = ARGS.includes('--dry-run');
/** Explicit window override — --backfill-days=N ignores state.json. */
const forcedBackfillDays = backfillArg
	? parseInt(backfillArg.match(BACKFILL_FLAG)[1], 10)
	: 0;
if (forcedBackfillDays > 0) cfg.backfillDays = forcedBackfillDays;

for (const [k, v] of Object.entries({
	MSSQL_USER: cfg.user,
	MSSQL_PASSWORD: cfg.password,
	WEBHOOK_URL: DRY_RUN ? 'x' : cfg.webhookUrl,
	WEBHOOK_SECRET: DRY_RUN ? 'x' : cfg.webhookSecret,
})) {
	if (!v) {
		// Via log() so a headless run's failure also lands in the log file.
		log('error', `Missing required setting: ${k} (see .env.example)`);
		process.exit(1);
	}
}

// ─── Time helpers ────────────────────────────────────────────────────

const p2 = (x) => String(x).padStart(2, '0');

/** Naive local 'YYYY-MM-DD HH:mm:ss' — SmartOffice stores IST wall time in a
 * tz-naive DATETIME, and tedious hands it back UTC-interpreted (12:45 wall
 * becomes 12:45Z). UTC getters therefore recover the wall clock exactly on
 * any box timezone. Do NOT use local getters (an IST box would add +5:30)
 * or toISOString() (UTC shift). */
function fmtLocal(d) {
	return (
		`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ` +
		`${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
	);
}

/** SmartOffice shards punches as DeviceLogs_<M>_<YYYY> — month unpadded. */
function shardNames(d) {
	const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
	const name = (x) => `DeviceLogs_${x.getMonth() + 1}_${x.getFullYear()}`;
	return [...new Set([name(d), name(prev)])];
}

// ─── SQL Browser port resolution ─────────────────────────────────────

function resolvePort() {
	return new Promise((resolve, reject) => {
		const sock = dgram.createSocket('udp4');
		const timer = setTimeout(
			() =>
				sock.close(() => reject(new Error('SQL Browser timeout (UDP 1434)'))),
			5000
		);
		sock.on('message', (buf) => {
			clearTimeout(timer);
			const text = buf.toString('latin1');
			const m = text.match(/tcp;(\d+)/i);
			sock.close(() =>
				m
					? resolve(parseInt(m[1], 10))
					: reject(new Error(`No tcp port in: ${text}`))
			);
		});
		sock.on('error', (e) => {
			clearTimeout(timer);
			try {
				sock.close();
			} catch {}
			reject(e);
		});
		sock.send(
			Buffer.from([0x02, ...Buffer.from(cfg.instance, 'ascii'), 0x00]),
			1434,
			cfg.host
		);
	});
}

async function connectConfig() {
	let port = cfg.port;
	if (!port) {
		port = await resolvePort();
		log(
			'info',
			`Resolved ${cfg.instance} on ${cfg.host}:${port} via SQL Browser`
		);
	}
	return {
		server: cfg.host,
		port,
		database: cfg.database,
		user: cfg.user,
		password: cfg.password,
		connectionTimeout: 10000,
		requestTimeout: 30000,
		options: { encrypt: false, trustServerCertificate: true },
	};
}

// ─── State ───────────────────────────────────────────────────────────

function readState() {
	try {
		const s = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
		if (s?.lastLogDate) return s;
	} catch {}
	return null;
}

function writeState(state) {
	const tmp = `${cfg.stateFile}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
	fs.renameSync(tmp, cfg.stateFile);
}

/** Window for this pass, plus why it was picked (logged for headless runs). */
function sinceDate(state) {
	if (forcedBackfillDays > 0) {
		const d = new Date();
		d.setDate(d.getDate() - forcedBackfillDays);
		return { since: d, reason: `--backfill-days=${forcedBackfillDays}` };
	}
	if (state?.lastLogDate) {
		// Overlap window: re-send anything newer than position - lookback.
		const d = new Date(`${state.lastLogDate.replace(' ', 'T')}`);
		d.setMinutes(d.getMinutes() - cfg.lookbackMinutes);
		return {
			since: d,
			reason: `state ${state.lastLogDate} - ${cfg.lookbackMinutes}m lookback`,
		};
	}
	const d = new Date();
	d.setDate(d.getDate() - cfg.backfillDays);
	return {
		since: d,
		reason: `first run (BACKFILL_DAYS=${cfg.backfillDays})`,
	};
}

// ─── Fetch ───────────────────────────────────────────────────────────

/** Serials that SmartOffice ships as virtual devices, never real punches. */
const VIRTUAL_SERIALS = new Set(['', '12345678']);

async function fetchShards(db, shards, since) {
	const punches = new Map(); // key: serial|logDate|userId — mirrors webhook dedupe
	for (const shard of shards) {
		const exists = (
			await db.request().input('name', sql.VarChar, shard)
				.query`SELECT 1 FROM sys.tables WHERE name = @name`
		).recordset.length;
		if (!exists) continue;

		const rows = (
			await db
				.request()
				.input('since', sql.DateTime, since)
				.query(
					`SELECT l.UserId, l.LogDate, l.AttDirection, d.SerialNumber
					 FROM dbo.${shard} l
					 JOIN dbo.Devices d ON d.DeviceId = l.DeviceId
					 WHERE l.LogDate > @since
					 ORDER BY l.LogDate ASC`
				)
		).recordset;

		let added = 0;
		for (const r of rows) {
			const serialNumber = String(r.SerialNumber ?? '').trim();
			if (VIRTUAL_SERIALS.has(serialNumber)) continue;
			if (cfg.deviceSerials.size > 0 && !cfg.deviceSerials.has(serialNumber))
				continue;
			const record = {
				employeeCode: String(r.UserId ?? '').trim(),
				logDate: fmtLocal(r.LogDate),
				serialNumber,
				direction: String(r.AttDirection ?? '').trim(),
			};
			if (!record.employeeCode || !record.logDate || !record.serialNumber)
				continue;
			const key = `${record.serialNumber}|${record.logDate}|${record.employeeCode}`;
			if (!punches.has(key)) {
				punches.set(key, record);
				added++;
			}
		}
		log('info', `${shard}: ${added} punch(es) since ${fmtLocal(since)}`);
	}
	// Global time order keeps batch boundaries deterministic.
	return [...punches.values()].sort((a, b) => (a.logDate < b.logDate ? -1 : 1));
}

// ─── Push ────────────────────────────────────────────────────────────

async function postBatch(batch, attempt = 0) {
	const delays = [1000, 5000, 15000];
	try {
		const res = await fetch(cfg.webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${cfg.webhookSecret}`,
			},
			body: JSON.stringify(batch),
			signal: AbortSignal.timeout(30_000),
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok || body.success === false) {
			throw new Error(
				`HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`
			);
		}
		return body;
	} catch (e) {
		if (attempt >= delays.length) throw e;
		const wait = delays[attempt];
		log(
			'warn',
			`POST failed (${e.message}); retry ${attempt + 1} in ${wait}ms`
		);
		await new Promise((r) => setTimeout(r, wait));
		return postBatch(batch, attempt + 1);
	}
}

async function push(punches) {
	let inserted = 0;
	let skipped = 0;
	for (let i = 0; i < punches.length; i += cfg.batchSize) {
		const batch = punches.slice(i, i + cfg.batchSize);
		const res = await postBatch(batch);
		inserted += res.inserted ?? 0;
		skipped += res.skipped ?? 0;
		log(
			'info',
			`POST ${batch.length} punch(es): inserted=${res.inserted ?? '?'} skipped=${res.skipped ?? '?'} unmatched=${(res.unmatchedCodes ?? []).length}`
		);
		if ((res.unmatchedCodes ?? []).length > 0) {
			log('warn', `Unmatched codes: ${res.unmatchedCodes.join(', ')}`);
		}
	}
	return { inserted, skipped };
}

// ─── One pass ────────────────────────────────────────────────────────

async function runPass() {
	const state = readState();
	const { since, reason } = sinceDate(state);
	log('info', `Pass starting (since ${fmtLocal(since)} — ${reason})`);

	const db = await sql.connect(await connectConfig());
	try {
		const punches = await fetchShards(db, shardNames(new Date()), since);
		if (punches.length === 0) {
			log('info', 'No new punches.');
			return;
		}
		if (DRY_RUN) {
			log('info', `DRY RUN: would POST ${punches.length} punch(es). First 3:`);
			for (const p of punches.slice(0, 3)) log('info', JSON.stringify(p));
			return;
		}

		const { inserted, skipped } = await push(punches);

		const maxLogDate = punches[punches.length - 1].logDate;
		writeState({
			lastLogDate: maxLogDate,
			updatedAt: new Date().toISOString(),
		});
		log(
			'info',
			`Pass done: fetched=${punches.length} inserted=${inserted} skipped=${skipped} position=${maxLogDate}`
		);
	} finally {
		await sql.close().catch(() => {});
	}
}

async function main() {
	log(
		'info',
		`smartoffice-sync starting (${ONCE ? 'once' : 'loop'}${DRY_RUN ? ', dry-run' : ''})` +
			` pid=${process.pid} node=${process.version} args=[${ARGS.join(' ')}]` +
			` user=${process.env.USERDOMAIN || '?'}\\${process.env.USERNAME || '?'}` +
			` cwd=${process.cwd()} scriptDir=${HERE}`
	);
	// Whose .env/state this run actually read — the usual scheduled-vs-manual
	// difference is a different copy, account, or URL.
	log(
		'info',
		`config: instance=${cfg.instance} db=${cfg.database} webhook=${cfg.webhookUrl}` +
			` state=${cfg.stateFile} log=${cfg.logFile}` +
			` lookback=${cfg.lookbackMinutes}m backfill=${cfg.backfillDays}d batch=${cfg.batchSize}` +
			` devices=${cfg.deviceSerials.size > 0 ? `[${[...cfg.deviceSerials].join(',')}]` : 'all'}`
	);
	let failed = 0;
	do {
		try {
			await runPass();
		} catch (e) {
			failed++;
			log('error', `Pass failed: ${e.message}`);
		}
		if (ONCE) break;
		await new Promise((r) => setTimeout(r, cfg.pollSeconds * 1000));
	} while (true);
	log('info', `smartoffice-sync stopped (failed passes: ${failed}).`);
	// Task Scheduler reports this as "Last Result": 0 = the pass was accepted,
	// 1 = read sync.log. Without it every scheduled failure looks like success.
	if (ONCE && failed > 0) process.exitCode = 1;
}

main();
