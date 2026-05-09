# Responsive Design Audit Report

**Application:** Accent SmartOffice (Next.js + Tailwind CSS v4)  
**Date:** Auto-generated audit  
**Scope:** All pages in `src/app/` and shared components in `src/components/`

---

## Executive Summary

The application has **systemic layout issues on mobile** stemming from the global CSS and inconsistent page-level layout approaches. Many individual pages have decent grid breakpoints but share common top-level problems. The **Messages page** is the highest-severity issue (completely unusable on mobile), and **several pages render their own `<Navbar>` / `<Sidebar>` causing double rendering** with the root layout.

### Severity Legend
- 🔴 **Critical** — Page is broken / unusable on mobile
- 🟠 **High** — Significant layout overflow or content hidden
- 🟡 **Medium** — Suboptimal but usable with some scrolling
- 🟢 **Good** — Properly responsive

---

## 1. Global / Systemic Issues

### 1.1 Missing Mobile Content Offset (`globals.css`)
**File:** `src/app/globals.css` (lines 235–241)  
**Severity:** 🔴 Critical

The `.content-with-sidebar` class only applies `padding-left: 80px; padding-top: 64px` inside `@media (min-width: 640px)`. On mobile (<640px), there is **no padding-top at all**, so content renders behind the fixed Navbar (h-16 / 64px).

```css
/* Current: no mobile offset */
@media (min-width: 640px) {
  .content-with-sidebar { padding-left: 80px; padding-top: 64px; }
}
```

**Fix:** Add `padding-top: 64px` (or `4rem`) for mobile screens outside the media query:
```css
.content-with-sidebar { padding-top: 64px; transition: padding-left .2s ease-out; }
@media (min-width: 640px) {
  .content-with-sidebar { padding-left: 80px; }
}
```

### 1.2 Pages Rendering Their Own Navbar/Sidebar (Double Rendering)
**Severity:** 🟠 High

The root layout (`src/app/layout.jsx`) already renders `<Sidebar>` and wraps children in `.content-with-sidebar`. However, many pages **also** render `<Navbar>` and/or `<Sidebar>` themselves, creating double navigation. Pages that do this bypass the global layout offset, leading to inconsistent spacing.

**Affected pages:**
| Page | Renders Own Navbar | Renders Own Sidebar |
|---|---|---|
| `src/app/proposals/page.jsx` | ✅ (line ~206) | ❌ |
| `src/app/admin/quotation/page.jsx` | ✅ | ✅ |
| `src/app/admin/cash-voucher/page.jsx` | ✅ (line ~183) | ❌ |
| `src/app/admin/material-requisition/page.jsx` | ✅ | ❌ |
| `src/app/reports/page.jsx` | ✅ (line ~711) | ❌ |
| `src/app/admin/accounts/page.jsx` | ✅ (line ~165) | ❌ |
| `src/app/admin/da-schedule/page.jsx` | ✅ (line ~98) | ❌ |
| `src/app/profile/page.jsx` | ✅ (line ~86) | ❌ |
| `src/app/work-logs/page.jsx` | ✅ (line ~205) | ❌ |
| `src/app/leads/page.js` | ✅ | ❌ |
| `src/app/vendors/page.jsx` | ❌ | ❌ |
| `src/app/admin/live-monitoring/page.jsx` | ❌ | ❌ |

Pages that render their own `<Navbar>` typically use `pt-24` or `pt-22` to manually offset the navbar, which conflicts with the root layout's `.content-with-sidebar` padding.

---

## 2. Page-by-Page Audit

### 2.1 `src/app/messages/page.jsx` (792 lines)
**Severity:** 🔴 Critical — Completely unusable on mobile

