---
name: Accent
description: Internal CRM and HR platform with a persistent purple-accented shadcn navigation spine.
colors:
  brand-purple: '#64126d'
  brand-purple-deep: '#52105a'
  brand-ring: '#86288f'
  purple-50: '#faf5ff'
  purple-100: '#f3e8ff'
  purple-200: '#e9d5ff'
  surface-white: '#ffffff'
  ink: '#171717'
  muted: '#6b7280'
  destructive: '#dc2626'
  chart-logged: '#64126d'
  chart-capacity: '#64748b'
  chart-pending: '#d97706'
  chart-approved: '#059669'
  chart-draft: '#2563eb'
  chart-rejected: '#e11d48'
typography:
  body:
    fontFamily: 'Poppins, sans-serif'
    fontSize: '16px'
  nav-item:
    fontFamily: 'Poppins, sans-serif'
    fontSize: '14px'
    fontWeight: 500
  label:
    fontFamily: 'Poppins, sans-serif'
    fontSize: '12px'
    fontWeight: 500
  mono:
    fontFamily: 'Geist Mono, monospace'
rounded:
  sm: '4px'
  md: '6px'
  lg: '8px'
  xl: '12px'
spacing:
  sidebar-pad: '8px'
  row-height: '32px'
  subrow-height: '28px'
  topbar-height: '64px'
components:
  sidebar:
    backgroundColor: '{colors.surface-white}'
    textColor: '{colors.brand-purple}'
    width: '256px'
  sidebar-menu-button:
    backgroundColor: '{colors.surface-white}'
    textColor: '{colors.brand-purple}'
    typography: '{typography.nav-item}'
    rounded: '{rounded.md}'
    padding: '8px'
    height: '32px'
  sidebar-menu-button-active:
    backgroundColor: '{colors.purple-100}'
    textColor: '{colors.brand-purple}'
    typography: '{typography.nav-item}'
    rounded: '{rounded.md}'
    padding: '8px'
    height: '32px'
  sidebar-avatar:
    backgroundColor: '{colors.brand-purple}'
    textColor: '{colors.surface-white}'
    rounded: '9999px'
    size: '32px'
  primary-button:
    backgroundColor: '{colors.brand-purple}'
    textColor: '{colors.surface-white}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '36px'
  primary-button-hover:
    backgroundColor: '{colors.brand-purple-deep}'
    textColor: '{colors.surface-white}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '36px'
  ghost-button:
    backgroundColor: 'transparent'
    textColor: '{colors.brand-purple}'
    rounded: '{rounded.md}'
    padding: '0 12px'
    height: '32px'
  top-navbar:
    backgroundColor: '{colors.surface-white}'
    textColor: '{colors.ink}'
    borderColor: '{colors.purple-200}'
    height: '64px'
  top-navbar-link:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.nav-item}'
    rounded: '{rounded.xl}'
    padding: '6px 12px'
  top-navbar-link-active:
    backgroundColor: '{colors.purple-100}'
    textColor: '{colors.brand-purple}'
    typography: '{typography.nav-item}'
    fontWeight: 600
    rounded: '{rounded.xl}'
    padding: '6px 12px'
  top-navbar-dropdown:
    backgroundColor: '{colors.surface-white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    shadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'
---

# Design System: Accent

## Overview

**Creative North Star: "The Persistent Navigation Spine."**

Accent's shipped interface is an internal work tool: dense, flat, and organized around one fixed navigation spine. The current shell is the shadcn sidebar at the left — a white 16rem panel that collapses to a 3rem icon rail without losing state — paired with a separate top navigation bar that carries the Accent mark, the module links, and the permitted Reports and Admin menus. Neither layer replaces the other in the build; new screens inherit both.

The palette is white plus five purple steps: deep brand purple for text, icons, active fills and primary buttons; lavender for selection and separators; a lighter purple for focus. Surfaces sit flat, corners use an 0.5rem base radius, and the icon language is Lucide at a single 16px stroke size inside the sidebar (the top bar uses Lucide for its chrome and outline Heroicons for menu item icons). Page content uses the same purple on cards and headers, but this document records only rules that are actually reused across the shell.

**Key Characteristics:**

