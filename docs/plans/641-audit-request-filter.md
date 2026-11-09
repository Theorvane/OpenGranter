# Audit request correlation (#637, #641)

1. Extend existing scoped audit metadata reads with optional exact `request_id`, matching usage request drilldown; retain model/time/keyset filters and JSON/CSV parity.
2. Before production changes, prove RED for strict parsing, SQL parameter binding, hidden off-request lookahead rejection and signed-test-SSO HTTP JSON/CSV pagination.
3. Bind the request ID in SQL, recheck projected request IDs in SQL/HTTP/export boundaries, and carry the filter through fresh SSO authorization and mandatory access audit. Do not search arbitrary details or infer identity from a request ID.
4. Prove GREEN, typecheck/lint/full checks; open a stacked PR and request exact-HEAD formal review. Merge only after required CI and approval.

Contract: one optional `request_id`, 1..256 ASCII characters, `[A-Za-z0-9][A-Za-z0-9._+:/@-]*`, exact case-sensitive match. Encode plus as `%2B`. Empty, repeated, whitespace, controls, non-ASCII and oversized values are invalid. Omission preserves behavior. Principal scope and `audit:Read` remain unchanged; authentication precedes invalid-query reporting. Hidden SQL lookahead must satisfy every filter. CSV and cursors retain the same request scope. Query values are not copied into access-audit metadata. No UI/session/runtime/DDL/IdP/deployment/paid-provider authorization.

Evidence: corrected preimplementation RED 3/3 failing (parser, real HTTP 400 instead of 200, missing off-request SQL rejection); GREEN 56/56 passing, zero skips across request-correlation, SQL reader, SSO HTTP, proxy HTTP and CSV suites. Full TypeScript and targeted Biome checks, planning/contracts scan and diff check pass. Full npm check and exact-HEAD remote CI/review pending. Local SQL and test issuer are not live company login or installed acceptance.
