# Accent

Accent is a CRM and HR platform for leads, projects, and monthly payroll for payroll and contract staff.

## Language

**Employee**:
A person employed by the company, stored in `employees`. Linked to a `users` account via `employee_id` when they need system access.
_Avoid_: User, Staff, Resource

**Employee Type**:
The employment category on the Employee record, `employees.employee_type`: `Payroll`, `Contract`, `Deputation`, `Permanent`, `Intern`, or NULL (never set). A directory grouping — how the person is filed in the company — and not a pay instruction: the pay stream an Employee is paid through is their Salary Type, which lives on the Salary Profile, and payroll decides stream membership there (ADR-0015). The Attendance report and the Employee Utilization report are the readers that filter on this field (`employee_type = 'Payroll'`), which is why a `Deputation` or unset employee never appears on their rosters: Attendance uses the as-of-today roster, Utilization the Payroll Roster scoped to the viewed month by the employment window. The field is read as of today — never time-traveled — so a retyped employee is not re-filed in past months.
_Avoid_: Employment status, Worker type, Salary Type

**Payroll Roster**:
The set of Employees a workforce report covers — live Employee records (`isDelete = 0`) with `employee_type = 'Payroll'`. The Employee Utilization report scopes it to the viewed month: the employment window must intersect that month, so a leaver stays visible in the months they worked and a joiner is absent before they joined. The window's evidence bounds are the min/max across all four dated sources — `employee_attendance`, Logged Hours, `user_screen_time` and `user_activity_logs` (the last two mapped through the user account) — not a source-priority chain; `status` never disqualifies there, and the non-Payroll/unset employees considered for the month are counted in an exclusion disclosure (bucketed by Employee Type value, absent when nothing was dropped) rather than silently hidden. The Attendance report keeps the as-of-today variant — `status = 'active'` on top of the live Payroll type (ADR-0015). Neither roster reads Salary Type: an Employee with no Salary Profile is still on it.
_Avoid_: Active employees, Payroll staff (when meaning this roster), Headcount

**Salary Type**:
Which pay stream an Employee is paid through, held on the pay agreement: `employee_salary_profile.salary_type` — `monthly`, `hourly`, `daily`, `contract`, `lumpsum`, `custom` (`payroll` is the query selector for everything that is not `contract`; legacy `salary_structures.pay_type` is its read-only predecessor). Payroll decides stream membership on this field, never on the Employee record: `salary_type = 'contract'` EXISTS for the contract stream, NOT EXISTS for the payroll stream. So a `Payroll`-typed Employee with no Salary Profile belongs to neither stream and silently vanishes from a payroll run while still appearing on the Attendance report's roster (ADR-0015).
_Avoid_: Employee Type, Employment status, Pay type

**Salary Profile**:
The employee's current pay agreement — gross, derived allowances (basic/da/hra/conveyance/call allowance), applicability flags (PF/ESIC/PT/MLWF/retention/bonus/incentive/insurance), and PL/loan/advance. The input to payroll. Canonical table is `employee_salary_profile`.
_Avoid_: Salary Structure, Compensation, Package

**Salary Structure** (legacy):
An earlier 25-column pay agreement in `salary_structures` (+ `salary_structure_components`). Superseded by Salary Profile; kept as read-only fallback until migration. Do not write new rows from payroll UI.
_Avoid_: Salary Profile (when meaning the legacy table)

**Payroll Slip**:
A computed monthly instance for one employee and month (YYYY-MM-01) — earnings, deductions, net pay, employer cost, attendance snapshot, and the hours basis it was priced with (CTC, Basis Hours, Hourly Rate, Logged Hours). Stored in `payroll_slips` (UNIQUE month+employee), produced by `computePayroll`/`generatePayrollSlip`. The employee's own view of them is "My Payroll Slips". It is a snapshot: every reader shows its stored figures (`slipFigures`), a later Salary Profile revision never re-prices a past month, and only the month's DA Component Rate stays authoritative (ADR-0009).
_Avoid_: Payslip, Salary Slip, Payroll Record — the self-service path segment `/api/me/payslips` is a kept exception (a URL, not a name for the entity)

