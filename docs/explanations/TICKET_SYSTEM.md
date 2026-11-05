# Support Ticket System

> Current reference — last verified 2026-11-04 against `src/app/api/tickets/**`,
> `src/app/api/ticket-departments/**`, `src/app/api/cron/ticket-emails/route.ts`,
> `src/lib/tickets/**`, the ticket pages, and migration
> `migrations/20261104100000_ticket_department_email_routing.ts`.
> Part of the [documentation index](../README.md).
>
> This guide describes the repository contract. It is not an installation
> record: no production migration, deployment, Resend domain verification, API
> key creation, or cron activation is performed by the code change. Use the
> [Resend ticket email setup guide](../app/tickets/resend-setup.md) for the real
> setup sequence.

## Overview

Support tickets let an employee ask a configured department for help. Every new
ticket names exactly one **ticket department** from a super-admin-managed
catalog. Each department maps to one `roles_master` role, and every active member
of that role is a handler for the department's tickets. The same role members
with a usable email address receive a summary email when a ticket is created or
reassigned.

Departments, role mappings, and handler access are independent of the legacy
`support_tickets.category` values and of individual `assigned_to` assignment.
A department name such as "HR" grants nothing by itself: only the configured
role mapping, its active members, and the department's active flag determine
who can see tickets.

Email delivery is a best-effort side channel. The ticket and its queued email
rows commit in one transaction, so a delivery failure never loses or rolls back
the ticket.

## Ticket Flow

The five persisted statuses in `support_tickets.status` are defined in
`src/lib/tickets/constants.ts`:

| Stored value   | UI label             | Meaning                                       |
| -------------- | -------------------- | --------------------------------------------- |
| `open`         | New                  | Created; no handler has started work          |
| `in_progress`  | In Progress          | Being worked                                  |
| `pending_info` | Waiting for Employee | Handler needs information from the submitter  |
| `resolved`     | Resolved             | Work completed; resolution notes may be added |
| `closed`       | Closed               | Archived, terminal by convention              |

There is no `new`, `under_review`, or `waiting_for_employee` stored value, and
there is no `urgent` priority. Status and priority writes reject values outside
those sets. The flow is not a state machine: an authorized user may save any
valid status. When a submitter comments on a `pending_info` ticket, the
API moves it to `in_progress`; every other transition is an explicit status save.

## Ticket departments

`ticket_departments` is the routing catalog. The migration seeds **IT**, **HR**,
and **Admin** with `role_id = NULL` and leaves existing rows untouched on
re-run, so seeded names are not configured departments. A super administrator
must choose the responsible role for each department in **Admin → Tickets →
Department settings**.

A department is offered on the new-ticket form only when all of these hold:

1. `is_active = 1` and `isDelete = 0`;
2. `role_id` points to a `roles_master` row whose `status = 'active'`;
3. at least one live, active user holds that role and has a syntactically valid
   trimmed `users.email`.

The last condition controls notifications and selectability only. Membership in
the role still authorizes handling even for a member whose email is missing or
malformed. Email addresses are not DNS- or mailbox-verified.

Super administrators may create departments and change their name, role, or
availability. There is no delete operation: disabling a department hides it from
new tickets and revokes handler access to its existing tickets until it is
re-enabled, while the tickets, history, owner access, and super-admin access
remain. Owner and super-admin access never depends on the department.
Duplicate names return `409`. The HTTP surface is
`GET /api/ticket-departments` (selectable departments),
`GET /api/ticket-departments?all=true` (super-admin configuration plus active
roles), `POST /api/ticket-departments`, and
`PUT /api/ticket-departments/{id}` (super-admin create/update; no DELETE). Other
users receive `401`/`403`; validation errors return `400`; an unknown id returns
`404`. No user list or email addresses are exposed.

The department settings panel is visible only to super administrators and lists
unmapped, disabled, or handler-less departments with the reason each cannot
receive tickets. Mapping a role does **not** create roles, create users, or
change any user's role.

## Access rules

| Capability                              |                      Owner                      | Current department handler | Super admin |
| --------------------------------------- | :---------------------------------------------: | :------------------------: | :---------: |
| See own ticket in `/tickets`            |                       yes                       |             —              |     yes     |
| See department tickets in `/tickets`    |                        —                        |            yes             |     yes     |
| Read the ticket and public comments     |                       yes                       |            yes             |     yes     |
| Update status                           |                       yes                       |            yes             |     yes     |
| Reply publicly                          |                       yes                       |            yes             |     yes     |
| See/create internal notes               |                        —                        |             —              |     yes     |
| Change responsible department           |                        —                        |             —              |     yes     |
| Change priority or legacy `assigned_to` |                        —                        |             —              |     yes     |
| Delete                                  | only legacy `open`, unassigned, unrouted ticket |             —              |     yes     |

Handler status is decided fresh from the database for each request
(`canHandleTicket`), not from the session's cached role. It requires a live
ticket, live account, live/active department, and an active `roles_master` role
matching the ticket's **current** department. Moving a ticket to another
department therefore ends the previous group's access immediately; no
per-ticket member list is stored. Adding a member to a role later grants access
to that department's existing tickets but does not send retrospective email.

