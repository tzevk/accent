# Resend ticket email setup

> Operator guide — last verified 2026-11-04 against
> `src/lib/tickets/email-outbox.ts`, `src/app/api/cron/ticket-emails/route.ts`,
> `vercel.json`, `.env.example`, and migration
> `migrations/20261104100000_ticket_department_email_routing.ts`.
> Behaviour reference: [Ticket system](../../explanations/TICKET_SYSTEM.md).
>
> **No production action has been taken for you.** This repository change did
> not run a production migration, deploy, create a Resend domain or API key,
> verify DNS, configure Vercel environment variables, or activate the cron.
> Those steps are manual and belong to the operator below.
>
> The DNS answers and local CLI details in §1 were inspected read-only on this
> machine on 2026-11-04. They are evidence about the domain and the installed
> tool, not proof of Resend account or verification state.

## What the feature sends

For each new or reassigned routed ticket, every eligible handler in the
department's responsible role receives one summary email:

- ticket number, subject, priority, submitter name;
- a link to `/tickets/{id}` built from the trusted `TICKET_APP_ORIGIN`;
- the approved sender `Accent Support <support@accent.net.in>`.

It deliberately does **not** send descriptions, attachments, comment or status
alerts, creator confirmations, or inbound replies. There is no inbound email
processing and no attachment forwarding. The Resend Node SDK (`resend`,
`^6.37.0`) is server-only and already a dependency; do not import it into client
components.

Delivery is queued in `ticket_email_outbox` in the same transaction as the
ticket. A provider failure never rolls back a saved ticket.

## Prerequisites

- The team's Vercel plan supports a per-minute cron (Vercel Pro; the repository
  cron uses `* * * * *`).
- Access to the Resend team that will verify `accent.net.in`, or authority to
  create that team.
- Edit access to the `accent.net.in` zone at its DNS host (Cloudflare, per
  §1.1). No mailbox password or Microsoft 365 tenant changes are needed.
- Production database credentials for the knex migration.
- Super-admin access to Accent for department/role mapping.

## 1. Verify the sending domain in Resend (manual)

