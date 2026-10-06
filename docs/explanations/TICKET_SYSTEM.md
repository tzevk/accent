# Support Ticket System Documentation

> Current reference — last verified 2026-10-06 against `src/app/api/tickets/**`, the ticket pages,
> and the live `support_tickets` schema. Part of the [documentation index](../README.md).
>
> ⚠️ **Schema drift:** the UI implements the six-status flow and department routing described here,
> but the database still carries the legacy schema — `status` enum `open|in_progress|pending_info|resolved|closed`,
> `category` enum `login_issues|performance|bug_report|feature_request|data_issue|access_permission|other`,
> and no `routed_to` / `attachment_url` columns. The newer definition exists only in the deprecated
> `src/utils/schema-init.js` (its `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table),
> and no knex migration reconciles it. Treat the status/routing/category details as the intended
> design until a migration lands. Details in [Schema drift](#schema-drift).

## Overview

A structured employee support ticket system. The intended design routes tickets to HR or Admin departments based on request category; the current API stores the category but has no routing field to set (see [Schema drift](#schema-drift)).

## Ticket Flow

```
New → Under Review → In Progress → Waiting for Employee → Resolved → Closed
```

The frontend (`src/app/tickets/page.jsx`, `src/app/admin/tickets/page.jsx`) implements this flow. The live DB enum still uses the legacy values, so status transitions beyond the default will fail until the schema is migrated.

### Status Definitions

1. **New** (🆕)
   - Initial status when a ticket is created
   - Visible to assigned department (HR/Admin)
   - Awaiting first review

2. **Under Review** (👀)
   - Department has acknowledged the ticket
   - Investigating the request
   - May request additional information

3. **In Progress** (⚡)
   - Actively working on the request
   - Changes being implemented
   - Employee will be updated on progress

4. **Waiting for Employee** (⏳)
   - Department needs information/action from employee
   - Employee must respond to proceed
   - Auto-moves back to "In Progress" when employee comments

5. **Resolved** (✅)
   - Request has been completed
   - Resolution notes provided
   - Employee can review and request reopening if needed

6. **Closed** (🔒)
   - Final status, ticket is archived
   - No further action
   - Historical record maintained

## Ticket Creation (Employee Side)

### Required Fields

- **Subject**: Brief summary of the request
- **Description**: Detailed explanation of the request

`POST /api/tickets` rejects the request when either is missing.

### Collected by the create form (`src/app/tickets/new/page.jsx`)

- **Subject**, **Description**
- **Priority**: Low, Medium, High, or Critical (see [Priority Levels](#priority-levels))
- **Attachment URL**: submitted by the form but **not persisted** — the INSERT omits it and the live table has no `attachment_url` column (comment attachments use `ticket_comments.attachments`)

### Category

The create form has **no category picker**. `POST /api/tickets` defaults `category` to `'other'` and accepts any value in the request body, but the live column enum only allows `login_issues`, `performance`, `bug_report`, `feature_request`, `data_issue`, `access_permission`, `other`. The HR/Admin category set below is the intended design, not what the form sends.

### Categories & Routing (intended design — not wired)

The mapping below is the design used by the admin filter labels; the create flow never sets a category and the API has no routing field, so nothing is routed automatically today.

#### HR Department

| Category             | Icon | Description                         |
| -------------------- | ---- | ----------------------------------- |
| Payroll              | 💰   | Salary, deductions, tax issues      |
| Leave                | 🏖️   | Leave applications, balance queries |
| Policy               | 📋   | Company policies, guidelines        |
| Confidential Matters | 🔒   | Private HR matters (restricted)     |

#### Admin Department

| Category        | Icon | Description                         |
| --------------- | ---- | ----------------------------------- |
| Access Cards    | 🪪   | ID cards, access permissions        |
| Seating         | 💺   | Desk allocation, workspace requests |
| Maintenance     | 🔧   | Facility issues, repairs            |
| General Request | 📝   | Other administrative requests       |

## Routing Logic (intended, not implemented)

No code performs category→department routing today:

- `POST /api/tickets` inserts the category (default `'other'`) but never sets a department — the live table has no `routed_to` column.
- The admin page sends a `routed_to` filter query param (`src/app/admin/tickets/page.jsx:113`), but `GET /api/tickets` ignores it (its filters are `status`, `priority`, `category`, `all`).
- The only category-aware code is the OT-approval ticket path (see [API Endpoints](#api-endpoints)), which uses `getSafeTicketCategory()` to pick a value the live enum accepts — not to route anywhere.

The mapping the design intends:

```javascript
// HR Categories
['payroll', 'leave', 'policy', 'confidential'] → HR

// Admin Categories
['access_cards', 'seating', 'maintenance', 'general_request'] → Admin
```

## Priority Levels

| Priority | Color  | Description                 |
| -------- | ------ | --------------------------- |
| Low      | Gray   | Can wait, not blocking work |
| Medium   | Blue   | Normal priority             |
| High     | Orange | Needs attention soon        |
| Critical | Red    | Critical, blocking work     |

The live enum and the employee UI use `critical`. The admin page uses the value `urgent` (`src/app/admin/tickets/page.jsx:37`), which the live enum does not accept — another symptom of the drift below.

## Employee Features

### Dashboard View

- Statistics cards showing ticket counts by status
- Filter by status, priority, or department (department filter is inert — see [Routing Logic](#routing-logic-intended-not-implemented))
- Search by ticket number, subject, or description
- Click any ticket to view full details

### Ticket Creation

1. Click "Create Ticket" button
2. Fill in the form:
   - Subject
   - Detailed description
   - Priority level
   - Optional attachment URL (currently not persisted — see [Ticket Creation](#ticket-creation-employee-side))
3. Submit

### Ticket Tracking

- View all your submitted tickets
- Status updates (subject to the schema drift)
- Comment thread for communication
- Attachment viewing (comment attachments)
- Resolution notes when closed

## Admin/HR Features

### Management Dashboard

- Super admins can list all tickets (`?all=true`); regular users see only their own — there is no department scoping
- Filter by status, priority, category; the department filter is inert
- Search across all fields including employee names
- Statistics showing ticket counts for each status

### Ticket Management Actions

1. **Status Updates**
   - Quick action buttons to move tickets through the flow
   - Required resolution notes when marking Resolved/Closed

2. **Assignment**
   - Assign tickets to specific team members
   - Dropdown showing all users
   - Unassign if needed

3. **Communication**
   - Add internal or external comments
   - Comments visible to employee
   - Track conversation history

4. **Priority Management**
   - Update priority levels as needed
   - Helps with workload prioritization

## Technical Implementation

### Database Schema

The **live** table (baseline migration `20260722080106_baseline_schema.js` and production) is:

```sql
CREATE TABLE support_tickets (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_number VARCHAR(20) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,            -- returned to the UI as `subject`
  description TEXT NOT NULL,
  category ENUM('login_issues','performance','bug_report','feature_request','data_issue','access_permission','other') DEFAULT 'other',
  priority ENUM('low','medium','high','critical') DEFAULT 'medium',
  status ENUM('open','in_progress','pending_info','resolved','closed') DEFAULT 'open',
  screenshots JSON, browser_info VARCHAR(255), page_url VARCHAR(500),
  steps_to_reproduce TEXT, expected_behavior TEXT, actual_behavior TEXT,
  assigned_to INT, resolution_notes TEXT, resolved_at DATETIME, resolved_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  isDelete TINYINT(1) NOT NULL DEFAULT 0
);

CREATE TABLE ticket_comments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  user_id INT NOT NULL,
  comment TEXT NOT NULL,
  is_internal TINYINT(1) DEFAULT 0,
  attachments JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Schema drift

`src/utils/schema-init.js` (deprecated) declares a different `support_tickets`: category enum `payroll|leave|policy|access_cards|seating|maintenance|general_request|confidential`, priority enum `low|medium|high|urgent`, status enum `new|under_review|in_progress|waiting_for_employee|resolved|closed`, plus a `routed_to ENUM('hr','admin')` column. That definition matches the UI, but because the table already exists its `CREATE TABLE IF NOT EXISTS` never ran, and no knex migration applies the change. Consequences today:

- Creating a ticket works (the INSERT omits `status`/`routed_to`), but the ticket is stored as `status='open'` and the UI expects `'new'`.
- Moving a ticket to `under_review` / `waiting_for_employee` (or saving admin priority `urgent`) writes a value the live enum rejects.
- The department filter and the "routed to" confirmations have no backing column.
- The OT-approval path (below) deliberately probes `information_schema` for the live enum and picks an accepted value (`getSafeTicketCategory()`), rather than fixing the mismatch.

Fix: add a knex migration that alters the enum values and adds `routed_to` (and decide whether to keep `attachment_url`), or align the UI to the legacy schema.

### API Endpoints

#### GET /api/tickets

- Lists the caller's tickets; `?all=true` lists everything for super admins only
- Query params: `status`, `priority`, `category`, `all` (`routed_to` is ignored)

#### POST /api/tickets

- Creates a ticket from `subject`, `description`, `category` (default `'other'`), `priority` (default `'medium'`)
- Auto-generates ticket number `TKT-YYYYMM-####`
- Does not set status or routing

#### GET /api/tickets/[id]

- Single ticket with comments; internal comments hidden from non-super-admins

#### PUT /api/tickets

- Updates `status`, `priority`, `assigned_to`, `resolution_notes`; owner or super admin only (priority/assignment only for super admins). Sets `resolved_at`/`resolved_by` on resolve/close

#### POST /api/tickets/[id]

- Adds a comment; `is_internal` is only honored for super admins
- Auto-moves `waiting_for_employee` → `in_progress` when the ticket owner comments (subject to the drift above)

#### DELETE /api/tickets/[id]

- Soft-deletes (`isDelete = 1`); super admins can delete any ticket, owners only while the ticket is `new` and unassigned

#### POST /api/users/[id]/activity-assignments (OT approval)

- With `ot_hours`, creates an OT-approval ticket assigned to the resolved project manager, using `getSafeTicketCategory()` to pick a category the live enum accepts (`src/app/api/users/[id]/activity-assignments/route.js:654-680`)

### File Structure

```
src/
├── app/
│   ├── tickets/
│   │   ├── page.jsx           # Employee ticket list
│   │   ├── new/page.jsx       # Create-ticket form
│   │   └── [id]/page.jsx      # Ticket detail
│   ├── admin/
│   │   └── tickets/
│   │       └── page.jsx       # Admin/HR management view
│   └── api/
│       └── tickets/
│           ├── route.js       # Ticket list/create/update
│           └── [id]/
│               └── route.js   # Ticket details, comments, delete
```

(`*.backup` files sit next to the ticket pages; they are stale copies, not part of the app.)

## User Experience

### Employee Flow

1. Employee creates a ticket (subject, description, priority; no category picker)
2. Employee tracks progress in the dashboard
3. Receives updates via comments
4. Can respond when status is "Waiting for You"
5. Sees resolution notes when completed

(The "Routed to [HR/Admin]" confirmation shown in some designs does not exist in the current code.)

### Admin/HR Flow

The admin page requests `?all=true`, but `GET /api/tickets` only honors it for **super admins** — other users see their own tickets even on the admin screen.

1. New tickets appear in the dashboard (super admins)
2. Review and move to "Under Review" (blocked by the live enum until migrated)
3. Assign to team member if needed
4. Work on request → "In Progress"
5. If need info → "Waiting for Employee"
6. Complete work → "Resolved" (add notes)
7. Archive → "Closed"

## Best Practices

### For Employees

- Provide detailed descriptions
- Attach relevant documents (via comments, while the create-form attachment field is not persisted)
- Respond promptly when status is "Waiting for You"
- Review resolution notes before closing

### For Admin/HR

- Acknowledge tickets quickly (New → Under Review)
- Assign to appropriate team members
- Add regular updates via comments
- Use "Waiting for Employee" when blocked
- Always add resolution notes when resolving
- Close tickets only when confirmed complete

## Future Enhancements

- Email notifications on status changes
- SLA tracking by priority level
- Ticket templates for common requests
- File upload instead of URL only
- Department-specific ticket queues
- Bulk ticket operations
- Advanced reporting and analytics
- Mobile-responsive design improvements