| Issue | Location | Details |
|---|---|---|
| Fixed three-column layout | Lines ~throughout | Left nav `w-48`, message list `w-[360px]`, reading pane `flex-1` — all use `flex-shrink-0` |
| No mobile breakpoints | Entire file | Zero responsive classes; purely desktop Outlook-style layout |
| Content hidden behind sidebar | Outer div | Uses `pt-16` but no sidebar offset mechanism |
| No mobile navigation | — | No way to toggle between folder list, message list, and reading pane on small screens |

**Recommendation:** Implement a mobile-first stacked layout with tab/drawer navigation between the three columns. Use `hidden`/`block` at `md:` breakpoints to show/hide columns.

---

### 2.2 `src/app/projects/page.jsx` (1122 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `px-8` main padding | Line ~header area | Too wide on mobile; should be `px-4 sm:px-8` |
| Calendar `grid-cols-7` | Calendar tab | No mobile alternative — 7 tiny columns on phone |
| Board view overflow | Board tab | `grid-cols-1 md:grid-cols-3 xl:grid-cols-6` — OK for tablet+ but 6 columns still crowd on medium screens |
| Stats grid | — | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |
| Tab bar | — | `flex-wrap` ✅ Good |

---

### 2.3 `src/app/leads/page.js` (1304 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `px-8` outer padding | Line ~1211 | Too wide on mobile; should be `px-4 sm:px-8` |
| `pt-24` manual navbar offset | Line ~1211 | Conflicts with root layout `content-with-sidebar` |
| Table `table-fixed` + hardcoded widths | Table columns | `w-14`, `w-64`, `w-56`, `w-32`, `w-28`, `w-40` — columns are fixed pixel widths |
| Has `overflow-x-auto` wrapper | — | ✅ Good (mitigates table width) |
| Filter bar | — | `flex flex-col lg:flex-row` ✅ Good |
| Stats cards | — | `grid-cols-1 sm:grid-cols-3` ✅ Good |
| Add Lead form | Form section | `grid-cols-1 md:grid-cols-3` ✅ Good |

---

### 2.4 `src/app/employees/page.jsx` (5481 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `px-8` outer padding | Line 2237 | Too wide on mobile |
| `pt-24` manual offset | — | Already manages own nav offset |
| Header flex layout | Line ~2239 | `flex items-start justify-between gap-4` — buttons may wrap poorly on mobile; needs `flex-wrap` |
| Filter grid | Line ~2291 | `grid-cols-1 md:grid-cols-3 lg:grid-cols-5` ✅ Good |
| Table | Line ~2382 | `overflow-x-auto` wrapping ✅ Good |
| Pagination | — | Mobile/desktop split via `sm:hidden` / `hidden sm:flex` ✅ Good |
| Edit form sidebar | Line ~2537 | `col-span-12 lg:col-span-3` — good responsive split |
| Max-height calc | Line ~2383 | `max-h-[calc(100vh-320px)]` — may clip on small screens |

---

### 2.5 `src/app/tickets/page.jsx` (355 lines)
**Severity:** 🟢 Good

| Issue | Location | Details |
|---|---|---|
| Layout offset | — | `flex pt-16 sm:pl-16` ✅ Handles sidebar offset |
| Stats grid | — | `grid-cols-1 md:grid-cols-4` ✅ |
| Filters | — | `flex flex-wrap gap-4` ✅ |
| `min-w-[250px]` on filter inputs | — | May cause horizontal scroll on very small screens |
| Ticket cards | — | `min-w-0` + `truncate` ✅ Good overflow handling |

---

### 2.6 `src/app/vendors/page.jsx` (325 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `h-screen flex flex-col overflow-hidden` | Line ~1 | Full-height locked layout |
| `pt-22` custom value | Line ~padding | Unusual Tailwind value for navbar offset — may not resolve correctly |
| Stats grid | — | `grid-cols-1 md:grid-cols-4` ✅ Good |
| Filter grid | — | `grid-cols-1 md:grid-cols-4` ✅ Good |
| Table | — | `overflow-x-auto` + `min-w-full` ✅ Good |

---

