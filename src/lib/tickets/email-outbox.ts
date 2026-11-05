/**
 * Ticket email outbox — Resend delivery for routed support tickets.
 *
 * Server-only module: never import it from a client component.
 *
 * Two entry points:
 *
 * - `enqueueTicketEmails` runs inside the caller's ticket transaction. It
 *   snapshots one row per eligible recipient (active member of the ticket
 *   department's responsible role) so the queued message survives membership
 *   and email changes. If the department has nobody to notify it throws, which
 *   rolls the caller's transaction back — a routed ticket is never accepted
 *   with no handler to notify.
 * - `processTicketEmailOutbox` is the worker used by the cron route. It
 *   claims due jobs with a short lease, revalidates each job against live
 *   ticket/department/role/member state immediately before sending, and
 *   writes the outcome under the same lease token. A cancellation performed
 *   by the ticket API therefore wins over an in-flight worker write.
 *
 * Delivery failures are classified honestly:
 *
 * - Transient failures (network, 5xx, 429/quota, auth and sender
 *   configuration rejections, concurrent idempotency races) are retried with
 *   bounded exponential backoff. `attempts` is incremented at claim time, so
 *   a crashed worker cannot retry forever; jobs claimed and released without
 *   a send have that attempt refunded.
 * - Auth/sender configuration rejections (401/403) stop the batch and refund
 *   the attempt. Fixing `RESEND_API_KEY` or the verified sender then lets the
 *   still-pending mail resume instead of ending as `failed`.
 * - Terminal request defects (validation errors, malformed parameters,
 *   invalid recipients, reused idempotency keys, unknown ids) mark the row
 *   `failed` immediately with `last_error`.
 * - After `MAX_ATTEMPTS` transient delivery failures the row also becomes
 *   `failed`. Nothing is ever marked `sent` without a provider message id.
 *
 * One invocation also gets a wall-clock budget. A send starts only while a
 * full request timeout plus slack still fits inside it; the untouched tail is
 * released back to `pending` with its claim attempts refunded. A slow provider
 * therefore cannot leave rows leased past the platform deadline, and the
 * lease is comfortably longer than the bounded processing window.
 *
 * Known limits, documented rather than hidden:
 *
 * - Resend idempotency keys expire after 24 hours. The database state is the
 *   primary duplicate guard; the stable key only covers a retry whose first
 *   attempt actually reached Resend. A lease that expires more than 24 hours
 *   after a successful send could duplicate the message.
 * - A reassignment that happens after the send call but before the
 *   conditional completion write cannot unsend the email. The completion
 *   write is rejected, the row stays cancelled, and the summary does not
 *   claim delivery.
 */

import { randomBytes } from 'node:crypto';

import type {
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { Resend, type CreateEmailResponse } from 'resend';

import { escapeHtml } from '@/lib/escape-html';
import { dbConnect } from '@/utils/database';

import { getDepartmentRecipients, listTicketDepartments } from './departments';

/** Sender used when `RESEND_FROM_EMAIL` is not set. */
const DEFAULT_FROM_ADDRESS = 'Accent Support <support@accent.net.in>';

/** Jobs claimed per worker run unless the caller asks for less. */
const DEFAULT_BATCH_LIMIT = 20;
/** Hard ceiling; matches the cron batch so a caller cannot exceed the time envelope. */
const MAX_BATCH_LIMIT = 20;
/** Lease length; comfortably longer than one bounded invocation. */
const LEASE_SECONDS = 120;
/** Wall-clock budget for one invocation, below the 60s cron platform limit. */
const PROCESSING_BUDGET_MS = 45_000;
/** Headroom for rendering, revalidation, the throttle gate, and outcome writes. */
const SEND_SLACK_MS = 3_000;
/** Attempts after which a transient failure becomes a visible `failed` row. */
const MAX_ATTEMPTS = 12;
const BASE_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 6 * 60 * 60;
/** Resend allows 10 requests/second; leave headroom for scheduling jitter. */
const MIN_SEND_INTERVAL_MS = 110;
const RESEND_REQUEST_TIMEOUT_MS = 20_000;
const MAX_ERROR_LENGTH = 1000;
const MAX_SUBJECT_LINE_LENGTH = 200;

/**
 * Provider codes caused by deployment configuration, not by this message.
 * They are retried, and the attempt is refunded, so fixing the key or sender
 * lets pending mail resume. Status-based 401/403 fallbacks cover the rest.
 */
const CONFIGURATION_PROVIDER_ERRORS: Record<string, true> = {
	missing_api_key: true,
	invalid_api_key: true,
	restricted_api_key: true,
	invalid_from_address: true,
};

/**
 * Provider races that clear on their own without a configuration change.
 * They retry normally (the send attempt is charged).
 */
const RETRYABLE_PROVIDER_ERRORS: Record<string, true> = {
	concurrent_idempotent_requests: true,
};

/**
 * Provider error codes that a retry cannot fix: the request itself is
 * invalid. Checked before the generic 4xx bucket so, for example, an
 * idempotency-key conflict stays `failed` even though 409 races retry.
 * Everything else (auth, sender, quota, rate limit, server errors) is
 * retried so a configuration fix recovers queued mail, bounded by
 * `MAX_ATTEMPTS`.
 */
const TERMINAL_PROVIDER_ERRORS: Record<string, true> = {
	validation_error: true,
	invalid_parameter: true,
	missing_required_field: true,
	invalid_attachment: true,
	invalid_idempotency_key: true,
	invalid_idempotent_request: true,
	not_found: true,
	method_not_allowed: true,
	security_error: true,
	invalid_access: true,
};

const PRIORITY_LABELS: Record<string, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	critical: 'Critical',
};