`GET /api/tickets/{id}` returns `can_update_status`, `can_reassign`, and
`can_handle` so the UI never offers an action the API will reject.

## Ticket creation

`POST /api/tickets` requires:

- `subject` and `description`;
- `ticket_department_id`, a positive integer for a **currently selectable**
  department;
- `priority` (default `medium`) and `category` (default `other`, legacy enum).

Inside one transaction the API re-checks that the department is selectable,
generates a unique `TKT-YYYYMM-####` number, inserts the ticket with
`assignment_version = 1`, and queues one outbox row per eligible recipient. An
invalid, disabled, unmapped, or handler-less department returns `400` and saves
nothing. Ticket-number races are retried a bounded number of times against the
unique index.

The create form has no individual assignee picker and no category picker. It
shows the chosen department's responsible role and handler count, states that
all of those handlers receive the email alert, and blocks submission when no
department is available. The **Attachment URL** field still exists, but it is
**not persisted**: the INSERT omits it and the live table has no
`attachment_url` column. Comment attachments are stored on
`ticket_comments.attachments` and remain separate.

## Listing and updating

### `GET /api/tickets`

- Without `all=true`: own tickets plus tickets whose current department role the
  caller holds.
- With `all=true` and a super-admin session: every ticket.
- Query parameters: `status`, `priority`, `category`, `ticket_department_id`,
  `all`.
- Returns ticket rows with `ticket_department_name` and `ticket_role_name`;
  soft-deleted rows are excluded.

The user ticket page (`/tickets`) shows submitted **and** handled tickets, with
status/priority/department filters and counts for active and
`pending_info` tickets. The admin page requests `all=true` and filters by the
real department catalog; a super-admin session sees every ticket, while any
other visitor still receives only the own/handled scope the API permits. It no
longer offers an inert HR/Admin label filter or an individual-assignee control.

### `PUT /api/tickets`

- Any owner, current handler, or super admin may update `status` and
  `resolution_notes`; handlers cannot delete.
- Non-super-admins attempting `priority`, `assigned_to`, or
  `ticket_department_id` receive `403`, not a silent ignore.
- Setting `resolved`/`closed` records `resolved_at`/`resolved_by`; another
  status clears them.
- A super admin changes the responsible department by sending
  `ticket_department_id`. The live ticket row is locked for the update.
  - Same department: success, no `assignment_version` bump, no duplicate email.
  - Different department: validates the target, increments
    `assignment_version`, cancels all `pending`/`processing` outbox jobs from the
    previous routing, and queues `reassigned` rows for the new department in the
    same transaction.
- Legacy individual `assigned_to` remains for super-admin bookkeeping and the
  OT path; it does not affect handler access.

### Comments and deletion

`POST /api/tickets/{id}` accepts public comments from the owner, current
handlers, and super admins. Only super admins can create internal notes
(`is_internal`), and non-super-admins never receive internal notes in reads.
The employee reply transition to `in_progress` is applied after a successful
owner comment on a `pending_info` ticket.

`DELETE /api/tickets/{id}` soft-deletes. A super admin may delete any ticket; an
owner may delete only a legacy ticket that is `open`, has no `assigned_to`, and
has no `ticket_department_id`.

## Email notifications

The [Resend setup guide](../app/tickets/resend-setup.md) covers configuration and
operations. Behaviour:

- One summary email per eligible recipient of the event's department snapshot:
  ticket number, subject, priority, submitter name, and a link to
  `/tickets/{id}`. No description, attachments, comments, or status alerts.
- `created` fires on creation; `reassigned` fires only when the department
  actually changes.
- `ticket_email_outbox` is the delivery queue. Rows are written in the ticket
  transaction, are unique per
  `(ticket_id, assignment_version, event_type, recipient_user_id)`, and carry a
  copy of the recipient email used at enqueue time.
- `GET /api/cron/ticket-emails` (Bearer `CRON_SECRET`, every minute on Vercel
  Pro) processes a bounded batch. Before sending, each job re-checks the live
  ticket, department, role mapping, assignment version, and recipient
  membership/email. Stale or revoked jobs become `cancelled`.
- Statuses: `pending`, `processing`, `sent`, `cancelled`, `failed`. `sent`
  means Resend accepted the request and returned a message id, not that the
  message reached an inbox.
- Transient failures retry with exponential backoff (60s base, capped at 6h)
  up to 12 attempts. A configuration rejection releases that job back to
  `pending` with its attempt refunded, and unattempted jobs held back behind a
  configuration error or `429` are likewise refunded, so fixing configuration
  can resume delivery. The rate-limited job itself uses an attempt and honours
  `retry-after`. Terminal provider/request errors mark the row `failed` with
  `last_error`.
- Delivery is at-most-once per queued row within Resend's 24-hour idempotency
  window; see the setup guide for the duplicate risk after that window.

