import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
	processTicketEmailOutbox,
	TicketEmailConfigurationError,
} from '@/lib/tickets/email-outbox';

/**
 * GET /api/cron/ticket-emails
 *
 * Scheduled worker for `ticket_email_outbox` (ADR-0014). Vercel Cron calls
 * this path every minute with `Authorization: Bearer <CRON_SECRET>`; a cron
 * invocation cannot carry a session cookie, so that header is the whole
 * authentication boundary.
 *
 * Responses:
 * - 503 when the endpoint (or the delivery SDK) is not configured, so the
 *   misconfiguration is visible without leaking any secret value.
 * - 401 for a missing or mismatched Bearer token, compared in constant time.
 * - 200 with the worker's aggregate counts after one bounded batch.
 * - 500 for an unexpected worker failure; the message stays generic and the
 *   real error is logged server-side only.
 *
 * The batch is bounded by `CRON_BATCH_LIMIT` and by `maxDuration`, so a slow
 * provider can never hold the invocation open past the platform limit.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Bounded work per invocation; the next minute's run picks up the rest. */
const CRON_BATCH_LIMIT = 20;

/** Constant-time comparison via SHA-256 digests (length-safe). */
function secretsEqual(a: string, b: string): boolean {
	const digestA = crypto.createHash('sha256').update(a).digest();
	const digestB = crypto.createHash('sha256').update(b).digest();
	return crypto.timingSafeEqual(digestA, digestB);
}

export async function GET(request: Request) {
	const secret = process.env.CRON_SECRET;
	if (!secret) {
		console.error(
			'[cron-ticket-emails] CRON_SECRET is not configured — rejecting all requests'
		);
		return NextResponse.json(
			{ success: false, error: 'Cron endpoint is not configured' },
			{ status: 503 }
		);
	}

	const authHeader = request.headers.get('authorization') ?? '';
	if (!secretsEqual(authHeader.trim(), `Bearer ${secret}`)) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	// The worker validates the delivery configuration (missing key, invalid
	// origin, bad sender) through `TicketEmailConfigurationError` and throws
	// before claiming any job. Mapping that error to 503 keeps one source of
	// truth for the rules and makes a misconfiguration visible without
	// burning retries.

	try {
		const summary = await processTicketEmailOutbox({
			limit: CRON_BATCH_LIMIT,
		});
		return NextResponse.json({ success: true, data: summary });
	} catch (error) {
		if (error instanceof TicketEmailConfigurationError) {
			console.error(
				'[cron-ticket-emails] email delivery is not configured:',
				error.message
			);
			return NextResponse.json(
				{ success: false, error: 'Email delivery is not configured' },
				{ status: 503 }
			);
		}
		// Logged without the secret: the worker reports provider failures with
		// actionable, secret-free messages.
		console.error('[cron-ticket-emails] outbox batch failed:', error);
		return NextResponse.json(
			{ success: false, error: 'Ticket email batch failed' },
			{ status: 500 }
		);
	}
}
