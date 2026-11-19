# Bid-to-Actual Profit Memory

**Status:** Proposed. Not implemented. **Business value rank:** 2 of 4.

## Business case

Help Accent price fixed-price work from completed Projects, not just the assumptions behind the last bid. Show where similar work took more hours or cost more than expected.

## Prerequisite

The [Bid Desk pricing design](../adr/0035-proposal-pricing-uses-reviewed-cost-assumptions.md) is not implemented. This feature needs a reviewed Proposal cost baseline linked to the resulting Project. Preserve the exact issued revision, including scope, hours, costs, currency assumptions, and price. Never reconstruct a baseline from current rates or invent a historical approval.

## Proposed workflow

1. At Project closeout, compare recorded delivery costs and logged hours with the issued baseline. Show variance by discipline or cost category where the source records support it.
2. Separate original scope from approved changes when costs can be attributed reliably. Label unmatched costs and incomplete records. Exclude poorly matched Projects from benchmarks.
3. For a new Proposal, show comparable completed Projects with the sample size and comparison criteria. Start with service type, discipline, and size of effort. Show the range and main causes of variance.
4. Let the reviewer adjust and explain the new estimate. Keep the resulting guidance advisory. Do not modify prices, pricing policy, or approval requirements.

## Comparison rules

- Compare like scope and cost categories. Report currency, tax, overhead, and contingency treatment with the comparison.
- Use recorded Project Employee Cost for finalized periods. Keep estimates labeled and avoid counting commitments as actual costs.
- Show price and cost variance separately. Do not label a partial cost comparison as realized profit.
- Show underlying costs only to authorized users. Never expose individual pay or exact margins through an unrestricted view.

## Pilot and success measures

Review up to ten completed fixed-price Projects with finance and delivery. Report how many have usable issued baselines and cost coverage. If too few qualify, collect baselines on new bids before publishing benchmarks.

Track effort and cost variance on comparable completed Projects. Record cases where the evidence changes a bid assumption. Before rollout, agree on comparison criteria and minimum evidence for publishing a benchmark.

## References

- [Reviewed Proposal pricing assumptions](../adr/0035-proposal-pricing-uses-reviewed-cost-assumptions.md)
- [Project Employee Cost](../adr/0016-project-employee-cost-from-recorded-payroll.md)
- [Financial close](../adr/0024-closed-financial-month-freezes-figures.md)
