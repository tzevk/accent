# Lead Conversion CRM Research

Research note (2026-10-19). Research only; no application code changed.
Question: what should happen to every incoming Accent lead — calls,
failed contacts, outcomes, conversion — following professional CRM
practice.

Prior slice review (source only, app/database not run): parent-supplied
local findings are incorporated under "Accent current-state
observations" below with repo-relative links. Do not claim a full-repo
audit; inspected slice only.

## TL;DR

- Strongest day-to-day reference: HubSpot's lead record model
  (stage tracker, owner, last contact/engagement, next activity,
  call outcomes separate from stage, recent/upcoming activity).
- Strongest conversion reference: Salesforce (`convertLead` converts a
  lead to account + contact + optional opportunity).
- Zoho supports both: field-mapped conversion to account/contact/deal
  and a dedicated Calls module with purpose/result separated from
  lead status.
- Three separations every reference keeps and Accent should adopt:
  call outcome is not lead status; a failed call is not a lost lead;
  conversion (lead becomes customer records) is not won revenue
  (deal closes).

## Vocabulary (do not conflate)

| Term              | Means                                                                                        | Decided by                         |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| Call outcome      | What happened on one call attempt (connected, no answer, busy, voicemail, wrong number)      | Logged per activity                |
| Lead status/stage | Where the lead is in the sales process (new, attempting, connected, qualified, disqualified) | Rep judgment over the whole thread |
| Conversion        | Qualified lead becomes account/contact plus optional deal/opportunity                        | Explicit convert action            |
| Won revenue       | Deal/opportunity closes with money                                                           | Deal stage + close date            |

HubSpot keeps lifecycle stage, lead status sub-stage, call outcome,
and deal stage as four distinct properties; see citations below.

## Salesforce: conversion semantics + activity model

Salesforce is the standard reference for what "conversion" means.

- A lead is an early-stage prospect; an opportunity is a qualified
  lead considered a viable deal with expected revenue, stage, close
  date, and probability.
  Source: <https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning>
- Converting a lead creates a business account, a contact, and an
  opportunity from the lead record (person account variant when no
  company name).
  Source: <https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning>
- `convertLead()` converts a lead into account + contact and
  optionally an opportunity; opportunity creation is the default and
  is skipped only when `doNotCreateOpportunity` is true; conversion
  requires a valid converted status and needs Convert Leads
  permission plus create/edit rights on the target objects.
  Source: <https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-convertlead.html>
- A lead is typically converted when it becomes a real opportunity
  worth forecasting; each org sets its own qualification guidelines.
  Source: <https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-convertlead.html>
- The lead record's Activity tab logs calls, emails, and notes, and
  plans future work via tasks/events.
  Source: <https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning>
- Lead Intelligence View segments work by activity health: total,
  no activity, idle (no completed activity in 30 days), no upcoming,
  overdue, due today, upcoming.
  Source: <https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning>
- Lead assignment is configurable per org: automatic rules (e.g.
  territory) or a shared queue.
  Source: <https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning>

## HubSpot: day-to-day lead record (strongest operational fit)

HubSpot's lead record is the closest match to what the client asked
for: one screen answering "what happened to this lead."

- Lead stages are New, Attempting, Connected, Qualified,
  Disqualified; New is automatic on creation, Attempting follows the
  owner's first outreach activity, Connected follows a reply or a
  logged call with Connected outcome / completed meeting, while
  Qualified and Disqualified are manual-only.
  Source: <https://knowledge.hubspot.com/records/view-a-lead-record>
- The lead stage tracker shows last contacted, last engagement, and
  next activity; if nothing is scheduled, the rep schedules the next
  activity from the tracker.
  Source: <https://knowledge.hubspot.com/records/view-a-lead-record>
- Owner, lead type, and stage are editable dropdowns; recent
  communications show the last three with expandable detail; call
  and meeting outcomes are set per communication.
  Source: <https://knowledge.hubspot.com/records/view-a-lead-record>
- Recent and upcoming activity cards show the three most recent and
  three nearest upcoming activities, searchable and filterable by
  type.
  Source: <https://knowledge.hubspot.com/records/view-a-lead-record>
- A lead needs an assigned owner to appear in the sales workspace;
  unassigned leads still exist on the index page and associated
  records.
  Source: <https://knowledge.hubspot.com/records/manage-leads>
- Default call outcomes are Busy, Connected, Left live message,
  Left voicemail, No answer, Wrong number; call direction
  (inbound/outbound) and call type are separate fields, and logging
  one activity can create a follow-up task in the same action.
  Source: <https://knowledge.hubspot.com/records/manually-log-activities-on-records>
