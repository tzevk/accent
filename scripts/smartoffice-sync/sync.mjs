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
 *
 * State (state.json) only advances when every batch was accepted, so a
 * failed pass naturally retries the same window next time.
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
	logFile: process.env.LOG_FILE ? path.join(HERE, process.env.LOG_FILE) : null,
};

const ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');
const backfillArg = process.argv.find((a) => a.startsWith('--backfill-days='));
if (backfillArg)
	cfg.backfillDays =
		parseInt(backfillArg.split('=')[1], 10) || cfg.backfillDays;

for (const [k, v] of Object.entries({
	MSSQL_USER: cfg.user,
	MSSQL_PASSWORD: cfg.password,
	WEBHOOK_URL: DRY_RUN ? 'x' : cfg.webhookUrl,
	WEBHOOK_SECRET: DRY_RUN ? 'x' : cfg.webhookSecret,
})) {
	if (!v) {
		console.error(`Missing required setting: ${k} (see .env.example)`);
		process.exit(1);
	}
}

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

// ─── Time helpers ────────────────────────────────────────────────────

const p2 = (x) => String(x).padStart(2, '0');

/** Naive local 'YYYY-MM-DD HH:mm:ss' — the DB stores IST wall time and
 * tedious hands it back as a client-local Date, so local getters round-trip
 * the punch clock exactly. Do NOT use toISOString() (UTC shift). */
function fmtLocal(d) {
	return (
		`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
		`${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
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

function sinceDate(state) {
	if (state?.lastLogDate) {
		// Overlap window: re-send anything newer than position - lookback.
		const d = new Date(`${state.lastLogDate.replace(' ', 'T')}`);
		d.setMinutes(d.getMinutes() - cfg.lookbackMinutes);
		return d;
	}
	const d = new Date();
	d.setDate(d.getDate() - cfg.backfillDays);
	return d;
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
	const since = sinceDate(state);
	log(
		'info',
		`Pass starting (since ${fmtLocal(since)}, state=${state ? state.lastLogDate : 'none'})`
	);

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
		`smartoffice-sync starting (${ONCE ? 'once' : 'loop'}${DRY_RUN ? ', dry-run' : ''})`
	);
	do {
		try {
			await runPass();
		} catch (e) {
			log('error', `Pass failed: ${e.message}`);
		}
		if (ONCE) break;
		await new Promise((r) => setTimeout(r, cfg.pollSeconds * 1000));
	} while (true);
	log('info', 'smartoffice-sync stopped.');
}

main();
