# Non-blocking rejected credential body cleanup (#764)

## Issue and problem
Refs #764, #637 and #640. Authenticated issue/revoke body rejection currently awaits stream cancellation. Oversized or invalid UTF-8 bodies whose underlying cancellation never settles can hold the existing invalid_request response indefinitely.

## Scope and expected behavior
Keep the existing 16384-byte budget, fatal UTF-8 decoder, authentication-first ordering and 400/no-store envelope. Best-effort cancellation and reader release must not await cleanup. No new timeout, endpoint, permission, session, database change or runtime activation. Cancellation is not transaction rollback; this change is before service dispatch.

## Design
Change only rejected-body cleanup in the public SSO credential handler. Retain cancellation error suppression and release the reader immediately. Avoid a timer or alternate parser: neither is needed to settle an already rejected request. Existing success/authentication/denial/mandatory-audit paths remain authoritative. No new domain terms or costly design decisions.

Contracts: contracts/sso-management-http.md; docs/acceptance.md. Main-based changes are independent of the unmerged administration stack.

## TDD plan
For both issue and revoke, inject oversized and invalid UTF-8 streaming bodies with pending cancellation. Assert prompt 400/no-store, no mutation, cancellation attempted, reader lock released and no private error projection. Reproduce RED with a bounded test race; resolve cleanup in finally to avoid leaked work. Make the minimal cleanup change; run SSO source/PostgreSQL HTTP regression, typecheck, lint, scripts and full check.

## Delivery
New issue-numbered main-based branch and PR; exact-head required CI and independent formal approval before merge. Rollback is the cleanup change; no migration or provider calls. Local source/HTTP/PGlite results are not browser/company-IdP/installed-runtime or paid-provider acceptance.
