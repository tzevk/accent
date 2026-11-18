---
version: 1
slug: 'src-components-sidebar-jsx'
primary_target: 'src/components/Sidebar.jsx'
related_targets: []
---

Scope: src/components/Sidebar.jsx, the app shell, and the shadcn sidebar primitives.
Visitor mode: Operate. Audience: internal CRM and HR staff who navigate modules daily.
Job: reach the current task with the least friction; keep unread Messages and the active route visible.
Constraints: RBAC governs every link; existing hrefs stay; Reports stay out of the sidebar.

## Direction contract

THESIS: One persistent navigation spine that collapses to icons without losing state. It refuses the hover-rail hybrid, where labels and a long submenu compete with the page.

OWN-WORLD: Shadcn sidebar primitives in Accent's hex palette: white shell, #64126D icons and active fill, #f3e8ff selection, #e9d5ff separators, lucide icons at one stroke weight.

STORY: Staff see one Masters group holding every permitted record list, Messages with its unread count, Tasks toggling the panel, and Timesheet. The current route is unmistakable.

FIRST VIEWPORT: A 16rem left panel with the toggle in its header, PAGES rows, then Masters collapsed by default. The 3rem rail shows parent icons only. No Reports group.

FORM: pinned by the user's words "implement the shadcn sidebar" with the brand theme. seed: none (pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