- White sidebar shell with deep-purple text and icons; no dark mode (backgrounds are forced white).
- Two widths only: 16rem expanded, 3rem collapsed icon rail (18rem mobile sheet).
- Lavender selection fill with matching purple foreground; lilac 1px separators.
- Flat surfaces; the top bar is flat, and only its dropdown cards carry a shadow.
- Poppins body face loaded in the root layout; Geist Mono for code and metrics.
- Lucide icons in the sidebar and the top bar's chrome; outline Heroicons for top-bar menu items.

## Colors

The palette is a small purple ramp on white. Brand purple is the workhorse; the lighter steps are reserved for selection, separation and quiet backgrounds.

### Primary

- **Accent Purple** (`#64126d` / `--purple-700`): Shadcn `--primary`, `--sidebar-foreground`, `--sidebar-primary` and `--sidebar-accent-foreground`; nav icons, nav labels, the footer avatar fill, primary buttons and the logged-hours chart series.
- **Pressed Purple** (`#52105a` / `--purple-800`): Hover state of the solid primary button only.
- **Focus Purple** (`#86288f` / `--ring`, `--sidebar-ring`): Focus ring on sidebar rows, top-bar links, and controls.

### Secondary

- **Selection Lavender** (`#f3e8ff` / `--purple-100`, `--sidebar-accent`, `--accent`): Hover, open and active fills for sidebar menu rows; also the quiet `--muted` / `--secondary` background.
- **Separator Lilac** (`#e9d5ff` / `--purple-200`, `--sidebar-border`, `--border`, `--input`): 1px rules — the sidebar footer border, the Masters submenu's left rule, field strokes.
- **Wash Lilac** (`#faf5ff` / `--purple-50`): Ghost-button hover and the lightest secondary/muted backgrounds.

### Neutral

- **White Shell** (`#ffffff` / `--background`, `--card`, `--popover`, `--sidebar-background`): App background, card and popover surfaces, sidebar panel, and foreground text on purple.
- **Ink** (`#171717` / `--foreground`): Default body text; also the dark fill of collapsed-rail tooltips.
- **Muted Gray** (`#6b7280` / `--neutral-500`, `--muted-foreground`): The account email in the sidebar footer and other quiet secondary text. Group labels are brand purple at 70% opacity, not gray.
- **Destructive Red** (`#dc2626` / `--red-600`, `--destructive`): Destructive actions; the danger button variant deepens to `rose-700` on hover.

Chart series tokens, defined alongside the semantic colors: logged `#64126d`, capacity `#64748b`, pending `#d97706`, approved `#059669`, draft `#2563eb`, rejected `#e11d48`.

**The Purple-on-White Rule.** Inside the shadcn sidebar, brand purple is text, icon, active fill and avatar — never the panel background. The white shell is what makes the lavender selection legible.

**The Lavender-Selection Rule.** Selection, hover and open states use `--sidebar-accent` (`#f3e8ff`) with `--sidebar-accent-foreground` (`#64126d`); separation uses `--sidebar-border` (`#e9d5ff`). No other fill marks an active row.

## Typography

**Body Font:** Poppins (sans-serif fallback), loaded via `next/font/google` in the root layout at 400, 500, 600 and 700, and applied on `body` in `globals.css`.
**Label / Nav Font:** Poppins at 12px and 14px, weight 500.
**Mono Font:** Geist Mono, exposed as `--font-geist-mono` / `--font-mono`.

**Character:** A neutral geometric sans for daily data entry and navigation. Poppins is the only text face; Geist Mono is reserved for code and fixed-width identifiers.

### Hierarchy

- **Body** (400, 15px at ≥1280 per the responsive rule; 16px otherwise): Page copy and form text.
- **Nav item** (500, 14px / `text-sm`): Sidebar menu rows and top-bar links.
- **Label** (500, 12px / `text-xs`): Sidebar group labels (`text-sidebar-foreground/70`), account name, badges, tooltips.
- **Fine print** (400, 12px / `text-xs`): Account email in the sidebar footer.
- **Nav heading** (600, 12px, uppercase, wide tracking): Section headings in the top bar's Reports/Admin panels and mobile sheet.

**The Single Body Face Rule.** Poppins is the body default; Geist Mono is reserved for code and metrics. Do not set a second body family in a screen stylesheet.

## Layout

