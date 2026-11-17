# The /admin/\* shell grants read-holders a data-less shell; APIs stay the boundary

`src/app/admin/layout.tsx` renders the admin shell for any identity with `other_expenses:read`, not only the admin role — the read-only other-expense reader (#315) reviews through the same page the APIs serve, and E2E drives that identity through a real browser at `/admin/other-expenses`. The shell carries no data: every section fetches client-side and each API still enforces its own create/approve/review/delete refusals, and the sidebar only links sections the identity may read.

Considered: scoping the exception to the `other-expenses` subtree. Rejected because no per-section gate exists (the parent layout redirects before any child layout could widen, so scoping needs a new path-aware mechanism), and the sibling review surfaces (`cost-accrual`, `orders`) share the same `other_expenses:*` resource — a subtree pin would break the reader there next. A future dedicated `cost_accruals` resource (see review note A4) may reopen this.

## Update: project administrators (#423)

The shared Project Lead policy lives at `/admin/project-lead-policy`, so `src/app/admin/layout.tsx` also renders the shell for an identity holding `projects:update`. The same boundary applies unchanged: the shell carries no data, and `GET`/`PUT /api/admin/project-lead-policy` authorize `projects:update` per request (super admins bypass). No other admin section is opened by this grant, because each page fetches through its own API.

## Update: Salary Profiles payroll readers (#434)

The Payroll Salary Profiles workspace lives at
`/admin/payroll/salary-profiles`, so the admin shell also renders for an
identity holding `payroll:read` even when it holds neither the admin role nor
employee-master access. This admits a minimal payroll reader/editor role through
the permission branch rather than an admin role-code shortcut.

The established boundary is unchanged. The shell itself carries no salary data;
the directory and editor re-check `payroll:read` in `SalaryProfileAccess`, and
every salary API authorizes its own read/update/delete request. An
`employees:read`-only identity still sees no salary summary and cannot open the
workspace, and a super admin bypass remains. No path-header or proxy redesign
was needed.
