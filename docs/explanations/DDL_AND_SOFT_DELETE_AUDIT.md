# DDL & Soft Delete Audit

> Generated from `src/app/api/` — run `grep` to refresh. State verified 2026-08-04.

**Knex migrations are now the single source of truth for schema.** `schema-init.js` is deprecated. All new DDL goes into `migrations/*.js` (see `AGENTS.md` for commands).

## 1. Inline DDL in API Routes

0 files still run `CREATE TABLE IF NOT EXISTS` and/or `ALTER TABLE` in request handlers (down from 50). The baseline migration below guarantees the schema, so no inline DDL remains.

### Already has a knex baseline migration ✅

All tables are covered by `migrations/20260722080106_baseline_schema.js` (110 tables from prod dump). This ensures tables exist on fresh DBs. Inline DDL in API routes is redundant — strip it as you touch each route.

### Cleaned since the audit ✅

Inline DDL was removed from these routes (previously listed under the schema-init legacy and module-guard tables):

`payroll/salary-profile/route.js` (was the sole Phase-1 unguarded route — CREATE + 35+ ALTERs/MODIFYs stripped, verified against live DB), `activities/route.js` (CREATE ×2 + ALTER `default_manhours` stripped), `attendance/route.js` (CREATE ×2 + ALTER `idle_time` stripped — upsert unique keys verified in baseline), `messages/route.js` (SHOW TABLES + 4 CREATEs + ALTER `receiver_id` stripped — was the top remaining per-request DDL offender), `admin/outgoing-quotations/route.js` (CREATE + 2 ALTER + 2 index migrations stripped; the `unique_active_quotation` composite it used to create at runtime is now a knex migration — `20260804120000_add_unique_active_quotation_index.js`), `admin/outgoing-purchase-orders/route.ts` (CREATE ×2 stripped — `unique_active_po` composite already in baseline, no migration needed), `masters/holidays/route.js` (CREATE ×2 stripped), `petty-cash-expenses/**`, `cash-vouchers/**`, `admin/invoices/**`, `admin/payment-entries/**`, `admin/purchase-orders/**`, `admin/quotations/**`, `admin/standalone-quotations/**`, `proposals/**`, `projects/[id]/**` (followups, invoice, purchase-order, quotation, mom-upload), `admin/payment-payables/**`, `admin/payment-receivables/**`, `admin/material-requisitions/**`, `admin/expenses/**`, `admin/other-expenses/**`, `admin/purchase-invoices/**`, `users/route.js`, `employees/route.js`, `vendors/route.js`, `tickets/route.js`, `followups/route.js`, `software/route.js`, `software-versions/route.js`, `software-master/route.js`, `masters/banks/route.js`, `activity-master/activities/route.js`, `admin/outgoing-purchase-orders/download/route.ts`

Final 14 routes (2026-08-04): `todos/route.js`, `admin/todos/route.js`, `document-master/route.js`, `document-upload/route.js`, `project-docs/route.js`, `masters/accounts/route.js`, `masters/account-heads/route.js`, `admin/accounts/route.js`, `audit-logs/route.js`, `roles/route.js`, `activity-master/subactivities/route.js`, `activity-master/route.js`, `settings/profile/route.js`, `users/[id]/activity-assignments/route.js`. No migrations required — the baseline already covers all tables and unique keys. `support_tickets` enum values and `sub_activities` column types are pre-existing drift (route DDL was always an `IF NOT EXISTS` no-op after baseline) and are unchanged.

### Remaining inline DDL

None remaining.

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

> Some already-soft-deleted tables were upgraded beyond `isDelete` (2026-08-03 migrations): `invoices`, `purchase_invoices`, and `payment_issues` now carry `deleted_at`/`deleted_by` audit columns; `invoices`/`purchase_invoices` uniqueness is re-scoped to active rows via a generated `active_invoice_number` column (removes the `-DEL` rename workaround in the invoices DELETE handler).

### Hard delete — critical data (HIGH priority)

| Table | API Route(s) | Delete Pattern |
| ----- | ------------ | -------------- |

### Hard delete — master/utility data (LOWER priority)

> **Note:** `user_activity_assignments` is intentionally excluded from soft-delete conversion. The table uses a sync-replacement pattern (`DELETE FROM ... WHERE project_id = ?` followed by batch INSERT) when saving project activities — this is an atomic rebuild, not a user-facing delete. Adding `isDelete` to this table would require refactoring the sync logic to use UPSERT instead of DELETE+INSERT, which is a larger architectural change beyond the scope of straightforward soft-delete migration.
>
> `salary_structure_components` is excluded for the same reason — it is rebuilt (DELETE + batch INSERT) whenever a salary structure is saved. The user-facing delete in that flow is `salary_structures` itself, which IS listed below.
>
> `payroll_slips` also has a full-wipe `DELETE FROM payroll_slips` (no WHERE) in the "delete all slips" reset handler.

