# Company Monthly Cost — how to read the report

Open `/reports/company-monthly-cost` and select **Company Expenditure**.
This guide explains the current calculations and the October 2026 screenshot.
The interface recommendations at the end are proposals, not implemented controls.

## What “available cost” means

**Available cost means the cost we can calculate from the records currently present.**
It includes confirmed costs and salary estimates for payroll that is not yet recorded.
It excludes employee costs that cannot be calculated.

It does **not** mean available funds, remaining budget, cash paid, or the final salary bill.
“Available” describes the data, not the company's money.
That makes it a confusing label for end users.

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

These are the screenshot's figures, not fixed report values.

| Figure                        |        Value | What it means                                                                               |
| ----------------------------- | -----------: | ------------------------------------------------------------------------------------------- |
| Available monthly expenditure | ₹2,53,827.00 | The calculable monthly total, including salary estimates.                                   |
| Available Project Cost        | ₹1,86,275.00 | The part attributed to Projects.                                                            |
| Company Overhead              |        ₹0.00 | No confirmed shared operating cost is included in this total.                               |
| Available Unallocated Cost    |   ₹67,552.00 | The part not attributed to a Project or overhead.                                           |
| Confirmed cost                |        ₹0.00 | No recognized operating cost or recorded payroll amount contributes to the confirmed total. |
| Estimated payroll             | ₹2,53,827.00 | Salary estimates already included in the headline, not another amount to add.               |
| Missing Salary Profiles       |  4 employees | Their unknown salary costs are excluded; their Logged Hours remain visible.                 |

**Here, the entire headline comes from estimated payroll.**
The Project and Unallocated amounts divide that same payroll estimate.
Do not add the Estimated payroll card to the headline again.
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

| Situation                                | Action                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Missing Salary Profile                   | Open **Employee Cost — Month** to identify affected Employees. Review their Salary Profiles in **Employees**.                  |
| A profile exists but the warning remains | Check the selected month, active profile, and effective dates. The report selects a profile covering the month's first day.    |
| Historical profile dates are uncertain   | Ask the payroll owner to review the agreement. Do not backdate a profile just to remove a warning.                             |
| Employee cost seems too low              | Check Logged Hours and payroll settings. The estimate is not automatically the Employee's full monthly CTC.                    |
| Unallocated payroll is high              | Inspect **Payroll detail** and the Employee's shares for **No project** or **No logged hours**.                                |
| A Project has no approved budget         | Open the Project and select **Manage cost budgets**, or use its report **Add budget** link.                                    |
| A real expense is missing                | Use **Record cost** if authorized, then follow its normal review and recognition workflow. A budget cannot replace an expense. |
| A currency total is unavailable          | Inspect the source currencies and conversion evidence. Do not read an unavailable amount as zero.                              |
| Confirmed cost remains zero              | Review expense recognition and payroll state. Do not finalize payroll just to populate a report.                               |
| A finalized cost needs correction        | Use the authorized correction or allocation-revision workflow. Profile edits must not silently reprice frozen payroll.         |
| Financial close has blockers             | Open its detail and read the stated blockers. The status count alone does not identify the cause.                              |

Controls depend on your permissions.
Creating a cost budget does not create expenditure, recognize an expense, or finalize payroll.

## Recommended end-user labels and help

**Recommendation: clearer labels first; shadcn contextual help second.**
Do not make the user discover the estimate basis or missing-profile warning by hovering.
Keep **Includes salary estimates**, **Partial**, and the missing-Employee count visible beside the figures.
Only show each status when it applies.

The following copy is proposed; the current page still uses the labels in the first column.

| Current label                 | Recommended label                        | Short explanation                                                                                   |
| ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Available monthly expenditure | Monthly expenditure                      | Confirmed costs plus salary estimates. Excludes employee costs that cannot be calculated.           |
| Available Project Cost        | Project cost                             | Cost attributed to Projects, including estimated salary shares.                                     |
| Company Overhead              | Company overhead                         | Confirmed shared operating cost deliberately not charged to one Project.                            |
| Available Unallocated Cost    | Unallocated cost                         | Cost without a Project or overhead destination, including unallocated payroll shares.               |
| Estimated payroll             | Salary estimate                          | Payroll employer cost calculated from Salary Profiles, Logged Hours, and applicable payroll rules.  |
| Confirmed                     | Confirmed cost                           | Recognized operating costs and recorded payroll allocations. Not the same as cash paid.             |
| Partial total                 | Partial — employee costs missing         | Some employee costs cannot be calculated. Their costs are excluded, but their hours remain visible. |
| Confirmed cost comparison     | Confirmed cost comparison                | Compares confirmed cost only. Salary estimates in the headline are excluded.                        |
| Remaining or overspent        | Budget remaining / overspent — confirmed | Approved budget minus confirmed Project cost. Salary estimates are excluded.                        |

### Tooltip or Popover?

Use a **shadcn Popover** for the explanation a reader needs to understand a financial figure.
A Popover opens through a button, so click, tap, and keyboard users can access the same explanation.
A visible **How costs are calculated** button can hold the main explanation without adding help controls to every row.
Longer explanations and navigation belong there, not inside a Tooltip.

Use a **shadcn Tooltip** only for short, optional term definitions.
Tooltip content opens on hover or keyboard focus; it is not a substitute for a reliable touch interaction.
Do not combine Tooltip and Popover behavior on the same trigger.
Do not add repeated focus stops to every numeric cell.

The project already uses Radix primitives for other controls.
It has no shared shadcn Tooltip or Popover component or `components.json` configuration at this revision.
Use the Radix-based shadcn variants rather than introducing another primitive library for this page.
Adapt the help controls to the existing buttons, icons, and styling tokens.

For implementation and verification:

- Keep missing-profile warnings, counts, and estimate status visible outside overlays.
- Use a native button with a clear accessible name and visible keyboard focus.
- For Tooltips, support hover and focus, keep focus on the trigger, and let Escape dismiss the content.
- Keep hover content readable while the pointer moves onto it; do not dismiss it on a timer.
- Keep links and other interactive controls out of Tooltips; use a Popover for those.
- Verify click/tap, keyboard navigation, focus return, screen-reader descriptions, and the 320px layout.
- Do not rely on the browser's `title` attribute as the only explanation.

These are interface recommendations, not implemented help controls or completed accessibility checks.

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
