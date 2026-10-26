# Company Monthly Cost — how to read the report

Open `/reports/company-monthly-cost` and select **Company Expenditure**.
This guide explains the current calculations and the October 2026 screenshot.
The report and Excel export use the plain-language labels described below.

Financial close and revision status appear once in the company summary.
Use those links to open their detailed sections.
The **Review summary** lists budget, recognition, payroll, and evidence items without repeating those statuses.

## What monthly expenditure means

**Monthly expenditure means the cost we can calculate from the records currently present.**
It includes confirmed costs and salary estimates for payroll that is not yet recorded.
It excludes employee costs that cannot be calculated.

It does **not** mean available funds, remaining budget, cash paid, or the final salary bill.
The earlier “Available cost” label described the data, not the company's money.
The interface now uses **Monthly expenditure** instead.

The main total follows this rule:

```text
Monthly expenditure shown = confirmed cost + salary estimates not already recorded
```

Recorded payroll is already inside confirmed cost.
The report never adds that payroll again as an estimate.
When recorded payroll becomes available, it replaces the corresponding estimate.
The recorded amount can differ from the earlier estimate.

The destination cards follow a second rule:

```text
Company total = Project cost + Company Overhead + Unallocated Cost
```

These sums require a common currency or supported conversion evidence.
The report does not invent exchange rates to produce a combined total.

## Reading your October 2026 screenshot

These are the screenshot's figures under their current labels, not fixed report values.

| Figure                  |        Value | What it means                                                                               |
| ----------------------- | -----------: | ------------------------------------------------------------------------------------------- |
| Monthly expenditure     | ₹2,53,827.00 | The calculable monthly total, including salary estimates.                                   |
| Project cost            | ₹1,86,275.00 | The part attributed to Projects.                                                            |
| Company overhead        |        ₹0.00 | No confirmed shared operating cost is included in this total.                               |
| Unallocated cost        |   ₹67,552.00 | The part not attributed to a Project or overhead.                                           |
| Confirmed cost          |        ₹0.00 | No recognized operating cost or recorded payroll amount contributes to the confirmed total. |
| Salary estimate         | ₹2,53,827.00 | Salary estimates already included in the headline, not another amount to add.               |
| Missing Salary Profiles |  4 employees | Their unknown salary costs are excluded; their Logged Hours remain visible.                 |

**Here, the entire headline comes from estimated payroll.**
The Project and Unallocated amounts divide that same payroll estimate.
Do not add the Salary estimate card to the headline again.
Do not treat the partial total as a complete or final company cost.

The screenshot does not identify which Employees produce the unallocated amount.
Open **Payroll detail**, then an Employee's Project shares, to inspect the destinations.
The four missing profiles do not explain the unallocated amount: their costs are not calculated at all.

## The terms that affect your decisions

### Confirmed cost

Recognized operating costs, whether paid or unpaid, plus recorded payroll allocations.
A Payroll Slip in a draft run does not by itself establish recorded payroll cost.
Recorded payroll requires the applicable frozen allocation and a finalized or paid run.

Confirmed cost is not the same as cash paid.
A payment settles an obligation; it must not create a second cost.

### Salary estimate

A payroll calculation using a covering Salary Profile, Logged Hours, and applicable payroll rules.
It includes employer cost, not just the Employee's take-home pay.
Configured earnings and employer contributions can affect the amount.

It is not a forecast of hours that Employees have not logged.
It can change while payroll is not finalized.
See the [Payroll operator guide](../payroll/operator-guide.md) for the pay formula and review process.

### Partial total and zero

**Partial** means some employee costs cannot be calculated.
Known costs remain included; missing employee costs do not become assumed salaries.
An Employee working on several Projects counts once in the company missing-profile warning.
Each affected Project can show its own warning for that Employee.

A displayed zero beside missing pricing is an **unpriced placeholder**.
It does not mean that Employee works for free.
A supported, recorded zero is different: it is a known recorded amount.

“Confirmed: ₹0.00” means no confirmed cost contributes to that total.
It does not prove the company has spent nothing.

### Project cost

Confirmed cost attributed to the Project, plus that Project's estimated payroll shares.
Employee shares follow the Employee's monthly Logged Hours by Project.
The Project table keeps confirmed cost visible beside the combined figure.

The Project filter narrows the detail, not the company headline or destination cards.
The largest-cost ordering includes salary estimates and ranks within each currency.
The largest-increase ordering uses confirmed comparable-period cost instead.

### Company Overhead

Confirmed shared operating cost deliberately classified as not attributable to one Project.
It is not a holding category for unknown Project attribution.

### Unallocated Cost

Cost that has no reliable Project or overhead destination.
For payroll, this includes **No project** and **No logged hours** shares.
An Employee can still have employer cost without hours because some configured earnings are not hours-based.

Unallocated cost is already inside the company total.
It is not automatically Bench Cost, a loss, unused salary, or a missing-profile amount.
Inspect the shares before deciding whether attribution needs correction.

### Confirmed cost comparison

This section compares confirmed cost only; it excludes the salary estimates in the headline.
For an unfinished month, it compares equivalent elapsed periods, not the full previous month.
Monthly amounts without day-level evidence can prevent a supported elapsed-period change.

