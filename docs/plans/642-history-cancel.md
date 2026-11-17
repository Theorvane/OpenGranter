# Cancel pending history requests (#642)

1. Reuse existing bounded authenticated clients; add explicit local cancel for pending JSON/CSV. No authority, endpoints or entry activation.
2. Invalidate generations and abort before notifying observers. JSON cancellation clears rows and pagination, preserves applied attempt for Retry. CSV cancellation preserves authorized page; late bytes cannot download.
3. No-op outside loading and after denial/disposal. Local cancel does not undo server work/audit or retract exported files.
4. RED/GREEN both histories, late completions, exact retry scope, denial/disposal and DOM no-download. Targeted regressions separate from installed/live evidence. Exact-head CI and formal approval before merge.
