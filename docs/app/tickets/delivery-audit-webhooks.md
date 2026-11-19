# Ticket email delivery webhooks and audit trail

> Plan note, 2026-11-17. **Not implemented.** This records the agreed design for
> confirming that ticket alerts actually reach recipients, and for keeping a
> durable audit trail in Accent.
>
> Context: [Resend ticket email setup](resend-setup.md) covers domain
> verification, the outbox worker, and the cron.

## Why

The outbox proves that the provider **accepted** a message. It cannot prove the
mailbox **received** it. For auditing that tickets reached the responsible
people, "accepted" is the weakest link in the chain.

Delivery confirmation comes from Resend webhooks, which report per-message
events back to endpoints we control. The trail then lives in Accent's database
rather than in a provider dashboard whose retention we do not control.

## What exists today

Every alert is one `ticket_email_outbox` row, written in the same transaction
as the ticket change:

| Column                                  | Audit meaning                                          |
| --------------------------------------- | ------------------------------------------------------ |
| `ticket_id`, `department_id`, `role_id` | the team responsible at send time                      |
| `assignment_version`                    | which reassignment the alert belongs to                |
| `event_type`                            | `created` or `reassigned`                              |
| `recipient_user_id`, `recipient_email`  | exactly who was notified                               |
| `payload`                               | snapshot of number, subject, priority, submitter       |
| `status`                                | `pending`, `processing`, `sent`, `cancelled`, `failed` |
| `attempts`, `last_error`                | retry history and the last failure reason              |
| `provider_message_id`                   | Resend's message id                                    |
| `created_at`, `sent_at`                 | queued and accepted timestamps                         |

Strengths: recipient-level rows, stable ids, cancellation on reassignment,
and a payload snapshot that does not drift when the ticket is edited.

Gaps: `sent` means accepted only; status rows are updated in place, so
intermediate transitions are lost; `provider_message_id` has no index.

## Events to subscribe

| Event                    | Use                                                        |
| ------------------------ | ---------------------------------------------------------- |
| `email.delivered`        | proves the receiving server accepted the message           |
| `email.bounced`          | permanent or transient rejection; surfaces dead recipients |
| `email.complained`       | marked as spam; a signal to stop notifying that mailbox    |
| `email.failed`           | provider-side failure after acceptance                     |
| `email.delivery_delayed` | optional; useful when a mailbox is slow to accept          |

Do not subscribe to `email.opened` or `email.clicked`. They measure recipient
behaviour, not delivery, and internal staff often block tracking pixels.

## Endpoint contract

`POST /api/webhooks/resend`

| Concern         | Rule                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Authentication  | signature only. No session cookie; the request is machine traffic                                 |
| Raw body        | read with `request.text()` before any JSON parsing; verification needs the exact bytes            |
| Signature       | the SDK verifier, using `svix-id`, `svix-timestamp`, `svix-signature`, and the `whsec_...` secret |
| Replay window   | reject timestamps outside the verifier's tolerance                                                |
| Idempotency     | key on the event id; a repeat delivery updates nothing and returns `200`                          |
| Unknown message | an `email_id` with no matching outbox row is accepted and logged, never an error                  |
| Response        | `200` once persisted; `401` on a bad signature; `5xx` only when retrying is useful                |

This route joins two existing guards:

- The exact unauthenticated allowlist in `src/proxy.ts` and ADR-0014, because
  the caller cannot hold a session.
- The CI route-auth allowlist, with the signature check named as the reason.

Both must change together, as ADR-0014 requires.

## Data changes

1. **Index** `ticket_email_outbox.provider_message_id`. Events arrive keyed by
   that value, so lookup must not scan.
2. **Append-only events** table, `ticket_email_event`:

| Column              | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `id`                | primary key                                               |
| `outbox_id`         | the notification this event belongs to                    |
| `provider_event_id` | unique; makes replays idempotent                          |
| `event_type`        | `delivered`, `bounced`, `complained`, `failed`, `delayed` |
| `occurred_at`       | provider timestamp                                        |
| `received_at`       | our timestamp                                             |
| `payload`           | the provider body, kept for evidence                      |

3. **Status projection** on the outbox row: a delivery state separate from the
   send state, so `sent` keeps its meaning and confirmation is an addition.

The event table is never updated or deleted. Corrections are new rows. That is
what makes it usable as evidence.

## Admin visibility

Minimum: a read-only panel listing recent notifications with ticket number,
department, recipient, send state, delivery state, and the last event time.
Plus counts of `bounced` and `complained` for the current month.

Internal notes and recipient addresses stay super-admin-only, matching the
existing ticket access rules.

## Prerequisites

- A public HTTPS endpoint. Production is the Vercel deployment. Local testing
  needs a tunnel, because Resend cannot reach `127.0.0.1`.
- A webhook signing secret (`whsec_...`), stored as a server-only environment
  variable beside `RESEND_API_KEY`, never prefixed `NEXT_PUBLIC_`.
- The webhook created in the Resend dashboard or by CLI, pointed at
  `/api/webhooks/resend`, with only the events above selected.

## Sequence

1. Add the event table, the index, and the delivery-state projection.
2. Add the route with verification and idempotent persistence.
3. Register the route in the proxy allowlist and the CI allowlist, and record
   the reason in ADR-0014.
4. Create the webhook in Resend and set the secret.
5. Send one real alert, then confirm: `sent` → `delivered`, one event row.
6. Replay the same event; confirm no duplicate row and a `200`.
7. Add the admin view.

## Acceptance checks

- A delivered message changes the delivery state and appends exactly one event.
- The same event replayed twice still leaves one event row.
- A tampered signature returns `401` and writes nothing.
- An event for an unknown `email_id` is harmless.
- A bounce is visible to a super-admin without reading provider logs.
- No webhook path can be used to trigger a send.

## Non-goals

- Inbound mail. Receiving stays disabled; replies are not imported.
- Webhook-driven sending. The cron worker remains the only sender.
- Open and click tracking.
- Replacing the outbox. Webhooks annotate it; they do not replace it.

## Open decisions

- Whether to surface `complained` as an automatic suppression, or leave the
  recipient in place and show a warning.
- Retention for `ticket_email_event`. Audit expectations favour long retention;
  storage cost is negligible at ticket volume.
- Whether bounces should block future sends to that address automatically.
