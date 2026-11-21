# Sales Escalation Queue

**Status:** Proposed. Not implemented. **Business value rank:** 4 of 4.

## Business case

Give the director a short list of stalled opportunities where his involvement could help. Routine follow-ups stay with their owners.

## Proposed workflow

1. Sales defines which opportunities qualify for escalation. Use reviewed Proposal value where available. Before pricing, allow a named owner to mark strategic importance with a reason.
2. Flag eligible records when an agreed follow-up deadline passes or a documented blocker requires director input. Surface missing ownership to the sales manager first.
3. Prompt the owner to record a next action before escalating a missed deadline. Route explicit director decisions directly, with evidence and a specific request.
4. Show one item per opportunity in the director’s queue. Include the owner, last confirmed contact, blocker, value if known, deadline, and requested decision.
5. Close or snooze each item with a reason and next action. Reopen only when the stated date passes or new evidence changes the case.

## Evidence and boundaries

- Extend the existing Lead activity and follow-up queues rather than duplicating them. Use when the activity happened, not when someone entered it.
- Distinguish attempted outreach from confirmed contact. An unanswered call or sent email is not contact. Missing history is not proof no work happened.
- After Lead Conversion, route the item through the linked Proposal. Do not count or escalate both records. Conversion to Proposal is not a sale.
- Exclude routine Nurture check-ins unless their agreed review date passes and they meet escalation rules. Do not infer stages or contact clients automatically.
- Respect existing record access. Do not expose restricted Proposal pricing through the director’s queue or notifications.

## Pilot and success measures

Run with a sales manager and the director. Review surfaced cases weekly. Track time to action, the share that genuinely needed director input, and stalled opportunities that moved forward after intervention. Do not report Proposal handoffs as won revenue.

Before rollout, agree on value and timing thresholds, which decisions warrant director involvement, and who handles unassigned work. Verify that a converted Lead and its Proposal produce one item.

## References

- [Lead activities and Proposal handoff](../../adr/0032-lead-activity-log-and-conversion-handoff.md)
- [Lead operator guide](../../app/leads/operator-guide.md)
- [Lead conversion research](../../explanations/LEAD_CONVERSION_CRM_RESEARCH.md)