- Tasks are reminders associated with records, with type
  (Call/Email/To-do), assignee, due date/time, reminders, and notes;
  a follow-up task can be created directly from a logged activity.
  Source: <https://knowledge.hubspot.com/tasks/create-tasks>
- Deals carry Closed won/lost reasons as dedicated properties; close
  date is set automatically when a deal enters a closed stage; deals
  also auto-track last activity date, last contacted, next activity
  date, number of sales activities, and times contacted.
  Source: <https://knowledge.hubspot.com/properties/hubspots-default-deal-properties>
- Lifecycle context (contacts/companies, wider funnel): Subscriber,
  Lead, Marketing Qualified Lead, Sales Qualified Lead, Opportunity,
  Customer, Evangelist, Other; Lead Status is explicitly the
  sub-stage property inside Sales Qualified Lead.
  Source: <https://knowledge.hubspot.com/records/use-lifecycle-stages>

## Zoho CRM: conversion mapping + calls discipline

Zoho corroborates the Salesforce conversion shape and adds explicit
field-mapping and calls-module practice.

- A lead converts to account + contact, with an optional deal; lead
  fields map to account/contact/deal fields (standard fields mapped
  by default, custom fields mappable by matching type/length);
  conversion is irreversible and requires the Convert Leads
  permission.
  Source: <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/leads/articles/convert-leads>
- On duplicate detection the rep chooses create-new vs merge into
  existing account/contact; notes move to the deal (copies on
  account/contact), attachments move to a chosen record.
  Source: <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/leads/articles/convert-leads>
- Leads that should not convert are closed via a status value
  (e.g. custom "Closed") plus a filtered list view — disqualified,
  not deleted.
  Source: <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/leads/articles/convert-leads>
- The Calls module stores inbound/outbound calls with subject,
  purpose, type, start time, duration, description, and result;
  completed calls are locked from editing and appear in the
  record's closed activities.
  Source: <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/activities/articles/log-calls>
- Scheduled calls support mark-completed, reschedule, or cancel;
  saving a call can also create a follow-up task.
  Source: <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/activities/articles/log-calls>

## Comparison

| Concern              | Salesforce                               | HubSpot                                         | Zoho                                     |
| -------------------- | ---------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Activity record      | Calls, emails, notes, tasks/events       | Calls with outcomes; recent/upcoming activities | Calls with purpose, result, and duration |
| Conversion reference | Account + contact + optional opportunity | Qualified/disqualified lead decisions           | Account + contact + optional deal        |
| Next step            | Tasks/events per record                  | Next activity + follow-up tasks                 | Follow-up task from call                 |

