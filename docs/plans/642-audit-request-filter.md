# Exact audit request filter (#642)

1. Extend the existing principal-scoped audit read contract with optional exact request_id. This implements the original PRD request-trace goal across keyset pages, not just the current page correlation view.
2. Validate against the existing projected audit request identifier vocabulary (1–256 ASCII identifier characters). Preserve strict unknown/duplicate query rejection. A request ID never identifies or authorizes a principal.
3. Bind request_id as a SQL parameter after principal, cursor, range and model predicates. Recheck every returned projected row, including lookahead, at database, HTTP and browser boundaries. No fallback on malformed or mismatched data.
4. Add a labelled audit filter and explicit per-event trace action. Preserve submitted principal/model/UTC/limit; discard cursor/history/drafts/CSV when choosing a trace. Keep expiry, denial, stale action and cancellation guards.
5. Demonstrate meaningful RED before implementation, then source/artifact UI, client, HTTP, migrated PGlite and existing audit regressions. Keep authentication-injected HTTP tests distinct from live SSO; no DDL, new permission, session, runtime, deployment or paid call.
6. Require exact-HEAD CI and independent formal approval through all stacked ancestors before merge.
