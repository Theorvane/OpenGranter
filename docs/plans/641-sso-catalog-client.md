# Explicit SSO catalog transport

1. Preserve proxy catalog behavior and reserved collection aliases. Add a separately named SSO client with a fixed management namespace, without arbitrary URLs or credential handling.
2. Reuse bounded JSON, cancellation and safe projection. SSO has no count/user subcollections, so those aliases remain retrievable. Caller supplies authorized request port; no browser session or credential bridge is granted.
3. RED missing factory, exact paths, reserved-name separation and denial states. GREEN focused tests and existing real Node/signed-JWT/migrated-PGlite durable audit suite, typecheck and lint.
4. Independent exact-head formal review and required CI before merge. No session/CSRF/IdP/DDL/runtime activation, installed/browser certification or provider calls.

## Local evidence
- RED: missing factory export failed module import before implementation.
- GREEN: SSO client 2/2, existing proxy client 23/23, real Node + signed JWT + migrated PGlite HTTP suite 12/12, zero skips. Includes fresh Deny, inactive principal and missing durable-audit table. Local evidence only, not browser login or installed PostgreSQL.
- Planning checker PASS. Typecheck and lint are blocked by host thread exhaustion (newosproc errno11 and Biome threadpool EAGAIN), including one constrained retry. Full required CI and independent formal approval remain mandatory.
