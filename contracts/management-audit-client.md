# Audit metadata browser client

- createAuditHistoryClient(request) accepts an already-authorized request port and exposes read(AuditFilters) and invalidate(). principalId is required. No credentials are accepted or stored by this module.
- Fixed same-origin GET /v1/audit with format=json, explicit principal_id and optional model/from_ms/to_ms/limit/cursor. No-store, redirect:error, Accept application/json. Existing proxy-authorized endpoint, NOT an SSO management endpoint.
- Ready contains projected data, hasMore and exact decimal nextCursor. IDs remain strings, including values above Number.MAX_SAFE_INTEGER. Client never invents continuation cursors.
- Empty is ready. Invalid query, unauthenticated, denied, unavailable and cancelled are private outcomes without server error bodies.
- Validate query before I/O. Snapshot filters before await. Validate entire page, target principal, descending event-ID order, filter bounds, page size and final-row continuation. Reproject allowlisted event metadata and discard unknown content.
- A 2 MiB streaming body bound, fatal UTF-8, media check and 15-second timeout apply. New read invalidates old read. Host MUST invalidate on logout, expiry or identity change and clear any rendered data; no client-side cache exists.
- Host must supply approved authentication transport; browser SSO/BFF/CSRF, mounting, CSV UI, retained content policy and installed acceptance remain separate, unresolved where not approved.
