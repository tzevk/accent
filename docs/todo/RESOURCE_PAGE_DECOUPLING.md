# ResourcePage Decoupling — TODO

**Status:** 1 of 9 consumers migrated. `src/components/admin/ResourcePage.tsx` is no longer in the build path for `payment-entry` but is still imported by 8 other admin pages.

> **Why this exists:** `POOR_PRACTICES_AUDIT.md` (also moved to `docs/todo/`) flagged the over-loaded generic `ResourcePage` as accumulating feature creep — pagination, stats, search, modals, form rendering, row actions, money/date/render cell helpers all glued together. Each new requirement risks breaking the 9 unrelated consumers. The fix is to stop reusing it.

---

## Done (2026-07-29)

| Item                                                  | Notes                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| New `src/app/admin/purchase-order/view/[id]/page.jsx` | Read-only PO view, mirrors `edit/[id]/page.jsx`; Back + Download PDF + Edit in header                                                |
| View button on `/admin/purchase-order` list           | `EyeIcon`, emerald, leftmost in the action cell                                                                                      |
| PO link in `/reports/sales-register`                  | Surfaced `po_id` from `invoices` (FK already in schema, was unselected) → linked `po_number` to `/admin/purchase-order/view/{po_id}` |
| Build error fix                                       | `ResourcePage.tsx` referenced undeclared `page`/`setPage` — added `useState(1)` at line 82                                           |
| `payment-entry` decoupled                             | `src/app/admin/payment-entry/page.tsx` is now a 516-line self-contained page using `ResourceFormModal` directly                      |

---

## Remaining — 8 consumers still on `ResourcePage`

All 8 import `ResourcePage` from `@/components/admin/ResourcePage`. Each is a candidate for the same pattern that `payment-entry` just used.

| Page                 | File                                        |
| -------------------- | ------------------------------------------- |
| `expenses`           | `src/app/admin/expenses/page.jsx`           |
| `other-expenses`     | `src/app/admin/other-expenses/page.tsx`     |
| `payment-issue`      | `src/app/admin/payment-issue/page.tsx`      |
| `payment-outgoing`   | `src/app/admin/payment-outgoing/page.jsx`   |
| `payment-payable`    | `src/app/admin/payment-payable/page.jsx`    |
| `payment-receivable` | `src/app/admin/payment-receivable/page.jsx` |
| `purchase-invoice`   | `src/app/admin/purchase-invoice/page.jsx`   |
| `quotation-outgoing` | `src/app/admin/quotation-outgoing/page.jsx` |

Run `grep -rn "from '@/components/admin/ResourcePage'" src/app/admin/` to confirm the current consumer list before starting each one.

---

## Migration recipe (proven on `payment-entry`)

1. Read the current page end-to-end. Note the constants: `schema`, `defaultValues`, `formFields`, `columns`, `statsConfig` (plus any `invoiceLabelFn`/helper used by `searchableLabelFn`).
2. Type the constants explicitly against the existing types: `FormField[]` for `formFields`, `StatsConfig[]` for `statsConfig`, `Column[]` for `columns`. Remove per-field `as const` if it fights the explicit type.
3. Import what `ResourcePage` was importing internally: `useState`/`useCallback`, `useSearchParams`, `useQuery`, `apiGet`/`apiDelete`, `Navbar`/`Sidebar`, the `Table*`/`Button`/`Input` UI primitives, `formatCurrency`/`formatDate`, `ResourceFormModal`, and the types `ModalMode`/`ApiListResponse`.
4. In the component:
   - `useState` for `search` (init from `useSearchParams().get('search') ?? ''`) and `modalState: { mode: ModalMode; row }`.
   - `useQuery<ApiListResponse>({ queryKey: [...key, { search }], queryFn: () => apiGet(endpoint, { search }) })`.
   - `openCreate` / `openEdit` / `openView` / `closeModal` mutators.
   - `onDelete = async (row) => { if (!confirm(...)) return; await apiDelete(`${endpoint}/${row.id}`); listQuery.refetch(); }` (toast on success/error).
5. Render in this order: `<Navbar />` → `<Sidebar />` → header (title + Refresh + Add) → stats grid (if any) → search row → `<Table>` with sticky header, `TableEmpty` for loading/empty, action cell with View/Edit/Delete plus any custom `rowActions` → `<ResourceFormModal>` gated on `modalState.mode`.
6. `TONE_COLOR_MAP` keyed on `StatTone` (the type union includes `violet` — add `'text-violet-600'`). Falls back to `text-gray-900` for unknown tones.
7. For column rendering, handle `c.money` → `formatCurrency`, `c.date` → `formatDate`, `c.render` → call it, else `?? '—'`. Money amounts may arrive as strings from `DECIMAL` columns — `formatCurrency` already guards.
8. Pass `endpoint`, `defaultValues`, `zodSchema`, `formFields`, `companyListEndpoint`/`vendorListEndpoint`/`employeeListEndpoint` (only what the page used) to `ResourceFormModal`. `onSaved={() => { closeModal(); listQuery.refetch(); }}`.
9. If the page had `disablePagination`, don't add a `<Pagination />` and don't pass `page`/`limit` query params. Pages that _do_ paginate should keep the `useState` page + `setPage(1)` on search + `<Pagination>` wiring that was previously inside `ResourcePage`.

---

## After all 9 are migrated

- Delete `src/components/admin/ResourcePage.tsx` and any remaining barrel exports.
- `src/components/admin/ResourceFormModal.tsx` is still consumed by every decoupled page; keep it as the shared form renderer. If form rendering also drifts (each page wants different field types or different layouts), repeat the same exercise on the modal — but only when the abstraction actually costs more than it saves.
- Drop `disablePagination`, `pageSize`, `canView`, `vendorListEndpoint`/`employeeListEndpoint`/`companyListEndpoint`, `rowActions`, `extraFilters`, `transformSubmit` plumbing from `src/types/admin.ts` once nothing reads them.

---

## Open risks / decisions

- **`/admin/purchase-order/page.jsx` is already decoupled** (custom 934-line page, not via `ResourcePage`). It is the structural model for the migrations above — copy its shell and stat layout, swap in the page-specific table and modal.
- **The form-field vocabulary** (`searchableSelect` + `companyAutofill` + `searchableDependency` + `computed`) lives in `ResourceFormModal`. Any new field types must be added there, not on individual pages. Keep that contract.
- **Stats response shape** is `Record<string, number | string | null>` from `ApiListResponse.stats`. The page's `statsConfig[].key` is a direct lookup — no nesting. If a page needs nested stats, fix the API to flatten or document the nested-key convention in `src/types/admin.ts`.
- **API endpoints** must work without `page`/`limit` (since `payment-entry` already does). Verify each consumer's endpoint accepts the minimal `?search=…` query before refactoring; some endpoints may have an alternate list endpoint or a different default-limit contract — call this out per-page.
