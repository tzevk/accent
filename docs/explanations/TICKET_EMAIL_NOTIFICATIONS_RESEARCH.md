# Ticket Email Notifications Research

Research note (2026-10-28). Research only; no application code changed.
Question: can Accent CRM email admins and responsible persons after ticket submission?
Focus: Gmail app passwords, limits, OAuth, one transactional provider, and safe delivery design.
Repository observations below come from source inspection.
The app and database were not run; no runtime behavior was verified.
No email was sent and no credentials were created.

## TL;DR

- Viable: yes for low-volume ticket alerts.
- Gmail app password fits a small pilot only.
- A transactional provider is another option; durable delivery also needs application-side retry handling.
- Gmail limits, revocation, and blocks make it fragile.
- Fix recipient access before adding links to emails.
- Commit ticket first; send only after commit.
- Use a queue or outbox for retries and proof.

For broader provider pricing, see the [email provider comparison](TICKET_EMAIL_PROVIDER_COMPARISON_RESEARCH.md).

## Vocabulary (do not conflate)

| Term                   | Means                                 | Why it matters                      |
| ---------------------- | ------------------------------------- | ----------------------------------- |
| Personal Gmail         | @gmail.com or @googlemail.com account | Lowest Gmail sending limits         |
| Google Workspace       | Paid org mail on own domain           | Higher limits plus admin controls   |
| App password           | 16-digit account passcode             | Needs 2-Step Verification           |
| OAuth 2.0              | Token access without passwords        | Recommended Google app path         |
| Transactional provider | API or SMTP service for app mail      | Keys, logs, retries, domain control |
| Outbox or queue        | Durable send jobs in storage          | Survives restarts and timeouts      |
| after or waitUntil     | Post-response background hooks        | Best effort with timeout bounds     |

Personal Gmail means @gmail.com or @googlemail.com accounts.
Source: <https://support.google.com/mail/answer/81126?hl=en>
Details and sources for each row appear below.

## Accent current-state observations (source review only)

Repository paths below identify the inspected source.
No database was examined; no live-data claim is made.

