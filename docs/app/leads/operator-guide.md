# Lead intake and ownership

## Create one Lead per enquiry

A Lead represents one project enquiry, not a company or contact. Create separate Leads for separate project needs. Reuse the company and contact details when appropriate.

Open **Leads → Add Lead**, or `/leads/new`. Enter the company and the available enquiry details. Budget and project timing are optional. A manual Lead starts at **New** and belongs to the signed-in creator.

Use **Existing company** to retain the company reference. You can also enter a company name manually. Users with `leads:assign` can select another owner. Leaving the manual creation owner at its default keeps the creator as owner.

## Assign responsibility

Open the Lead detail. Select **Lead Owner**, then **Save owner**. Select **Unassigned intake** to remove the owner from a New Lead. Active stages require an owner and a dated next action.

Assignment requires `leads:assign`. Contact and enquiry edits require `leads:update`. A combined edit and owner change requires both permissions. Ownership does not prevent other permitted users from editing the Lead.

**Ownership history** retains the previous owner, new owner, actor, and recording time. Legacy owner mappings do not invent historical actors or assignment times. A numeric user reference remains the ownership authority when a display name changes.

Administrators can enable the existing **Assign** permission in the Lead permission controls. This change grants no permissions automatically. Existing super-admin access remains unchanged.

## Import CSV files

Open **Leads → Import Leads**. Download the template, then select **Import CSV**. Import requires both `leads:create` and `leads:import`.

With `leads:assign`, select **Owner for imported leads** before selecting the file. Without a selected owner, imported Leads enter unassigned intake. Owner names inside a CSV remain evidence; they do not assign users.

The import result separates imported records, review cases, and row errors. A quoted CSV field can contain commas. Correct failed rows before importing them again; successful rows already exist.

For an active stage, select an owner and include a **Next follow-up date** CSV column. Rows that lack required values fail without saving a Lead. Unknown legacy stages remain review cases, not guessed active stages.

## Use one stage vocabulary

| Lead Stage         | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| New                | Captured enquiry, before outreach                        |
| Attempting Contact | Outreach has started                                     |
| Connected          | Initial contact is established                           |
| Qualified          | Suitable enquiry with usable contact and project details |
| Nurture            | Suitable enquiry that is not ready now                   |
| Disqualified       | Explicit decision not to proceed, with a recorded reason |
| Converted          | A Proposal handoff, not a sale won                       |

Create, edit, import, detail, and list filters share these labels. Proposal negotiation, Proposal approval, and sale outcomes are not Lead Stages.

Attempting Contact, Connected, Qualified, and Nurture require an owner and **Next follow-up date**. Generic edits cannot record conversion, disqualification, or reopening. These decisions need their accountable workflow actions. Existing Converted and Disqualified stages remain read-only during ordinary detail edits.

## Review legacy values and potential duplicates

Use **Unassigned intake**, **Needs review only**, or the **Unresolved** stage filter to find records that need attention. A missing canonical stage displays **Needs review**, not a guessed stage.

The detail shows original legacy stage and owner values. Migration maps an owner only when the name matches exactly one active user. Ambiguous names and old stage labels retain their original evidence. Assignment does not erase that evidence or claim that every review issue is resolved.

**Potential duplicate leads** shows other active records with the same company and project description. Compare the enquiries before taking action. The system does not merge or delete them automatically. Different enquiries can share company and contact details without sharing a Lead identity.

## Resolve legacy values

The Lead cutover maps what the stored records support and leaves the rest visibly unresolved. Three things need a human decision:

| Review item        | When it is open                                   | What you choose                      |
| ------------------ | ------------------------------------------------- | ------------------------------------ |
| Lead Stage         | the stored label is not a canonical stage         | the canonical stage                  |
| Lead Owner         | the stored name matched no user, or more than one | an active user, or unassigned intake |
| Canonical Proposal | several Proposals link to the enquiry             | the one authoritative Proposal       |

Open **Leads**, tick **Needs review only**, and open a Lead. The **Legacy review** panel on the Lead detail page shows the original values, the linked Proposals, and the facts the old records never stored as unknown. The stage-entry date, the original author, and the call outcome are unknown for legacy records; the creation and update timestamps are record timestamps, not stage history.

Resolve one item at a time: pick the value, write the reason, and select **Resolve**. The decision keeps the original value, the selected resolution, your name, and the time. Decisions are listed under **Review history** and stay there.