### 2.7 `src/app/proposals/page.jsx` (508 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line ~206 | Double navbar with root layout |
| `px-8` header padding | Line ~210 | Too wide on mobile |
| `pt-24` manual offset | — | Conflicts with layout padding |
| Filter section | — | `flex flex-col sm:flex-row` ✅ Good |
| Stats grid | — | `grid-cols-1 md:grid-cols-4` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |
| Pagination | — | Mobile/desktop split ✅ Good |

---

### 2.8 `src/app/profile/page.jsx` (full file)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line 86 | Double navbar |
| `pt-22` manual offset | Line ~90 | Non-standard Tailwind value |
| Form grid | — | `grid-cols-1 md:grid-cols-2` ✅ Good |
| Page grid | — | `grid-cols-1 xl:grid-cols-3` ✅ Good |

---

### 2.9 `src/app/work-logs/page.jsx` (498 lines)
**Severity:** 🟢 Good

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line ~205 | Double navbar |
| Container | — | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` ✅ Excellent responsive padding |
| Filter grid | — | `grid-cols-1 md:grid-cols-3` ✅ Good |
| Modal | — | `fixed inset-0 ... max-w-2xl w-full max-h-[90vh] overflow-y-auto` ✅ Good |
| Form grids | — | `grid-cols-1 md:grid-cols-2`, `md:grid-cols-3` ✅ Good |
| Log cards | — | `flex items-start justify-between` — good but action buttons may crowd on mobile |

---

### 2.10 `src/app/reports/page.jsx` (1320 lines)
**Severity:** 🟠 High

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line ~711 | Double navbar |
| `px-6 py-6` flat padding | Line ~712 | No responsive variants |
| Header controls overflow | Lines 720–870 | Multiple selects, dropdowns, and buttons in a single `flex` row — **will overflow on mobile** |
| No `flex-wrap` on header actions | — | Month selector + salary type + employee dropdown + 2 buttons all in one unwrapped flex row |
| Stats grid | — | `grid-cols-2 md:grid-cols-6` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |
| Salary slip modal | — | `max-w-6xl w-full max-h-[90vh] overflow-auto` — very wide modal, OK on desktop |
| Print template | — | Uses fixed `colgroup` widths — print-only, acceptable |

**Recommendation:** Wrap header controls in `flex flex-wrap gap-3` and stack month/employee selectors on mobile with responsive widths.

---

### 2.11 `src/app/admin/dashboard/page.jsx` (697 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `px-6 py-6` flat padding | — | No responsive variants |
| No explicit mobile navbar offset | — | Relies on parent `.content-with-sidebar` (which lacks mobile padding-top) |
| KPI cards | — | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` ✅ Good |
| Manhours grid | — | `grid-cols-1 lg:grid-cols-3` ✅ Good |
| Projects table | — | `overflow-x-auto` ✅ Good |
| `max-w-[150px]` truncation | — | Acceptable |

---

### 2.12 `src/app/admin/tickets/page.jsx` (615 lines)
**Severity:** 🟢 Good