The desktop shell reserves a 64px band at the top for the fixed navbar (`h-16`, `scroll-padding-top: 64px`). The shadcn sidebar begins at `top: 64px` and runs to `calc(100svh - 4rem)`, so the two layers never overlap. Its expanded width is 16rem (256px); collapsed width is 3rem (48px); the mobile sheet is 18rem (288px). The panel state is persisted in a 7-day `sidebar_state` cookie, toggleable with the header trigger, the rail, or Cmd/Ctrl+B.

At `md` and above, the Accent mark and sidebar toggle share the collapsed rail's centerline. The navbar stays full width, and both shell dividers use the same lilac.
The navbar lifts the mark artwork by 4px to offset the asset's transparent top padding. The link and navigation controls stay in place.

Vertical rhythm is 8px-based: header and footer `p-2`, menu padding `p-2`, 32px menu rows (`h-8`), 28px submenu rows (`h-7`), 32px group labels (`h-8`). The Masters submenu indents with `mx-3.5` and a left border, and hides entirely in icon mode. The footer is separated by a 1px `border-t`. Open content offsets by 64px for the navbar, and the task panel sits at `left: 256px` while the sidebar is expanded.

Responsive behavior is structural: below `md` the desktop panel is hidden and navigation arrives as a slide-in sheet; the top bar keeps the Accent mark, the dark-mode placeholder, the notification bell and the menu trigger. Between `md` and `lg` the sidebar is present while top-bar section links stay collapsed into the sheet.

The Proposals and Projects lists follow the Leads page gutters and panel height. Filters wrap, and counters respond to the space left by the sidebar. Horizontal scrolling belongs to the results tables and project calendar, not the page.

The user dashboard uses the same page gutters. Its attendance tiles adapt to the content width, and the activity editor keeps its columns inside a keyboard-scrollable table.

**The Persistent Spine Rule.** One panel, two widths — 16rem or 3rem — with state preserved across reloads. No hover-reveal rail or competing flyout in the sidebar; the only expandable group is Masters.

## Elevation & Depth

The sidebar is flat at rest and in every state: selection is tonal, not lifted. The top bar is flat too. Depth in the shell belongs to its floating dropdown cards and to page cards (`rounded-xl`, `shadow-xl`, 1px lilac ring). Collapsed-rail tooltips are dark on `--foreground` with a 6px corner, not elevated cards.

**The Flat-By-Default Rule.** Do not add shadows to sidebar rows, groups or the panel. If a surface needs separation from white, use `--sidebar-border` or the lavender selection fill.

## Shapes

The radius base is 0.5rem (8px, `--radius`), with derived steps of 4px (`sm`), 6px (`md`), 8px (`lg`) and 12px (`xl`). Menu rows, submenu rows, group labels, badges, tooltips and buttons use the 6px `rounded-md` step; the account avatar is a 32px circle; the top bar's links, its dropdown panels, and page cards use 12px. Lines are single pixels in lilac; the collapsed rail shows a 2px hover bar at its edge.

**The Eight-Pixel Base Rule.** New shell surfaces derive their corners from `--radius`; do not introduce a separate radius scale.

## Components

### Buttons

- **Shape:** 6px radius (`rounded-md`), `font-medium`, color transition, 2px focus ring in `purple-300`.
- **Primary:** `#64126d` fill with white text (solid button variant), 36px tall (`h-9`), 16px horizontal padding; hover `#52105a`; disabled `purple-300`.
- **Outline:** white fill, 1px `gray-200` border, `gray-700` text, hover `gray-50`.
- **Ghost / trigger:** transparent with `#64126d` text; hover `#faf5ff`. The sidebar trigger is a ghost icon button (32px, `PanelLeftIcon`).
- **Danger:** `rose-600` fill, white text, hover `rose-700`, disabled `rose-300`.
- **Sizes:** small 32px (`h-8`, 12px padding), medium 36px (`h-9`, 16px padding), icon 36×36 (`h-9 w-9`).

### Sidebar menu rows

- **Shape / size:** full-width 6px-radius row, 8px padding, 32px tall; icons 16px (`size-4`), text 14px.
- **Rest:** white surface, `#64126d` label and icon; group label at 70% purple, 12px.
- **Hover / open / active:** `#f3e8ff` fill with `#64126d` text; active rows add medium weight. The Masters parent also tracks `data-open` for its rotated chevron.
- **Focus:** 2px `#86288f` ring (`focus-visible:ring-2`).
- **Icon state:** rows become 32×32, labels and badges disappear, and tooltips appear to the right only when collapsed.

