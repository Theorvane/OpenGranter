# Cancel pending history requests (#642)

1. Reuse existing bounded authenticated clients; add explicit local cancel for pending JSON/CSV. No authority, endpoints or entry activation.
2. Invalidate generations and abort before notifying observers. JSON cancellation clears rows and pagination, preserves applied attempt for Retry. CSV cancellation preserves authorized page; late bytes cannot download.
3. No-op outside loading and after denial/disposal. Local cancel does not undo server work/audit or retract exported files.
4. RED/GREEN both histories, late completions, exact retry scope, denial/disposal and DOM no-download. Targeted regressions separate from installed/live evidence. Exact-head CI and formal approval before merge.

## Parent reconciliation (2026-11-20 04:30 KST)

5. Integrate current #961 aa8afecde6e7cf4e70b2c987187b1f2dcc8e670a into existing #962 rather than duplicating cancellation. Preserve page-size controls, destination-owned request investigation, canonical operations and HTTP lifetime contracts. Resolve only concrete source conflicts; no new policy/session/DDL/runtime activation.
6. Test cancellation with an applied page limit and request filter, including an unapplied size draft. Retry and CSV must keep applied bounds. Preserve original cancellation RED evidence; reconciliation is not a new defect claim. Verify focused DOM/HTTP regressions and type/lint/docs, then full check/CI and independent formal review before any merge.