Sources: [Salesforce lead records](https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning),
[HubSpot lead records](https://knowledge.hubspot.com/records/view-a-lead-record),
[Zoho conversion](https://help.zoho.com/portal/en/kb/crm/sales-force-automation/leads/articles/convert-leads),
and [Zoho calls](https://help.zoho.com/portal/en/kb/crm/sales-force-automation/activities/articles/log-calls).

## Accent current-state observations (source review only)

Parent-supplied, verified against the cited files. App and database
were not run; treat as source observations, not proven live-data
errors.

- The new-lead form exposes `NEW/contacted/qualified/proposal/
negotiation/won/lost/cancelled`
  ([src/app/leads/new/page.jsx#L13-L22](../../src/app/leads/new/page.jsx#L13-L22)),
  while the leads API counts older `enquiry_status` values `Under
Discussion`, `Proposal Sent`, `Follow Up`, `Closed Won`,
  `Closed Lost`
  ([src/app/api/leads/route.js#L105-L116](../../src/app/api/leads/route.js#L105-L116)).
  Vocabulary mismatch between form and reporting is a source
  observation.
- Per-lead follow-ups carry date, type, description, status,
  next_action, next_follow_up_date, notes
  ([src/app/leads/[id]/edit/page.js#L46-L55](../../src/app/leads/%5Bid%5D/edit/page.js#L46-L55)),
  fetched per lead
  ([src/app/leads/[id]/edit/page.js#L134-L145](../../src/app/leads/%5Bid%5D/edit/page.js#L134-L145));
  the follow-ups INSERT stores those fields with no separate call
  outcome column
  ([src/app/api/followups/route.js#L116-L130](../../src/app/api/followups/route.js#L116-L130)).
- "Convert to Proposal" POSTs `/api/proposals` with `lead_id` and
  then separately PUTs the lead status to `Converted to Proposal`
  ([src/app/leads/[id]/page.js#L134-L215](../../src/app/leads/%5Bid%5D/page.js#L134-L215)),
  with an explicit warning when the proposal is created but the
  status update fails
  ([src/app/leads/[id]/page.js#L217-L221](../../src/app/leads/%5Bid%5D/page.js#L217-L221)).
  Two-step client conversion can strand records half-converted.
- No claim is made about audit/history systems elsewhere in the
  repo; inspected slice only.

## Recommended minimal Accent workflow (recommendations, not product facts)

Keep Accent's lead-to-proposal shape; borrow the separations above.

1. One lead status vocabulary: New, Attempting Contact, Connected,
   Qualified, Nurture, Disqualified, Converted to Proposal.
   Nurture means not ready now, with a future follow-up date.
   Keep Proposal Sent, Negotiation, Won, and Lost on the linked
   proposal/sales record, not the lead qualification status.
   Map legacy values once after inspecting stored records and links.
   Do not guess mappings for ambiguous legacy statuses.
2. Per-attempt call logging. Add `call_outcome` (Connected, No
   answer, Busy, Voicemail, Wrong number, plus free note) to the
   follow-up/activity record. A failed outcome never changes lead
   status by itself; it schedules the next attempt.
3. Task status separate from outcome. `status`
   (Scheduled/Completed/Cancelled) answers "did the work happen";
   `call_outcome` answers "what happened on the call";
   `next_follow_up_date` answers "what is next". Three columns,
   three questions.
4. Lead detail header. Owner, status, last contacted, last outcome,
   next follow-up date, linked proposal — the HubSpot stage-tracker
   pattern in one glance.
5. Server-side conversion. Move "Convert to Proposal" into one API
   action that creates the proposal and updates the lead status in
   a single transaction; keep the `lead_id` link and the proposal
   back-link so the handoff is traceable both ways.
6. Qualified/disqualified as explicit decisions. Only a rep action
   (with reason for lost/disqualified) closes a lead; conversion
   and closure stay manual, mirroring HubSpot's manual
   Qualified/Disqualified and Zoho's close-with-status.
7. Lost reason on the outcome, not the call. Store win/loss reason
   with the lead closure or proposal outcome, never inferred from
   a single call attempt.
8. One chronological lead timeline. Show call attempts, emails,
   meetings, notes, owner changes, stage changes, and conversion.
   Each event records actor, occurrence time, and relevant outcome.
   Preserve earlier events; do not replace history with the latest
   status. Record corrections explicitly.

## Dashboard metrics (recommended)

Borrow Salesforce Intelligence View buckets and HubSpot activity
properties. Stage-duration and first-contact metrics require
timestamped history, not just the current status and next due date.

- Funnel: leads by status; conversion rate lead-to-proposal and
  proposal-to-won; median days per stage.
- Activity health: no activity ever, idle 30+ days, no upcoming
  follow-up, overdue follow-ups, due today, upcoming 7 days.
- Contact effectiveness: attempts per lead, connect rate
  (Connected / all call outcomes), attempts-to-first-connect.
- Outcome quality: lost/disqualified counts by reason; wrong-number
  and unreachable rates (data quality signal, not rep performance).
- Ownership: per-owner open leads, overdue follow-ups, average
  time-to-first-contact on new leads.

## Scope limits (recommendations)

- No marketing automation, sequences, cadences, or lead scoring;
  the ask is tracking and conversion, not outreach automation.
- No telephony integration; manual call logging with outcome is
  the target, matching Zoho's log-completed-call pattern.
- No opportunity revenue forecasting beyond proposal value and
  won/lost; full pipeline probability is out of scope.
- No cross-record merge UI for duplicates yet; note it as a known
  gap at conversion time (Salesforce/Zoho both handle merge at
  convert).
- No permission/role redesign; conversion gating by role is noted
  but not specified here.

## Direct references

- HubSpot lead record (strongest operational fit):
  <https://knowledge.hubspot.com/records/view-a-lead-record>
- HubSpot manage leads:
  <https://knowledge.hubspot.com/records/manage-leads>
- HubSpot lifecycle stages:
  <https://knowledge.hubspot.com/records/use-lifecycle-stages>
- HubSpot log activities (call outcomes):
  <https://knowledge.hubspot.com/records/manually-log-activities-on-records>
- HubSpot tasks:
  <https://knowledge.hubspot.com/tasks/create-tasks>
- HubSpot deal properties (closed reasons, auto dates):
  <https://knowledge.hubspot.com/properties/hubspots-default-deal-properties>
- Salesforce Trailhead leads module (conversion semantics):
  <https://trailhead.salesforce.com/content/learn/modules/leads_opportunities_lightning_experience/create-and-convert-leads-lightning>
- Salesforce `convertLead()` API:
  <https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-convertlead.html>
- Zoho converting leads:
  <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/leads/articles/convert-leads>
- Zoho logging calls:
  <https://help.zoho.com/portal/en/kb/crm/sales-force-automation/activities/articles/log-calls>

## User-agreed design decisions

Captured during the design interview. Application changes await scope confirmation.

- Conversion occurs when a linked proposal is created, not when accepted or when a project starts.
- Conversion requires a named contact, a usable phone or email, and a clear project need. Budget and timing can remain unknown.
- Lead stages: New, Attempting Contact, Connected, Qualified, Nurture, Disqualified, Converted.
- Proposal negotiations and won/lost outcomes belong to the linked proposal, not the lead stage.
- One owner is accountable for each lead. Other permitted users can log activities. Unassigned leads remain in an intake queue.
- Attempting Contact, Connected, Qualified, and Nurture require a dated next action. New leads enter intake; Converted and Disqualified need no lead follow-up.
- Users manually log calls with outcomes, emails, meetings, and notes. Follow-up scheduling shares the activity form. Phone and email integrations are excluded.
- Limited automatic stage updates: first outreach moves New to Attempting Contact; a connected call or confirmed reply moves New/Attempting Contact to Connected. Later stages never move backward automatically. Qualification, Nurture, and Disqualification remain explicit decisions.
- Activity corrections retain previous values, correcting actor, correction time, and a reason. History must not disappear through silent edits or deletion.
- Users with lead-update permission may reopen a Disqualified lead with a reason, an owner, and a dated next action. Preserve the original disqualification history.
- The main workspace is an action-focused searchable lead table with My Leads, Unassigned, Due Today, Overdue, Untouched, and No Next Action views. Lead details expose the timeline and quick actions.
- One lead represents one project enquiry. Separate project needs create separate leads even for the same company/contact. Duplicate submissions for the same enquiry require review.
- One enquiry has one proposal. Repeated conversion opens the existing proposal; price changes use proposal revisions rather than another lead conversion.
- Lead conversion requires `leads:convert`, `leads:update`, and `proposals:create`, enforced consistently in the interface and API.
- Manually created leads default to their creator as owner. Imports enter unassigned intake unless an owner is selected. Outreach and qualification require an owner.
- Converted leads retain their history and show the linked proposal's current status and later project link. New sales follow-ups belong to the proposal, without reopening the converted lead.
- Legacy migration maps only evidence-backed stages and owners, preserves original records, and flags ambiguous cases or duplicate proposal links for review. Legacy activities retain unknown authors/outcomes rather than invented history.
- Conversion transfers scheduled follow-ups to the proposal with traceable links and no duplicate task counting. Completed lead activities remain unchanged.

### Implementation acceptance criteria for the agreed workflow

- One enquiry has one lead and one canonical linked proposal. Repeat or concurrent conversion must not create another proposal.
- Conversion validates qualification and all three permissions on the server, then creates the proposal, records conversion history, and transfers scheduled follow-ups in one transaction. Prior lead activities and handoff links remain visible.
- Active lead work requires an owner and dated next action. Conversion and disqualification remove that requirement without deleting history.
- A no-answer call records an attempt, not a disqualification. Connected activity cannot automatically regress Qualified or Nurture.
- Activity corrections preserve old values, actor, timestamp, and reason. Legacy authors and missing outcomes remain explicitly unknown.
- Reopening a Disqualified lead requires update permission, a reason, an owner, and a dated next action.
- The action-focused lead table filters work by owner and due date. The lead detail exposes a chronological timeline and linked proposal progress.
- Imports, create/edit screens, API filters, and counters use the same stage vocabulary. Ambiguous historical cases are visible for review.
- No phone/email integrations, scoring, marketing automation, or proposal-to-project redesign are included.

### Design approval and implementation order

The user confirms this workflow and its boundaries. This interview changes documentation only; application implementation has not started.

1. Data cutover: introduce stable owner references, canonical lead stages, activity outcomes, correction history, and proposal handoff links. Preserve legacy evidence and identify ambiguous mappings and duplicate proposal links before enforcing uniqueness.
2. Server behavior: enforce ownership, dated next actions, stage transitions, qualification, correction history, and reopening rules across create/edit/import/activity paths.
3. Conversion: align permissions, prevent repeat/concurrent duplicate creation, create the proposal and transfer scheduled tasks transactionally, and expose proposal progress from the lead.
4. User workspace: add action-focused table views, owner/due-date filters, a chronological timeline, and activity/follow-up quick actions. Use the same stage definitions and counters across all screens.
5. Verification: exercise unanswered-call progression, qualification rejection, ownership and next-action requirements, correction history, disqualification/reopening, concurrent conversion, task transfer, and legacy review. Verify the actual UI and database effects, not just mocked responses.
