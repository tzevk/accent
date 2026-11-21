# Browser journeys

A spec proves something a person can do and verify afterward. It is not a list of pages to visit.

Name four things next to each test:

- **Actor:** The signed-in role and the permissions this workflow needs, or an anonymous visitor.
- **Starting state:** What already exists in this test's fixture.
- **Action:** What the person does in the browser.
- **Proof:** What the person can see afterward that would be wrong if the workflow broke.

Keep dependent steps together. Saving a quotation and reopening it are one journey because the proof concerns that save. A read-only view and an unsaved-change warning can start from their own fixtures and fail independently.

## Test at the right layer

Use role, label, text, or an explicit test ID. Use Playwright assertions that wait for the visible result. Avoid sleeps, CSS styling selectors, forced clicks, and first-party API mocks. Seed prerequisites outside the browser, but do the action under test in the browser. For financial or persistence outcomes, check the visible result after a fresh read and inspect the saved rows independently.

Keep rounding combinations in unit tests, authorization decisions at the API, and race conditions against MariaDB. A browser test can still cover one representative permission outcome when the visible response matters. Use isolated data and ordinary test accounts. Do not use operational data or bypass authentication.

See [Playwright best practices](https://playwright.dev/docs/best-practices), [the TodoMVC examples](https://github.com/microsoft/playwright/tree/main/examples/todomvc), and [Accent verification rules](../CODING_STANDARDS.md#testing-and-verification).

## Runtime

GitHub Actions owns routine browser verification. `npm run test:e2e` covers the maintained suite through the owned runtime. See [local database operations](../docs/agents/local-database.md#authorized-local-debugging) for approved focused debugging.

For a full run, register each spec exactly once in [`groups.ts`](../scripts/e2e/groups.ts). A group uses a fresh disposable database and app server. Count the signed-out requests to the auth endpoint across its tests. Four planned attempts leave room for a retry of each test and the harness's startup login. Keep the real rate limiter enabled.

The test server uses Webpack because the default development bundler intermittently returned 404 for existing routes in CI. CI verifies the production build separately.

The CI artifact contains a separate HTML report and failure traces for each group under `e2e/artifacts/groups/`. A focused local run keeps the existing `npm run test:e2e:report` path.

## Maintained outcomes

| Spec                                                                                                                                               | Visible proof                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Session](specs/session.spec.ts)                                                                                                                   | A user signs in and sees the employee dashboard. Signed-out reentry returns to sign-in, and an employee without admin access returns to their own dashboard. |
| [Quotation](specs/quotation.spec.ts)                                                                                                               | The creator reopens the saved quotation from the register and sees the same client, scope line, and tax totals.                                              |
| [Cash voucher](specs/cash-voucher.spec.ts)                                                                                                         | The creator reopens the voucher and sees the same payee, bill number, rupees, paise, and total.                                                              |
| [Lead conversion](specs/lead-conversion.spec.ts)                                                                                                   | The Lead owner's conversion opens the linked Proposal. The reopened Lead links to that same Proposal.                                                        |
| [Payroll review](specs/payroll-review.spec.ts)                                                                                                     | Current attendance and recorded slip amounts stay distinct in the company sheet and slip document.                                                           |
| [Salary profile lifecycle](specs/salary-profiles.spec.ts)                                                                                          | An editor creates and corrects an agreement, generates payroll, and revises the agreement without repricing the earlier slip.                                |
| [Salary profile access](specs/salary-profile-access.spec.ts)                                                                                       | A reader sees used history without write controls. Independent tests prove zero CTC and the unsaved-draft guard.                                             |
| [Company and Vendor](specs/company-vendor.spec.ts)                                                                                                 | Creators can reopen the saved contact data and the Vendor's Basic, Contact, and Financial details.                                                           |
| [Lead work](specs/lead-work.spec.ts)                                                                                                               | A creator reopens a new enquiry at the expected stage. An owner can see the recorded call and dated next action.                                             |
| [Tickets](specs/tickets.spec.ts) · [Work logs](specs/work-logs.spec.ts)                                                                            | Requests, replies, status updates, and independently edited or deleted logs survive reopening.                                                               |
| [Messages](specs/messages.spec.ts) · [Monitoring](specs/monitoring.spec.ts)                                                                        | The sender sees the recipient's reply. Operators can open the selected activity dashboard and inspect saved audit evidence.                                  |
| [Personal tasks](specs/personal-tasks.spec.ts) · [Ledger](specs/accounts-ledger.spec.ts)                                                           | A saved task reappears after reload, and a completed task leaves the pending list. An accounts reader can download the selected receipt.                     |
| [Project policy](specs/project-lead-policy.spec.ts) · [Project budget](specs/project-budget.spec.ts)                                               | A section restriction applies to a Project Lead. An approved budget shows the matching cost and remaining amount.                                            |
| [Project workspace](specs/project-workspace.spec.ts) · [Proposal handoff](specs/proposal-project.spec.ts)                                          | A creator reopens the saved Project. A Project Lead verifies changes and grants a team member access. A converted Proposal opens its linked Project.         |
| [Orders](specs/orders.spec.ts) · [Supplier invoice](specs/supplier-invoice.spec.ts)                                                                | A client order retains its terms, a supplier commitment shows its remaining value, and recognition matches the recorded cost.                                |
| [Sales](specs/sales-invoice.spec.ts) · [Register](specs/sales-register.spec.ts) · [Payments](specs/payment-workflows.spec.ts)                      | An invoice reopens from the register, links open the selected document, and a posted receipt reduces the customer balance.                                   |
| [Expense recognition](specs/expense-recognition.spec.ts) · [Petty cash](specs/petty-cash-spend.spec.ts)                                            | A recognized cost counts once in its month. A supported petty cash spend does not turn its funding into cost.                                                |
| [Financial close](specs/financial-close.spec.ts) · [Expenditure evidence](specs/expenditure-evidence.spec.ts)                                      | Closed figures stay frozen, a revision keeps the original, a settlement changes cash rather than cost, and the export matches the month.                     |
| [Attendance](specs/attendance.spec.ts) · [Holiday](specs/holiday.spec.ts) · [Leave](specs/leave-workflows.spec.ts)                                 | Saved attendance matches its report and export. Holiday and leave decisions appear in the relevant attendance or leave views.                                |
| [Own timesheet](specs/employee-time.spec.ts) · [Timesheet report](specs/timesheet-report.spec.ts) · [Utilization](specs/workforce-reports.spec.ts) | The chosen employee and month show matching hours or project detail. The utilization workbook carries the selected evidence.                                 |
| [Payroll run](specs/payroll-run.spec.ts) · [Rates](specs/payroll-rates.spec.ts) · [Payslip](specs/employee-payslip.spec.ts)                        | Finalization locks the roster; payment records the chosen date; rates reopen; the employee can download their paid Payslip.                                  |
| [User administration](specs/user-administration.spec.ts) · [Account access](specs/account-access.spec.ts) · [Roles](specs/roles.spec.ts)           | A created account opens its permission editor, saved grants reopen, disabled sign-in fails, and the reset password works.                                    |
| [Profile and dashboard](specs/profile-dashboard.spec.ts)                                                                                           | The account's saved email reopens. The linked employee sees their attendance and can open their timesheet.                                                   |

[Salary contention](specs/salary-contention.spec.ts) runs in the same harness but checks real database transactions without a browser.

## Boundaries

- Do not add browser scenarios for each tax rate, date combination, permission flag, or write race. Those belong to unit, HTTP contract, or MariaDB transaction tests.
- Cover shared form behavior once at its common component boundary. Cover distinct business outcomes separately, even if they use the same page.
- Redirect aliases are not separate business journeys. Test the destination as part of the workflow when it affects the result.
- Do not seed a super-admin to reach super-admin-only journeys in this harness. Keep those authorization and command contracts at the appropriate lower layer.
- The Material Requisition register links to detail and edit pages that do not exist. A create test cannot prove those paths work.
- The Project editor renders an Add Day control only for a tab missing from its tab registry. The browser can verify saved timesheet data, but it cannot enter hours through that hidden path.
- Completing the last pending personal task removes the control that shows completed tasks. The current journey verifies its removal from pending and its saved completion; it does not claim completed-list coverage.
- Project creation can reopen the saved record from the Projects list. Its automatic redirect reads `id`, but the write returns `project_id`.
- Client Balance shows invoice numbers as text. The invoice-document journey follows the link from Outstanding Balances instead.
- The expanded desktop sidebar can cover the Messages compose button. The journey uses the visible Toggle Sidebar control before composing.
