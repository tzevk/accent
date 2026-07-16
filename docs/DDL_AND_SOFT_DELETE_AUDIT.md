# DDL & Soft Delete Audit

> Generated from `src/app/api/` — run `grep` to refresh.

## 1. Inline DDL in API Routes

50 files run `CREATE TABLE IF NOT EXISTS` and/or `ALTER TABLE` in request handlers instead of at server startup via `schema-init.js`.

### Already migrated to `schema-init.js` ✅

| API Route                            | Tables Previously Created/Altered                                        |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `petty-cash-expenses/route.ts`       | `petty_cash_expenses` (DDL + ensureTable)                                |
| `petty-cash-expenses/[id]/route.ts`  | — (no DDL, just added isDelete guard)                                    |
| `cash-vouchers/route.js`             | `cash_vouchers` (CREATE + ALTER), `petty_cash_expenses` (CREATE + ALTER) |
| `cash-vouchers/[id]/route.js`        | — (no DDL, just cascade soft-delete)                                     |
| `cash-vouchers/next-number/route.js` | `cash_vouchers` (CREATE)                                                 |
| `admin/invoices/route.js`            | `purchase_orders`, `invoices` (DDL + isDelete)                           |
| `admin/invoices/[id]/route.js`       | `purchase_orders`, `invoices` (DDL + isDelete)                           |
| `admin/invoices/download/route.js`   | `purchase_orders`, `invoices` (DDL + isDelete)                           |
| `admin/invoices/po-balance/route.js` | `purchase_orders`, `invoices` (DDL + isDelete)                           |
| `admin/payment-entries/route.js`     | `payment_entries` (CREATE + 11 ALTER + INDEX)                            |

### Unguarded — runs on EVERY request (HIGH priority)

| File                                        | Tables Created/Altered                                          |
| ------------------------------------------- | --------------------------------------------------------------- |
| `admin/purchase-orders/route.js`            | `purchase_orders` (8+ ALTER + INDEX)                            |
| `admin/quotations/route.js`                 | `quotations`, `project_quotations`                              |
| `admin/quotations/[id]/route.js`            | `proposals`, `project_quotations`, `quotations` (26 ALTER each) |
| `admin/quotations/[id]/project/route.js`    | `quotations`                                                    |
| `admin/standalone-quotations/route.js`      | `quotations` (48 ALTER + MODIFY + INDEX)                        |
| `admin/standalone-quotations/[id]/route.js` | `quotations` (48 ALTER + MODIFY + INDEX)                        |
| `proposals/route.js`                        | `proposals` (38 ALTER via `ensureProposalColumns()`)            |
| `proposals/[id]/route.js`                   | `proposals`, `projects` (39+ ALTER)                             |
| `projects/[id]/route.js`                    | `projects`, `user_activity_assignments` (12+ ALTER)             |
| `employees/route.js`                        | `employees` (14+ ALTER + MODIFY)                                |
| `payroll/salary-profile/route.js`           | `employee_salary_profile` (35+ ALTER + MODIFY)                  |
| `vendors/route.js`                          | `vendors` (24 ALTER)                                            |

### Has module-level guard — runs at most once per process (LOWER priority)

| File                                               | Tables Created/Altered                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `tickets/route.js`                                 | `support_tickets`, `ticket_comments`                                       |
| `users/[id]/activity-assignments/route.js`         | `support_tickets`                                                          |
| `followups/route.js`                               | `follow_ups`                                                               |
| `attendance/route.js`                              | `employee_attendance`, `employee_attendance_summary`                       |
| `activities/route.js`                              | `functions_master`, `activities_master`                                    |
| `activity-master/route.js`                         | `functions_master`, `activities_master`                                    |
| `users/route.js`                                   | `users`, `roles`                                                           |
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
| `projects/[id]/invoice/route.js`                   | `project_invoices`                                                         |
| `projects/[id]/followups/route.js`                 | `project_followups`                                                        |
| `projects/[id]/purchase-order/route.js`            | `project_purchase_orders`                                                  |
| `projects/[id]/quotation/route.js`                 | `project_quotations`                                                       |
| `proposals/[id]/followups/route.js`                | `proposal_followups`                                                       |
| `admin/accounts/route.js`                          | `account_transactions`                                                     |
| `admin/purchase-invoices/route.js`                 | `purchase_invoices`                                                        |
| `settings/profile/route.js`                        | `employees`                                                                |
| `activity-master/subactivities/route.js`           | `sub_activities`                                                           |
| `activity-master/activities/route.js`              | `activities_master`                                                        |
| `admin/purchase-orders/download/route.js`          | — (only queries with isDelete check)                                       |
| `admin/outgoing-purchase-orders/download/route.ts` | — (only queries with isDelete check)                                       |

