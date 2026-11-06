# 642 Audit navigation in the existing management host

1. Reuse audit-app in the existing host with the same guarded grant. No new session, listener, IAM or retention.
2. Prove source/artifact RED: no anonymous fetch, scoped history, denial clears all views, lifecycle and expiry.
3. Extend real HTTP/PGlite audit/CSV test through host navigation. Test authentication is not SSO.
4. Typecheck, focused tests, exact-head CI and independent formal approval before merge.

Current SSO review server has no /v1/audit composition. This change does not invent that contract or activate deployment. Approved adapters must route the existing audit API; otherwise unavailable is shown.
