# DDL & Soft Delete Audit

> Generated from `src/app/api/` — run `grep` to refresh.

**Knex migrations are now the single source of truth for schema.** `schema-init.js` is deprecated. All new DDL goes into `migrations/*.js` (see `AGENTS.md` for commands).

## 1. Inline DDL in API Routes

50 files run `CREATE TABLE IF NOT EXISTS` and/or `ALTER TABLE` in request handlers. These should be migrated to knex migration files.

### Already has a knex baseline migration ✅

All tables are covered by `migrations/20260722080106_baseline_schema.js` (110 tables from prod dump). This ensures tables exist on fresh DBs. Inline DDL in API routes is redundant but harmless — strip it as you touch each route.

### Already migrated to `schema-init.js` (legacy, now superseded by knex) 🗄️

| API Route                                   | Tables Previously Created/Altered                                         |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `petty-cash-expenses/route.ts`              | `petty_cash_expenses` (DDL + ensureTable)                                 |
| `petty-cash-expenses/[id]/route.ts`         | — (no DDL, just added isDelete guard)                                     |
| `cash-vouchers/route.js`                    | `cash_vouchers` (CREATE + ALTER), `petty_cash_expenses` (CREATE + ALTER)  |
| `cash-vouchers/[id]/route.js`               | — (no DDL, just cascade soft-delete)                                      |
| `cash-vouchers/next-number/route.js`        | `cash_vouchers` (CREATE)                                                  |
| `admin/invoices/route.js`                   | `purchase_orders`, `invoices` (DDL + isDelete)                            |
| `admin/invoices/[id]/route.js`              | `purchase_orders`, `invoices` (DDL + isDelete)                            |
| `admin/invoices/download/route.js`          | `purchase_orders`, `invoices` (DDL + isDelete)                            |
| `admin/invoices/po-balance/route.js`        | `purchase_orders`, `invoices` (DDL + isDelete)                            |
| `admin/payment-entries/route.js`            | `payment_entries` (CREATE + 11 ALTER + INDEX)                             |
| `admin/purchase-orders/route.js`            | `purchase_orders` (CREATE + 12 ALTER + INDEX + DROP legacy column)        |
| `admin/purchase-orders/download/route.js`   | — (no DDL, only queries with isDelete check)                              |
| `admin/quotations/route.js`                 | `quotations`, `project_quotations` (CREATE + 12 ALTER)                    |
| `admin/quotations/[id]/route.js`            | `project_quotations`, `quotations` (60 ALTERs across 2 tables)            |
| `admin/quotations/[id]/project/route.js`    | `quotations` (CREATE + ALTER + INDEX)                                     |
| `admin/standalone-quotations/route.js`      | `quotations` (CREATE + 48 ALTER + 2 MODIFY + INDEX)                       |
| `admin/standalone-quotations/[id]/route.js` | `quotations` (CREATE + 48 ALTER + 2 MODIFY + INDEX)                       |
| `admin/quotations/[id]/route.js` (PUT)      | `proposals` (25 ALTER cols for quotation fields)                          |
| `proposals/route.js`                        | `proposals` (38 ALTER via dead `ensureProposalColumns()`)                 |
| `proposals/[id]/route.js`                   | `proposals` (50+ ALTER via module guard + MODIFY status + ALTER projects) |
| `proposals/[id]/followups/route.js`         | `proposal_followups` (CREATE TABLE per GET/POST)                          |
| `projects/[id]/route.js`                    | `projects` (LONGTEXT/TEXT auto-migration + user_activity_assignments DDL) |
| `projects/[id]/followups/route.js`          | `project_followups` (CREATE TABLE + ALTER logged_by per GET)              |
| `projects/[id]/invoice/route.js`            | `project_invoices` (CREATE TABLE + 8 ALTERs per GET/POST/PUT)             |
| `projects/[id]/purchase-order/route.js`     | `project_purchase_orders` (CREATE TABLE + MODIFY per GET/POST)            |
| `projects/[id]/quotation/route.js`          | `project_quotations` (CREATE TABLE + ALTER client_name per GET/POST)      |
| `projects/mom-upload/route.js`              | `project_mom_documents` (CREATE TABLE per GET/POST)                       |

