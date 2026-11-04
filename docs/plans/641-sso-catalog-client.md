# Explicit SSO catalog transport

1. Preserve proxy catalog behavior and reserved collection aliases. Add a separately named SSO client with a fixed management namespace, without arbitrary URLs or credential handling.
2. Reuse bounded JSON, cancellation and safe projection. SSO has no count/user subcollections, so those aliases remain retrievable. Caller supplies authorized request port; no browser session or credential bridge is granted.
3. RED missing factory, exact paths, reserved-name separation and denial states. GREEN focused tests and existing real Node/signed-JWT/migrated-PGlite durable audit suite, typecheck and lint.
4. Independent exact-head formal review and required CI before merge. No session/CSRF/IdP/DDL/runtime activation, installed/browser certification or provider calls.

## Local evidence
- RED: missing factory export failed module import before implementation.
- GREEN: SSO client 2/2, existing proxy client 23/23, real Node + signed JWT + migrated PGlite HTTP suite 12/12, zero skips. Includes fresh Deny, inactive principal and missing durable-audit table. Local evidence only, not browser login or installed PostgreSQL.
- Planning checker PASS. Typecheck and lint are blocked by host thread exhaustion (newosproc errno11 and Biome threadpool EAGAIN), including one constrained retry. Full required CI and independent formal approval remain mandatory.

## SSO UI state integration follow-up
1. Add a separately named SSO catalog lifecycle factory; retain the existing proxy lifecycle and its authority port unchanged. Never authenticate or infer an SSO-to-proxy grant.
2. Exercise SSO list/detail paths, loading/empty/error states, immediate expiry cleanup, identity replacement and deny lockout. Add RED tests before production changes.
3. Reuse the existing epoch/cancellation implementation with an explicit client factory, not a caller-controlled URL or new session protocol. No browser activation, session contract, runtime or DDL changes.
4. Run both lifecycle and transport regressions; require typecheck/lint, exact-head CI and formal independent approval before merge.

Follow-up RED: missing createSsoManagementCatalogSession export. GREEN: new SSO lifecycle 3/3, existing proxy lifecycle 8/8 and proxy/SSO clients 25/25, zero skips. Planning checker PASS. Tests executed directly with Node 22.23.4, UV_THREADPOOL_SIZE=1 and --v8-pool-size=1 to avoid child-runner resource pressure. Browser authentication and live API activation remain unverified.