Permissions follow the decision. A stage needs `leads:update`. An owner needs `leads:assign`. The canonical Proposal needs `leads:update` and `proposals:read`, because you have to be able to see the Proposals you choose between. A refused or invalid decision changes nothing.

Two rules keep the cutover honest. Resolve the owner before an active stage, because a stage such as Qualified or Nurture needs a resolved owner. And a stage of **Converted** is never a review decision: conversion arrives through the linked Proposal handoff.

A resolved Lead leaves the review queue and stays in every operational result, under its resolved stage. Nothing is deleted when you resolve an item. Duplicate Proposals and their references stay exactly as they are, and the choice of canonical Proposal is recorded next to them.

## Keep one canonical Proposal per enquiry

A Lead has one authoritative Proposal. A Proposal create or edit that would add a second link to an enquiry is refused, with the enquiry's existing Proposal named in the message. Use the linked Proposal, or resolve the legacy review to choose the canonical one.

Re-saving a Proposal that keeps its link is not a new link and stays allowed. A Proposal that never had a link is unaffected. When a Proposal stops pointing at its enquiry, or is deleted, the enquiry recomputes its canonical Proposal from the Proposals that still link to it. The recorded decision stays in the review history.

## Record what happened

Open the Lead detail and use the **Log activity** form. Choose the kind of
work, when it happened, and any plain-text notes. A call also needs its
outcome: Connected, No Answer, Busy, Voicemail, or Wrong Number. An email
asks whether the client replied. A sent email is not a reply.

Tick **Schedule the next action now** to date the next step in the same entry.
The next action is scheduled work: it has a date, a kind, and an author.

Recording needs `leads:update`. The signed-in user is the author; a request
never names an author. Notes stay plain text.

| Activity | What it records                             | What it needs                                     |
| -------- | ------------------------------------------- | ------------------------------------------------- |
| Call     | the call, with its outcome                  | one of the canonical outcomes                     |
| Email    | the message, and whether the client replied | a confirmed reply is contact; a sent email is not |
| Meeting  | the meeting                                 | —                                                 |
| Note     | a plain-text note                           | —                                                 |

A task status and a call outcome are different things. A scheduled task
answers _is the work scheduled, completed, or cancelled_. A call outcome
answers _what happened during the call_. A finished attempt can be **No
Answer** and still be a completed call.

### The stages that move by themselves

| What you record               | Stage movement                        |
| ----------------------------- | ------------------------------------- |
| First call, email, or meeting | New → Attempting Contact              |
| Connected call                | New or Attempting Contact → Connected |
| Confirmed email reply         | New or Attempting Contact → Connected |
| Note or scheduled task        | no stage change                       |

Only these two movements happen on their own. A failed call is an attempt, not
a disqualification. Qualified, Nurture, Disqualified, and Converted never move
down. A Converted Lead takes no new Lead-side sales work: its follow-up
belongs to the linked Proposal.

### The dated next action

Attempting Contact, Connected, Qualified, and Nurture need a dated next
action. New, Disqualified, and Converted never need one.

The check uses the stage the Lead has **after** the write, so the first
outreach on a new Lead needs its next action in the same request. Closing the
last scheduled action of such a Lead needs its replacement in the same
request. A refused entry writes nothing: no activity, no next action, no
stage change.

### The Lead timeline

The Lead detail shows one chronological history: the activities and the
scheduled work, the stage changes, the owner changes, the corrections, and
the conversion. Completed work and scheduled work are marked apart, and each
entry carries when it happened, who recorded it, and when it was recorded.

The summary next to it shows the owner, the stage, the source, the last
successful contact, the latest outcome, the dated next action, and the linked
Proposal. **Last successful contact** advances on a connected call or a
confirmed email reply only: a failed attempt never counts as contact.

Legacy records stay honest. The old records never stored the author or the
call outcome, so the timeline shows them as unknown instead of guessing. The
record's creation date is a record date; it is not a stage-entry date.

## Correct a logged activity

A logged activity can be wrong. Correct it from the Lead timeline: every
logged activity has a **Correct activity** control for users with the Lead
update right.

- The form asks for the **Correction reason** — it is required, and a
  correction without one is refused.