---

## 2. Soft Delete Audit

Tables are listed if they use hard `DELETE FROM ... WHERE id = ?` in any API route. The `isDelete TINYINT(1) NOT NULL DEFAULT 0` column + migration + query changes are needed.

### Already has `isDelete` ✅

| Table                      | API Route(s)                        |
| -------------------------- | ----------------------------------- |
| `cash_vouchers`            | `admin/cash-vouchers/**`            |
| `invoices`                 | `admin/invoices/**`                 |
| `petty_cash_expenses`      | `admin/petty-cash-expenses/**`      |
| `payment_entries`          | `admin/payment-entries/**`          |
| `outgoing_quotations`      | `admin/outgoing-quotations/**`      |
| `outgoing_purchase_orders` | `admin/outgoing-purchase-orders/**` |
| `purchase_orders`          | `admin/purchase-orders/**`          |
| `leads`                    | `leads/**`                          |
| `proposals`                | `proposals/**`                      |
| `projects`                 | `projects/**`                       |

### Hard delete — critical data (HIGH priority)

| Table | API Route(s) | Delete Pattern |
| ----- | ------------ | -------------- |

| `companies` | `companies/[id]/route.js` | `DELETE FROM companies WHERE id = ?` |
| `users` | `users/route.js`, `users/[id]/route.js` | `DELETE FROM users WHERE id = ?` |
| `employees` | `employees/[id]/route.js` | `DELETE FROM employees WHERE id = ?` |
| `vendors` | `vendors/[id]/route.js` | `DELETE FROM vendors WHERE id = ?` |
| `support_tickets` | `tickets/[id]/route.js` | `DELETE FROM support_tickets WHERE id = ?` |
| `expenses` | `admin/expenses/[id]/route.js` | `DELETE FROM expenses WHERE id = ?` |
| `other_expenses` | `admin/other-expenses/[id]/route.ts` | `DELETE FROM other_expenses WHERE id = ?` |
| `payment_payables` | `admin/payment-payables/[id]/route.js` | `DELETE FROM payment_payables WHERE id = ?` |
| `payment_receivables` | `admin/payment-receivables/[id]/route.js` | `DELETE FROM payment_receivables WHERE id = ?` |
| `purchase_invoices` | `admin/purchase-invoices/[id]/route.js` | `DELETE FROM purchase_invoices WHERE id = ?` |
| `material_requisitions` | `admin/material-requisitions/route.js` | `DELETE FROM material_requisitions WHERE id = ?` |
| `follow_ups` | `followups/[id]/route.js` | `DELETE FROM follow_ups WHERE id = ?` |
| `project_followups` | `projects/[id]/followups/route.js` | `DELETE FROM project_followups WHERE id = ?` |
| `project_invoices` | `projects/[id]/invoice/route.js` | `DELETE FROM project_invoices WHERE id = ?` |
| `proposal_followups` | `proposals/[id]/followups/route.js` | `DELETE FROM proposal_followups WHERE id = ?` |
| `user_activity_assignments` | `users/[id]/activities/route.js`, `projects/[id]/assign-activities/route.js` | `DELETE FROM user_activity_assignments WHERE id = ? AND ...` |
| `softwares` | `software/route.js` | `DELETE FROM softwares WHERE id = ?` |
| `software_versions` | `software-versions/route.js` | `DELETE FROM software_versions WHERE id = ?` |
| `software_categories` | `software-master/route.js` | `DELETE FROM software_categories WHERE id = ?` |

### Hard delete — master/utility data (LOWER priority)

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

Every migration follows the 4-step pattern established with `petty_cash_expenses`:

```
Step 1: Add init{TableName}Table(db) to schema-init.js
Step 2: Add it to doSchemaInit() Promise chain
Step 3: Strip DDL from API route (remove CREATE TABLE + ALTER blocks)
Step 4: Update SELECT/UPDATE queries to filter by isDelete = 0
```
