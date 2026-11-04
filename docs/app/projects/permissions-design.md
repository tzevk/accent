# Project permissions design

Approved on 2026-11-04. **Implemented on `integration/410-project-permissions` (issue #410).**

This document records the agreed project access policy. The policy module, section vocabulary, scoped saves, team lifecycle, commercial omission, financial gates, and migrations implement it.

Domain terms: [Project Team Member and Project Lead](../../../GLOSSARY.md). Decision: [ADR-0034](../../adr/0034-project-membership-lead-policy-and-explicit-scopes.md).

## Goals

- Give Project Team Members a Projects navigation entry without requiring broad project permissions.
- Give Project Leads work-editing rights only on projects they lead.
- Configure lead section rights through one shared policy.
- Separate project scope, permitted actions, work sections, and commercial access.
- Enforce the policy on direct URLs and APIs, not only visible buttons.
- Preserve explicitly granted broad management access during migration.

## Access sources

| Source | Default authority |
| --- | --- |
| Project Team membership | Projects navigation, the member section set, and limited contributions on that project. |
| Project Lead designation | The shared lead policy on that project. Several leads may serve one project. |
| Explicit project permission | Its action, permitted sections or fields, and saved project scope. |
| Explicit financial permission | Its financial document area, subject to access to the target project workspace. |
| Explicit commercial field permission | The permitted project amounts, independently of financial document permissions. |
| Super-admin | Existing permission bypass remains. Data integrity rules still apply. |

Project Lead is a responsibility within one Project, not a system-wide role or Employee Designation.

### Membership

Membership comes from Project Team, the team edited through `ProjectTeamTab`.

- An activity assignment alone does not grant project workspace access.
- An employee's designation does not establish team membership or lead authority.
- Adding someone to an activity requires that person to be a Project Team Member first.
- Activity assignment must not silently add someone to Project Team.
- Historical activity assignments must not become a fallback workspace access grant.

### Explicit project scopes

Configure scope separately for each granted project action:

| Scope | Projects covered |
| --- | --- |
| Led projects | Projects where the person is designated Project Lead. |
| Assigned projects | Projects where the person belongs to Project Team, including led projects. |
| All projects | Every project covered by the granted action, without requiring team membership. |

Read, Update, Assign, Close, and Delete can have different scopes. Create has no existing-project scope.

An action grant does not grant unrelated actions. Assign must not become a full-project Update grant.

Explicit grants add authority within their scope. The shared lead policy restricts lead-derived rights, not separate explicit grants.

Financial and commercial permissions remain independent. Project Update alone must not reveal or modify protected commercial data.

## Shared Project Lead policy

Use one configurable policy for all Project Leads. Do not introduce per-user or per-project lead policies.

Each work section can be hidden, read-only, or editable through the shared policy. The approved starting policy makes every work section editable.

| Tab | Ordinary member baseline | Project Lead starting policy |
| --- | --- | --- |
| Project Details | Hidden | Edit |
| Scope | View | Edit |
| Project Activity | Hidden | Edit |
| Schedule | View | Edit |
| Project Team | View | Manage all team roles |
| Input Document | View | Edit |
| Deliverables | View | Edit, including all sign-off fields |
| Meeting | Hidden | Edit |
| Progress Measurement | Hidden | Edit |
| Project Manhours | Hidden | Edit |
| Software | Hidden | Edit |
| Query Log | View and existing limited contributions | Edit |
| Assumption | View and existing limited contributions | Edit |
| Lessons Learnt | View and existing limited contributions | Edit |
| Discussion | View and existing limited contributions | Edit |
| Upload Documents | View | Edit |
| Quotation | No membership-derived access | No lead-derived access |
| Purchase Order | No membership-derived access | No lead-derived access |
| Invoice | No membership-derived access | No lead-derived access |

Explicit permissions may add rights beyond this baseline. A tab's visibility must not grant a write action.

Project Details includes editable work metadata such as project code, name, client, and dates. Commercial fields remain protected even when their stored values share the project record.

### Deliverable sign-offs

The shared lead policy initially grants Prepared By, Checked By, Approved By, and Client Approval rights on led projects.

This is deliberate authority, not merely access to ordinary deliverable fields. The shared policy may later restrict these rights.

### Ordinary member contributions

Preserve existing limited contribution workflows:

- Own activity entries and work records.
- Queries, assumptions, discussions, and lessons learnt through the existing contribution workflows.

Do not convert these workflows into general project editing, team management, or authority over another person's work.

The member section set remains the existing ten-section set. Viewing Upload Documents does not itself grant upload or deletion rights.

## Team and lead lifecycle

Project Leads may add and remove team members and change every team role on projects they lead.

- Several Project Leads are allowed.
- A new project may start without a lead.
- Once appointed, the last lead cannot be removed or demoted without a replacement.
- This protection includes a lead removing or demoting themselves.
- Validate changes against the current team, not the submitted replacement team alone.
- Concurrent changes must not remove the last lead or restore revoked authority through a stale save.

Removing a person from Project Team revokes their team-derived workspace access and future activity edits on that project.

Preserve historical assignments, entries, authorship, and reporting evidence. Retained history grants no new access.

Explicit broader permissions remain separate. Removing membership does not revoke an independent All projects grant.

## Project lifecycle actions

Lead status alone grants none of these actions:

- Create a project.
- Delete a project.
- Close a project.
- Reopen a project.

These actions require separate explicit permissions. Existing-project actions must respect their saved scope.

Editing a work section must not provide another route to a protected lifecycle transition.

## Commercial boundary

Hide Quotation, Purchase Order, and Invoice unless their separate financial permissions grant access.

Hide project budget, value, internal cost, profitability, and other protected commercial amounts unless commercial field permissions grant access.

- A document permission reveals its document area, not every project amount.
- Commercial field rights remain separate from quotation, purchase order, and invoice rights.
- Hidden values must be absent from unauthorized API responses, not merely hidden in the interface.
- Hidden values must also be protected from unauthorized updates.
- Lead status and broad project Update do not replace financial or commercial permissions.

Financial permissions can add access for a member or lead. They do not establish Project Team membership.

## Navigation, direct URLs, and API enforcement

Projects navigation must reflect effective project access, including membership and scoped explicit grants.

A lead must not need the Projects Update workaround to open and manage led projects.

Every affected read and write path must use the same target-project policy:

- Project lists, project view, edit data, and direct edit URLs.
- Collection-level and individual-project update or deletion handlers.
- Team changes, activity allocation, activity self-service, and member contributions.
- Status transitions, follow-ups, and project work logs.
- Project documents, financial tab requests, and shared handlers serving those tabs.
- Imports and full-form saves that reach the same write paths.

Required boundaries:

1. Establish the authenticated identity and target project.
2. Check the current relationship or explicit action grant and scope.
3. Check section and field rights independently of page visibility.
4. Reject unauthorized mutations before writing.
5. Omit protected fields from read responses.
6. Deny access when membership or permission checks fail.

A read-only member opening `/projects/[id]/edit` must not gain write authority. Guessing an ID or tab query parameter must not reveal protected sections.

Section-scoped saves must not rewrite inaccessible sections. Replace the current whole-form authorization assumption; hidden controls are not sufficient.

## Migration and rollout

The approved migration preserves existing explicit management authority:

- Existing Projects Update grants receive All projects scope.
- Existing Projects Assign grants receive All projects scope, but authorize assignment operations only.
- Preserve role-derived and direct-user grants. Do not silently narrow either source.
- Do not grant other actions merely because Update or Assign exists.
- Normalize stored `project_team[].role = 'Project Manager'` values to `Team Member`.
- Do not change Employee Designation, account role, or unrelated team-role values.
- Do not infer Project Lead from position, designation, names, email, or activity assignments.

Administrators must review users who received Update only as a lead-access workaround. Remove that redundant grant or narrow its scope for lead-only access.

**Deliberate consequence:** an existing Update holder can still edit projects they do not lead after migration. All projects remains an explicit grant until changed.

Deploy the policy, scope migration, server enforcement, and corresponding screens as one coherent cutover. Do not leave old unrestricted write paths available.

Use the existing authorization-cache invalidation mechanism for explicit permission changes. Team-derived authorization must reflect membership removal on subsequent requests.

No application migration or database changes were performed during this design session.

## Investigation evidence

Observed on 2026-11-04 before implementation:

- Navbar Projects visibility requires `projects:read` in `src/components/Navbar.jsx`.
- `src/utils/project-access.ts` checks team identity, not the team's role label.
- The edit form disables inputs and submission for ordinary members, but those client checks do not protect write APIs.
- The individual project PUT handler permits any team member to update project content.
- Projects Update and Assign bypass the individual PUT handler's membership check.
- The PUT membership-check exception path logs the failure and continues.
- Project reads return commercial fields within the project record before field filtering.
- Activity self-assignment checks the target user and project existence without requiring Project Team membership.
- Read-only development database inspection found old Project Manager values in the team-role field, independently of employee position.

### Executed authorization smoke

Executed the actual individual-project route handler through an in-memory Node VM harness.

The harness used the real RBAC and project-access helpers. Authentication, database, schema metadata, and sanitization dependencies used isolated fixtures.

| Scenario | Observed PUT result |
| --- | --- |
| Ordinary Team Member with no project grants changes project name | 200; captured update |
| Activity-only assignee with no team membership or grants changes project name | 403; no update |
| Unrelated user with Projects Update changes project name | 200; captured update |
| Unrelated user with Projects Assign changes project name | 200; captured update |
| Unrelated user with no grants changes project name | 403; no update |
| Membership query throws for a user with no grants | 200; captured update |

These are isolated handler observations, not live database or browser results. No real database writes occurred.

The DELETE guard also trusts team membership. Its mutation hardcodes `WHERE id = ?`, while inspected project schemas use `project_id`. A schema-realistic fixture returned 500 without mutation. Do not describe this as a successful live-database deletion bypass.

## Implementation acceptance scenarios

These are future verification requirements, not checks completed by this documentation change.

- A lead of A and ordinary member of B edits all permitted work sections on A, but cannot generally edit B.
- The same lead sees Projects navigation without explicit Projects Read or Update.
- The lead edits B only after an explicit applicable grant and scope authorizes it.
- Existing Update holders retain All projects scope until administrators change it.
- Assign-only users cannot change project names, commercial fields, or unrelated sections.
- Separate Read, Update, Assign, Close, and Delete scopes remain independent.
- Ordinary members retain the approved section set and limited contribution workflows.
- Activity-only assignees cannot obtain workspace access or self-assign into an unrelated project.
- A lead cannot assign activity to a non-member.
- Team removal blocks further team-derived reads and activity edits while preserving historical records.
- Direct edit URLs, guessed tab parameters, collection writes, and child APIs cannot bypass authorization.
- Lead-only users cannot create, delete, close, or reopen projects through any payload shape.
- Several leads can coexist. Removing the last lead requires a replacement, including concurrent requests.
- Lead deliverable sign-offs follow the shared lead policy.
- Financial document grants and commercial field grants remain independent.
- Unauthorized reads omit commercial values; unauthorized writes cannot alter them.
- A scoped save preserves sections the actor cannot edit.
- A membership lookup failure denies access rather than allowing a write.
- Old Project Manager team roles become Team Member without changing Employee Designation.

Use focused authorization contracts and real runtime scenarios during implementation. Verify the actual navigation and project workspace, not only helper functions.
