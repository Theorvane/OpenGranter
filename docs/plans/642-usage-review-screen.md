# Scoped usage review screen

## Issue and problem
- Issue: #642, parent #637.
- Existing validated JSON transport and session lifecycle have no mounted usage screen.

## Scope and expected behavior
- Mount a read-only native DOM review surface with principal/model/time filters, page size, pagination and explicit loading/empty/private failure states.
- Preserve unknown tokens and money, exact decimal estimates versus upstream reports, duplication and potentially billed markers.
- Trusted host owns authentication, request authority, logout, identity changes and expiry. No session acquisition, storage, runtime activation, content retention, export UI or write controls.

## Design
- New usage-app.ts composes existing usage-session.ts. Existing frontend catalog files remain untouched.
- Native labeled inputs and buttons; all external values use textContent, never HTML. Clear/dispose synchronously replace protected DOM and abort requests through lifecycle.
- Alternatives: duplicate transport rejected; framework choice remains open. Login/BFF/CSRF/IdP decisions remain unresolved and are not changed here.
- See contracts/management-usage-screen.md and appended PRD/architecture/acceptance notes.

## TDD plan
- RED missing mount module through public DOM port.
- Test filters and opaque cursor, loading replacement, unknown/exact cost rendering, hostile text, 401/403, failures, empty and late logout/identity results.
- Implement smallest renderer/coordinator; run focused tests, tsc, lint, planning checker, compatibility and npm run check.

## Delivery
- Stack on #845 until prerequisite merge, then reconcile against main and require new exact-head CI and formal review.
- Disclose DOM-port tests and browser smoke separately from real SSO/PostgreSQL/provider acceptance. No production/paid calls.
- Rollback by removing mount from host; no data migration or persistent storage.

## Evidence and integration hold
- RED: missing usage-app.ts through public DOM mount test. GREEN: 23/23 zero skipped across mounted app, lifecycle and JSON client. Includes mounted signed-JWT, migrated PGlite, actual Fetch-handler, mandatory audit failure and fresh SQL policy revocation.
- tsc/lint/planning checker and six offline compatibility pins pass (existing lint warnings retained). Browser bundle 27.4 KiB. Chromium local fixture smoke at http://127.0.0.1:8765 verifies sign-in boundary, labeled controls, immediate loading, hostile text rendered inertly, unknown values and expiry clearing. This browser smoke uses synthetic transport, separately from SQL composition.
- Standard npm run check launched with two-CPU process affinity to bound local resources; one gateway-disk-recovery SIGKILL already observed; not a full pass. Final summary must be recorded. Earlier #845 standard full check had 9324 pass / 1 fail / 1 skipped with postgres-sso-usage-history SIGKILL, not success.
- Frontend owns the product navigation and may already have an alternate usage surface. This isolated mount is NOT activated or a replacement for their owned screen. Keep draft until frontend confirms composition ownership or selects the existing view; no duplicate entrypoint is introduced.
