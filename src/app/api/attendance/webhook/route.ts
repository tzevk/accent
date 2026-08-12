import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { withDb } from '@/utils/database';
import { resolveDirection } from '@/app/reports/attendance-report/data-source';

/**
 * POST /api/attendance/webhook
 *
 * Ingestion endpoint for Smart Office's outbound "Attendance Export"
 * webhook (Utilities > Data Collector Service > Third Party API). Smart
 * Office POSTs biometric punches on a schedule with a static Authorization
 * header; we authenticate, parse (single object OR array), and upsert into
 * `attendance_logs` keyed by (employee_code, log_date, serial_number).
 *
 * Auth: `Authorization: Bearer <SMARTOFFICE_WEBHOOK_SECRET>` — the only
 * verification Smart Office's webhook config supports. Missing/mismatched
 * header → 401 before any parsing or DB work. This route is in
 * middleware.ts's publicPaths (Smart Office sends no session cookie); the
 * real boundary is the Bearer check here, same posture as /api/login.
 *
 * Mapping: `employee_code` matches `employees.smartoffice_code`. Unmatched
 * punches are stored with employee_id = NULL — never dropped — so the
 * Attendance Report's "unmapped codes" strip can surface them.
 *
 * Direction: the raw device value is normalized via the report module's
 * `resolveDirection` ('in'/'out', blank → NULL) and stored; the report
 * infers in/out at read time when the column is NULL.
 *
 * Idempotency: re-pushed punches hit the unique constraint and become a
 * no-op (except backfilling employee_id when a previously-unmapped punch is
 * re-pushed after mapping — the original raw_payload is preserved).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — plenty for a punch batch

interface PunchRecord {
	employeeCode: string;
	logDate: string;
	serialNumber: string;
	direction: string | null;
}

interface ParsedPunch {
	record: PunchRecord;
	raw: Record<string, unknown>;
}

/** Constant-time comparison via SHA-256 digests (length-safe). */
function secretsEqual(a: string, b: string): boolean {
	const digestA = crypto.createHash('sha256').update(a).digest();
	const digestB = crypto.createHash('sha256').update(b).digest();
	return crypto.timingSafeEqual(digestA, digestB);
}

/** Normalize one raw punch; returns null when required fields are missing. */
function parsePunch(value: unknown): ParsedPunch | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const employeeCode =
		typeof raw.employeeCode === 'string' ? raw.employeeCode.trim() : '';
	const logDate = typeof raw.logDate === 'string' ? raw.logDate.trim() : '';
	const serialNumber =
		typeof raw.serialNumber === 'string' ? raw.serialNumber.trim() : '';
	if (!employeeCode || !logDate || !serialNumber) return null;
	return {
		record: {
			employeeCode,
			logDate,
			serialNumber,
			direction: typeof raw.direction === 'string' ? raw.direction : '',
		},
		raw,
	};
}