- The form shows the current values. Change only what is wrong: the values
  you leave alone stay as they are, and the corrected activity keeps its
  author, its occurrence time, and its recording time.
- After saving, the timeline shows a correction entry with the values before
  the correction, the reason, who corrected it, and when. The activity
  itself stays one entry: a corrected activity is still one activity in
  every total.
- If somebody corrected the same activity while you were writing, the save is
  refused with a conflict message and a **Reload the activity** button. Their
  correction is never overwritten.
- A correction never changes the stage of the Lead and never counts as new
  outreach. It also refuses to turn a record into outreach on a Lead that has
  no owner.
- Nothing is deleted. There is no delete for a Lead activity, and cancelling
  scheduled work keeps it as evidence.
- A legacy row keeps what it never knew: correcting it does not invent its
  author or its call outcome. The correction itself names the person who
  made it.

## Decide the Lead stage explicitly

Open the Lead detail and use **Lifecycle decisions**. The panel offers the
decisions the current stage allows: **Qualify**, **Nurture**,
**Disqualify**, and **Reopen**. Every decision needs `leads:update`, is
recorded with its reason, its author, and the time, and appears in the Lead
timeline.

| Decision   | What it means                             | What it needs                                                                                                    |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Qualify    | the enquiry is suitable and ready         | a named contact, a usable phone number or email address, a clear project need, an owner, and a dated next action |
| Nurture    | the enquiry is suitable but not ready now | an owner and a dated next action                                                                                 |
| Disqualify | the enquiry will not proceed              | a reason                                                                                                         |
| Reopen     | a disqualified enquiry comes back         | a reason, an owner, and a dated next action                                                                      |

Budget and project timing are not Lead fields, so they never block a
qualification.

A refusal names the field that is missing: a missing contact name, missing
contact details, a missing project need, a missing owner, a missing dated
next action, or a missing reason. Fill the field in and decide again.

**Disqualify** closes the Lead. Its outstanding scheduled work is cancelled,
never deleted, and the Lead leaves the active work queue. Every recorded
call, email, meeting, and note stays, and the reason of the decision stays in
the stage history.

**Reopen** applies to a disqualified Lead only. The reopened Lead returns to
**Attempting Contact** with its owner and its dated next action. The earlier
disqualification stays visible in the timeline.

A **Converted** Lead takes no lifecycle decision. Routine sales work belongs
to the linked Proposal. Generic edits and CSV imports cannot express these
decisions either: a conversion or a disqualification arrives through its
audited action only, and an import row that asks for one is refused without
saving a Lead.

Automatic activity updates never override a decision. A recorded call, email,
or meeting never moves a Lead out of **Qualified**, **Nurture**, or
**Disqualified**.

## Work Leads through the queues

Open **Leads**. The queue tabs above the table split the Leads into the work
that needs attention. Each tab shows how many Leads it holds, counted over
the whole filtered dataset and not over the visible page.

| Queue          | Shows                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------- |
| All Leads      | every Lead the filters allow                                                                    |
| My Leads       | the Leads you own                                                                               |
| Unassigned     | the Leads without an owner, including the legacy records whose owner name could not be resolved |
| Due Today      | the Leads with outstanding work dated today                                                     |
| Overdue        | the Leads with outstanding work dated before today                                              |
| Untouched      | the Leads without completed outreach; a note is not outreach                                    |
| No Next Action | the Leads in an active stage without a dated next action                                        |

**My Leads** always means the signed-in user. The server resolves the owner,
so no request can open another person's queue. **Unassigned** never guesses an
owner: a record whose owner name could not be resolved stays unassigned and
says so.

**Due Today** and **Overdue** read the outstanding scheduled work of the
Lead. Work that was completed, cancelled, or moved to a Proposal is not
outstanding and never stays in a due queue. The dates follow the application
calendar day.

**Untouched** means no completed call, email, or meeting. A note is not
outreach, so a Lead with only notes stays in the queue.

**No Next Action** holds the Leads in Attempting Contact, Connected,
Qualified, or Nurture without a dated next action. Those stages need one, so
every Lead in this queue needs a next action. New, Disqualified, and
Converted Leads need none, and the preserved legacy records are included.

Use the **Lead Owner**, **Lead Stage**, and **Next Action Date** filters to
narrow the queues. The **Next Action Date** filter offers any date, due
today, overdue, and the next seven days. The counters follow the filters,
and a deleted Lead leaves both the rows and the totals.