export type TicketEmailEvent = {
	ticketId: number;
	departmentId: number;
	assignmentVersion: number;
	eventType: 'created' | 'reassigned';
	ticketNumber: string;
	subject: string;
	priority: string;
	submitterName: string;
};

export type TicketEmailOutboxSummary = {
	processed: number;
	sent: number;
	retried: number;
	cancelled: number;
	failed: number;
};

/** Raised when delivery cannot start because the environment is incomplete. */
export class TicketEmailConfigurationError extends Error {
	readonly code = 'TICKET_EMAIL_CONFIG';

	constructor(message: string) {
		super(message);
		this.name = 'TicketEmailConfigurationError';
	}
}

/** Raised when the caller asks to queue mail nobody could receive. */
export class TicketEmailEnqueueError extends Error {
	readonly code = 'TICKET_EMAIL_ENQUEUE';

	constructor(message: string) {
		super(message);
		this.name = 'TicketEmailEnqueueError';
	}
}

type TicketEmailConfig = {
	apiKey: string;
	from: string;
	origin: string;
};

type TicketEmailPayload = {
	ticketNumber: string;
	subject: string;
	priority: string;
	submitterName: string;
};

type OutboxJob = {
	id: number;
	lockToken: string;
	ticketId: number;
	departmentId: number;
	roleId: number;
	assignmentVersion: number;
	eventType: string;
	recipientUserId: number;
	recipientEmail: string;
	payload: unknown;
	attempts: number;
};

type RenderedTicketEmail = {
	subject: string;
	html: string;
	text: string;
};

type ProviderFailure =
	| {
			kind: 'transient';
			retryAfterSeconds?: number;
			rateLimited?: boolean;
			configError?: boolean;
			message: string;
	  }
	| { kind: 'terminal'; message: string };

type DeliverResult =
	| { outcome: 'sent' | 'cancelled' }
	| { outcome: 'failed'; haltBatch?: boolean }
	| {
			outcome: 'retried';
			rateLimited?: boolean;
			haltBatch?: boolean;
			retryAfterSeconds?: number;
	  };

type Revalidation = { ok: true } | { ok: false; reason: string };

/**
 * Queue one summary email per eligible recipient of the ticket department.
 *
 * Runs on the caller's connection so the tickets row and the outbox rows
 * commit or roll back together. `ON DUPLICATE KEY UPDATE id = id` keeps the
 * unique (ticket, assignment version, event, recipient) identity idempotent
 * without swallowing unrelated insert errors the way `INSERT IGNORE` would.
 */
