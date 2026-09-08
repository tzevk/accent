# Sandwich leave warns first, then deducts bracketed WO/H days

A Weekend/Holiday run bracketed by leave on both sides (canonical: Sat leave + Sun WO + Mon leave → Sun deducted) is a Sandwich. The leave form warns with an explicit "apply anyway (N extra days deducted)" acknowledge; on attendance save the bracketed `WO`/`H` days auto-convert to the same leave type, overflowing to `LWP` when the balance is short.server re-derives the sandwich (client warning is bypassable).

Considered: warn-only with no deduction, and hard-blocking submit. Warn-only breeds payroll disputes; blocking removes legitimate travel-day use. Chose warn + auto-convert because the warning preserves choice and the ledger stays explainable.

Consequences: ledger fix comes first — in-range `WO`/`H` are excluded from `duration_days` before sandwich extras are added; `written_attendance` audit gains a versioned sandwich extension so reverts restore exactly.
