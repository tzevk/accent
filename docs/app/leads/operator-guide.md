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

## Change notes — issue #369

- Replaced display-name-only ownership with stable user references and transactional ownership history.
- Consolidated surviving Lead create, edit, import, and read requests behind one server workflow module.
- Replaced conflicting Lead status lists with the canonical stage vocabulary.
- Added unassigned intake, original legacy evidence, review indicators, and duplicate candidates.
- Removed the client-side two-request conversion path. Ordinary field edits cannot simulate a Proposal handoff.
- Added a repeatable isolated-MySQL HTTP integration command and CI job. See [integration guidance](integration.md).
- Reordered unchanged baseline table creation so Proposals exist before the snapshot's Project foreign keys are resolved. Existing databases do not rerun this baseline.