### Badges

- **Unread count:** 20px-tall, rounded-md, `px-1`, 12px medium tabular numerals in `--sidebar-foreground` — used for Messages; the count is fetched every 60 seconds. Hidden in icon mode; the badge carries no colored fill of its own.

### Avatar

- **Shape:** 32px circle (`size-8 rounded-full`), `#64126d` fill, white 12px semibold initials (first two characters of the display name). Hidden in icon mode, alongside the account name and email.

### Navigation

- **Sidebar (shadcn, current):** `collapsible="icon"`, left, fixed below the navbar. Pages group holds Dashboard, Messages, Tasks (toggles the task panel), Support Tickets, Timesheet and admin-only Manage Tickets. Masters is a collapsed-by-default group of permission-filtered record lists; it opens automatically on master routes. Reports is not a sidebar group. Icons are Lucide at one 16px stroke size.
- **Top bar (shadcn navigation menu):** fixed, `z-50`, 64px tall, white with a 1px lilac bottom border. The Accent mark links to `/dashboard`; Dashboard, Leads, Proposals and Projects are plain links. Reports and Admin are hover/click menus rendered in a 12px white card: Reports is a one-column list of permitted report links; Admin is a three-column grouping of every permitted admin group. Links are 14px Poppins; active and open states use the lavender fill and brand purple. The right side holds an inert dark-mode control and the notification bell. Below `lg` the module links collapse into a right-side sheet with the same items, with Reports and Admin as accordions. The mark is `public/accent-mark.png`, cropped from the existing `public/accent-logo.png`; its white background was cleared to alpha.

### Top bar rows

- **Rest:** transparent, ink text at 75% opacity, 14px medium, 12px radius, `px-3 py-1.5`; hover fills lavender with brand-purple text.
- **Active / open:** lavender fill, brand-purple text, semibold; the open trigger rotates its chevron. The current sub-item adds the same lavender fill.
- **Dropdown card:** white, 12px radius, 1px lilac ring, `shadow-xl`, 8px below the 64px bar; Reports is 380px wide, Admin 860px with a 3-column grid and internal scroll on short viewports.
- **Mobile sheet:** right-side, up to 340px on phones and 380px from `sm`, white, with the Accent mark, the module links, the Reports and Admin accordions, the permitted Pages list, then Sign Out pinned by a top border.

### Tooltips

- **Style:** dark `#171717` fill, white 12px text, 6px radius, `px-3 py-1.5`, placed to the right of collapsed rows; suppressed on mobile.

## Do's and Don'ts

### Do:

- **Do** keep the panel at 16rem expanded and 3rem collapsed (`--sidebar-width`, `--sidebar-width-icon`) and reserve 64px for the fixed navbar.
- **Do** use `--sidebar-accent` (`#f3e8ff`) with `--sidebar-accent-foreground` (`#64126d`) for hover, open and active rows.
- **Do** keep sidebar icons Lucide at `size-4` (16px), one stroke weight.
- **Do** derive corners from the 0.5rem `--radius` base and keep sidebar surfaces flat.
- **Do** keep navigation permission-filtered, preserve existing hrefs, and leave Reports in the top bar.
- **Do** keep the top bar flat white with a lilac border; top-level links and dropdown cards use the 12px radius, and only the dropdown cards and mobile sheet carry a shadow.
- **Do** keep the dark-mode control present but inert until the app ships a dark palette.

### Don't:

- **Don't** add a Reports group to the sidebar; Reports belongs to the top bar in this build.
- **Don't** introduce a hover-rail / flyout hybrid or a second expandable sidebar group; the spine holds one 16rem-or-3rem state.
- **Don't** switch the shell to dark surfaces — the app is light-only and backgrounds are forced white.
- **Don't** use Heroicons inside the shadcn sidebar; the top bar owns that outline set for its menu items.
- **Don't** restore the purple gradient band or a scrolled shadow on the top bar.
- **Don't** add shadows to sidebar rows or panels, or a second body font family to screen styles.
