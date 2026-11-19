# Project platform comparison: ERPNext, Odoo, and Deltek

**Research note, not a decision.** Evidence read on **2026-11-17** from Accent and
ERPNext source plus official vendor documentation. No product was installed,
trialled, configured, demonstrated, or benchmarked. Pricing, edition entitlement,
implementation effort, and end-to-end replacement fit remain unverified.

The question: does an existing project platform natively reproduce Accent's
project workspace — one project record whose tabs combine scope and assumptions,
team, manhours, per-person activity assignments with daily quantity and hours,
issued/received documents, query/RFI log, schedule, procurement and invoices,
meetings, and closeout material?

Short answer: **no reviewed product is proven to match the complete integrated
workflow.** ERPNext and Odoo provide native commercial, task, time, and financial
functions. Deltek Vantagepoint supports project financials, time, and daily units.
Deltek PIM separately handles engineering document control. These are substantive
overlaps, not evidence that any product reproduces Accent's exact workspace.

## Comparison baseline

Accent keeps the project as the primary record. Its current project navigation has
19 reachable tab IDs. The wider project subsystem also carries scope/assumptions,
project team, manhours, activity assignments (per person, with date, hours,
quantity done, and remarks), documents issued and received, query log, schedule,
purchase orders and invoices, meetings, and lessons/handover. Some legacy activity
views exist outside the current tab navigation, so the comparison below targets
the workflow and data model, not only what is currently clickable.

Two distinctions matter throughout:

1. **A native capability is not the same workflow.** A timesheet with hours and a
   separate quantity field is not Accent's assignment row where both describe the
   same piece of work.
2. **A tab is not a module.** Vendor apps may expose related records through
   separate menus and forms; that does not reproduce one project workspace with
   Accent's tab semantics.

### What the current Accent source actually exposes

The [canonical registry](../../../src/lib/project-tabs.js), lines 33–57,
defines the current navigation. The
[editor](../../../src/app/projects/[id]/edit/EditProjectForm.jsx), lines
180–229, 4094–4127, and 4539–4557, builds navigation from that registry.
LSP references to `setActiveTab` found only initialization, canonical-tab reset,
and navigation clicks.

The implemented project workflow includes:

- Discipline/activity/subactivity selection and per-person assignments:
  [Project Activity](../../../src/app/projects/[id]/edit/tabs/ProjectActivityTab.jsx).
- Scope, assumptions, client queries/replies, schedule, meetings, progress
  measurement, and lessons/handover.
- Deliverable revision, issue-stage, planned/actual-date, and prepare/check/
  approve/client sign-off fields:
  [Documents Issued](../../../src/app/projects/[id]/edit/tabs/DocumentsIssuedTab.tsx),
  lines 17–60.
- Project manhours, employee/client rate distinctions, and financial views:
  [Project Manhours](../../../src/app/projects/[id]/edit/tabs/ProjectManhoursTab.jsx).

The source folder is not a list of equally reachable features. `my_activities`,
`construction`, `risk`, and `closeout`, among others, have legacy render branches
but no current registry entry. The daily quantity/hour/balance grid exists in
[My Activities](../../../src/app/projects/[id]/edit/tabs/MyActivitiesTab.jsx),
lines 455–489, while the editor does not expose that tab through current navigation.
Daily work records also exist in the API and reporting model; this is not a claim
that activity logging is absent. The dashboard has a separate
[activity assignment interface](../../../src/components/ProjectActivityAssignments.jsx).
This was a source inspection, not a browser verification of deployed behavior.

## ERPNext 16

Inspected the local `version-16` checkout at commit
`8e10a348daaa93853de8c36dc55ec789a440c219` (16.55.0).

### Native capabilities

