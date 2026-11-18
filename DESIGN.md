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
    backgroundColor: 'linear-gradient(135deg, #64126d 0%, #86288f 100%)'
    textColor: '{colors.surface-white}'
    height: '64px'
---

# Design System: Accent

## Overview

**Creative North Star: "The Persistent Navigation Spine."**

Accent's shipped interface is an internal work tool: dense, flat, and organized around one fixed navigation spine. The current shell is the shadcn sidebar at the left — a white 16rem panel that collapses to a 3rem icon rail without losing state — paired with a separate, still-shipping legacy top navbar that carries broad section links and the Accent logo. Neither layer replaces the other in the build; new screens inherit both.

The palette is white plus five purple steps: deep brand purple for text, icons, active fills and primary buttons; lavender for selection and separators; a lighter purple for focus. Surfaces sit flat, corners use an 0.5rem base radius, and the icon language is Lucide at a single 16px stroke size inside the sidebar (the older navbar uses outline Heroicons at 20px). Page content uses the same purple on cards and headers, but this document records only rules that are actually reused across the shell.

**Key Characteristics:**

- White sidebar shell with deep-purple text and icons; no dark mode (backgrounds are forced white).
- Two widths only: 16rem expanded, 3rem collapsed icon rail (18rem mobile sheet).
- Lavender selection fill with matching purple foreground; lilac 1px separators.
- Flat surfaces; the only shell shadow is on the fixed top navbar.
- Poppins body face loaded in the root layout; Geist Mono for code and metrics.
- Lucide icons in the sidebar; outline Heroicons in the legacy navbar.

## Colors

The palette is a small purple ramp on white. Brand purple is the workhorse; the lighter steps are reserved for selection, separation and quiet backgrounds.

### Primary

- **Accent Purple** (`#64126d` / `--purple-700`): Shadcn `--primary`, `--sidebar-foreground`, `--sidebar-primary` and `--sidebar-accent-foreground`; nav icons, nav labels, the footer avatar fill, primary buttons and the logged-hours chart series. It is the first stop of the top navbar gradient.
- **Pressed Purple** (`#52105a` / `--purple-800`): Hover state of the solid primary button only.
- **Focus Purple** (`#86288f` / `--ring`, `--sidebar-ring`): Focus ring on sidebar rows and controls; second stop of the top navbar gradient.

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

- **Body** (400, 15px at ≥1280 per the legacy responsive rule; 16px otherwise): Page copy and form text.
- **Nav item** (500, 14px / `text-sm`): Sidebar menu rows and the legacy navbar links (`xl:text-base` at extra-large widths).
- **Label** (500, 12px / `text-xs`): Sidebar group labels (`text-sidebar-foreground/70`), account name, badges, tooltips.
- **Fine print** (400, 12px / `text-xs`): Account email in the sidebar footer.
- **Nav heading** (600, 12px, uppercase, wide tracking): Section headings in the legacy navbar's mobile menu only.

**The Single Body Face Rule.** Poppins is the body default; Geist Mono is reserved for code and metrics. Do not set a second body family in a screen stylesheet.

## Layout

The desktop shell reserves a 64px band at the top for the fixed navbar (`h-16`, `scroll-padding-top: 64px`). The shadcn sidebar begins at `top: 64px` and runs to `calc(100svh - 4rem)`, so the two layers never overlap. Its expanded width is 16rem (256px); collapsed width is 3rem (48px); the mobile sheet is 18rem (288px). The panel state is persisted in a 7-day `sidebar_state` cookie, toggleable with the header trigger, the rail, or Cmd/Ctrl+B.

Vertical rhythm is 8px-based: header and footer `p-2`, menu padding `p-2`, 32px menu rows (`h-8`), 28px submenu rows (`h-7`), 32px group labels (`h-8`). The Masters submenu indents with `mx-3.5` and a left border, and hides entirely in icon mode. The footer is separated by a 1px `border-t`. Open content offsets by 64px for the navbar, and the task panel sits at `left: 256px` while the sidebar is expanded.

Responsive behavior is structural: below `md` the desktop panel is hidden and navigation arrives as a slide-in sheet; the legacy navbar keeps the logo and bell, replacing desktop links with a hamburger. Between `md` and `xl` the sidebar is present while navbar section links stay collapsed into the mobile menu.

**The Persistent Spine Rule.** One panel, two widths — 16rem or 3rem — with state preserved across reloads. No hover-reveal rail or competing flyout in the sidebar; the only expandable group is Masters.

## Elevation & Depth

The sidebar is flat at rest and in every state: selection is tonal, not lifted. Depth in the shell belongs to the legacy top navbar (`shadow-lg`, becoming `shadow-xl backdrop-blur-lg` when scrolled) and to floating dropdowns and page cards (`rounded-xl`, `shadow-xl`, 1px `border-gray-100`). Collapsed-rail tooltips are dark on `--foreground` with a 6px corner, not elevated cards.

**The Flat-By-Default Rule.** Do not add shadows to sidebar rows, groups or the panel. If a surface needs separation from white, use `--sidebar-border` or the lavender selection fill.

## Shapes

The radius base is 0.5rem (8px, `--radius`), with derived steps of 4px (`sm`), 6px (`md`), 8px (`lg`) and 12px (`xl`). Menu rows, submenu rows, group labels, badges, tooltips and buttons use the 6px `rounded-md` step; the account avatar is a 32px circle; the fixed navbar's dropdown panels and page cards use 12px. Lines are single pixels in lilac; the collapsed rail shows a 2px hover bar at its edge.

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
- **Top navbar (legacy, still shipping):** fixed, `z-50`, 64px tall, 135° gradient from `#64126d` to `#86288f` (translucent stops when scrolled), white logo tile, white / white-90 links with rgba-white active and hover washes, a 20px outline-Heroicons icon set, and a hamburger + bell below `xl`. Active and hover rows use `rounded-xl`; dropdown panels are white with a shadow.

### Tooltips

- **Style:** dark `#171717` fill, white 12px text, 6px radius, `px-3 py-1.5`, placed to the right of collapsed rows; suppressed on mobile.

## Do's and Don'ts

### Do:

- **Do** keep the panel at 16rem expanded and 3rem collapsed (`--sidebar-width`, `--sidebar-width-icon`) and reserve 64px for the fixed navbar.
- **Do** use `--sidebar-accent` (`#f3e8ff`) with `--sidebar-accent-foreground` (`#64126d`) for hover, open and active rows.
- **Do** keep sidebar icons Lucide at `size-4` (16px), one stroke weight.
- **Do** derive corners from the 0.5rem `--radius` base and keep sidebar surfaces flat.
- **Do** keep navigation permission-filtered, preserve existing hrefs, and leave Reports in the top navbar.

### Don't:

- **Don't** add a Reports group to the sidebar; Reports belongs to the legacy top navbar in this build.
- **Don't** introduce a hover-rail / flyout hybrid or a second expandable sidebar group; the spine holds one 16rem-or-3rem state.
- **Don't** switch the shell to dark surfaces — the app is light-only and backgrounds are forced white.
- **Don't** use Heroicons inside the shadcn sidebar; that outline set belongs to the legacy navbar.
- **Don't** add shadows to sidebar rows or panels, or a second body font family to screen styles.
