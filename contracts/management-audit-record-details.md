# Audit record details (#642)

The explicit history mount renders each already-authorized audit record as native, initially collapsed details/summary. Opening it performs no request. Exact event/request/principal/credential identifiers, Unix-millisecond timestamp, policy id/version pairs and redacted metadata are display data, never authority. Empty policies are labeled as no recorded versions, not permission absence.

The renderer reuses projectGatewayAuditEvent and serializes only its allowlisted details; unsupported/invalid records show a generic unavailable summary without raw input. No prompt, completion, bearer, secret reference contents or unknown fields are dumped. All values enter textContent. Event IDs remain exact PostgreSQL bigint strings.

The existing page and identity lifecycle is unchanged. Filters/paging replace details immediately while loading. A tab change removes the current DOM; returning to the audit tab can render its existing authorized snapshot until a fresh request, known expiry, logout or disposal invalidates the epoch. This is not continuous IAM polling. Fresh 401/403 clears the entire operations workspace. Audit-store failure returns no records. Native disclosure state is not cached or restored.

No new endpoint/grant/schema/retention, cookie/session acquisition, authentication or public entry activation. The trusted caller remains responsible for logout, expiry and identity replacement. Evidence: docs/plans/642-audit-record-detail-evidence.md.