A positive headline can therefore coexist with an unavailable confirmed comparison.
**Unknown prior amount** is not the same as a prior amount of zero.
The report does not invent a percentage change when the prior amount is unknown or zero.

### Approved budget and variance

A budget is a plan, not an expense, and does not populate monthly expenditure.
The current variance is **approved monthly budget minus confirmed Project cost**.
It does not subtract the salary estimates shown in the available-cost column.
A positive variance means remaining budget; a negative variance means overspent on that confirmed basis.

A comparison needs the same Project, currency, cost scope, and exact monthly period.
A missing or incompatible budget does not mean the Project has no cost.

## What to do when a number looks wrong

| Situation                                | Action                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Missing Salary Profile                   | Open **Employee Cost — Month** to identify affected Employees. Review their Salary Profiles in **Employees**.                      |
| A profile exists but the warning remains | Check the selected month, active profile, and effective dates. The report selects a profile covering the month's first day.        |
| Historical profile dates are uncertain   | Ask the payroll owner to review the agreement. Do not backdate a profile just to remove a warning.                                 |
| Employee cost seems too low              | Check Logged Hours and payroll settings. The estimate is not automatically the Employee's full monthly CTC.                        |
| Unallocated payroll is high              | Inspect **Payroll detail** and the Employee's shares for **No project** or **No logged hours**.                                    |
| A Project has no approved budget         | Open **View cost budgets** with read access. Authorized operators see **Manage cost budgets** or the report's **Add budget** link. |
| A real expense is missing                | Use **Record cost** if authorized, then follow its normal review and recognition workflow. A budget cannot replace an expense.     |
| A currency total is unavailable          | Inspect the source currencies and conversion evidence. Do not read an unavailable amount as zero.                                  |
| Confirmed cost remains zero              | Review expense recognition and payroll state. Do not finalize payroll just to populate a report.                                   |
| A finalized cost needs correction        | Use the authorized correction or allocation-revision workflow. Profile edits must not silently reprice frozen payroll.             |
| Financial close has blockers             | Open its detail and read the stated blockers. The status count alone does not identify the cause.                                  |

Controls depend on your permissions.
Creating a cost budget does not create expenditure, recognize an expense, or finalize payroll.

## End-user labels and help

The headline is **Monthly expenditure**.
Its destination cards are **Project cost**, **Company overhead**, and **Unallocated cost**.
The payroll breakdown is **Salary estimate**.
Budget remaining or overspent explicitly states its **confirmed** cost basis.
Excel uses the same labels and cost-basis qualifications.

The headline keeps these statuses visible without opening help:

- **Includes salary estimates** when the total includes estimates.
- **Partial — N employee costs missing** when some employee costs cannot be calculated.
- **Salary estimate shown separately** when currencies prevent a combined total.
- **Confirmed cost** when supported confirmed cost exists, with no estimates or missing employee costs.

Estimate and partial statuses can appear together.
Missing-profile explanations remain on the page.
An entirely unpriced month keeps a qualified zero and Logged Hours.

### How costs are calculated

Select **How costs are calculated** to open the calculation help.
This Popover works through click, touch, or keyboard activation.
It explains both reconciliation formulas and the main financial terms.
It is read-only and does not create expenses, approve budgets, or finalize payroll.

Press Tab from its close button to enter the **Cost definitions** reading area.
Use Page Down or the arrow keys to read content that does not fit.
Touch users can scroll the same area.
Select **Close cost explanation** or press Escape to close it.
Focus returns to **How costs are calculated**.

### Short definitions

The information buttons beside the main cards and Salary estimate show optional Tooltips.
They open on hover or keyboard focus and close with Escape.
You can move the pointer onto a Tooltip to finish reading it.
They contain no links or other controls.
Critical cost status and missing-profile warnings never depend on these Tooltips.

### Implementation and verification

The shared Popover and Tooltip use the Radix-based shadcn composition.
They match the existing buttons, Heroicons, and styling tokens.
The Tooltip provider is scoped to the company summary, not the whole application.
Definitions and exported labels come from the report's shared vocabulary.
No `components.json` initialization or application-wide theme migration is required.

Browser checks cover keyboard opening, focus indicators, keyboard scrolling, Escape, focus return, hoverable definitions, and native touch interaction.
The help fits the 320px viewport and its long definitions remain scrollable.
Checks also cover estimated/partial, entirely unpriced, uncombined-currency, and confirmed-only reporting states.
Accessible names and descriptions are checked through the browser's accessibility tree.
A real screen-reader session is not part of these checks.

## References

### Current report rules

- [Report implementation and budget workflow](company-expenditure-implementation.md)
- [Payroll operator guide](../payroll/operator-guide.md)
- [Recorded Project employee cost decision](../../adr/0016-project-employee-cost-from-recorded-payroll.md)
- [Available-cost calculation](../../../src/lib/company-expenditure/available-cost.ts)

### Contextual help guidance

- [shadcn Tooltip — Radix variant](https://ui.shadcn.com/docs/components/radix/tooltip): short hover/focus content.
- [shadcn Popover — Radix variant](https://ui.shadcn.com/docs/components/radix/popover): richer content opened by a button.
- [Radix Tooltip](https://www.radix-ui.com/primitives/docs/components/tooltip): focus, hover, and Escape behavior.
- [WCAG 2.2: Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html): dismissible, hoverable, persistent content.
