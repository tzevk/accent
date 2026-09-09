# Attendance — Next Steps (post pipeline fix)

> Captured 2026-09-10 after the SmartOffice pipeline recovery (tz fix `7ea4f29`, ATS-only filter `7ca9d65`, double-tap collapse `94c4d7d`, prod `attendance_logs` wiped + refilled, scheduler re-enabled). Pipeline is healthy; both items below build on clean data.

## Item 1 — Late-3-days → absent rule

- **Ask:** mark an employee absent after 3 late arrivals. Consumer undecided — report badge vs payroll input.
- **Where:** new logic over `attendance_logs`, likely next to `applyInferredDirections` in `src/app/reports/attendance-report/data-source.ts` (pure, tested) or a shared helper if payroll also needs it.
- **Open before coding:** late threshold (first punch after HH:MM? grace minutes?); per-employee shifts (does `employees` carry shift start, or one company-wide cutoff?); 3 = consecutive days or any 3 in a rolling window/month; what "absent" drives (display flag vs leave-balance vs payroll deduction — money path must use `src/lib/money.ts`, never floats).
- **Fix sketch:** group punches per employee per day → first-punch time vs threshold → late-day set → rolling 3-flag → surface as an exception strip/badge in the report first, wire to payroll only once HR signs off the counting rule.
- **Effort:** ~half day once the rule is pinned. **Risk:** medium — wrong cutoff silently mislabels people; needs HR-confirmed fixtures in `data-source.test.ts` before shipping.

## Item 2 — Resigned/inactive profile removal

- **Ask:** ex-employees linger as active profiles (and mapped `smartoffice_code`s), polluting report/mapping and risking stale access.
- **Where:** `employees` (has `exit_date`/`exit_reason`/`status` fields per `src/app/api/employees/route.js`, plus soft-delete `isDelete`); mapping column `smartoffice_code`; hierarchy guard `canModifyTargetUser` still applies to edits.
- **Open before coding:** what "removal" means — `isDelete = 1` vs status flag (payroll/history needs leavers queryable, so hard delete is out); whether exit clears `smartoffice_code` (frees the device code for reuse, but breaks the punch→name link on historic rows — probably keep mapping, filter by status at read); who runs the exit step (HR checklist vs automatic on `exit_date`).
- **Fix sketch:** defined exit transition (status + `exit_date`, keep row + mapping for history) and an exception strip in the attendance report: "exited but still mapped / punching in last N days" — catches both forgotten offboards and device-code reuse. No cron until the transition itself is manual-tested.
- **Effort:** ~half day. **Risk:** low if read-side first; the dangerous direction is auto-`isDelete`, which would hide payroll history — never do that silently.