### Unguarded — runs on EVERY request (HIGH priority)

| File                              | Tables Created/Altered                         |
| --------------------------------- | ---------------------------------------------- |
| `payroll/salary-profile/route.js` | `employee_salary_profile` (35+ ALTER + MODIFY) |

### Has module-level guard — runs at most once per process (LOWER priority)

| File                                               | Tables Created/Altered                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `users/[id]/activity-assignments/route.js`         | `support_tickets`                                                          |
| `followups/route.js`                               | `follow_ups`                                                               |
| `attendance/route.js`                              | `employee_attendance`, `employee_attendance_summary`                       |
| `activities/route.js`                              | `functions_master`, `activities_master`                                    |
| `activity-master/route.js`                         | `functions_master`, `activities_master`                                    |
| `messages/route.js`                                | `messages`, `message_attachments`, `conversations`, `conversation_members` |
| `software/route.js`                                | `softwares`                                                                |
| `software-versions/route.js`                       | `software_versions`                                                        |
| `software-master/route.js`                         | `software_categories`, `softwares`, `software_versions`                    |
| `masters/holidays/route.js`                        | `holiday_master`                                                           |
| `masters/banks/route.js`                           | `bank_master`                                                              |
| `masters/accounts/route.js`                        | `account_master`                                                           |
| `masters/account-heads/route.js`                   | `account_head_master`                                                      |
| `admin/outgoing-quotations/route.js`               | `outgoing_quotations`                                                      |
| `admin/outgoing-purchase-orders/route.ts`          | `outgoing_purchase_orders`                                                 |
| `admin/expenses/route.js`                          | `expenses`                                                                 |
| `admin/other-expenses/route.ts`                    | `other_expenses`                                                           |
| `admin/payment-payables/route.js`, `[id]`          | `payment_payables`                                                         |
| `admin/payment-receivables/route.js`, `[id]`       | `payment_receivables`                                                      |
| `admin/material-requisitions/next-number/route.js` | `material_requisitions`                                                    |
| `admin/todos/route.js`                             | `todos`                                                                    |
| `document-master/route.js`                         | `documents_master`                                                         |
| `document-upload/route.js`                         | `entity_documents`                                                         |
| `project-docs/route.js`                            | `project_documents`                                                        |
| `audit-logs/route.js`                              | `audit_logs`                                                               |
| `roles/route.js`                                   | `roles`                                                                    |
| `todos/route.js`                                   | `todos`                                                                    |
| `projects/mom-upload/route.js`                     | `project_mom_documents`                                                    |
| `users/route.js`                                   | `users` (CREATE TABLE + 5 ALTERs), `roles` (CREATE TABLE)                  |
| `employees/route.js`                               | `employees` (CREATE + 48 ALTERs + MODIFY employee_type)                    |
| `vendors/route.js`                                 | `vendors` (CREATE TABLE + 24 ALTERs + MODIFY payment_terms)                |
| `tickets/route.js`                                 | `support_tickets`, `ticket_comments` (CREATE TABLE + isDelete)             |
| `admin/expenses/route.js`                          | `expenses` (CREATE TABLE + isDelete)                                       |
| `admin/other-expenses/route.ts`                    | `other_expenses` (CREATE TABLE + isDelete)                                 |
| `admin/accounts/route.js`                          | `account_transactions`                                                     |
| `admin/purchase-invoices/route.js`                 | `purchase_invoices`                                                        |
| `settings/profile/route.js`                        | `employees`                                                                |
| `activity-master/subactivities/route.js`           | `sub_activities`                                                           |
| `activity-master/activities/route.js`              | `activities_master`                                                        |
| `admin/outgoing-purchase-orders/download/route.ts` | — (only queries with isDelete check)                                       |

---

## 2. Soft Delete Audit