export async function enqueueTicketEmails(
	connection: PoolConnection,
	event: TicketEmailEvent
): Promise<void> {
	const ticketId = requirePositiveInteger(event.ticketId, 'ticketId');
	const departmentId = requirePositiveInteger(
		event.departmentId,
		'departmentId'
	);
	const assignmentVersion = requirePositiveInteger(
		event.assignmentVersion,
		'assignmentVersion'
	);
	if (event.eventType !== 'created' && event.eventType !== 'reassigned') {
		throw new TicketEmailEnqueueError(
			`Unsupported ticket email event "${String(event.eventType)}". Expected "created" or "reassigned".`
		);
	}
	const ticketNumber = requireText(event.ticketNumber, 'ticketNumber');
	const subject = typeof event.subject === 'string' ? event.subject.trim() : '';
	const priority =
		typeof event.priority === 'string' ? event.priority.trim() : '';
	const submitterName =
		typeof event.submitterName === 'string' ? event.submitterName.trim() : '';

	const departments = await listTicketDepartments(connection, true);
	const department = departments.find((row) => row.id === departmentId);
	if (!department) {
		throw new TicketEmailEnqueueError(
			`Ticket department ${departmentId} does not exist or was removed, so no notification can be queued.`
		);
	}
	if (!department.is_active) {
		throw new TicketEmailEnqueueError(
			`Ticket department "${department.name}" is inactive, so no notification can be queued.`
		);
	}
	if (department.role_id === null) {
		throw new TicketEmailEnqueueError(
			`Ticket department "${department.name}" has no responsible role configured. A super-admin must assign one before tickets can be routed to it.`
		);
	}

	const recipients = await getDepartmentRecipients(connection, departmentId);
	if (recipients.length === 0) {
		throw new TicketEmailEnqueueError(
			`Ticket department "${department.name}" has no active role members with a usable email address, so nobody would be notified. Assign at least one active user to the responsible role with a valid email before routing tickets to this department.`
		);
	}

	const payload = JSON.stringify({
		ticketNumber,
		subject,
		priority,
		submitterName,
	} satisfies TicketEmailPayload);

	for (const recipient of recipients) {
		const recipientEmail = recipient.email.trim();
		await connection.execute(
			`INSERT INTO ticket_email_outbox (
				ticket_id, department_id, role_id, assignment_version, event_type,
				recipient_user_id, recipient_email, payload, status, attempts,
				next_attempt_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NOW())
			ON DUPLICATE KEY UPDATE id = id`,
			[
				ticketId,
				departmentId,
				department.role_id,
				assignmentVersion,
				event.eventType,
				recipient.user_id,
				recipientEmail,
				payload,
			]
		);
	}
}

/**
 * Deliver due ticket emails.
 *
 * Throws `TicketEmailConfigurationError` before touching the outbox when the API
 * key or trusted origin is missing, so pending jobs stay pending instead of
 * burning retries on a misconfigured deployment.
 */
export async function processTicketEmailOutbox(
	options: { limit?: number } = {}
): Promise<TicketEmailOutboxSummary> {
	const config = loadTicketEmailConfig();
	const limit = normalizeBatchLimit(options.limit);
	const deadline = Date.now() + PROCESSING_BUDGET_MS;

	await recoverExpiredLeases();
	const jobs = await claimBatch(limit);
	const summary: TicketEmailOutboxSummary = {
		processed: jobs.length,
		sent: 0,
		retried: 0,
		cancelled: 0,
		failed: 0,
	};
	if (jobs.length === 0) return summary;

	const resend = new Resend(config.apiKey);
	const sendGate = { lastStartedAt: 0 };
	const waitForSendSlot = async (): Promise<void> => {
		const wait = sendGate.lastStartedAt + MIN_SEND_INTERVAL_MS - Date.now();
		if (wait > 0) {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, wait);
			await promise;
		}
		sendGate.lastStartedAt = Date.now();
	};

	for (let index = 0; index < jobs.length; index += 1) {
		const job = jobs[index];

		// Never start a send that could outlive the invocation budget. Release
		// this job and the untouched tail with their claim attempts refunded so
		// the next cron tick picks them up without a stalled lease.
		if (deadline - Date.now() < RESEND_REQUEST_TIMEOUT_MS + SEND_SLACK_MS) {
			const heldBack = jobs.slice(index);
			await releaseLeasedJobs(
				heldBack,
				0,
				'Held back because this invocation reached its wall-clock budget. The job will retry on the next run.'
			);
			summary.retried += heldBack.length;
			break;
		}

		const result = await deliverJob(job, config, resend, waitForSendSlot);
		summary[result.outcome] += 1;

		if ('haltBatch' in result && result.haltBatch) {
			// Resend rate-limited the batch or rejected the deployment
			// configuration. Return the untouched tail to the queue without
			// spending its lease or attempts on calls that cannot succeed.
			const heldBack = jobs.slice(index + 1);
			if (heldBack.length > 0) {
				const holdbackDelaySeconds =
					result.outcome === 'retried' && result.rateLimited
						? (result.retryAfterSeconds ?? retryDelaySeconds(1))
						: 0;
				await releaseLeasedJobs(
					heldBack,
					holdbackDelaySeconds,
					'Held back because the previous send could not proceed (rate limit or configuration). The job will retry automatically.'
				);
				summary.retried += heldBack.length;
			}
			break;
		}
	}

	return summary;
}