The application sends as `Accent Support <support@accent.net.in>`. Resend must
therefore verify the root domain `accent.net.in`: verification proves you may
send from any address at that domain, it does not create or take over a mailbox
([sender addresses](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend.md),
[add a domain](https://resend.com/docs/add-a-domain.md)).

You can do this entirely in the dashboard, or with the CLI as described below.
Either way, DNS and Resend account changes are outside this repository. Do not
put the API key, DNS values, or `CRON_SECRET` in code, docs, tickets, chat, or
commits.

### 1.1 What public DNS already shows

Observed read-only on 2026-11-04 with DNS-over-HTTPS queries for the exact
names below. No records were changed.

| Name                              | Type | Observed value                                    |
| --------------------------------- | ---- | ------------------------------------------------- |
| `accent.net.in`                   | NS   | `duke.ns.cloudflare.com`, `lia.ns.cloudflare.com` |
| `accent.net.in`                   | MX   | `0 accent-net-in.mail.protection.outlook.com`     |
| `accent.net.in`                   | TXT  | `MS=ms99216808`                                   |
| `accent.net.in`                   | TXT  | `v=spf1 include:spf.protection.outlook.com -all`  |
| `_dmarc.accent.net.in`            | TXT  | none                                              |
| `send.accent.net.in`              | MX   | none                                              |
| `send.accent.net.in`              | TXT  | none                                              |
| `resend._domainkey.accent.net.in` | TXT  | none                                              |

What this means:

- **Cloudflare is the authoritative DNS host** for the zone. NS records prove
  who answers queries, not who the registrar is or who holds the account
  login. Edit records at the DNS host, not at the registrar.
- The root MX routes incoming mail to Microsoft's mail-protection endpoint.
  Preserve that MX record and the `MS=` ownership TXT.
- The root SPF authorizes Microsoft's sending service. The queried names have
  no DMARC policy or Resend sending records yet.
- Public DNS cannot prove that a Resend team exists, is verified, or owns the
  domain. Only the Resend account can show that (§1.4).

### 1.2 Locate the installed CLI on Windows

The installed binary was observed at
`%USERPROFILE%\.resend\bin\resend.exe` (version `resend-cli v2.27.0`,
installed by the PowerShell installer). The npm global prefix contains no
Resend binary on this machine, so that installer was the install path. Its
script appends `%USERPROFILE%\.resend\bin` to the **user** `PATH`; a shell
started before the install keeps the old `PATH`, which is the likely reason a
bare `resend` is not found. Verify the location without changing anything:

```powershell
& "$env:USERPROFILE\.resend\bin\resend.exe" --version
```

Check whether the user `PATH` already contains the directory:

```powershell
[Environment]::GetEnvironmentVariable('PATH','User') -split ';' -contains "$env:USERPROFILE\.resend\bin"
```

`True` means only this shell is stale: open a new terminal. `False` means the
entry is missing; add it in **Edit environment variables for your account** or
prepend it for the current session only:

```powershell
$env:Path += ";$env:USERPROFILE\.resend\bin"
resend --version
```

Do not reinstall unless the file is missing; the official options are
`irm https://resend.com/install.ps1 | iex` (Windows) or
`npm install -g resend-cli`
([CLI installation](https://resend.com/docs/cli.md#installation)). The
`resend` package in this repository is the Node SDK, not the CLI.

### 1.3 Authenticate the CLI with a management key

The CLI resolves credentials in this order: `--api-key` flag, `RESEND_API_KEY`
environment variable, then the key saved by `resend login`
([CLI authentication](https://resend.com/docs/cli.md#authentication)).
Management operations (creating a domain, listing keys) require **full-access
permission**. That can come from an OAuth login with a suitable team role or
from a full-access API key.

A stored credential already exists on this machine. Observed read-only on
2026-11-04, `resend whoami` reports `authenticated: true`, profile `default`,
source `secure_storage`, and a masked key that resembles an OAuth token rather
than a literal API key. Treat this as "a credential is saved", not as proof
that it is full-access or that any domain is verified. If it belongs to the
wrong team, `resend logout` and log in again; otherwise the steps below are
only needed when management commands fail.

1. If you need a management key, open the dashboard
   [API keys](https://resend.com/api-keys) → **Create API Key**. Name it for
   this task (for example `cli-domain-setup`) and choose **Full access**. The
   value is displayed once and cannot be retrieved later. You can store it
   under a separate profile (`resend login --profile setup`, then pass
   `--profile setup`) so the existing login is untouched.
2. If you created that key, store it with the CLI. In an interactive terminal,
   run `resend login` and complete the prompt:

   ```powershell
   resend login
   ```

   Paste the key only into a hidden prompt if the CLI asks for one. The
   installed v2.27.0 help says the interactive flow "prompts and opens
   browser" and its error codes include OAuth failures, while the CLI docs
   describe a masked API-key prompt; both flows exist, so follow whatever the
   command presents. Do not pass the key with `--key` in a recorded shell,
   chat, or ticket: that flag is for non-interactive use and would be left in
   shell history. Do not use `--insecure-storage`; the CLI otherwise uses the
   operating system's secure credential store, and `doctor` reports which
   backend it actually used.

3. Confirm what is stored:

   ```powershell
   resend whoami
   resend doctor
   ```

   `whoami` is **local only** and makes no network call: it shows the profile,
   a masked key, and the credential source, not whether the key is still
   valid. `doctor` validates the key against the API, reports the credential
   backend, and summarizes domain status; it exits `1` if any check fails.

If you added a setup-only credential, remove it with `resend logout` (or
`resend auth remove <profile>`) and revoke that management key in the
dashboard. Leave the organization's existing login alone. The application
needs only the sending-only key from §1.8.

### 1.4 Check whether the domain already exists

Resend allows a domain on one team at a time, so look before creating:

```powershell
resend domains list --limit 100
```

Observed read-only in the same session on 2026-11-04: the authenticated team
contains exactly one domain, **`accent.in`** (id
`af1c7266-15c4-4f2c-bd3f-b0591e2e6b68`, status `not_started`, region
`ap-northeast-1`, sending enabled, receiving disabled). **`accent.net.in` is
not present.** These are different registrable domains: `accent.in` does not
authorize mail from `@accent.net.in` and has no relationship to the observed
`accent.net.in` MX. Do not delete, reuse, or cite it as evidence for this
setup; deleting a domain is destructive and outside this app's scope.

`accent.net.in` is therefore the domain to add. If a later `domains list`
shows it already present, reuse its id instead of creating a duplicate; if it
belongs to another team you control, transfer it deliberately; if another
party controls it, use the dashboard claim flow. The list omits DNS records;
`resend domains get <id>` returns them.

### 1.5 Create the domain only if it is absent

As of the observation above, `accent.net.in` is not in the account; re-run
`resend domains list` first in case that changed. Then:

```powershell
resend domains create --name accent.net.in --region ap-northeast-1 --json
```

The CLI accepts `us-east-1`, `eu-west-1`, `sa-east-1`, and `ap-northeast-1`.
The example matches the existing account domain's `ap-northeast-1` region.
`--region` is optional; specify it deliberately rather than relying on a
default. Leave receiving disabled — this feature never receives mail.
Add `--custom-return-path` only
if you have a reason to move the Return-Path away from the default
`send.accent.net.in`. The response contains the domain id and the exact DNS
records; that id is also what `verify`, `get`, and a domain-restricted API key
need.

### 1.6 Add exactly the returned records at Cloudflare

Open the Cloudflare dashboard for `accent.net.in` → **DNS → Records** and add
the records Resend returned, character for character. Use Resend's
[Cloudflare guide](https://resend.com/docs/guides/dns/cloudflare.md) for the
field mapping.

- Enter names **relative** to the zone (`send`, `resend._domainkey`), not the
  full name; omit `accent.net.in` when pasting.
- Keep Cloudflare's default **Auto** TTL, and give each MX record the unique
  priority Resend shows (commonly `10`). The root MX's priority `0` is on a
  different name and does not conflict.
- Newer domains (created after August 2026) may receive two **CNAME** records
  for sending instead of the MX + TXT pair. Add whichever set your Records tab
  shows, and set CNAMEs to **DNS Only** (grey cloud). A CNAME cannot coexist
  with other records on the same name.
- Do **not** add Resend receiving/inbound MX records, and do not touch the
  existing root MX. Resend's Return-Path MX/TXT pair lives on
  `send.accent.net.in`, and the DKIM record is a `resend._domainkey` CNAME at
  the zone root; neither changes where `support@accent.net.in` is delivered
  ([MX conflicts](https://resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records.md)).
- Keep the `MS=ms99216808` TXT and the existing root SPF. Resend's SPF belongs
  to the `send` subdomain, so the root SPF (Microsoft 365 only) does not need a
  Resend include for this setup. If, and only if, your Records tab lists a
  root-level SPF change, merge the include into the existing record instead of
  replacing it.
- There is no DMARC record today. Adding one is optional after verification:
  start with `v=DMARC1; p=none; rua=mailto:<monitored-address>;` and tighten
  only after every sender passes. Never overwrite an existing DMARC record;
  merge tags instead
  ([DMARC](https://resend.com/docs/dashboard/domains/dmarc.md)).

### 1.7 Verify and poll until verified

```powershell
resend domains verify <domain-id>
resend domains get <domain-id>
```

Verification is asynchronous. `get` returns the records and a status of
`not_started`, `pending`, `verified`, `partially_verified`, `partially_failed`,
or `failed`. Repeat `get` (or run `resend doctor`) until it reports
`verified`; usually this takes minutes, but DNS propagation can take up to 72
hours. `resend domains verify <id>` is safe to re-run if it stays pending.

### 1.8 Create a separate sending-only key for the app

CLI login is **not** application configuration. The Next.js server reads
`RESEND_API_KEY` from its environment at runtime; it never uses the CLI
profile or the saved credential. The app's server-side variables are
`RESEND_API_KEY`, the optional `RESEND_FROM_EMAIL`, `TICKET_APP_ORIGIN`, and
`CRON_SECRET` (§2); none of them come from the CLI. Create a second key with
**Sending access**, optionally restricted to the verified domain id, and use
only that key in Vercel:

```powershell
resend api-keys create --name "ticket-email-prod" --permission sending_access --domain-id <domain-id>
```

The token is shown once. Put it directly into the Vercel variable from §2; do
not save it in a file, and do not reuse the full-access management key. You can
also create this key in the dashboard with the same name, **Sending access**,
and domain restriction; the CLI command needs the management credential from
§1.3. The [Next.js guide](https://resend.com/docs/send-with-nextjs) confirms
the runtime requirements: a verified domain in the `from` address, the key in
`RESEND_API_KEY`, and the `resend` SDK — all already implemented here, so no
new route or dependency is needed.

### 1.9 The support mailbox does not move

Resend does not need the `support@accent.net.in` password, IMAP/SMTP access,
an app password, or OAuth consent. It only sends. Microsoft 365 keeps
receiving that mailbox, and replies to a ticket email go to the `From`
address, so they still arrive there. Resend does not require the sender
address to exist, but here it does, which is what makes replies work.

Verifying the **root** domain is required because the `From` address uses the
root domain. Resend generally recommends a sending subdomain for reputation
isolation; that would change the visible sender and is not the choice made
here. If the sender ever moves to a subdomain, that subdomain must be verified
separately and `RESEND_FROM_EMAIL` updated.

### 1.10 Safe checks (never run against real recipients)

Validate a send request without contacting the API:

```powershell
resend emails send --from "Accent Support <support@accent.net.in>" `
  --to delivered@resend.dev --subject "Resend setup check" `
  --text "Setup check" --dry-run
```

`--dry-run` prints the request JSON only. A real end-to-end check, once the
domain is verified and before the cron is enabled, may send one message to
`delivered@resend.dev` (a Resend test address); never test with real users or
bulk mail. Do not run either command as part of a repository change, and do
not use `onboarding@resend.dev` as the production sender.

### 1.11 Facts this guide cannot establish

- Who holds the registrar and Cloudflare logins; NS records do not identify
  them.
- Whether the Resend team's plan allows another domain; check the dashboard if
  `domains create` is rejected.
- Whether Resend will issue the MX + TXT pair or the newer two-CNAME variant;
  only the created domain's Records tab knows.
- Which address should receive DMARC aggregate reports, if DMARC is added.

None of these blocks the code path; they only affect who performs the manual
steps and which records are pasted.

## 2. Set server-only environment variables

Set these in Vercel → Project → Settings → Environment Variables for
**Production** (and separately for any preview/staging deployment that should
send). Mark the API key and cron secret as sensitive. They are read only by
server code; never rename them with a `NEXT_PUBLIC_` prefix.

| Variable            | Required | Value                                                                                                                                             |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`    | yes      | Sending-only Resend API key from §1.8 (secret)                                                                                                    |
| `RESEND_FROM_EMAIL` | no       | `Accent Support <support@accent.net.in>` (code default when unset)                                                                                |
| `TICKET_APP_ORIGIN` | yes      | Trusted public HTTPS origin, e.g. `https://crm.accent.net.in`; `http://localhost` and `http://127.0.0.1` are accepted only for local verification |
| `CRON_SECRET`       | yes      | Random shared secret for the cron endpoint                                                                                                        |

Generate a cron secret locally without sending it anywhere:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the result into the Vercel variable field, then discard it. Redeploy after
changing environment variables; Vercel does not apply them to an existing
deployment.

Notes:

- `RESEND_FROM_EMAIL` must use a verified Resend domain and one line. The code
  validates the address shape and rejects line breaks.
- `TICKET_APP_ORIGIN` is required even for local testing. Links never use the
  request `Host` header.
- `RESEND_BASE_URL` is an optional SDK/test transport override. Leave it unset
  in production.
- `RESEND_API_KEY` and `TICKET_APP_ORIGIN` are checked before any job is
  claimed. When missing, the worker returns `503` and leaves all jobs
  `pending`; it does not spend retries.
- `CRON_SECRET` protects the machine endpoint. A missing secret makes the route
  return `503`; a wrong or missing `Bearer` header returns `401`. Never expose
  this value to the browser.

## 3. Run the database migration

The migration creates `ticket_departments`, `ticket_email_outbox`, and the two
new `support_tickets` columns/index. It seeds **IT**, **HR**, and **Admin** with
no responsible role. It is additive, re-run safe, and does not change the
status, category, or priority enums, existing tickets, roles, or users.

Check state, then migrate:

```bash
npm run migrate:status          # current NODE_ENV target (development by default)
npm run migrate

npm run migrate:prod:status     # explicit production target (NODE_ENV=production)
npm run migrate:prod
```

Run the production pair only with production credentials and a current backup.
Until the migration has run, the department settings page, new-ticket form, and
worker cannot work. This repository does not perform that production step.

## 4. Map each department to one role (manual)

Sign in as a super administrator and open **Admin → Tickets → Department
settings**:

1. Edit a seeded department (IT, HR, Admin) or add one.
2. Choose the single `roles_master` role responsible for it, and leave the
   department **Active**.
3. Confirm the table shows at least one eligible handler.

This action changes only the department's `role_id` and `is_active`. It does
**not** create a role, create a user, change a user's role, or email anyone. A
department called "HR" or "IT" is not configured until this mapping exists;
existing role names or spellings imply no responsibility or access.

Every active member of the mapped role:

- can list, read, reply to, and change the status of that department's tickets;
- receives its creation and reassignment emails if their email address is
  usable.

Reassignment to another department immediately ends the previous group's access
and cancels its unsent alerts. Newly added role members are not notified
retroactively. Internal notes remain super-admin-only.

## 5. Why a department is unavailable

A department is not offered on the new-ticket form unless it is all of:

1. active and not soft-deleted;
2. mapped to an active `roles_master` role;
3. held by at least one live, active user with a syntactically valid email.

The settings panel lists each blocked department and the reason ("disabled",
"no responsible role", "no eligible handlers"). The new-ticket form shows "No
department is available" and blocks submission when the catalog is empty. A
member with a missing email still handles tickets; the email requirement only
limits notifications and selectability.

Disabling a department also revokes its handlers' access and cancels pending
alerts when the worker checks them. Reassign open tickets before disabling it.
Owners and super administrators keep access to the ticket and its history.

The employee does not choose an individual assignee. Do not add an
`assigned_to` person as a substitute for department routing; that legacy field
does not grant handler access.

## 6. Activate and verify the cron

`vercel.json` already declares:

```json
{
	"crons": [{ "path": "/api/cron/ticket-emails", "schedule": "* * * * *" }]
}
```

After deploying with `CRON_SECRET` set, Vercel Cron calls
`GET /api/cron/ticket-emails` every minute with
`Authorization: Bearer <CRON_SECRET>`. The route runs one bounded batch of 20
jobs with `maxDuration = 60`; the next minute continues the queue. Keep the
path and schedule exact. Do not add a session-based call path or weaken the
general auth/rate-limit rules.

An operator can check the endpoint with the secret already present in their
shell; never paste the secret into a URL, ticket, or chat:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://crm.accent.net.in/api/cron/ticket-emails
```

Expected `200` with a JSON summary (`processed`, `sent`, `retried`,
`cancelled`, `failed`). `401` means the Bearer value is wrong; `503` means
`CRON_SECRET`, `RESEND_API_KEY`, `TICKET_APP_ORIGIN`, or the sender config is
missing or invalid. There is no separate "send test email" endpoint: create a
real ticket routed to a test department whose role contains a consenting
internal account.

## 7. Outbox states and diagnosis

Each row is one recipient for one ticket routing event.

| Status       | Meaning                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`    | Waiting for `next_attempt_at`; due rows are claimable                                                                                    |
| `processing` | Claimed under a 120-second lease; an expired lease is returned to `pending`                                                              |
| `sent`       | Resend accepted the request and returned a message id (`provider_message_id`)                                                            |
| `cancelled`  | Obsolete or revoked: ticket deleted, department/role changed, assignment version advanced, recipient removed, or recipient email changed |
| `failed`     | Terminal request error, or 12 charged attempts exhausted                                                                                 |

Retry policy: transient network/5xx failures retry with exponential backoff
starting at 60 seconds and capped at 6 hours. `429` honours `retry-after` and
holds the batch. A configuration rejection (for example a bad key or unverified
sender, `401`/`403`) returns that job to `pending` with its attempt refunded;
the unattempted tail held back behind a configuration rejection or rate limit is
also refunded. The rate-limited job itself spends one attempt. Validation
defects, unusable recipients, and other terminal request errors go to `failed`.
The worker never invents a success: a missing provider message id is retried, and
`last_error` keeps the last secret-free reason.

Safe read-only diagnostics:

```sql
-- Counts by state; expected to be mostly sent plus a few pending/cancelled.
SELECT status, COUNT(*) AS jobs
FROM ticket_email_outbox
WHERE isDelete = 0
GROUP BY status;

-- Rows needing attention, newest first.
SELECT id, ticket_id, department_id, assignment_version, event_type,
       recipient_user_id, status, attempts, next_attempt_at,
       sent_at, provider_message_id, last_error
FROM ticket_email_outbox
WHERE isDelete = 0
  AND status IN ('failed', 'pending', 'processing', 'cancelled')
ORDER BY id DESC
LIMIT 50;

-- Confirm the routing version of recent tickets.
SELECT id, ticket_number, ticket_department_id, assignment_version, status,
       created_at
FROM support_tickets
WHERE isDelete = 0
ORDER BY id DESC
LIMIT 20;
```

Use the settings panel, not hand-written counts, for the authoritative eligible
handler count. Treat `recipient_email` and `last_error` as operational PII; do
not paste them into shared channels.

## 8. What "sent" does and does not prove

`sent` means **Resend accepted the API request**. It does not prove inbox
delivery, and this application stores no delivery, bounce, complaint, or
open events. Check the Resend dashboard for provider-side delivery status. A
successful cron response with `failed: 0` likewise proves only that the worker
processed its batch.

Idempotency keys are stable per ticket/version/event/recipient, which prevents
duplicate sends for retries within Resend's **24-hour** idempotency window. A
manual replay after that window can deliver a duplicate. Do not reset `sent`
rows or rebuild outbox rows to "fix" delivery; fix configuration or the
recipient and let `pending` rows retry.

## 9. Limits to communicate

- No inbound replies: email replies are not imported. Sender verification does
  not create a receiving mailbox.
- No attachment forwarding: ticket and comment attachments are never included
  in email.
- No notifications for comments, status changes, resolutions, or closures.
- No creator confirmation email and no broadcast to users outside the mapped
  role.
- No retrospective email when someone is added to a role later.
- Email reach depends on a current, active role member with a usable address;
  fixing the mapping or membership affects future events and pending jobs that
  still revalidate, not already-`sent` mail.

## Related documents

- [Ticket system](../../explanations/TICKET_SYSTEM.md)
- [RBAC permissions](../../explanations/RBAC_PERMISSIONS_SYSTEM.md)
- [Unauthenticated endpoint allowlist (ADR-0014)](../../adr/0014-unauthenticated-endpoint-allowlist.md)
- [Environment template](../../../.env.example)