**Payroll Run**:
The month-level lifecycle record for one pay period (month/year) — starts `draft`, becomes `finalized`, which locks its slips against regeneration; only a super-admin can reopen a finalized run, and only while no slip in the month is `paid`. Payment is tracked per-slip, not on the run: the run's `paid` state is derived (every slip of the month paid), never a stored transition. Canonical table `payroll_runs`.
_Avoid_: Month (ambiguous), Pay cycle, Batch

**Component Rate** (was "Payroll Schedule"):
The versioned rate for a statutory or allowance component (DA, PT, MLWF, bonus, incentive, insurance) with `component_type`, `value`/`value_type`, and `effective_from`/`effective_to`. Canonical table is `payroll_schedules` — the single source for ALL component rates, incl. DA (legacy `da_schedule` retired). Served under `/admin/payroll/rates`.
_Avoid_: Payroll Schedule (collides with pay-period cadence), Config, Slab

**DA** (Dearness Allowance):
The inflation-linked component of Basic+DA, read from `payroll_schedules` (component*type `da`) everywhere.
\_Avoid*: Allowance without qualifier

**Gross**:
The month's earnings before deductions — Hourly Rate × Logged Hours, from which
basic+da+hra+conveyance+call*allowance+other_allowances+bonus+incentive are
derived. Never the Salary Profile's agreed `gross_salary`, and never CTC itself.
\_Avoid*: CTC, Basic, Salary (ambiguous)

**CTC**:
Cost to company — the monthly pay base in `employee_salary_profile.employer_cost`
(falling back to `gross_salary`, then `gross`). Apportioned over the month's
Basis Hours to give the Hourly Rate (ADR-0010); the employer contributions it
adds (PF/ESIC employer, gratuity, insurance) stay display-only.
_Avoid_: Gross, Package

**Basis Hours**:
The payroll month's payable hours — working days (Sundays and active
`holiday_master` dates excluded) × the Salary Profile's `std_hours_per_day`
(default 8). The divisor that turns the month's CTC into its Hourly Rate.
_Avoid_: Standard hours, Capacity (that is net of leave)

**Hourly Rate**:
CTC ÷ Basis Hours. Gross is Hourly Rate × Logged Hours; the slip stores the
two-decimal rate it printed while the money math uses the unrounded value.
_Avoid_: Rate (unqualified)