function loadTicketEmailConfig(): TicketEmailConfig {
	const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
	const originRaw = (process.env.TICKET_APP_ORIGIN ?? '').trim();

	const missing: string[] = [];
	if (!apiKey) missing.push('RESEND_API_KEY');
	if (!originRaw) missing.push('TICKET_APP_ORIGIN');
	if (missing.length > 0) {
		throw new TicketEmailConfigurationError(
			`Ticket email delivery is not configured: ${missing.join(' and ')} ${
				missing.length === 1 ? 'is' : 'are'
			} required. Pending outbox jobs were left untouched. Set the missing environment variable(s) and run the worker again.`
		);
	}

	const origin = resolveAppOrigin(originRaw);
	const from = resolveFromAddress();
	return { apiKey, from, origin };
}

function resolveAppOrigin(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new TicketEmailConfigurationError(
			`TICKET_APP_ORIGIN "${raw}" is not a valid absolute URL. Example: https://crm.accent.net.in`
		);
	}
	if (url.username || url.password) {
		throw new TicketEmailConfigurationError(
			'TICKET_APP_ORIGIN must not embed credentials.'
		);
	}
	if (url.protocol === 'https:') return url.origin;
	if (url.protocol === 'http:' && isLocalHostname(url.hostname)) {
		return url.origin;
	}
	throw new TicketEmailConfigurationError(
		'TICKET_APP_ORIGIN must use https://. http:// is accepted only for localhost or 127.0.0.1 local verification.'
	);
}

function isLocalHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '::1' ||
		host === '[::1]'
	);
}

function resolveFromAddress(): string {
	const raw = (process.env.RESEND_FROM_EMAIL ?? '').trim();
	const from = raw || DEFAULT_FROM_ADDRESS;
	if (/[\r\n]/.test(from)) {
		throw new TicketEmailConfigurationError(
			'RESEND_FROM_EMAIL must be a single line.'
		);
	}
	const bracketed = /<([^<>]+)>\s*$/.exec(from);
	const address = (bracketed ? bracketed[1] : from).trim();
	if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
		throw new TicketEmailConfigurationError(
			`RESEND_FROM_EMAIL "${from}" is not a valid sender. Use "Name <address@domain>" with a verified Resend domain.`
		);
	}
	return from;
}

function normalizeBatchLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_BATCH_LIMIT;
	}
	return Math.min(MAX_BATCH_LIMIT, Math.max(1, Math.floor(value)));
}

async function recoverExpiredLeases(): Promise<void> {
	await withConnection(async (connection) => {
		await connection.execute(
			`UPDATE ticket_email_outbox
			 SET status = 'pending',
			     next_attempt_at = NOW(),
			     locked_until = NULL,
			     lock_token = NULL,
			     last_error = ?
			 WHERE status = 'processing'
			   AND isDelete = 0
			   AND (locked_until IS NULL OR locked_until < NOW())`,
			[
				'Delivery lease expired before the send completed; the job was re-queued.',
			]
		);
	});
}

/**
 * Claim up to `limit` due jobs inside a short transaction. The lease token is
 * per row so completion writes can prove ownership. `SKIP LOCKED` keeps
 * overlapping workers from waiting on the same rows.
 */
