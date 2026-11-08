# Current-principal API for the management UI

## Issue and problem

Refs #639 and #637. The existing human management HTTP boundary only exposes token mutations; the UI cannot retrieve its verified current principal.

## Scope and expected behavior

1. Add GET /management/v1/me returning only {principalId}, derived from the existing RFC 9068 verifier and current active-human binding on every request.
2. Preserve Bearer-only authentication, no-store, server request IDs, fixed errors and mandatory anonymous authentication-failure auditing. Extend the audit operation vocabulary with current-principal.
3. Reject query parameters and request bodies after authentication. Do not issue cookies, accept proxy credentials or grant IAM rights. Identity is not authorization; no policy/secret/claim data is returned.

## Design

Reuse createSsoManagementHandler and the PostgreSQL composition rather than adding an independent auth boundary. No database migration or new permissions. Successful self-identification has no anonymous event, matching existing successful authentication behavior. Browser sessions, CSRF/CORS, login/logout, owned runtime activation and lists/detail APIs remain separate work. Update contracts/sso-management-http.md and docs/acceptance.md; PRD scope is unchanged.

## TDD plan

1. Write HTTP tests for verified identity, repeated current authentication, 401/503, failed audit, cancellation, invalid query/body/method and secret-safe errors.
2. Confirm RED is a 404 instead of the new route response.
3. Add minimal dispatch and projection; extend the audit store operation allowlist.
4. Exercise the composed JWT + migrated database boundary for active/inactive/rebound human identity and persisted failure audits.
5. Run focused tests, typecheck/lint, planning checker and npm run check. Record results accurately.

## Delivery

Keep this a small independently reviewable PR, not completion of #639. No provider calls, deployment or permission bypass. Rollback removes the route and audit vocabulary addition; existing stored event details remain readable JSON. Exact-head CI and independent approval remain merge gates.

## Socket regression follow-up

The Node Fetch adapter drops GET bodies. Add real node:http GET cases before the fix: Content-Length: 2 and chunked transfer must return 400 after authentication; missing authentication must still return audited 401. Empty Content-Length: 0 remains valid. Reject nonzero Content-Length or any Transfer-Encoding on this identity route using preserved framing headers; do not read the body or change the shared adapter.

## Local verification (2026-11-04)

- Node 22.23.4 arm64 used explicitly; system Node 18 is not the supported runtime.
- Socket regression RED: 15 tests, 13 pass and 2 fail (authenticated length/chunked returned 200 instead of 400).
- GREEN: current-principal plus existing management HTTP tests, 137/137 pass.
- Composed JWT + PGlite management HTTP suite: 37/37 pass.
- Full npm run check launched; final result remains pending at PR preparation. Exact-head CI and independent approval remain required.
- No environment variables, migration, runtime activation, deployment, session or catalog permissions added.