Every row shows the owner, the stage, the contact, the dated next action, and
the linked Proposal. A Lead without a resolved owner or stage says so and
keeps its original value for review; nothing is guessed. Open a Lead to see
its timeline, log work, and record the next action.

## Convert a Lead into its Proposal

A Qualified Lead becomes a Proposal with one action: **Convert to Proposal** on
the Lead list or on the Lead detail page. The handoff creates the one
canonical Proposal of the enquiry, marks the Lead **Converted**, records the
conversion, and moves the scheduled Lead work to the Proposal. The action
opens the Proposal of the enquiry, and a repeated action opens the same
Proposal again.

The Lead must be **Qualified** before it can be converted. Any other stage is
refused, and the refusal names the required stage. The Lead also needs a named
contact, a usable phone number or email address, a clear project need, and a
resolved owner. Each missing item is refused with its own message, and the
interface shows it against the field it belongs to. Budget and project timing
are not Lead fields, so they never block a conversion.

The handoff needs three permissions: `leads:convert`, `leads:update`, and
`proposals:create`. A missing permission is refused before anything is
written.

What the handoff does to the records:

- The Proposal carries the company, contact, and project evidence of the Lead,
  and the canonical link to the enquiry. Its own status vocabulary is
  untouched: **Converted** is a handoff, never a sale won.
- The Lead is marked **Converted**, and the enquiry keeps the time and the
  person of the conversion.
- The conversion is recorded as evidence, and the stage history keeps the
  change.
- Every scheduled Lead task becomes one Proposal follow-up. The Lead task
  keeps the link to its destination, and the Lead work queue no longer lists
  it. The completed activities of the Lead stay with the Lead.
- A Lead whose enquiry already carries a Proposal returns that Proposal and
  writes nothing a second time. Two simultaneous actions still produce one
  Proposal.

An enquiry with several linked Proposals and no canonical choice is refused
with a review conflict. Open the **Legacy review** panel and choose the
canonical Proposal; the handoff never guesses one, and the prior alternatives
stay exactly as they are.

Generic Proposal create and edit requests cannot write the canonical Lead
link. That link belongs to the handoff.

## Follow the enquiry after the conversion

A converted Lead keeps its own history and points at the Proposal that
replaced it. The **Proposal progress** panel on the Lead detail shows:

- the link to the canonical Proposal, its own status, its own progress, and
  its value;
- the next action of the Proposal, which is now the next action of the
  enquiry: the sales work of a converted Lead continues on the Proposal;
- the Project the Proposal links to, once the Proposal has become a Project.

Four states stay apart, and each one says what it is:

| State       | What it means                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| No Proposal | The enquiry has no Proposal yet.                                                                                   |
| Unresolved  | The enquiry carries several Proposals and no canonical choice. A reviewer picks one in the legacy review panel.    |
| Restricted  | The reader may read Leads but not Proposals, so no Proposal title, status, value, or Project information is shown. |
| Available   | The canonical Proposal and its current progress are shown.                                                         |

The read permissions decide what is visible: `proposals:read` for the
Proposal details, `projects:read` for the Project details. A reader with only
`leads:read` sees the Lead, its history, and the restricted marker.

The canonical link is the only source. No Proposal is matched by name, by
the newest date, or by a second link; an unresolved link is never guessed.

Converted is a handoff, never a sale won. The panel states the Proposal's
own status and progress and renames nothing: Proposal approval, the
Proposal-to-Project conversion, and revenue recognition keep their own
rules. Price changes stay in the Proposal revision controls — the Lead side
has no price change and offers no second conversion.

## Change notes — issue #376

- Added the downstream read of a converted Lead: the canonical Proposal, its
  current status, progress, and value, its next action, and the Project it
  later links to. The canonical link is the only source — no name match, no
  newest-date guess, no second link.
- Applied the Proposal and Project read permissions to the Lead detail read
  and to the Lead list row: a reader with only `leads:read` gets the Lead,
  its history, and a restricted marker, never a Proposal title, status,
  value, or Project information.
- Added the Proposal progress panel to the Lead detail, and the current
  Proposal status and progress to the Lead list row.
- Kept the next action of a converted Lead on its Proposal: the Lead refuses
  new Lead-side sales work, and the panel names the Proposal's next action.