async function claimBatch(limit: number): Promise<OutboxJob[]> {
	const connection = (await dbConnect()) as PoolConnection;
	let committed = false;
	try {
		await connection.beginTransaction();
		const [dueRows] = await connection.execute<RowDataPacket[]>(
			`SELECT id
			 FROM ticket_email_outbox
			 WHERE status = 'pending'
			   AND isDelete = 0
			   AND next_attempt_at <= NOW()
			 ORDER BY next_attempt_at ASC, id ASC
			 LIMIT ?
			 FOR UPDATE SKIP LOCKED`,
			[limit]
		);

		const tokens = new Map<number, string>();
		for (const row of dueRows) {
			const id = Number(row.id);
			if (!Number.isInteger(id) || id <= 0) continue;
			const token = randomBytes(24).toString('hex');
			const [result] = await connection.execute<ResultSetHeader>(
				`UPDATE ticket_email_outbox
				 SET status = 'processing',
				     lock_token = ?,
				     locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
				     attempts = attempts + 1
				 WHERE id = ?
				   AND status = 'pending'
				   AND isDelete = 0`,
				[token, LEASE_SECONDS, id]
			);
			if (result.affectedRows === 1) tokens.set(id, token);
		}

		await connection.commit();
		committed = true;

		if (tokens.size === 0) return [];

		const ids = [...tokens.keys()];
		const placeholders = ids.map(() => '?').join(', ');
		const [jobRows] = await connection.query<RowDataPacket[]>(
			`SELECT id, ticket_id, department_id, role_id, assignment_version,
			        event_type, recipient_user_id, recipient_email, payload,
			        attempts, lock_token
			 FROM ticket_email_outbox
			 WHERE status = 'processing'
			   AND isDelete = 0
			   AND id IN (${placeholders})`,
			ids
		);

		const jobs: OutboxJob[] = [];
		for (const row of jobRows) {
			const id = Number(row.id);
			const token = tokens.get(id);
			if (!token) continue;
			jobs.push({
				id,
				lockToken: token,
				ticketId: Number(row.ticket_id),
				departmentId: Number(row.department_id),
				roleId: Number(row.role_id),
				assignmentVersion: Number(row.assignment_version),
				eventType: String(row.event_type),
				recipientUserId: Number(row.recipient_user_id),
				recipientEmail: String(row.recipient_email ?? ''),
				payload: row.payload,
				attempts: Number(row.attempts),
			});
		}
		return jobs;
	} catch (error) {
		if (!committed) {
			try {
				await connection.rollback();
			} catch {
				// Preserve the original failure.
			}
		}
		throw error;
	} finally {
		connection.release();
	}
}

async function deliverJob(
	job: OutboxJob,
	config: TicketEmailConfig,
	resend: Resend,
	waitForSendSlot: () => Promise<void>
): Promise<DeliverResult> {
	if (job.eventType !== 'created' && job.eventType !== 'reassigned') {
		await failJob(
			job,
			`Unknown event_type "${job.eventType}"; the job cannot be rendered.`
		);
		return { outcome: 'failed' };
	}

	const payload = parsePayload(job.payload);
	if (!payload) {
		await failJob(
			job,
			'Stored payload is missing or malformed; the job cannot be rendered.'
		);
		return { outcome: 'failed' };
	}

	const revalidation = await revalidateJob(job);
	if (!revalidation.ok) {
		await cancelJob(job, revalidation.reason);
		return { outcome: 'cancelled' };
	}

	const rendered = renderTicketEmail(
		job.eventType,
		payload,
		job.ticketId,
		config.origin
	);
	const idempotencyKey = `accent-ticket-${job.ticketId}-v${job.assignmentVersion}-${job.eventType}-${job.recipientUserId}`;

	await waitForSendSlot();

	let response: CreateEmailResponse;
	try {
		response = await sendWithTimeout(
			resend,
			config.from,
			job.recipientEmail,
			rendered,
			idempotencyKey
		);
	} catch (error) {
		const scheduled = await scheduleRetry(
			job,
			retryDelaySeconds(job.attempts),
			`Network error while calling Resend: ${describeError(error)}`
		);
		if (scheduled === null) return { outcome: 'cancelled' };
		return scheduled === 'failed'
			? { outcome: 'failed' }
			: { outcome: 'retried' };
	}

	if (response.error) {
		const failure = classifyProviderError(response.error, response.headers);
		if (failure.kind === 'terminal') {
			await failJob(job, failure.message);
			return { outcome: 'failed' };
		}
		if (failure.configError) {
			// No message went out: refund the attempt and stop the batch so the
			// same bad key or sender is not replayed against every remaining
			// job. Fixing the configuration lets the pending rows resume.
			await releaseLeasedJobs([job], 0, failure.message);
			return { outcome: 'retried', haltBatch: true };
		}
		const scheduled = await scheduleRetry(
			job,
			failure.retryAfterSeconds ?? retryDelaySeconds(job.attempts),
			failure.message
		);
		if (scheduled === null) return { outcome: 'cancelled' };
		if (scheduled === 'failed') {
			return {
				outcome: 'failed',
				haltBatch: failure.rateLimited === true,
			};
		}
		return {
			outcome: 'retried',
			rateLimited: failure.rateLimited === true,
			haltBatch: failure.rateLimited === true,
			retryAfterSeconds: failure.retryAfterSeconds,
		};
	}

	const messageId = response.data?.id;
	if (!messageId) {
		// The provider accepted the request but returned no id: do not claim
		// success we cannot prove.
		const scheduled = await scheduleRetry(
			job,
			retryDelaySeconds(job.attempts),
			'Resend returned no message id for an accepted request; delivery could not be confirmed.'
		);
		if (scheduled === null) return { outcome: 'cancelled' };
		return scheduled === 'failed'
			? { outcome: 'failed' }
			: { outcome: 'retried' };
	}

	const completed = await completeJob(job, messageId);
	return completed ? { outcome: 'sent' } : { outcome: 'cancelled' };
}

