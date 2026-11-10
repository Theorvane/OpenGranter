# Usage browser API client

createManagementUsageClient takes an already-authorized request port, never a token, cookie, issuer or storage. list(filters) and csv(filters) request exactly one GET /management/v1/usage page with cache no-store, redirect error and a matching Accept header. Optional filters are principalId/model/fromMs/toMs/limit/cursor; omission of principalId preserves self scope, explicit selection still requires server ReadAll. No authority is inferred locally. Cursor is opaque and URL-encoded, not decoded/reconstructed.

Results are ready(data), unauthenticated, denied, invalid_query, unavailable or cancelled. JSON data is {records, hasMore, nextCursor}; CSV data is {csv, hasMore, nextCursor}, without automatic navigation/download. Unknown tokens stay null, estimated and upstream costs stay separate, and flags remain unchanged. Only allowlisted stored-record fields survive. Invalid schemas/media types/paging metadata and over-limit bodies yield unavailable. Non-200 response bodies and raw exceptions are never exposed.

New requests and invalidate() cancel old requests. The caller must invalidate on logout/expiry/principal change. Body bytes are capped at 1 MiB and the entire operation at 30 seconds, including ignored aborts. No cache, persistence, credential handling, session contract or installed acceptance is provided.

Plan: [642](../docs/plans/642-usage-browser-client.md). Tests: test/management-usage-client.test.ts and test/management-usage-integration.test.ts.

## Restricted public build (#642)

The usage client imports the shared pure record parser, not the server history/cursor module. The existing management builder permits exactly `src/usage/record-parser.ts`, `src/usage/record-usage.ts` and `src/audit/attribution.ts` as reviewed shared public dependencies. These are not entry points. Canonical paths must match; server directories, packages, symlink escapes and future unapproved transitive imports remain blocked. History retains its parser re-export for existing server consumers. Parsing and accounting semantics are unchanged.

Build integration tests execute the real bundled client and import the real bundled usage app. They verify unknown usage/costs, allowlisted projection and malformed record rejection without Node Buffer. This is not real DOM/browser, installed listener/session, schema or provider acceptance. See [plan](../docs/plans/642-usage-public-build.md).

## Requested JSON page size (#642)

Reject the entire JSON page as unavailable if its record count exceeds the limit captured before transport (50 when omitted, explicit 1 through 100). Do not truncate or invent paging metadata. Mutation of caller filters while awaiting transport cannot widen that page size. CSV behavior is unchanged.