export async function POST(request: Request) {
	// TEMP-DEBUG: log every hit (before auth, so misconfigured Smart Office
	// pushes — wrong header, wrong casing — are visible too). The secret
	// itself is never logged. Remove once real traffic is confirmed.
	console.log(
		'[attendance-webhook] hit',
		JSON.stringify({
			method: request.method,
			contentType: request.headers.get('content-type'),
			contentLength: request.headers.get('content-length'),
			authHeaderPresent: !!request.headers.get('authorization'),
		})
	);

	// 1. Authenticate before anything else.
	const secret = process.env.SMARTOFFICE_WEBHOOK_SECRET;
	if (!secret) {
		console.error(
			'[attendance-webhook] SMARTOFFICE_WEBHOOK_SECRET is not configured — rejecting all requests'
		);
		return NextResponse.json(
			{ success: false, error: 'Webhook is not configured' },
			{ status: 500 }
		);
	}
	const authHeader = request.headers.get('authorization') ?? '';
	if (!secretsEqual(authHeader.trim(), `Bearer ${secret}`)) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	// 2. Read + parse the raw body so we can log it recoverably on failure.
	let rawBody = '';
	try {
		rawBody = await request.text();
	} catch (error) {
		console.error('[attendance-webhook] Failed to read body:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to read request body' },
			{ status: 200 }
		);
	}

	if (rawBody.length === 0) {
		console.error('[attendance-webhook] Empty body received');
		return NextResponse.json(
			{ success: false, error: 'Empty request body' },
			{ status: 200 }
		);
	}
	if (rawBody.length > MAX_BODY_BYTES) {
		console.error(
			`[attendance-webhook] Body too large (${rawBody.length} bytes); first 1KB:`,
			rawBody.slice(0, 1024)
		);
		return NextResponse.json(
			{ success: false, error: 'Request body too large' },
			{ status: 200 }
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		console.error('[attendance-webhook] Invalid JSON body:', rawBody);
		return NextResponse.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 200 }
		);
	}

	// Accept a single object or an array of objects (IsArray toggle unknown).
	const values = Array.isArray(parsed) ? parsed : [parsed];

	// TEMP-DEBUG: surface the real payload shape (casing/nesting) in logs.
	// Remove once Smart Office's actual body is confirmed.
	console.log(
		'[attendance-webhook] payload sample:',
		JSON.stringify(parsed).slice(0, 500)
	);
	const punches: ParsedPunch[] = [];
	const skipped: { index: number; reason: string }[] = [];
	values.forEach((value, index) => {
		const punch = parsePunch(value);
		if (punch) punches.push(punch);
		else
			skipped.push({
				index,
				reason: 'missing employeeCode/logDate/serialNumber or wrong type',
			});
	});

	if (punches.length === 0) {
		console.warn(
			'[attendance-webhook] No valid punches in body:',
			rawBody.slice(0, 4096)
		);
		return NextResponse.json({
			success: true,
			received: values.length,
			inserted: 0,
			skipped: values.length,
			unmatchedCodes: [],
		});
	}

	// 3. Map employee codes → Accent employees in one query.
	const codes = Array.from(new Set(punches.map((p) => p.record.employeeCode)));
	const codeToEmployeeId = new Map<string, number>();
	let inserted = 0;
	let unmatchedCodes: string[] = [];

	try {
		await withDb(async (db) => {
			const placeholders = codes.map(() => '?').join(', ');
			const [employeeRows] = (await db.execute(
				`SELECT id, smartoffice_code FROM employees
				 WHERE smartoffice_code IN (${placeholders}) AND isDelete = 0`,
				codes
			)) as [Array<{ id: number; smartoffice_code: string }>, unknown];
			for (const row of employeeRows) {
				codeToEmployeeId.set(String(row.smartoffice_code), row.id);
			}

			// 4. Upsert each punch; duplicate keys no-op except backfilling a
			// newly-available mapping.
			for (const { record, raw } of punches) {
				const resolvedDirection = resolveDirection(record.direction);
				const [result] = (await db.execute(
					`INSERT INTO attendance_logs
					   (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
					 VALUES (?, ?, ?, ?, ?, ?)
					 ON DUPLICATE KEY UPDATE
					   employee_id = COALESCE(VALUES(employee_id), employee_id)`,
					[
						record.employeeCode,
						record.logDate,
						record.serialNumber,
						resolvedDirection === 'unknown' ? null : resolvedDirection,
						JSON.stringify(raw),
						codeToEmployeeId.get(record.employeeCode) ?? null,
					]
				)) as [{ affectedRows: number; insertId: number }, unknown];
				// MariaDB reports affectedRows=1 for an unchanged duplicate
				// (MySQL reports 0) and returns the existing row's id on the
				// update branch — so a true insert is only affectedRows === 1
				// with a non-zero insertId.
				if (result.affectedRows === 1 && result.insertId !== 0) inserted++;
			}
		});
	} catch (error) {
		console.error(
			'[attendance-webhook] DB write failed:',
			error instanceof Error ? error.message : error
		);
		return NextResponse.json(
			{ success: false, error: 'Failed to store punches' },
			{ status: 500 }
		);
	}

	// 5. Fast response — no downstream processing in the request path.
	unmatchedCodes = codes.filter((code) => !codeToEmployeeId.has(code));
	if (skipped.length > 0) {
		console.warn(
			`[attendance-webhook] Skipped ${skipped.length} invalid punch(es):`,
			JSON.stringify(skipped)
		);
	}
	return NextResponse.json({
		success: true,
		received: values.length,
		inserted,
		skipped: skipped.length,
		unmatchedCodes,
	});
}