Tables are listed if they use hard `DELETE FROM ... WHERE id = ?` in any API route. The `isDelete TINYINT(1) NOT NULL DEFAULT 0` column + migration + query changes are needed.

### Already has `isDelete` ✅

| Table                      | API Route(s)                                            |
| -------------------------- | ------------------------------------------------------- |
| `cash_vouchers`            | `admin/cash-vouchers/**`                                |
| `invoices`                 | `admin/invoices/**`                                     |
| `petty_cash_expenses`      | `admin/petty-cash-expenses/**`                          |
| `payment_entries`          | `admin/payment-entries/**`                              |
| `outgoing_quotations`      | `admin/outgoing-quotations/**`                          |
| `outgoing_purchase_orders` | `admin/outgoing-purchase-orders/**`                     |
| `purchase_orders`          | `admin/purchase-orders/**`                              |
| `quotations`               | `admin/quotations/**`, `admin/standalone-quotations/**` |
| `project_quotations`       | `admin/quotations/**`                                   |
| `proposal_followups`       | `proposals/[id]/followups/**`                           |
| `project_followups`        | `projects/[id]/followups/**`                            |
| `project_invoices`         | `projects/[id]/invoice/**`                              |
| `leads`                    | `leads/**`                                              |
| `proposals`                | `proposals/**`                                          |
| `projects`                 | `projects/**`                                           |
| `companies`                | `companies/**`                                          |
| `users`                    | `users/**`                                              |
| `employees`                | `employees/**`                                          |
| `vendors`                  | `vendors/**`                                            |
| `support_tickets`          | `tickets/**`                                            |
| `expenses`                 | `admin/expenses/**`                                     |
| `other_expenses`           | `admin/other-expenses/**`                               |
| `payment_payables`         | `admin/payment-payables/**`                             |
| `payment_receivables`      | `admin/payment-receivables/**`                          |
| `purchase_invoices`        | `admin/purchase-invoices/**`                            |
| `material_requisitions`    | `admin/material-requisitions/**`                        |
| `follow_ups`               | `followups/**`                                          |
| `software_categories`      | `software-master/**`                                    |
| `softwares`                | `software/**`                                           |
| `software_versions`        | `software-versions/**`                                  |

### Hard delete — critical data (HIGH priority)

| Table | API Route(s) | Delete Pattern |
| ----- | ------------ | -------------- |

### Hard delete — master/utility data (LOWER priority)

> **Note:** `user_activity_assignments` is intentionally excluded from soft-delete conversion. The table uses a sync-replacement pattern (`DELETE FROM ... WHERE project_id = ?` followed by batch INSERT) when saving project activities — this is an atomic rebuild, not a user-facing delete. Adding `isDelete` to this table would require refactoring the sync logic to use UPSERT instead of DELETE+INSERT, which is a larger architectural change beyond the scope of straightforward soft-delete migration.

| Table                                 | API Route(s)                                                 |
| ------------------------------------- | ------------------------------------------------------------ |
| `todos`                               | `todos/route.js`, `admin/todos/route.js`                     |
| `categories` (category_master)        | `masters/categories/route.js`                                |
| `descriptions` (description_master)   | `masters/descriptions/route.js`                              |
| `holidays` (holiday_master)           | `masters/holidays/route.js`                                  |
| `accounts` (account_master)           | `masters/accounts/route.js`                                  |
| `account_heads` (account_head_master) | `masters/account-heads/route.js`                             |
| `roles`                               | `roles/route.js`                                             |
| `activities_master`                   | `activities/route.js`, `activity-master/activities/route.js` |
| `functions_master`                    | `activity-master/route.js`                                   |
| `sub_activities`                      | `activity-master/subactivities/route.js`                     |
| `documents_master`                    | `document-master/route.js`                                   |
| `entity_documents`                    | `document-upload/route.js`                                   |
| `project_documents`                   | `project-docs/route.js`                                      |
| `user_work_logs`                      | `work-logs/route.js`                                         |
| `project_activities`                  | `projects/[id]/activities/route.js`                          |
| `salary_structures`                   | `employees/[id]/salary-structure/route.js`                   |
| `payroll_schedules`                   | `payroll/schedules/route.js`                                 |
| `payroll_slips`                       | `payroll/slips/route.js`                                     |
| `employee_salary_profile`             | `payroll/salary-profile/route.js`                            |
| `da_schedule`                         | `payroll/da-schedule/route.js`                               |
| `attendance_monthly`                  | `attendance/monthly/route.js`                                |

