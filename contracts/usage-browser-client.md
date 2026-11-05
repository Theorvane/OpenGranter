# Usage browser API client

createManagementUsageClient takes an already-authorized request port, never a token, cookie, issuer or storage. list(filters) and csv(filters) request exactly one GET /management/v1/usage page with cache no-store, redirect error and a matching Accept header. Optional filters are principalId/model/fromMs/toMs/limit/cursor; omission of principalId preserves self scope, explicit selection still requires server ReadAll. No authority is inferred locally. Cursor is opaque and URL-encoded, not decoded/reconstructed.

Results are ready(data), unauthenticated, denied, invalid_query, unavailable or cancelled. JSON data is {records, hasMore, nextCursor}; CSV data is {csv, hasMore, nextCursor}, without automatic navigation/download. Unknown tokens stay null, estimated and upstream costs stay separate, and flags remain unchanged. Only allowlisted stored-record fields survive. Invalid schemas/media types/paging metadata and over-limit bodies yield unavailable. Non-200 response bodies and raw exceptions are never exposed.

New requests and invalidate() cancel old requests. The caller must invalidate on logout/expiry/principal change. Body bytes are capped at 1 MiB and the entire operation at 30 seconds, including ignored aborts. No cache, persistence, credential handling, session contract or installed acceptance is provided.

Plan: [642](../docs/plans/642-usage-browser-client.md). Tests: test/management-usage-client.test.ts and test/management-usage-integration.test.ts.
