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
