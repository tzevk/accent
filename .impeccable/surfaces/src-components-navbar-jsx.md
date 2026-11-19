---
version: 1
slug: 'src-components-navbar-jsx'
primary_target: 'src/components/Navbar.jsx'
related_targets: ['src/components/watermelon-ui/navigation-2.tsx']
---

Scope: src/components/Navbar.jsx and src/components/watermelon-ui/navigation-2.tsx, the fixed top bar and its mobile sheet.
Visitor mode: Operate. Audience: internal CRM and HR staff who move between modules and admin queues daily.
Job: reach a permitted module, report or admin group in one step; see notifications and the current section.
Constraints: RBAC governs every link; existing hrefs and sub-items stay; Reports stays in the top bar; dark mode is present but inert.

## Direction contract

THESIS: A white shadcn navigation-menu bar replacing the purple gradient band. It refuses the marketing mega-menu's feature cards and keeps one compact link row plus two permission-aware menus.

OWN-WORLD: White ground, 1px lilac border, ink links, lavender active fill and brand-purple type in Poppins; 12px pill links, 12px white dropdown cards with a soft shadow, and the Accent mark cropped from the existing logo.

STORY: Staff see Dashboard, Leads, Proposals and Projects, then the Reports and Admin menus they are allowed to use, with the open section in lavender. The bar ends with an inert dark-mode control and the notification bell.

FIRST VIEWPORT: A 64px fixed bar, Accent mark at left, six 14px top-level entries, actions at right. Reports opens a 380px list below the bar; Admin opens an 860px, three-column permission-aware panel. Below `lg` the same items become a right-side sheet.

FORM: pinned by the user's words "Use the component I pasted from a shadcn registry" with the navigation-2 registry URL. seed: none (pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and the mark asset's provenance.
