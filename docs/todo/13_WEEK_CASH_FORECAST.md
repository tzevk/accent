# 13-Week Cash Forecast

**Status:** Proposed. Not implemented. **Business value rank:** 3 of 4.

## Business case

Give the director early warning of cash shortfalls. Finance can follow up on receipts, plan supplier discussions, and schedule spending before a shortfall arrives.

## Proposed workflow

1. Finance records a reconciled opening cash balance and its date. The forecast starts from that balance and shows 13 weekly columns.
2. Schedule expected client receipts and supplier payments from their source records. Include payroll, tax, and other material cash movements that affect liquidity.
3. Keep confirmed timing separate from estimated timing. Each estimate has an owner, a date, a basis, and a last-reviewed date. Put undated items in a visible review queue rather than guessing a week.
4. Show opening balance, inflows, outflows, and closing balance per week. Highlight the first week below the cash buffer finance sets.
5. Provide an expected case and a downside case. Finance can test delayed receipts without changing invoices, payment terms, or accounting records.

## Cash rules and boundaries

- Forecast cash movement, not revenue or cost recognition. An incurred cost is not necessarily a payment that week.
- Track remaining amounts after partial receipts or settlements. When an invoice replaces an expected milestone or commitment, forecast the linked amount only once.
- Shift settled amounts from forecast to recorded movements. Do not include cash already reflected in the opening balance.
- Keep unsigned deals outside the expected case. Flag missing balances, dates, or currency assumptions instead of treating them as zero.
- Show payroll and account details only where permissions allow. Do not initiate payments or send collection messages.

## Pilot and success measures

Run the forecast alongside finance’s current process. Reconcile opening balances, then review expected against recorded receipts and payments each week. Track forecast error, undated amounts, and how early finance sees shortfalls.

Before rollout, confirm bank balance sources, cash buffer, included accounts and currencies, and who owns updates. Verify that a partly settled invoice contributes only its unpaid amount to future weeks.

## References

- [Company Monthly Cost research](../explanations/COMPANY_MONTHLY_COST_ERP_RESEARCH.md)
- [Incurred cost and supplier commitments](../adr/0017-project-incurred-cost-and-commitments-are-separate.md)
- [Outward cash movements](../adr/0023-outward-cash-paid-as-dated-movement.md)