- Converted still means a handoff: Proposal approval, the
  Proposal-to-Project conversion, revenue recognition, and the Proposal
  revision controls keep their own rules, and no second conversion is
  offered.

## Change notes — issue #375

- Added the Lead-to-Proposal handoff: one action on the Lead screens creates
  the canonical Proposal, marks the Lead Converted, records the conversion,
  and transfers the scheduled work.
- Added the database-enforced canonical linkage, the conversion evidence
  table, and the conversion marks on the enquiry.
- Added the conversion refusals: a missing permission, a stage that is not
  Qualified, a missing named contact, a missing phone number or email
  address, a missing project need, a missing owner, and an unresolved
  canonical Proposal.
- Refused a client-supplied canonical Lead link on the Proposal create and
  edit paths, and released the link when a Proposal is deleted.

## Change notes — issue #374

- Added the Lead queues (My Leads, Unassigned, Due Today, Overdue,
  Untouched, No Next Action) with the owner, stage, and due-date filters.
- Added full-dataset counters that reconcile with the table, the tabs, and
  the pagination.
- Replaced the two list-route filter parsers with one shared parser, and the
  `status` filter with the `stage` filter.
- The Lead workspace row now shows the owner, the stage, the contact, the
  next action, and the linked Proposal, and states the unknown legacy values
  instead of guessing them.
- An unknown queue selection is refused with the `view_invalid` code instead
  of quietly showing the wrong queue.

## Change notes — issue #373

- Added the explicit Qualify, Nurture, Disqualify, and Reopen decisions with
  their own audited action, their field-level refusals, and the reason, the
  author, and the time of every decision.
- Added the qualification checks: a named contact, a usable phone number or
  email address, and a clear project need. Budget and timing stay optional.
- A disqualification now cancels the outstanding work explicitly and keeps
  every recorded activity; a reopening needs a reason, an owner, and a dated
  next action, and keeps the earlier disqualification visible.
- Generic edits and CSV imports can no longer express a conversion or a
  disqualification.

## Change notes — issue #372

- Added the correction of a logged activity with a required reason, the
  previous values, the correcting user from the session, and the time.
- The timeline shows a correction next to its activity; the corrected
  activity stays one activity in every total.
- A stale correction is refused with a conflict instead of overwriting
  somebody else's accepted correction.
- There is no delete path for a Lead activity, and cancelling scheduled work
  keeps the activity and its correction history.

## Change notes — issue #371

- Added the Lead activity log: calls with structured outcomes, emails,
  meetings, and plain-text notes, each with its occurrence time, its
  recording time, and its authenticated author.
- Separated the scheduled work from the completed activity: a task status
  answers whether work is scheduled, completed, or cancelled, and a call
  outcome answers what happened during the call.
- Added dated next actions, including the rule that an active Lead keeps one
  and that the last scheduled action needs a replacement.
- Added the automatic, forward-only stage movement for the first outreach and
  for a connected call or confirmed reply.
- Added the chronological Lead timeline with stage changes, owner changes,
  activities, scheduled work, and the legacy unknown markers.
- Replaced the legacy per-Lead follow-up table and its writers with one
  activity log, so no writer can bypass the owner, next-action, or stage
  rules.

## Change notes — issue #370

- Added a review flow for unresolved legacy stages, owner names, and duplicate Proposal links.
- Added the canonical Proposal linkage, the per-dimension review state, and an append-only decision history with the reviewer, the reason, and the time.
- Added the stored-value inventory of the legacy stage labels and owner names, with the count and the classification of each value.
- Guarded the Proposal create and edit paths against a second authoritative Lead link, and stopped unrelated Proposal edits from clearing the Lead link.
- Legacy facts the records never stored stay explicitly unknown. Record timestamps are never presented as stage history.

## Change notes — issue #369

- Replaced display-name-only ownership with stable user references and transactional ownership history.
- Consolidated surviving Lead create, edit, import, and read requests behind one server workflow module.
- Replaced conflicting Lead status lists with the canonical stage vocabulary.
- Added unassigned intake, original legacy evidence, review indicators, and duplicate candidates.
- Removed the client-side two-request conversion path. Ordinary field edits cannot simulate a Proposal handoff.
- Added a repeatable HTTP integration command and CI job that run against a disposable MariaDB database, the engine production uses. See [integration guidance](integration.md).