| Issue | Location | Details |
|---|---|---|
| Container | — | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` ✅ Excellent |
| Stats grid | — | `grid-cols-2 md:grid-cols-6` ✅ Good |
| Filters | — | `flex flex-wrap gap-4` ✅ Good |
| Modal | — | `fixed inset-0 ... max-w-4xl w-full` ✅ Good |
| `min-w-[250px]` on inputs | — | Minor edge case on very small screens |

---

### 2.13 `src/app/admin/invoice/page.jsx` (369 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `px-6 py-6` flat padding | — | No responsive variants |
| No explicit navbar offset | — | Relies on parent CSS (missing on mobile) |
| Stats | — | `grid-cols-2 md:grid-cols-6` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |
| Filters | — | `flex flex-wrap` + `min-w-[200px]` ✅ Good |

---

### 2.14 `src/app/admin/quotation/page.jsx` (364 lines)
**Severity:** 🟠 High

| Issue | Location | Details |
|---|---|---|
| **Double Sidebar + Navbar** | Renders `<Sidebar>` and `<Navbar>` explicitly | Root layout already renders these — causes duplicate navigation |
| Uses `flex` wrapper | Wraps sidebar + content in own flex layout | Completely bypasses `.content-with-sidebar` offset system |
| Same pattern as other admin pages | — | Stats, table, filters are fine |

---

### 2.15 `src/app/admin/purchase-order/page.jsx` (419 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `px-6 py-6` flat padding | — | No responsive variants |
| Stats | — | `grid-cols-2 md:grid-cols-6` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |

---

### 2.16 `src/app/admin/cash-voucher/page.jsx` (396 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line ~183 | Double navbar with root layout |
| `min-h-screen flex` outer wrapper | — | Own layout system, bypasses `.content-with-sidebar` |
| `p-6` flat main padding | — | No responsive variants |
| Stats | — | `grid-cols-2 md:grid-cols-5` ✅ Good |
| Filters | — | `flex flex-wrap gap-4` + `min-w-[200px]` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |

---

### 2.17 `src/app/admin/productivity/page.jsx` (365 lines)
**Severity:** 🟢 Good

| Issue | Location | Details |
|---|---|---|
| Filter grid | — | `grid-cols-1 md:grid-cols-3` ✅ Good |
| Charts | — | `ResponsiveContainer width="100%"` ✅ Good |
| Stats | — | `grid-cols-1 lg:grid-cols-3` ✅ Good |
| Missing navbar offset | — | Relies on parent CSS |

---

### 2.18 `src/app/admin/live-monitoring/page.jsx` (408 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| `h-screen flex flex-col overflow-hidden` | — | Full-height locked layout |
| `px-8 pt-24 pb-8` | — | Manual navbar offset; `px-8` too wide on mobile |
| Stats | — | `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` ✅ Good |
| Filters | — | `flex flex-wrap` + `min-w-[250px]` ✅ Good |

---

### 2.19 `src/app/admin/material-requisition/page.jsx` (359 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | — | Double navbar |
| Stats | — | `grid-cols-2 md:grid-cols-5` ✅ Good |
| Similar patterns to other admin pages | — | Table, filters generally OK |

---

### 2.20 `src/app/admin/da-schedule/page.jsx` (277 lines)
**Severity:** 🟢 Good

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line ~98 | Double navbar |
| Container | — | `px-4 sm:px-6 lg:px-8 py-8 pt-16` ✅ Good responsive padding |
| Form grid | — | `grid-cols-1 md:grid-cols-3` ✅ Good |
| Table | — | `overflow-x-auto` implicit via rounded container ✅ |

---

### 2.21 `src/app/admin/accounts/page.jsx` (338 lines)
**Severity:** 🟡 Medium

| Issue | Location | Details |
|---|---|---|
| Renders own `<Navbar>` | Line ~165 | Double navbar |
| `px-6 py-6` flat padding | — | No responsive variants |
| Stats | — | `grid-cols-2 md:grid-cols-4` ✅ Good |
| Filters | — | `flex flex-wrap gap-4` + `min-w-[200px]` ✅ Good |
| Table | — | `overflow-x-auto` ✅ Good |

---

### 2.22 `src/app/signin/page.jsx` (222 lines)
**Severity:** 🟢 Good

| Issue | Location | Details |
|---|---|---|
| Centered card | — | `fixed inset-0 flex items-center justify-center px-4` ✅ |
| Card sizing | — | `w-[420px] sm:w-[440px]` with `px-4` wrapper — works on mobile |
| Windows scaling | — | Platform-specific `transform: scale(0.85)` — unusual but not a responsive issue |

---

### 2.23 `src/app/user/dashboard/page.jsx`
**Severity:** 🟢 Good — Wrapper component that delegates to `user-dashboard` (dynamic import). No direct layout concerns.

---

### 2.24 `src/app/dashboard/page.jsx`
**Severity:** 🟢 Good — Simple redirect page with loading spinner. No responsive issues.

---

## 3. Components Audit

### 3.1 `src/components/Sidebar.jsx` (270 lines)
**Severity:** 🟢 Good for mobile (hidden), 🟡 Medium for desktop

- Correctly uses `hidden sm:block` to hide on mobile
- Fixed width `w-[64px]` collapsed, `hover:w-[260px]` expanded — desktop-only  
- No mobile hamburger drawer alternative (hamburger menu is in Navbar)

### 3.2 `src/components/Navbar.jsx` (493 lines)
**Severity:** 🟢 Good

- Has mobile hamburger menu (`md:hidden`)
- Desktop nav hidden on mobile (`hidden md:flex`)
- Fixed `h-16` with `z-50` positioning
- Mobile menu is a full overlay with proper close button

### 3.3 `src/components/TodoList.jsx` (511 lines)
**Severity:** 🟡 Medium

- Uses fixed `w-72` width — not responsive
- Designed as a sidebar panel widget, not a standalone page
- If rendered in a space smaller than 288px, it will overflow

### 3.4 `src/components/Layout.jsx` / `src/components/StatsCard.jsx`
**Severity:** N/A — Both files are empty

---

## 4. Summary of Recommendations

### Priority 1 — Critical Fixes

1. **Fix global mobile offset** in `globals.css`: Add `padding-top: 64px` for `.content-with-sidebar` outside the `@media (min-width: 640px)` block

2. **Redesign Messages page** (`src/app/messages/page.jsx`): Implement mobile layout with stacked views (folder → message list → reading pane) using tab/drawer pattern

3. **Remove duplicate Navbar/Sidebar** from pages that render their own — or, if pages need standalone layout, exclude them from the root layout wrapper

### Priority 2 — High Impact

4. **Reports page header overflow** (`src/app/reports/page.jsx`): Add `flex-wrap` and responsive stacking to the header controls row

5. **Quotation page double sidebar** (`src/app/admin/quotation/page.jsx`): Remove explicitly rendered `<Sidebar>` and `<Navbar>`

### Priority 3 — Medium Polish

6. **Replace `px-8` with `px-4 sm:px-8`** across all pages using wide fixed padding:
   - `src/app/projects/page.jsx`
   - `src/app/leads/page.js`
   - `src/app/employees/page.jsx`
   - `src/app/proposals/page.jsx`
   - `src/app/admin/live-monitoring/page.jsx`

7. **Replace `pt-22` / `pt-24`** manual offsets — standardize on the `.content-with-sidebar` CSS approach or a consistent Tailwind value

8. **Calendar view mobile alternative** (`src/app/projects/page.jsx`): Add a list/agenda fallback for small screens instead of `grid-cols-7`

9. **TodoList** (`src/components/TodoList.jsx`): Add `max-w-full` or responsive width instead of fixed `w-72`

### Priority 4 — Minor Polish

10. **`min-w-[250px]` filter inputs**: On screens <320px these can still cause overflow. Consider `min-w-0 w-full sm:min-w-[250px]`

11. **Leads table fixed column widths**: While `overflow-x-auto` prevents clipping, the `table-fixed` with `w-64` columns forces a very wide table. Consider making a few columns auto-width on desktop

---

## 5. Pages with Good Responsive Patterns (Reference)

These pages demonstrate proper responsive design and can serve as templates:

- **`src/app/work-logs/page.jsx`** — Uses `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`, responsive grids, proper modal sizing
- **`src/app/admin/tickets/page.jsx`** — Same `max-w-7xl` pattern, `flex-wrap` filters, good modal
- **`src/app/tickets/page.jsx`** — Proper sidebar offset (`sm:pl-16`), responsive stats grid, `min-w-0` on cards
- **`src/app/admin/da-schedule/page.jsx`** — Clean responsive padding, simple responsive grid