| Table                                 | API Route(s)                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `todos`                               | `todos/route.js` (`admin/todos/route.js` has no DELETE handler)                                                                    |
| `categories` (category_master)        | `masters/categories/route.js`                                                                                                      |
| `descriptions` (description_master)   | `masters/descriptions/route.js`                                                                                                    |
| `holidays` (holiday_master)           | `masters/holidays/route.js`                                                                                                        |
| `accounts` (account_master)           | `masters/accounts/route.js`                                                                                                        |
| `account_heads` (account_head_master) | `masters/account-heads/route.js`                                                                                                   |
| `roles`                               | `roles/route.js`                                                                                                                   |
| `activities_master`                   | `activities/route.js`, `activity-master/activities/route.js`                                                                       |
| `functions_master`                    | `activity-master/route.js`                                                                                                         |
| `sub_activities`                      | `activity-master/subactivities/route.js`                                                                                           |
| `documents_master`                    | `document-master/route.js`                                                                                                         |
| `entity_documents`                    | `document-upload/route.js`                                                                                                         |
| `project_documents`                   | `project-docs/route.js`                                                                                                            |
| `user_work_logs`                      | `work-logs/route.js`                                                                                                               |
| `project_activities`                  | `projects/[id]/activities/route.js`                                                                                                |
| `salary_structures`                   | `employees/[id]/salary-structure/route.js`                                                                                         |
| `payroll_schedules`                   | `payroll/schedules/route.js`                                                                                                       |
| `payroll_slips`                       | `payroll/slips/route.js`                                                                                                           |
| `employee_salary_profile`             | `payroll/salary-profile/route.js`                                                                                                  |
| `da_schedule`                         | `payroll/da-schedule/route.js`                                                                                                     |
| `attendance_monthly`                  | `attendance/monthly/route.js`                                                                                                      |
| `bank_master`                         | `masters/banks/route.js` — **missed by the original audit**; no `isDelete` column in baseline, hard delete on every DELETE request |

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

Since the baseline migration already covers all 110 tables, every inline `CREATE TABLE IF NOT EXISTS` is redundant. Strip it; no dedicated migration run is needed for removal.

### Phased approach

**Phase 1 — Unguarded (runs on every request):** ✅ COMPLETE — all 13 unguarded routes stripped (`payroll/salary-profile/route.js`, `activities/route.js`, `attendance/route.js`, `messages/route.js`, `admin/outgoing-quotations/route.js`, `admin/outgoing-purchase-orders/route.ts`, `masters/holidays/route.js`, and the 13 single-table CREATE routes listed in Section 1).

**Phase 2 — Guarded (runs once per process):** ✅ COMPLETE — `activity-master/route.js` stripped (module guard, GET wrapper, and POST `functions_master` CREATE removed; defensive try/catches kept).

**Phase 3 — Legacy routes already cleaned:** ✅ COMPLETE — the old schema-init list is done; `settings/profile/route.js` was stripped with Phase 1.

### What to remove

All of it — the baseline migration guarantees every table and column already exists on all environments (fresh DBs get the migration; prod tables were created years ago).

- **`CREATE TABLE IF NOT EXISTS` blocks** — dead no-ops, remove entirely.
- **`ALTER TABLE` / `MODIFY COLUMN` blocks** — remove them alongside their enclosing `try/catch` or `hasColumn()` guard. Those guards were scaffolding for the pre-knex era; they serve no purpose now.
- **`hasColumn()` runtime checks used for query branching** — these guard logic like "include `isDelete` in WHERE only if the column exists." Since the column always exists post-migration, inline the truth: remove the check and always include the column in the query.

### What NOT to touch in this cleanup

- `src/utils/schema-init.js` — dead but harmless; delete it wholesale in a separate PR rather than inline-editing it across 50 route files.
- DDL in `src/utils/activity-logger.js` — it creates `user_screen_time` at startup. **No knex migration exists for `user_screen_time` yet** — create one first, then remove the DDL.

### Follow-ups

- **`hasColumn()` query-branching still live in 4 files:** `analytics/projects/route.js` (`projects.budget`), `projects/route.js` (`company_id`), `projects/[id]/status/route.js` (`project_status`/`status`), `projects/[id]/route.js` (`project_id`/`project_code`). All guarded columns exist in baseline — inline the truth.
- **`users/route.js.backup`** — stale backup containing old CREATE/ALTER/DELETE code for `users`/`roles_master`; delete.
