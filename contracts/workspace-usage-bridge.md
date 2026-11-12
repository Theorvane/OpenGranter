# Canonical workspace usage bridge (#637)

The explicit createManagementUsageClient(request) export in src/management/workspace-usage-client.ts adapts the product workspace list/csv/invalidate surface to the canonical SSO JSON and CSV transports. The existing workspace can change its import from usage-client.ts to this module when integrating canonical main. No old parser, CSV header contract or access-audit table should be restored for compatibility.

- list(filters) returns ready data { records, hasMore, nextCursor }; csv(filters) returns ready data { csv, hasMore, nextCursor }. Empty pages remain ready. Unknown billing and duplicate markers pass through canonical sanitized records without invented costs.
- A new request in EITHER channel invalidates BOTH older channels; explicit invalidation does the same even for transports ignoring cancellation. Invalid queries also invalidate stale work.
- Canonical request validation, exact case-sensitive request filters, pagination, scope checks, byte bounds, deadlines, status mapping and CSV continuation headers remain unchanged. No cursor generation or export loop exists in this bridge.
- The trusted request port owns authorized transport. The bridge acquires no token and touches no browser storage, session, cookies, database, IAM grants, listener configuration or provider.

Acceptance: cross-channel races in both directions, explicit invalidation, empty/failure mapping, invalid filters before transport, malformed JSON rejection; real signed-JWT owned HTTP over PGlite proving request-filtered pages/CSV, foreign-principal denial, anonymous denial and audit-loss failure. These are local transport/runtime checks, not installed PostgreSQL, IdP login, native-browser or live-provider acceptance.

Integration dependency: canonical exact request filter transport #882 and its parents; their individual exact-head CI/formal approvals remain mandatory. This bridge does not resolve the unrelated old workspace identity/audit composition conflicts or approve session decisions.