async function sendWithTimeout(
	resend: Resend,
	from: string,
	to: string,
	rendered: RenderedTicketEmail,
	idempotencyKey: string
): Promise<CreateEmailResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), RESEND_REQUEST_TIMEOUT_MS);
	try {
		return await resend.emails.send(
			{
				from,
				to,
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
			},
			{ idempotencyKey, signal: controller.signal }
		);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Live-state check immediately before the network call. Any drift cancels the
 * job instead of sending an obsolete summary.
 */
async function revalidateJob(job: OutboxJob): Promise<Revalidation> {
	return withConnection<Revalidation>(
		async (connection): Promise<Revalidation> => {
			const [ticketRows] = await connection.execute<RowDataPacket[]>(
				`SELECT id, ticket_department_id, assignment_version, isDelete
			 FROM support_tickets
			 WHERE id = ?
			 LIMIT 1`,
				[job.ticketId]
			);
			const ticket = ticketRows[0];
			if (!ticket || Number(ticket.isDelete) !== 0) {
				return {
					ok: false,
					reason: 'The ticket was deleted before the notification was sent.',
				};
			}
			if (
				ticket.ticket_department_id === null ||
				Number(ticket.ticket_department_id) !== job.departmentId
			) {
				return {
					ok: false,
					reason:
						'The ticket now belongs to a different department; this notification is obsolete.',
				};
			}
			if (Number(ticket.assignment_version) !== job.assignmentVersion) {
				return {
					ok: false,
					reason: `The ticket assignment moved to version ${Number(ticket.assignment_version)}; this notification is obsolete.`,
				};
			}

			const [departmentRows] = await connection.execute<RowDataPacket[]>(
				`SELECT id, role_id, is_active, isDelete
			 FROM ticket_departments
			 WHERE id = ?
			 LIMIT 1`,
				[job.departmentId]
			);
			const department = departmentRows[0];
			if (!department || Number(department.isDelete) !== 0) {
				return {
					ok: false,
					reason:
						'The ticket department was removed before the notification was sent.',
				};
			}
			if (Number(department.is_active) !== 1) {
				return {
					ok: false,
					reason:
						'The ticket department is inactive; its notifications are cancelled.',
				};
			}
			if (
				department.role_id === null ||
				Number(department.role_id) !== job.roleId
			) {
				return {
					ok: false,
					reason:
						'The department responsible role changed; this notification is obsolete.',
				};
			}

			const recipients = await getDepartmentRecipients(
				connection,
				job.departmentId
			);
			const recipient = recipients.find(
				(row) => row.user_id === job.recipientUserId
			);
			if (!recipient) {
				return {
					ok: false,
					reason:
						'The recipient is no longer an active member of the responsible role.',
				};
			}
			if (
				normalizeEmail(recipient.email) !== normalizeEmail(job.recipientEmail)
			) {
				return {
					ok: false,
					reason:
						'The recipient email address changed after the notification was queued.',
				};
			}

			return { ok: true };
		}
	);
}

async function completeJob(
	job: OutboxJob,
	messageId: string
): Promise<boolean> {
	return withConnection(async (connection) => {
		const [result] = await connection.execute<ResultSetHeader>(
			`UPDATE ticket_email_outbox
			 SET status = 'sent',
			     provider_message_id = ?,
			     sent_at = NOW(),
			     last_error = NULL,
			     locked_until = NULL,
			     lock_token = NULL
			 WHERE id = ?
			   AND status = 'processing'
			   AND lock_token = ?
			   AND isDelete = 0`,
			[messageId, job.id, job.lockToken]
		);
		return result.affectedRows === 1;
	});
}

async function scheduleRetry(
	job: OutboxJob,
	delaySeconds: number,
	message: string
): Promise<'pending' | 'failed' | null> {
	const status = job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
	return withConnection(async (connection) => {
		const [result] = await connection.execute<ResultSetHeader>(
			`UPDATE ticket_email_outbox
			 SET status = ?,
			     next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
			     last_error = ?,
			     locked_until = NULL,
			     lock_token = NULL
			 WHERE id = ?
			   AND status = 'processing'
			   AND lock_token = ?
			   AND isDelete = 0`,
			[status, delaySeconds, truncateError(message), job.id, job.lockToken]
		);
		if (result.affectedRows !== 1) return null;
		return status as 'pending' | 'failed';
	});
}

async function failJob(job: OutboxJob, message: string): Promise<void> {
	await withConnection(async (connection) => {
		await connection.execute(
			`UPDATE ticket_email_outbox
			 SET status = 'failed',
			     last_error = ?,
			     locked_until = NULL,
			     lock_token = NULL
			 WHERE id = ?
			   AND status = 'processing'
			   AND lock_token = ?
			   AND isDelete = 0`,
			[truncateError(message), job.id, job.lockToken]
		);
	});
}

async function cancelJob(job: OutboxJob, reason: string): Promise<void> {
	await withConnection(async (connection) => {
		await connection.execute(
			`UPDATE ticket_email_outbox
			 SET status = 'cancelled',
			     last_error = ?,
			     locked_until = NULL,
			     lock_token = NULL
			 WHERE id = ?
			   AND status = 'processing'
			   AND lock_token = ?
			   AND isDelete = 0`,
			[truncateError(reason), job.id, job.lockToken]
		);
	});
}

async function releaseLeasedJobs(
	jobs: OutboxJob[],
	delaySeconds: number,
	reason: string
): Promise<void> {
	await withConnection(async (connection) => {
		for (const job of jobs) {
			await connection.execute(
				`UPDATE ticket_email_outbox
				 SET status = 'pending',
				     next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
				     attempts = GREATEST(attempts, 1) - 1,
				     locked_until = NULL,
				     lock_token = NULL,
				     last_error = ?
				 WHERE id = ?
				   AND status = 'processing'
				   AND lock_token = ?
				   AND isDelete = 0`,
				[delaySeconds, truncateError(reason), job.id, job.lockToken]
			);
		}
	});
}

async function withConnection<T>(
	callback: (connection: PoolConnection) => Promise<T>
): Promise<T> {
	const connection = (await dbConnect()) as PoolConnection;
	try {
		return await callback(connection);
	} finally {
		connection.release();
	}
}

function classifyProviderError(
	error: { message: string; name: string; statusCode: number | null },
	headers: Record<string, string> | null
): ProviderFailure {
	const message = `Resend ${error.statusCode ?? 'unknown'} ${error.name}: ${error.message}`;
	const status = error.statusCode ?? 0;

	if (error.name === 'rate_limit_exceeded' || status === 429) {
		return {
			kind: 'transient',
			rateLimited: true,
			retryAfterSeconds: parseRetryAfter(headers),
			message,
		};
	}
	// A 401/403 is an auth or sender configuration failure even when Resend
	// names it `validation_error` (unverified domain) or another generic code.
	// Check it before the terminal map so fixing the key or verified sender
	// recovers the pending mail instead of failing the batch permanently.
	if (status === 401 || status === 403) {
		return { kind: 'transient', configError: true, message };
	}
	// Explicit provider codes decide the remaining 4xx cases: a concurrent 409
	// idempotency race must not become terminal, and an idempotency-key
	// conflict must stay terminal despite 409.
	if (CONFIGURATION_PROVIDER_ERRORS[error.name] === true) {
		return { kind: 'transient', configError: true, message };
	}
	if (RETRYABLE_PROVIDER_ERRORS[error.name] === true) {
		return { kind: 'transient', message };
	}
	if (TERMINAL_PROVIDER_ERRORS[error.name] === true) {
		return { kind: 'terminal', message };
	}
	if (status === 409) {
		return { kind: 'transient', message };
	}
	if (status >= 400 && status < 500 && status !== 408) {
		return { kind: 'terminal', message };
	}
	return { kind: 'transient', message };
}

function parseRetryAfter(
	headers: Record<string, string> | null
): number | undefined {
	if (!headers) return undefined;
	const raw = headers['retry-after'] ?? headers['Retry-After'];
	if (!raw) return undefined;

	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(Math.ceil(seconds), MAX_RETRY_SECONDS);
	}

	const date = Date.parse(raw);
	if (!Number.isNaN(date)) {
		const delta = Math.ceil((date - Date.now()) / 1000);
		if (delta > 0) return Math.min(delta, MAX_RETRY_SECONDS);
	}
	return undefined;
}