**Leave Application**:
An employee's request for time off with a start date, end date, type, reason, and status (`pending`, `approved`, or `rejected`). One employee can never hold two intersecting `pending`/`approved` applications — the server rejects that as its own overlap.
_Avoid_: Leave (ambiguous), Overlapping leaves (when meaning one person's own collision)

**Leave Overlap**:
Two or more _different_ employees whose `pending` or `approved` applications intersect on at least one calendar date. `rejected` applications never count toward an overlap.
_Avoid_: Concurrent Leave

**Capacity**:
Net available working hours for an Employee in a period — 8h per working day (excluding Sundays, 2nd/4th Saturdays, and active non-optional `holiday_master` dates — an optional holiday is a working day), minus approved leave (8h per full day, 4h per half-day).
_Avoid_: Expected hours, Standard hours (ambiguous), Bandwidth

**Logged Hours**:
Sum of `user_activity_assignments.daily_entries.hours` (`actual_hours`) entered via Project Activity Assignments, including overtime. The billed-effort truth for utilization, and the payroll numerator: Gross = Hourly Rate × Logged Hours (ADR-0010); never `planned_hours`/`estimated_hours`.
_Avoid_: Manhours (ambiguous), Planned hours, Assigned hours

**Utilization**:
`total_logged / capacity × 100` per employee per month. Under <80%, healthy 80–100%, over >100%. Answers whether an Employee is underworked or overworked.
_Avoid_: Attendance %, Allocation %, Productivity

**Monthly Cost**:
CTC-based monthly price of an Employee — `employee_salary_profile.employer_cost` (stored CTC), falling back to `gross_salary` then `gross`. Profile picked by `pickActiveProfile` (effective-range cover, else latest active). In the Employee Utilization report a month the employment window only partly covers is pro-rated by employed working days ÷ the month's working days, 2dp — a full-month window reproduces the full CTC, and the row is marked partial ("Partial (window)") with the covered dates.
_Avoid_: Gross, Salary (ambiguous), Hourly rate

**Company Incurred Cost**:
Operating cost recognized for the company in a period, whether paid or unpaid. Includes direct Project costs, Company Overhead, and Unallocated Cost, each counted once.
_Avoid_: Cash paid, Sum of Project totals, PO value

**Company Overhead**:
Shared operating cost deliberately classified as not directly attributable to one Project. Distinct from a cost whose Project is unknown.
_Avoid_: Unallocated Cost, Bench Cost, Missing project

**Unallocated Cost**:
Recognized cost awaiting reliable classification as a direct Project cost or Company Overhead. Includes Unallocated Employee Cost and non-employee cost awaiting classification.
_Avoid_: Company Overhead, Bench Cost, Zero cost

**Cost Accrual**:
Estimated cost for goods or services already received but not yet invoiced. The related invoice replaces the estimate rather than creating a second cost.
_Avoid_: Supplier commitment, Advance, Forecast cost

**Cost Identity**:
The stable `cost_uid` of one underlying cost, minted when the cost is captured and carried by every later source reference, command, and revision. One underlying cost has one identity whichever workflow recorded it; the expense number stays a display and search reference.
_Avoid_: Expense number (when meaning identity), Row id, Document number

**Non-operating Item**:
A recorded spend whose nature is an advance, deposit, prepayment, or capital item (`expenses.cost_nature`), rather than operating cost. Its payment or invoice is a balance, not Company Incurred Cost; it is shown separately with its identity, amount, currency/tax basis, evidence, and unconsumed amount. A treatment that is still undecided stays explicitly unresolved and is also excluded from operating cost.
_Avoid_: Operating cost, Fixed asset register, Capitalization decision

**Period Charge**:
An approved, evidenced consumption, depreciation, or amortization of a Non-operating Item's supported balance, dated in its own month (`expense_period_charges`). Only an approved charge becomes Company Incurred Cost, in that month, with the item's destination and currency. One item month and basis holds one approved charge, and the approved charges never exceed the item's confirmed balance; cancelling a charge is reasoned, versioned, and restores the balance.
_Avoid_: Depreciation schedule, Automatic amortization, Payment

**Recognition Period**:
The month a cost belongs to (`recognition_period`, as its first day), with `period_basis` saying how it was established. It comes from the received-work/service period, or from the bill date as a disclosed fallback; an order date or a payment date never sets it.
_Avoid_: Invoice month, Payment month, Accounting period

**Recognition State**:
A direct cost's financial state — `draft`, `pending_evidence`, `recognized`, `rejected`, or `cancelled`. Only `recognized` is confirmed cost, and only an authorized recognize command sets it. It is not the expense register's `status`, so approving a register row does not create cost.
_Avoid_: Expense status, Approval status, Paid

**Supplier Cost**:
The recognized cost of one supplier invoice — the single liability for the goods or services received. A payable follow-up, a receipt copy, or a later payment references this one cost; none of them creates another. Its gross liability, transaction currency, tax treatment, and evidence stay on the invoice, and its Recognition Period comes from the service period (the invoice date only as a disclosed fallback).
_Avoid_: Payable amount, Payment, Receipt copy

**Service-Period Slice**:
One received-work period's share of a supplier invoice that covers several periods (`supplier_invoice_periods`). The slices total the invoice gross exactly, each month counts only its own slice, and recognition is refused while they do not total it. A slice is never a second cost.
_Avoid_: Partial invoice, Split payment, Duplicate invoice

**Financial Cost Link**:
A durable, reviewed mapping from a foreign row (payable, receipt copy, settlement, funding event) to a cost's `cost_uid`, held in `financial_cost_links` with a role, a basis, and a review state. Only confirmed links are authoritative; a text candidate stays pending review and never merges identity or totals.
_Avoid_: Duplicate expense, Auto-match, Journal entry

**Incurred Project Cost**:
Employee cost and non-employee expenses recognized for a Project in a period, whether paid or unpaid. Excludes unfulfilled supplier commitments and client order value.
_Avoid_: Cash paid, PO value, Total committed exposure

**Comparable Period**:
The prior period a month is measured against. A month that has fully elapsed is compared with the whole prior month — so June against May includes 31 May even though June has 30 days. An unfinished month is compared over equivalent elapsed service periods: the first N days of both months, where N is the day the month is measured to (`as_of`, today by default) and the prior window is clamped to the prior month's length — a clamped window is disclosed as unequal. A cost is inside the window only when its received-work period is fully dated and wholly inside it — start and end in the window's own month, with the end on or before the window's last day; a period crossing the cutoff, a period starting in the prior month, and a bill-date-only period are unproven: never prorated, never counted by their first day, and the change they would distort is withheld (`unproven`, disclosed as `window_evidence_unproven`). Approved period charges and recorded employee cost are day-less monthly cost the window cannot place either, so they are disclosed as `dayless_monthly_cost_unproven` and withhold the change. Late entries (entered after the window closed), backdated recognition, and unequal coverage between the two windows are disclosed with the comparison, and a Project with no prior-period record has an unknown prior amount, never a zero.
_Avoid_: Prior month (when the window may be partial), Budget, Full prior period

**Cost to Date**:
Cumulative confirmed cost of every month before the reported one plus the reported window, so it is stated through the window's last day rather than the month's. A contributing unknown amount makes it unknown (`null`), not zero.
_Avoid_: Lifetime cost, Total commitment, Budget consumed

**Project Cost Ranking**:
The report's two orderings of the same Project rows inside one currency: largest monthly incurred cost, and largest change against the Comparable Period. A row whose comparison amount is unknown is not placed by increase — it is reported as unranked with its reason. Ties share a position.
_Avoid_: Sort order, Priority, Importance

**Outstanding Supplier Commitment**:
The portion of a supplier order not yet recognized as incurred cost. Paying a supplier invoice does not itself create another incurred cost.
_Avoid_: Unpaid invoice balance, Client PO balance, Cash paid

**Outward Cash Paid**:
Dated supported third-party money out in a month (`cash` on the reconciliation): recorded settlements, native payroll payouts, and dated petty-cash spending, each counted once by canonical movement identity (`settle:<uid>`, `payroll:<slipId>`, `petty:<rowId>`). Bank-into-float funding is one internal movement per voucher (`fund:<voucherId>`) shown outside paid. Client receipts, internal transfers, undated balances, and unlinked free-text rows are disclosed as legacy evidence, never counted.
_Avoid_: Company Incurred Cost, Funding, Client receipts, Current balance

**Outward Settlement**:
One dated outward movement against a canonical cost or payroll slip identity (`financial_settlements`, idempotent `settle-<uuid>`), with amount, currency, cash date, reference, destination, actor, and version. Withholdings and deductions remit against the same liability without reducing its cost. A manual settlement never restates a native movement (payroll payout, petty spend, funding). Corrections are versioned commands with history, never edits or deletes.
_Avoid_: Second expense, Payroll payout (when meaning the native one), Funding

**Petty Cash Funding**:
Cash moved into the petty-cash float — one cash voucher (`cash_vouchers`) and its mirrored credit row in `petty_cash_expenses` are one funding event. Cash movement only: neither the voucher total nor the mirrored credit is operating cost. The pair carries a funding-event identity (`fund-<voucher>`, never a Cost Identity), and repeat mirroring updates that one row.
_Avoid_: Petty cash expense, Petty cash cost, Advance

**Petty Cash Spend**:
Actual petty-cash spending — one debit row in `petty_cash_expenses` with its own Cost Identity, Recognition Period, approval state, and Project / Company Overhead / Unallocated classification. Spending creates cost once; a receipt already linked to another cost (`linked_cost_uid`) settles that cost instead of creating a second one, and missing voucher or Project linkage stays disclosed rather than inferred from free text.
_Avoid_: Petty cash funding (the voucher side), Cash balance, Payment

**Remaining Supported Funding**:
Petty-cash funding dated in a period minus the spending drawn from vouchers in that period. Spending with no voucher linkage is cost but reduces no funding; unspent funding is never operating cost.
_Avoid_: Petty cash balance, Cash in hand, Unspent expense
**Order**:
A client or supplier commitment with one **explicit** direction — `client` or `supplier` — stored in `orders`, identified by `order_uid`, and carrying its counterparty, Project, currency, tax/amount basis, order date, source document, status, and firm/cancellable evidence. The order number is a display and search attribute, never the identity: the same number may name two different orders.
_Avoid_: Purchase order (when direction is unknown), PO, Commitment

**Client Order**:
An Order with direction `client` — commercial context for a Project. Its value is never incurred cost, supplier commitment, or recognized revenue; a client invoice may reference one, and its invoiced value rolls up on the order.
_Avoid_: Sales order (when meaning an Order), Client PO value, Revenue

**Supplier Order**:
An Order with direction `supplier`. Its value is an Outstanding Supplier Commitment, not incurred cost; recognized goods or services consume it.
_Avoid_: Purchase order (when direction is unknown), Supplier cost, Expense

**Order Identity**:
The stable `order_uid` minted when one underlying order is captured; every later reference — invoices, documents, consumption — carries it. The document number stays a display and search attribute.
_Avoid_: PO number (when meaning identity), Row id, Document number

**Legacy Order Copy**:
An order representation left in a pre-canonical store (`purchase_orders`, `outgoing_purchase_orders`, `project_purchase_orders`, or a `project_invoices` row with `tab_type = 'purchase_order'`). It carries no reliable direction, so it is queued in `order_legacy_mappings` until a document-backed, versioned review classifies, links, or marks it a duplicate representation. Table names, counterparty text, and client-invoice links are not direction evidence, and a shared document number is not proof of one order.
_Avoid_: Duplicate order (when unresolved), Old PO, Archived order

**Project Employee Cost**:
The share of an Employee's recorded monthly payroll employer cost, including earnings and employer contributions, attributed to a Project by its share of the Employee's Logged Hours. Excludes project expenses and supplier costs; it is not a measure of cash paid.
_Avoid_: Total project expenditure, Total project cost, Project payments

**Unallocated Employee Cost**:
Recorded payroll employer cost that cannot be attributed to a Project. Includes the share for Logged Hours without a Project and the full cost of an Employee with no Logged Hours; it is not Bench Cost.
_Avoid_: Bench Cost, Zero project cost, Missing salary

**Project Cost Allocation Revision**:
An explicit correction to how finalized employee payroll cost is attributed to Projects. Preserves the previous attribution and the reason for the correction; it does not itself change the employee's payroll cost.
_Avoid_: Payroll correction, Timesheet edit, Payroll regeneration

**Project Cost Allocation Reconstruction**:
A one-time rebuild of a finalized Payroll Slip's Project attribution from its recorded employer cost and the available monthly Logged Hours, for slips that predate saved allocations. Stored as a proposal until a reviewer approves it; the result is labelled reconstructed and never presented as the original finalization-time attribution.
_Avoid_: Payroll repricing, Salary Profile estimate, Original allocation

**Bench Cost**:
`monthly_cost − Hourly Rate × logged_hours` — Monthly Cost (pro-rated for a partial window, see above) minus the utilized figure, priced with the same CTC ÷ Basis Hours rate a Payroll Slip pays with (ADR-0010), so the report reconciles with the slips. The utilized figure plus Bench Cost foots to Monthly Cost per row and in totals (overload may read negative); a row without a covering Salary Profile shows blank cost, never zero.
_Avoid_: Fractional cost, Loss, Waste

**Weekly Off**:
A scheduled non-working day — every Sunday plus the 2nd and 4th Saturdays of the month. Stored as attendance status `WO`.
_Avoid_: Weekend, Holiday, Sunday-off

**Sandwich**:
A Weekly Off or Holiday run bracketed by leave on both sides inside one continuous absence — each bracketed day is deducted as leave. Canonical: Sat leave + Sun WO + Mon leave → Sun deducted.
_Avoid_: Sandwich holiday, Bridge leave

**Punch**:
A single biometric check-in/out event captured by a Smart Office device, stored in `attendance_logs` under the device's employee code and attributed to an Employee at ingest (see Device Code). Direction may be inferred when the device doesn't report one.
_Avoid_: Attendance log (ambiguous), Log entry, Scan

**Device Code**:
The code a Punch arrives under (`attendance_logs.employee_code`) and the code an Employee is enrolled under (`employees.smartoffice_code`) — the same namespace, matched at ingest, which stamps the Punch's employee (`attendance_logs.employee_id`). Attribution is fixed when the Punch is stored: re-enrolment changes future matches only, and every reader counts a Punch by its stamped employee, never by the code written on it.
_Avoid_: Employee Code (unqualified — `employees.employee_id` also carries that name), Smart Office code (names the column, not the concept)

**Time Present**:
The measured office-presence duration for one Employee on one day — the day's last Punch minus its first, ignoring the Punches in between. Direction-agnostic (real devices report no direction, so direction is not evidence) and pooled across devices, so one accidental middle Punch can neither shorten nor lengthen the day. A shift crossing midnight counts on the day it began: a next-day Punch joins the day only when it is chronologically after that day's last Punch and within 12 hours of the day's first, and a merged Punch is consumed, so no Punch is ever counted for two days. A day with a single Punch is uncomputable and shows an em dash, never 0 — zero would read as "was there and left instantly". A would-be merge past 12 hours is refused rather than believed, leaving the day uncomputable instead of inventing an implausible presence. It is explicitly **not** Logged Hours (the billed effort and the payroll numerator, ADR-0010), **not** Capacity, **not** Payable Day and **not** Payable OT — each is a different quantity, and reading Time Present as Logged Hours would silently re-price payroll. Deliberately uncapped on a half day: a day authored as `HD` measures its true span here while the attendance grid credits 4 hours, because a half day is HR intent, not a measurement (ADR-0007, ADR-0015).
_Avoid_: Logged Hours (the two are not interchangeable — one bills, one measures), Attendance %, Presence hours, Span, Hours present

**Attendance Record**:
The human-authored daily attendance cell for one Employee — status (`P`/`HD`/leave codes/`WO`/`H`), in/out times, and OT — stored in `employee_attendance`. Status is authoritative over Punch evidence; times on a punch day follow the device (ADR-0007).
_Avoid_: Attendance (ambiguous), Attendance log (when meaning the cell), Punch (when meaning the day)

**Payable Day**:
Attendance credit toward salary — `P` = 1, `HD` = 0.5, paid leave (`PL`/`CL`/`SL`/`EL`) = 1; `WO`/`H`/`A`/`LWP`/`UL` = 0.
_Avoid_: Present day, Working day

**Payable OT**:
Overtime that clears the payability gate — daily excess over 8h only when it exceeds 2h. Coexists with worked-hours OT in the timesheet report, which counts every minute past 8.
_Avoid_: OT (ambiguous), Overtime (ambiguous)

**Session**:
One browser's authenticated login of one User — established by logging in, ended by logging out, a password change/reset, or deactivation. Ending a Session does not end the User's other Sessions, and a Session is the unit revocation acts on.
_Avoid_: Login (the act, not the state), Token (the credential, not the identity), Cookie (the carrier)

**Public endpoint**:
An API endpoint that deliberately answers without a Session — exactly: login, logout, the session probe, the attendance webhook (authenticated by its own Bearer secret), and the minimal health probe. Everything else requires a Session and a permission check.
_Avoid_: Unauthenticated route, Anonymous API, Open endpoint

**Financial Close**:
A reviewed company financial month saved with immutable closed figures (`financial_close_snapshots`, `close-<uuid>`). The close freezes the month's Company Incurred Cost, source and Project identities, allocation and financial versions, classification, currency and tax basis, and evidence states exactly as the report stated them. Unresolved cost exceptions, unwired sources, unsupported commitments, and an empty month block the close; pending payroll, partial cash cover, and legacy cash gaps are disclosed warnings. Once closed, ordinary writes to the month are refused (`409 month_closed`); only explicit revisions can change closed figures. Payroll finalization freezes attribution but never closes the month.
_Avoid_: Payroll finalization, Locked run, Frozen estimate

**Financial Revision**:
An authorized correction to a closed financial month (`financial_revision_events`, `rev-<uuid>` or a caller-supplied key) carrying the target cost or settlement, the operation (correct or reverse), the version read, the frozen closed version targeted, a reason, an evidence reference, the actor, and the timestamp, with the prior and new figures preserved. A revision runs through the source's own command path, carries linked order consumptions forward in the same transaction, and never rewrites the frozen close. Payroll attribution keeps its allocation revision contract instead.
_Avoid_: Edit, Reversal without reason, Rewriting history

**Version-Matched Expenditure Evidence Export**:
An authorized multi-sheet Excel workbook export (`GET /api/reports/employee-project-monthly-cost/download?view=expenditure`) containing version-matched audit evidence for company and project expenditure reconciliation. It delivers five sheets: Company Reconciliation, Project Detail, Budgets & Commitments, Cash Paid, and Revisions & Close. The export matches the web report calculations, distinguishes missing data from zero, keeps company reconciliation totals intact when filtered by project, and displays commercial client orders with an explicit non-revenue non-profit disclaimer.
_Avoid_: Unverified export, Filtered company total, Ad-hoc spreadsheet