There is no inbound email: replies to a notification go to the mailbox, are not
parsed, and are not added to the ticket. Attachments are never forwarded.

## Database

`support_tickets` keeps its baseline columns and enum values, including the
legacy `category` enum. The ticket migration adds:

```sql
ALTER TABLE support_tickets
  ADD COLUMN ticket_department_id INT UNSIGNED NULL,
  ADD COLUMN assignment_version INT UNSIGNED NOT NULL DEFAULT 0,
  ADD INDEX idx_support_tickets_ticket_department_id (ticket_department_id);
```

`ticket_departments`:

```sql
id INT UNSIGNED PK AUTO_INCREMENT,
name VARCHAR(100) UNIQUE,
role_id INT NULL,                    -- roles_master.id, mapped manually
is_active TINYINT(1) DEFAULT 1,
isDelete TINYINT(1) DEFAULT 0,
created_at, updated_at
```

`ticket_email_outbox`:

```sql
id INT UNSIGNED PK AUTO_INCREMENT,
ticket_id INT NOT NULL,
department_id INT UNSIGNED NOT NULL,
role_id INT NOT NULL,
assignment_version INT UNSIGNED NOT NULL,
event_type VARCHAR(20) NOT NULL,     -- created | reassigned
recipient_user_id INT NOT NULL,
recipient_email VARCHAR(255) NOT NULL,
payload JSON NOT NULL,
status VARCHAR(20) DEFAULT 'pending',
attempts INT UNSIGNED DEFAULT 0,
next_attempt_at DATETIME,
locked_until DATETIME NULL,
lock_token VARCHAR(64) NULL,
provider_message_id VARCHAR(255) NULL,
last_error TEXT NULL,
created_at, sent_at, isDelete,
UNIQUE (ticket_id, assignment_version, event_type, recipient_user_id)
```

Tickets created before this feature, including OT-approval tickets, keep
`ticket_department_id = NULL` and `assignment_version = 0`. They remain visible
to their owner and super admins and can be routed later by a super admin;
routing one bumps the version to 1 and queues a reassignment email. The
OT-approval creation path is otherwise unchanged and does not queue email.

## Legacy OT-approval path

`POST /api/users/[id]/activity-assignments` with `ot_hours` still creates an
unrouted ticket assigned to the resolved project manager and picks a category
the legacy enum accepts. It does not select a department and does not notify
handlers. Those tickets behave like other legacy tickets: owner/super-admin
access until a super admin routes them to a department.

## File structure

```
src/
├── lib/tickets/
│   ├── constants.ts           # TICKET_STATUSES (client-safe)
│   ├── departments.ts         # catalog, recipients, canHandleTicket
│   └── email-outbox.ts        # enqueue + Resend worker
├── app/
│   ├── tickets/
│   │   ├── page.jsx           # Submitted and handled tickets
│   │   ├── new/page.jsx       # Required department + details
│   │   └── [id]/page.jsx      # Detail, status, reply, notes
│   ├── admin/tickets/page.jsx # Super-admin management + department settings
│   ├── api/
│   │   ├── tickets/route.js
│   │   ├── tickets/[id]/route.js
│   │   ├── ticket-departments/route.ts
│   │   ├── ticket-departments/[id]/route.ts
│   │   └── cron/ticket-emails/route.ts
│   └── ...
├── components/tickets/TicketDepartmentSettings.tsx
migrations/20261104100000_ticket_department_email_routing.ts
```

`*.backup` files beside the ticket pages are stale copies and are not part of
the application.

## Priority levels

| Value      | UI label                                          | Intent               |
| ---------- | ------------------------------------------------- | -------------------- |
| `low`      | Low                                               | Can wait             |
| `medium`   | Medium                                            | Normal               |
| `high`     | High                                              | Needs attention soon |
| `critical` | Critical (shown as "Urgent" on the employee list) | Blocking             |

## Best practices

### Employees

- Choose the department that actually owns the issue; the alert goes to every
  handler in that department's role.
- Put the detail in the description; it is deliberately not emailed.
- Respond when a ticket is "Waiting for Employee"; an owner reply moves it back
  to In Progress.
- The create-form attachment URL is not saved yet. Use a comment attachment if
  one is needed.

### Handlers and super admins

- Keep department role mappings current. Disabling a department hides it from new
  tickets and revokes handler access to its existing tickets until re-enabled;
  owners and super admins keep access.
- Reassign the department, not the individual, to change ownership.
- Resolve with notes before closing.
- A failed outbox row is an operator signal, not proof that the user received
  email; inspect `ticket_email_outbox` and the Resend dashboard.

## Related documents

- [Resend ticket email setup](../app/tickets/resend-setup.md)
- [RBAC permissions](RBAC_PERMISSIONS_SYSTEM.md)
- [Super-admin setup](SUPER_ADMIN_SETUP.md)
- [Unauthenticated endpoint allowlist (ADR-0014)](../adr/0014-unauthenticated-endpoint-allowlist.md)