function retryDelaySeconds(attempts: number): number {
	const exponent = Math.max(0, attempts - 1);
	const base = Math.min(MAX_RETRY_SECONDS, BASE_RETRY_SECONDS * 2 ** exponent);
	const jitter = Math.floor(Math.random() * Math.min(30, base));
	return Math.min(MAX_RETRY_SECONDS, base + jitter);
}

function parsePayload(raw: unknown): TicketEmailPayload | null {
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object') return null;

	const record = value as Record<string, unknown>;
	const ticketNumber =
		typeof record.ticketNumber === 'string' ? oneLine(record.ticketNumber) : '';
	if (!ticketNumber) return null;

	return {
		ticketNumber,
		subject: typeof record.subject === 'string' ? record.subject.trim() : '',
		priority: typeof record.priority === 'string' ? record.priority.trim() : '',
		submitterName:
			typeof record.submitterName === 'string'
				? record.submitterName.trim()
				: '',
	};
}

function renderTicketEmail(
	eventType: 'created' | 'reassigned',
	payload: TicketEmailPayload,
	ticketId: number,
	origin: string
): RenderedTicketEmail {
	const link = `${origin}/tickets/${ticketId}`;
	const eventLabel =
		eventType === 'created'
			? 'New support ticket'
			: 'Support ticket reassigned';
	const title = oneLine(payload.subject) || '(no subject)';
	const priority = priorityLabel(payload.priority);
	const submitter = oneLine(payload.submitterName) || 'Unknown';

	const subject = truncateLine(
		`${eventLabel} ${payload.ticketNumber}: ${title}`,
		MAX_SUBJECT_LINE_LENGTH
	);

	const rows: Array<[string, string]> = [
		['Ticket', payload.ticketNumber],
		['Subject', title],
		['Priority', priority],
		['Submitted by', submitter],
	];
	const htmlRows = rows
		.map(
			([label, value]) =>
				`<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(
					label
				)}</td><td style="padding:8px 0 8px 16px;font-size:14px;color:#111827;">${escapeHtml(
					value
				)}</td></tr>`
		)
		.join('');

	const html = `<!doctype html>
<html>
	<body style="margin:0;padding:24px;background:#f5f3f7;font-family:Arial,Helvetica,sans-serif;color:#111827;">
		<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
			<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64126D;">${escapeHtml(
				eventLabel
			)}</p>
			<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;">${escapeHtml(
				payload.ticketNumber
			)}</h1>
			<table role="presentation" style="width:100%;border-collapse:collapse;">${htmlRows}</table>
			<p style="margin:24px 0 0;">
				<a href="${escapeHtml(
					link
				)}" style="display:inline-block;background:#64126D;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Open ticket</a>
			</p>
			<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">You receive this email because you are an active member of the role responsible for this ticket&#39;s department. This is a summary only; open the ticket to read the full conversation.</p>
		</div>
	</body>
</html>`;

	const text = [
		eventLabel,
		'',
		`Ticket: ${payload.ticketNumber}`,
		`Subject: ${title}`,
		`Priority: ${priority}`,
		`Submitted by: ${submitter}`,
		'',
		`Open the ticket: ${link}`,
		'',
		"You receive this email because you are an active member of the role responsible for this ticket's department. This is a summary only; open the ticket to read the full conversation.",
	].join('\n');

	return { subject, html, text };
}

function priorityLabel(value: string): string {
	const key = value.trim().toLowerCase();
	return PRIORITY_LABELS[key] ?? (oneLine(value) || 'Not set');
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function truncateLine(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function truncateError(message: string): string {
	const clean = oneLine(message);
	return clean.length > MAX_ERROR_LENGTH
		? `${clean.slice(0, MAX_ERROR_LENGTH - 3)}...`
		: clean;
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function requirePositiveInteger(value: number, field: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new TicketEmailEnqueueError(
			`${field} must be a positive integer; received ${String(value)}.`
		);
	}
	return value;
}

function requireText(value: string, field: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) {
		throw new TicketEmailEnqueueError(
			`${field} is required to queue a ticket email.`
		);
	}
	return text;
}
