# Filtered usage export

Explicit coordinator, not automatic browser activation. The caller supplies an already-authorized request port and AbortSignal tied to logout/expiry/navigation. Capture filters before the first await; ignore any page cursor to export the filter from its beginning. Preserve each server CSV row unchanged; only remove subsequent identical header lines and an optional page BOM. CSV remains spreadsheet-import mitigated, not a safe executable format.

Result ready means the last server page was reached within page/byte bounds; it is not a transactionally consistent snapshot and does not certify billing completeness. Never publish partial data on failure, a repeated cursor, changed headers, cancellation, denial or bounds. The existing per-page deadline applies. No automatic retries. Caller must discard completed data on subsequent authority teardown and must not cache it. UI integration is a separate frontend-owned change.