- Opportunity to quotation mapping:
  [implementation, lines 592–641](https://github.com/frappe/erpnext/blob/8e10a348daaa93853de8c36dc55ec789a440c219/erpnext/crm/doctype/opportunity/opportunity.py#L592-L641).
- A submitted sales order can create a linked Project:
  [implementation, lines 1361–1385](https://github.com/frappe/erpnext/blob/8e10a348daaa93853de8c36dc55ec789a440c219/erpnext/selling/doctype/sales_order/sales_order.py#L1361-L1385).
- Project templates, completion methods, customer/order links, and actual
  hours, costing, purchase-invoice cost, and invoiced totals:
  [Project schema](https://github.com/frappe/erpnext/blob/8e10a348daaa93853de8c36dc55ec789a440c219/erpnext/projects/doctype/project/project.json).
- Hierarchical tasks, dependencies, milestones, expected hours, and progress:
  [Task schema](https://github.com/frappe/erpnext/blob/8e10a348daaa93853de8c36dc55ec789a440c219/erpnext/projects/doctype/task/task.json).
- Employee Timesheets with activity/project/task, hours, and separate billing
  and costing fields:
  [Timesheet](https://github.com/frappe/erpnext/blob/8e10a348daaa93853de8c36dc55ec789a440c219/erpnext/projects/doctype/timesheet/timesheet.py#L70-L185)
  and [Timesheet Detail](https://github.com/frappe/erpnext/blob/8e10a348daaa93853de8c36dc55ec789a440c219/erpnext/projects/doctype/timesheet_detail/timesheet_detail.json).

### Limits and uncertainty

This is not Accent's exact Lead → Proposal → Project meaning. Native sales-order
conversion does not establish matching proposal handoff rules.
The inspected Project/Task/Timesheet models do not establish a direct equivalent
to per-person assigned quantities, daily `qty_done`, remaining-quantity balances,
and the linked engineering document/query registers.
Generic attachments and comments do not establish deliverable issue/revision or
sign-off parity. Configuration or a custom app may fill gaps, but that has not
been designed or demonstrated.

**Assessment:** a genuine native match for the general project/task/time and
commercial spine. Not a demonstrated replacement for the engineering workspace.


## Odoo 19

Odoo documents a chain of separately activated applications: CRM, Sales, Project,
Timesheets, Accounting, Purchase, and Expenses. The cited pages describe app
activation and configuration, not a single packaged project workspace.

### Native capabilities

- **CRM opportunity to quotation to sales order.** A qualified lead is converted
  to an opportunity; **New Quotation** creates a quotation linked to it, requires
  the Sales app, and confirmed quotations become sales orders. The source also
  documents quotation templates, order lines, preview, and email delivery ([Odoo
  CRM quotations](https://www.odoo.com/documentation/19.0/applications/sales/crm/acquire_leads/send_quotes.html)).
- **Quotation to project and task.** A service product can set **Create on Order**
  to **Project & Task**; confirming a sales order for that product creates a
  project and task. The same product can use **Based on Timesheets** as its
  invoicing policy ([Odoo time and materials](https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/time_materials.html)).
- **Per-person daily hours.** Timesheets must be enabled on the project, and users
  must be employees. The My Timesheets grid records time per project per day.
  Entry details include Date, Project, Task, Description, Sales Order Item when
  the project is billable, and Time Spent. Users log their own time; broader roles
  can view, edit, and validate all employees' timesheets ([Odoo
  Timesheets](https://www.odoo.com/documentation/19.0/applications/services/timesheets.html)).
- **Milestones.** Milestones are project records that can be linked to tasks. When
  a milestone is marked reached, the delivered quantity on the linked sales-order
  line updates, and that delivered quantity can be invoiced ([Odoo milestone
  invoicing](https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/milestone.html)).
- **Purchase and invoicing links.** The time-and-materials flow supports invoicing
  time, expenses, and purchases needed to fulfil an order; it requires the
  Purchase and Accounting apps for those parts. Project profitability can include
  timesheet revenue and cost, customer invoices, materials, expenses, and purchase
  orders linked to the project, provided the records carry the project and its
  analytic account. Purchase-order cost appears only after the vendor bill is
  posted ([Odoo project
  profitability](https://www.odoo.com/documentation/19.0/applications/services/project/project_management/project_profitability.html)).

### Limits and uncertainty

- **Apps, not one project tab set.** CRM, Sales, Project, Timesheets, Accounting,
  Purchase, and Expenses are distinct applications with their own menus. The
  cited docs do not describe a project form with Accent's scope, assumptions,
  query log, meetings, lessons, or document-issue sections.
- **Hours are native; per-activity quantity done is not established.** The
  timesheet pages document hours, project/task, description, and sales-order item.
  They do not document a daily "quantity done" field attached to an assigned
  activity, nor a BOQ/activity category with an assigned quantity cap.
- **Milestones are not deliverable quantities.** Milestone completion updates a
  sales-order delivered quantity; it is not the same object as an assigned
  deliverable quantity with daily progress.
- **Edition and commercial entitlement unresolved.** The docs say to activate
  apps; they do not establish whether a given database or Odoo edition includes
  every app, nor what is licensed. No Community/Enterprise or pricing conclusion
  is drawn here.
- **Document control not covered.** The cited Odoo pages do not establish
  Accent-style issued-document revision statuses, prepare/check/approve/client
  signatures, received-document logging, or transmittal-class issue records.

**Assessment:** Odoo is a **partial native match** for the commercial-to-delivery
spine — quote, sales order, project/task, daily hours, milestone billing, purchase
costs, and project profitability. It is **not evidenced** as the same integrated
per-person daily quantity-plus-hours workflow, and it does not expose the Accent
tab set. Parity would need configuration and, for the quantity/document sections,
customization; that scope was not estimated.

## Deltek Vantagepoint

Vantagepoint is marketed as an ERP for architecture, engineering, and consulting
firms. Its product page groups CRM and pipeline, project management with plans,
Gantt charts and dashboards, resource management, and financial management and
billing, including timesheet and expense entry ([Deltek Vantagepoint
product](https://www.deltek.com/products/erp/vantagepoint/)).

### Native capabilities

- **Project, phase, and task time entry.** A timesheet row selects a project and,
  when configured, a phase and task. Selecting an unbudgeted project, phase, or
  task prompts the user to confirm whether to keep the selection ([Vantagepoint
  phase/task
  entry](https://help.deltek.com/product/vantagepoint/2025.2/ts_enter_a_project_for_a_timesheet.html)).
- **Daily units, in addition to hours.** Vantagepoint documents a **Hours/Units**
  toggle. In Units mode the row carries project/phase/task, a unit table, a unit,
  and a per-day **Quantity** plus description. The unit table can default from the
  project's accounting setup at the lowest work-breakdown level. The grid totals
  units and shows the unit of measure; the timesheet can be saved or submitted,
  and changed units require a revision explanation that is retained in revision
  records ([Vantagepoint
  units](https://help.deltek.com/Product/Vantagepoint/6.0/ts_Enter_Units_in_Timesheet.html)).
- **Financial and resource layer.** The product page documents resource management,
  project plans and Gantt charts, project dashboards, financial management, and
  billing. It does not itemize every project tab or field.

### Limits and uncertainty

- **Units are not automatically Accent's quantity done.** The documented unit
  record is a unit-table entry with a unit of measure, used while "charging" a
  project. That is consistent with billing or cost units, not with a proven
  assigned deliverable quantity, activity category, remaining-quantity check, or
  BOQ progress model.
- **Hours and units are a toggle, not a proven shared row.** The help describes
  switching the timesheet between Hours and Units modes. It does not establish
  simultaneous hours and quantity on the same daily assignment line, which is the
  Accent pattern.
- **No Accent tab set.** The product page describes modules and views, not a single
  project record with Accent's scope, assumptions, query log, meetings, lessons,
  or document-issue sections. Exact field-level parity is unverified.
- **Commercial scope unresolved.** Vantagepoint's module packaging and licensing
  are not established by these pages. No pricing or entitlement claim is made.

**Assessment:** Vantagepoint is a closer engineering-specific project ERP/time
candidate, and its daily unit entry is substantive overlap with quantity tracking.
It is still **not proven** to match the per-person daily quantity-plus-hours
workflow. The documented unit-table entry and Accent's assigned deliverable
quantity need a real fit test; the exact accounting meaning was not validated.

## Deltek PIM

Deltek PIM is a **separate product** for project information management at A&E
firms, not a Vantagepoint module. Deltek markets it for email, document, and
drawing control, and states that it integrates with Vantagepoint and Ajera ([Deltek
PIM product](https://www.deltek.com/products/delivery-assurance/project-information-management/)).
It is not Deltek ComputerEase, which Deltek lists separately as construction
accounting and job costing.

### Native capabilities

- **Controlled document lifecycle.** PIM's Design Management uses Document
  Lifecycle Manager (DLM) placeholders with document numbers, sets, work packages,
  and revisions. It documents review and approval routes, resubmittals, and
  document issues through the Document Control System (DCS) ([PIM Design
  Management](https://help.deltek.com/Product/PIM/26.0/DLM_Main.html)).
- **Issue and transmission control.** Documents are issued from DLM placeholders
  to selected recipients, with chosen renditions, previous revisions, reason,
  issue method, hardcopy/CD copy counts, notes, and an issue log. Issues can
  require approval before processing ([PIM issue
  documents](https://help.deltek.com/Products/PIM/26.0/Issue_Documents_from_the_DLM.html)).
- **Version and audit control.** The PIM product page documents full version
  history, check-in/check-out file locking, and a complete audit trail, plus
  drawing review and markup and cross-project search.

### Limits and uncertainty

- **Separate product and workspace.** PIM integrates with Vantagepoint/Ajera; the
  cited pages do not show PIM sections inside the Vantagepoint project form as
  Accent tabs. The integration is a connection between products, not evidence of
  one package.
- **Transmittal-class, not a proven "Transmittals" object.** The cited pages use
  document issues, transmissions, recipients, renditions, and issue logs. That is
  the transmittal control class, but the exact Accent document fields and status
  vocabulary (for example IFI/IFR/IFA/IFD/IFC with prepare/check/approve/client
  signatures) are not mapped.
- **No timesheets or project financials.** PIM is document/drawing information
  management; it is not the Vantagepoint time, resource, or financial layer.
- **Commercial scope unresolved.** PIM is separately marketed; licensing,
  deployment, and integration effort are not established here.

**Assessment:** PIM is the **strongest native match for the document, drawing,
revision, review, and controlled-issue class.** It is not a project ERP and not a
substitute for the project workspace. Using it would mean integrating a second
Deltek product, not adopting one integrated suite.

## Summary

| Accent baseline need | ERPNext 16 | Odoo 19 | Deltek Vantagepoint / separate PIM |
| --- | --- | --- | --- |
| Commercial-to-project flow | Opportunity/quotation and sales-order/project mappings | Native, service-product configuration | CRM/project management; exact conversion not verified |
| Project tasks, planning, progress | Native templates, dependencies, milestones, hours/progress | Native tasks, planning, milestones across apps | Native project/resource layer |
| Employee project/task hours | Native Timesheets | Native Timesheets | Native Vantagepoint timesheets |
| Daily quantities | Exact assigned-quantity equivalent not established | Not established in cited timesheet docs | Native daily units; exact deliverable semantics untested |
| Same daily assignment: quantity + hours + remaining balance | Not established | Not established | Not established by separate Hours/Units modes |
| Project financial roll-up | Native time, purchase, sales totals | Native linked-app profitability | Native Vantagepoint financial layer |
| Engineering document revisions and controlled issues | Exact workflow not established | Not established in cited pages | Separate PIM provides substantive native controls |
| Scope, assumptions, client-query register, handover | Exact integrated workflow not established | Exact integrated workflow not established | Exact integrated workflow not established |
| Complete Accent workspace parity | Not demonstrated | Not demonstrated | Not demonstrated |

### Bottom line

- **Native partial matches:** ERPNext for the general commercial/project/task/time
  spine; Odoo for quote/order/project/time and milestone invoicing; Vantagepoint
  for project ERP, resource planning, hours, and daily units; PIM for engineering
  document/drawing/revision/issue control.
- **Not established:** the same integrated per-person daily quantity-plus-hours
  workflow, assigned-quantity balances, and linked document/query semantics.
- **Full replacement is unproven.** Broad overlap does not prove like-for-like
  replacement. Conversely, absent evidence is not proof that no add-on can fit.
- Keeping Accent's engineering workspace is defensible on workflow fit and
  adoption cost, not on claiming nobody else offers project or quantity tracking.
  HR/payroll extraction can be evaluated independently.

## Scope caveats

- Documentation snapshot: Odoo **19.0**, Vantagepoint Help **6.0/2025.2**, PIM Help
  **26.0**. Product documentation changes; claims are limited to the cited pages.
- No live product was used. Absence of a feature in these pages is not proof that
  no configuration, app, or add-on provides it.
- No pricing, edition, licence, implementation, migration, API, security, or
  reporting-parity conclusion is made. Odoo edition entitlement and Deltek module/
  PIM commercial terms remain open.
- "Units" in Vantagepoint is interpreted from the cited help. Its exact accounting
  and billing behaviour, and whether it can represent Accent's assigned deliverable
  quantity, were not tested against a tenant.
- Autodesk Docs/Build was not reviewed; PIM already establishes the
  document-control class for this comparison.
- The Accent baseline was checked against the current tab registry and source,
  not a deployed browser session. Legacy render branches are distinguished from
  registered navigation. ERPNext findings are source-level, not runtime proof.

## Sources

1. Odoo 19.0, **Timesheets** — https://www.odoo.com/documentation/19.0/applications/services/timesheets.html
2. Odoo 19.0, **Create and send quotations** and **Invoicing based on time and materials** — https://www.odoo.com/documentation/19.0/applications/sales/crm/acquire_leads/send_quotes.html; https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/time_materials.html
3. Odoo 19.0, **Invoice project milestones** and **Project profitability** — https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/milestone.html; https://www.odoo.com/documentation/19.0/applications/services/project/project_management/project_profitability.html
4. Deltek, **Vantagepoint product page**, **Enter Project, Phase, and Task for a Timesheet**, and **Enter Units in a Timesheet** — https://www.deltek.com/products/erp/vantagepoint/; https://help.deltek.com/product/vantagepoint/2025.2/ts_enter_a_project_for_a_timesheet.html; https://help.deltek.com/Product/Vantagepoint/6.0/ts_Enter_Units_in_Timesheet.html
5. Deltek, **PIM product page**, **Design Management**, and **Issue Documents from the DLM** — https://www.deltek.com/products/delivery-assurance/project-information-management/; https://help.deltek.com/Product/PIM/26.0/DLM_Main.html; https://help.deltek.com/Products/PIM/26.0/Issue_Documents_from_the_DLM.html