- Ticket form submits subject, description, priority, and attachment_url to POST /api/tickets ([src/app/tickets/new/page.jsx#L43-L60](../../src/app/tickets/new/page.jsx#L43-L60)).
- Tickets API authenticates, inserts support_tickets, selects the ticket, then returns success. Insert covers ticket_number, user_id, title, description, category, and priority. That POST path has no send integration ([src/app/api/tickets/route.js#L110-L168](../../src/app/api/tickets/route.js#L110-L168)).
- Only PUT accepts assigned_to, and only is_super_admin can assign ([src/app/api/tickets/route.js#L183-L241](../../src/app/api/tickets/route.js#L183-L241)).
- GET exposes all tickets only to is_super_admin. Regular admins and responsible users gain no automatic access. Creation assigns no recipient ([src/app/api/tickets/route.js#L63-L68](../../src/app/api/tickets/route.js#L63-L68)).
- Detail GET permits only ticket owner or is_super_admin. Assigned_to alone grants no read access ([src/app/api/tickets/[id]/route.js#L65-L73](../../src/app/api/tickets/%5Bid%5D/route.js#L65-L73)).
- Package list has no Nodemailer, Resend, or other mail SDK ([package.json#L42-L89](../../package.json#L42-L89)).
- Mail-name search found only permission UI fields, not send code.
- Ticket notes confirm no automatic category routing today ([docs/explanations/TICKET_SYSTEM.md#L75-L105](TICKET_SYSTEM.md#L75-L105)).
- Local Next docs support after() in route handlers ([node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L6-L8](../../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L6-L8)). It stays bound by route maximum duration. It can run even after failures ([node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L48-L54](../../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L48-L54)).
- Non-NEXT*PUBLIC* values stay server-only. NEXT*PUBLIC* values inline into client JavaScript ([node_modules/next/dist/docs/01-app/02-guides/environment-variables.md#L154-L166](../../node_modules/next/dist/docs/01-app/02-guides/environment-variables.md#L154-L166)).

## Gmail app passwords and 2-Step Verification

Google does not recommend app passwords in most cases.
Source: <https://support.google.com/accounts/answer/185833?hl=en>

- It prefers "Sign in with Google" over app passwords.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- An app password is a 16-digit passcode for account access.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- It works only with 2-Step Verification turned on.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- Account password change revokes all app passwords.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- User must then create a new app password.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- Each app password shows only once; lost values need regeneration.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- Owners can revoke one app password from the app-passwords list.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- Creation may be hidden for security-key-only 2SV accounts.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- Creation may be hidden for work, school, or org accounts.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- Creation may be hidden for Advanced Protection accounts.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>

## Gmail SMTP settings and sender rules

Workspace app guide publishes the Gmail SMTP settings below.
Source: <https://support.google.com/a/answer/176600?hl=en>

- Host is smtp.gmail.com for app sending.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Port 465 is for SSL and port 587 is for TLS.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Port 25 also appears as a configuration option.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Setup signs in with full Workspace email plus app password.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Device reuses those credentials on every send attempt.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- SSL or TLS can send inside or outside the organization.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Suspicious SMTP mail may face filtering or rejection.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- SMTP sent mail is copied to Gmail Sent automatically.
  Source: <https://support.google.com/mail/answer/78892?hl=en>
- Less-secure username-plus-password access ended for Workspace accounts.
  Source: <https://support.google.com/accounts/answer/6010255?hl=en>
- Gmail blocks third-party apps that demand Google username and password.
  Source: <https://support.google.com/mail/answer/7126229?hl=en>
- Personal Gmail keeps IMAP always on with no toggle.
  Source: <https://support.google.com/mail/answer/7126229?hl=en>
- Relay option uses smtp-relay.gmail.com on ports 25, 465, or 587.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Relay is the recommended path for Workspace devices and apps.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Restricted option uses aspmx.l.google.com port 25 for Google recipients only.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Restricted option needs IP allowlist and SPF, but no auth.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Senders to personal Gmail accounts must use TLS and authenticate with SPF or DKIM.
  Source: <https://support.google.com/mail/answer/81126?hl=en>
- Messages must follow RFC 5322 format.
  Source: <https://support.google.com/mail/answer/81126?hl=en>
- Senders must not impersonate Gmail From headers.
  Source: <https://support.google.com/mail/answer/81126?hl=en>

## Sending limits and account restrictions

Read personal and Workspace limits separately.

**Personal Gmail**

- Personal Gmail allows up to 500 emails per day.
  Source: <https://support.google.com/mail/answer/22839?hl=en>
- One message allows up to 500 total recipients.
  Source: <https://support.google.com/mail/answer/22839?hl=en>
- Sending resumes within 1 to 24 hours after limit error.
  Source: <https://support.google.com/mail/answer/22839?hl=en>
- Heavy bounces can block sending until after 24 hours.
  Source: <https://support.google.com/mail/answer/22839?hl=en>

**Google Workspace**

- Paid Workspace allows 2,000 messages per user per day.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Mail merge allows 1,500 messages per day.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Trial accounts allow 500 messages per day.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- SMTP senders allow 100 recipients per message.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Gmail API senders allow 500 recipients per message.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- One message allows 2,000 total recipients, at most 500 external.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Daily totals allow 10,000 recipients and 3,000 external recipients.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Unique recipients allow 3,000 per day, 2,000 external.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Trial unique external recipients allow 500 per day.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Limits run over rolling 24 hours, not calendar days.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Google says limits can change without notice.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Over-limit users cannot send for up to 24 hours.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Suspended accounts may need admin restore.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Spam senders may face permanent sending restriction.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- SMTP relay allows 10,000 recipients per day per user.
  Source: <https://support.google.com/a/answer/176600?hl=en>
- Higher paid limits may need $100 paid plus up to 75 days.
  Source: <https://support.google.com/a/answer/166852?hl=en>
- Bulk senders above 5,000 Gmail messages per day must add SPF, DKIM, and DMARC.
  Source: <https://support.google.com/mail/answer/81126?hl=en>

**Operational risks**

- Password change stops app-password sending until replacement.
  Source: <https://support.google.com/accounts/answer/185833?hl=en>
- One limit block pauses all mail from that account.
  Sources: <https://support.google.com/mail/answer/22839?hl=en>, <https://support.google.com/a/answer/166852?hl=en>
- Tying alerts to one human inbox creates a single point of failure [INFERENCE].
- Tying Workspace sending to one user consumes that user quota [INFERENCE].
  Source: <https://support.google.com/a/answer/166852?hl=en>

## Nodemailer Gmail guidance (library docs only)

Use these points only for Nodemailer guidance, not exact quotas.
Google-owned docs above remain the quota source of truth.

- Nodemailer recommends OAuth 2.0 for all new integrations.
  Source: <https://nodemailer.com/usage/using-gmail/>
- It calls app passwords simpler for small internal tools.
  Source: <https://nodemailer.com/usage/using-gmail/>
- App password path needs 2-Step Verification enabled.
  Source: <https://nodemailer.com/usage/using-gmail/>
- Gmail suits quick tests, not production workloads.
  Source: <https://nodemailer.com/usage/using-gmail/>
- Gmail targets individual users, not automated services.
  Source: <https://nodemailer.com/usage/using-gmail/>
- Google may block server logins that look like hijacking.
  Source: <https://nodemailer.com/usage/using-gmail/>
- Gmail overwrites sender with the authenticated account address.
  Source: <https://nodemailer.com/usage/using-gmail/>
- Different sender needs an alias or Workspace Send As setup.
  Source: <https://nodemailer.com/usage/using-gmail/>
- Its quota summary is oversimplified, so this report ignores it.
  Source: <https://nodemailer.com/usage/using-gmail/>

## OAuth alternative through Gmail API

Server flow uses tokens rather than user passwords.
Source: <https://developers.google.com/workspace/gmail/api/auth/web-server>

- Gmail API requests must use OAuth 2.0 credentials.
  Source: <https://developers.google.com/workspace/gmail/api/auth/web-server>
- Server flow exchanges a one-time code for access and refresh tokens.
  Source: <https://developers.google.com/workspace/gmail/api/auth/web-server>
- Apps store refresh tokens on the server, usually in a database.
  Source: <https://developers.google.com/workspace/gmail/api/auth/web-server>
- Offline access lets the app act while the user is away.
  Source: <https://developers.google.com/workspace/gmail/api/auth/web-server>
- Scope gmail.send means "Send email on your behalf."
  Source: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Google classes gmail.send as sensitive.
  Source: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Sensitive scopes can require verification; Google documents exceptions.
  Source: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Google advises the narrowest scope that meets the need.
  Source: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Sending uses messages.send or drafts.send.
  Source: <https://developers.google.com/workspace/gmail/api/guides/sending>
- Message body must be base64URL MIME under RFC 2822.
  Source: <https://developers.google.com/workspace/gmail/api/guides/sending>
- API cap stays 500 recipients per message, noted above.
  Source: <https://support.google.com/a/answer/166852?hl=en>

## Resend for production delivery

Consider Resend as the production example below.

**Domain setup**

- Production sending needs a verified owned domain; a testing sender is available.
  Source: <https://resend.com/docs/add-a-domain>
- Dashboard, API, CLI, or MCP server can add domains.
  Source: <https://resend.com/docs/add-a-domain>
- Resend strongly recommends a subdomain for sending.
  Source: <https://resend.com/docs/add-a-domain>
- Each subdomain needs separate configuration and verification.
  Source: <https://resend.com/docs/add-a-domain>
- DNS needs exact DKIM and SPF TXT, MX, or CNAME values.
  Source: <https://resend.com/docs/add-a-domain>
- Verification often takes 15 minutes, sometimes up to 72 hours.
  Source: <https://resend.com/docs/add-a-domain>
- DMARC should follow after successful verification.
  Source: <https://resend.com/docs/add-a-domain>
- CNAME records must not use proxying such as Cloudflare orange cloud.
  Source: <https://resend.com/docs/add-a-domain>

**Sending with Next.js**

- The Next.js example reads its API key from RESEND_API_KEY.
  Source: <https://resend.com/docs/send-with-nextjs>
- From address must use a verified domain in production.
  Source: <https://resend.com/docs/send-with-nextjs>
- onboarding@resend.dev is for testing only.
  Source: <https://resend.com/docs/send-with-nextjs>
- Each call supports up to 50 To addresses.
  Source: <https://resend.com/docs/send-with-nextjs>
- SDK returns { data, error } instead of throwing for send errors.
  Source: <https://resend.com/docs/send-with-nextjs>
- Idempotency keys expire after 24 hours and allow 256 characters.
  Source: <https://resend.com/docs/send-with-nextjs>
- Suggested pattern is event-type/entity-id, such as welcome-user/123456789.
  Source: <https://resend.com/docs/send-with-nextjs>
- Default rate limit is 10 requests per second per team.
  Source: <https://resend.com/docs/send-with-nextjs>
- Excess calls receive HTTP 429.
  Source: <https://resend.com/docs/send-with-nextjs>
- Attachments allow 40 MB total per email after encoding.
  Source: <https://resend.com/docs/send-with-nextjs>
- Plain text is auto-generated from HTML when omitted.
  Source: <https://resend.com/docs/send-with-nextjs>

**Resend SMTP**

- Resend SMTP host is smtp.resend.com with user resend.
  Source: <https://resend.com/docs/send-with-smtp>
- Password is the Resend API key.
  Source: <https://resend.com/docs/send-with-smtp>
- Ports are 25, 465, 587, 2465, and 2587.
  Source: <https://resend.com/docs/send-with-smtp>
- Ports 465 and 2465 use implicit SSL/TLS.
  Source: <https://resend.com/docs/send-with-smtp>
- Ports 25, 587, and 2587 use explicit STARTTLS.
  Source: <https://resend.com/docs/send-with-smtp>
- Same API rate limit applies to SMTP sending.
  Source: <https://resend.com/docs/send-with-smtp>

**Pricing (read 2026-10-28)**

- Pricing below reflects the Resend page read on 2026-10-28.
- Free plan costs $0 for 3,000 emails per month.
  Source: <https://resend.com/pricing>
- Free plan caps sending at 100 emails per day.
  Source: <https://resend.com/pricing>
- Pro starts at $20 for 50,000 emails per month.
  Source: <https://resend.com/pricing>
- Overage costs $0.90 per 1,000 extra emails on Pro.
  Source: <https://resend.com/pricing>
- Transactional /emails sends count toward quota; check page before budgeting.
  Source: <https://resend.com/pricing>
- Prices and quotas can change; recheck official pricing before purchase.

## Vercel and Next.js background execution

Respect function timeouts and secret rules for ticket mail.

- With Fluid compute enabled, Hobby defaults to 300 seconds and caps at 300 seconds.
  Source: <https://vercel.com/docs/functions/limitations>
- With Fluid compute enabled, Pro and Enterprise default to 300 seconds, max 800 seconds.
  Source: <https://vercel.com/docs/functions/limitations>
- Extended beta allows 1,800 seconds on Pro and Enterprise.
  Source: <https://vercel.com/docs/functions/limitations>
- waitUntil extends handler lifetime for a given promise.
  Source: <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>
- waitUntil promises share function timeout and cancel on timeout.
  Source: <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>
- For Next.js 15.1 and above, use after() instead of waitUntil().
  Source: <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>
- after() does not block the response.
  Source: <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>
- Local Next docs confirm after() works in route handlers ([node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L6-L8](../../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L6-L8)).
- Local docs bind after() by route maximum duration ([node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L48-L54](../../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L48-L54)).
- Local docs warn after() can run even after failures ([node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L48-L54](../../node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md#L48-L54)).
- Non-NEXT*PUBLIC* values stay server-only ([node_modules/next/dist/docs/01-app/02-guides/environment-variables.md#L154-L166](../../node_modules/next/dist/docs/01-app/02-guides/environment-variables.md#L154-L166)).
- NEXT*PUBLIC* values inline into client JavaScript ([node_modules/next/dist/docs/01-app/02-guides/environment-variables.md#L154-L166](../../node_modules/next/dist/docs/01-app/02-guides/environment-variables.md#L154-L166)).

Recommendations from these facts:

- Register after() only after successful ticket creation.
- Treat after() and waitUntil() as best effort, not durable delivery.
- Prefer a durable queue or outbox over after() alone for must-send alerts.
- Store mail secrets in deployment secrets only.
- Never place keys in source, chat logs, or client code.

## Comparison

Compare pilot and production on risk, not just cost.

| Concern         | Gmail app-password pilot                                   | Resend production                   |
| --------------- | ---------------------------------------------------------- | ----------------------------------- |
| Sender identity | One human Gmail or Workspace mailbox                       | Verified app subdomain              |
| Sending quota   | 500 daily personal messages; 2,000 paid Workspace messages | 3,000 monthly and 100 daily on Free |
| Per-message cap | 500 personal, 100 Workspace SMTP                           | 50 To addresses per call            |
| Credential risk | Password change revokes all                                | Scoped API keys with permissions    |
| Verification    | None for pilot mailbox                                     | DNS SPF DKIM plus DMARC             |
| Rate behavior   | Account limit blocks                                       | 10 per second with 429              |
| Idempotency     | No key found in cited docs                                 | 24-hour keys                        |
| Audit trail     | Human Sent folder                                          | API logs with message IDs           |
| Best fit        | Few internal alerts                                        | Durable customer-facing alerts      |

Sources for this table appear in the sections above.

## Recommended Accent notification design (recommendations, not product facts)

These steps are proposals only; they describe no existing repo behavior.

1. Select authorized administrator recipients explicitly; notify responsible persons when assigned. Creator confirmation is optional.
2. Align email links with read rights; assigned_to alone opens nothing today ([src/app/api/tickets/[id]/route.js#L65-L73](../../src/app/api/tickets/%5Bid%5D/route.js#L65-L73)).
3. Update assignee access deliberately before sending assignees deep links.
4. Commit ticket row first; send only after commit succeeds.
5. Isolate send failures; email errors must not roll back tickets.
6. Write a durable outbox row or queue job in the same ticket transaction if possible.
7. Let a worker send, retry with backoff, and record status per recipient.
8. For separate recipient sends, use stable keys such as ticket-created/<ticket-id>/<recipient-id>. Provider deduplication expires after 24 hours.
9. Log provider message IDs and errors; expose status to super admins.
10. Keep secrets server-only; never expose keys to browsers.
11. A dedicated Gmail mailbox can serve low-volume alerts. Compare providers before choosing production delivery.

## Scope limits (recommendations)

- No implementation, migration, or UI change in this note.
- No credentials created, rotated, or shared.
- No live database examined; no delivery tested.
- No legal or spam-policy review beyond cited docs.
- Recipient and routing choices still need product approval.

## Direct references

- Google app passwords: <https://support.google.com/accounts/answer/185833?hl=en>
- Gmail in other clients: <https://support.google.com/mail/answer/7126229?hl=en>
- Less secure apps: <https://support.google.com/accounts/answer/6010255?hl=en>
- Gmail client settings and Sent copy: <https://support.google.com/mail/answer/78892?hl=en>
- Personal Gmail limits: <https://support.google.com/mail/answer/22839?hl=en>
- Workspace sending limits: <https://support.google.com/a/answer/166852?hl=en>
- Workspace printer scanner app sending: <https://support.google.com/a/answer/176600?hl=en>
- Gmail sender guidelines: <https://support.google.com/mail/answer/81126?hl=en>
- Gmail API send guide: <https://developers.google.com/workspace/gmail/api/guides/sending>
- Gmail API scopes: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Gmail server-side auth: <https://developers.google.com/workspace/gmail/api/auth/web-server>
- Nodemailer Gmail guidance: <https://nodemailer.com/usage/using-gmail/>
- Resend Next.js sending: <https://resend.com/docs/send-with-nextjs>
- Resend domain setup: <https://resend.com/docs/add-a-domain>
- Resend SMTP: <https://resend.com/docs/send-with-smtp>
- Resend pricing: <https://resend.com/pricing>
- Vercel function limits: <https://vercel.com/docs/functions/limitations>
- Vercel functions package: <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>
