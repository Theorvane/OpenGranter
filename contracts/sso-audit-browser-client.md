# SSO audit browser client

createManagementSsoAuditClient(request, principalId) is an explicit /management/v1/audit transport. principalId comes from the trusted current-principal grant; caller owns fresh authority and MUST invalidate on logout, expiry, principal/policy change or disposal. No authentication or session implementation.

list(filters) returns projected events/nextCursor/hasMore; csv(filters) returns one bounded server CSV page and paging metadata. Filters: principalId, model, fromMs inclusive, toMs exclusive, limit 1..100, cursor positive decimal signed-64-bit event ID. Explicit target is a request, not permission. JSON must match default/explicit principal, filters, descending IDs, limit and header/body cursor agreement. Unknown fields discarded by canonical projector.

GET/no-store/credentials omit/redirect error; no bearer synthesis or provider calls. Injected authorized request port owns authentication. x-audit-has-more/x-audit-next-cursor preserve exact server cursors; no all-pages traversal. CSV is server-formatted, not interpreted as event authority.

States ready/invalid_query/unauthenticated/denied/unavailable/cancelled. Private errors discarded. Response bound 1 MiB, valid UTF8, 30 seconds even for uncooperative transports. Invalidation suppresses late responses. One active request per instance. No UI mount/cookies/CORS/DDL/runtime activation/installed durability claims.

## Restricted public build

The actual client and workspace can be bundled through scripts/build-management-browser.ts. Only the exact reviewed query, filter, time, principal-reference and content-free event-projection sources are allowed transitively. SQL storage modules, arbitrary audit files and non-management entry points remain forbidden. The shared projector is unchanged and re-exported from the existing server module for compatibility; no database or provider code is published. Build success is not a mounted audit screen, approved login/session, deployed URL or native-browser acceptance.