---

## 3. Migration Pattern

Every migration follows the knex pattern:

```
Step 1: Create the migration file
        npm run migrate:make -- <descriptive_name>
Step 2: Write up(knex) and down(knex) in the migration file
        Use knex.schema builder or knex.raw() for DDL
Step 3: Strip DDL from API route (remove CREATE TABLE + ALTER blocks)
Step 4: Update SELECT/UPDATE queries to filter by isDelete = 0 (if applicable)
```

---

## 4. Plan: remove remaining inline DDL from API routes

Since the baseline migration already covers all 110 tables, every inline `CREATE TABLE IF NOT EXISTS` is redundant. Strip it inline when touching a route; no dedicated migration run is needed for removal.

### Phased approach

**Phase 1 — Unguarded (runs on every request):**
Remove DDL from `payroll/salary-profile/route.js` (35+ ALTERs + MODIFYs on every call). This has the highest perf impact.

**Phase 2 — Module-level guard routes (runs once per process):**
Each file below has a `let tableEnsured = false` guard. The DDL fires on the first request per process, then never again. Low risk, low urgency — strip when touching the route:

`attendance/route.js`, `activities/route.js`, `activity-master/route.js`, `messages/route.js`, `masters/holidays/route.js`, `masters/accounts/route.js`, `masters/account-heads/route.js`, `admin/outgoing-quotations/route.js`, `admin/outgoing-purchase-orders/route.ts`, `admin/todos/route.js`, `document-master/route.js`, `document-upload/route.js`, `project-docs/route.js`, `audit-logs/route.js`, `roles/route.js`, `todos/route.js`, `activity-master/subactivities/route.js`, `admin/accounts/route.js`

**Phase 3 — Routes already migrated to schema-init.js (legacy):**
These passed through the old `schema-init.js` pattern. Baseline migration covers the tables; strip DDL as you touch each route:

`petty-cash-expenses/route.ts`, `cash-vouchers/**`, `admin/invoices/**`, `admin/payment-entries/**`, `admin/purchase-orders/**`, `admin/quotations/**`, `admin/standalone-quotations/**`, `proposals/**`, `projects/[id]/**` (followups, invoice, purchase-order, quotation, mom-upload), `admin/payment-payables/**`, `admin/payment-receivables/**`, `admin/material-requisitions/**`, `admin/expenses/**`, `admin/other-expenses/**`, `admin/purchase-invoices/**`, `users/route.js`, `employees/route.js`, `vendors/route.js`, `tickets/route.js`, `settings/profile/route.js`

### What to remove

All of it — the baseline migration guarantees every table and column already exists on all environments (fresh DBs get the migration; prod tables were created years ago).

- **`CREATE TABLE IF NOT EXISTS` blocks** — dead no-ops, remove entirely.
- **`ALTER TABLE` / `MODIFY COLUMN` blocks** — remove them alongside their enclosing `try/catch` or `hasColumn()` guard. Those guards were scaffolding for the pre-knex era; they serve no purpose now.
- **`hasColumn()` runtime checks used for query branching** — these guard logic like "include `isDelete` in WHERE only if the column exists." Since the column always exists post-migration, inline the truth: remove the check and always include the column in the query.

### What NOT to touch in this cleanup

- `src/utils/schema-init.js` — dead but harmless; delete it wholesale in a separate PR rather than inline-editing it across 50 route files.
- DDL in `src/utils/activity-logger.js` — it creates `user_screen_time` at startup. Migrate that table to a knex migration first, then remove the DDL.
