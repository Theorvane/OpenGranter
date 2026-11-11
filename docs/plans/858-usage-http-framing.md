# Reject framed SSO usage reads (#858)

## Issue and problem
Refs #637 and #642. Node deliberately omits GET bodies when creating Fetch requests. The usage handler only checks request.body, so a framed GET can reach the read/audit service and return JSON or CSV. Catalog already rejects such framing.

## Scope and expected behavior
Reject any Transfer-Encoding and Content-Length other than exact 0 before usage service work. Preserve bodyless/zero-length reads, current method/path behavior, JSON/CSV, authorization and durable audit errors, and private headers. No session, auth, policy, SQL, DDL, provider, activation or deployment changes. Malformed framing rejection is transport validation, not an authenticated read or a new audit event.

## Design
Add the existing catalog framing guard to src/gateway/sso-usage-history-http.ts. Do not modify the shared Node adapter or duplicate usage authorization. No new domain terms or ADR. Update PRD/architecture/acceptance and contracts/sso-usage-http-framing.md.

## TDD plan
New direct Fetch cases and real Node HTTP GETs with fixed-length/chunked bodies must fail RED with 200 instead of 400 and unwanted service invocation. Controls exercise exact zero length, ordinary JSON/CSV and 401/403/503 results. Existing signed-test-JWT SQL/audit suites cover the unchanged trusted service. Implement minimal guard then run focused tests, typecheck/lint/docs/compatibility and standard npm run check.

## Delivery
Direct main6757eee branch fix/858-usage-http-framing. No dependency on unmerged855. Record RED/GREEN and full-check evidence; CI and independent formal exact-head approval required before merge. Rollback removes only framing validation. Tests use controlled service for transport evidence, plus existing embedded SQL suites; not company SSO/browser login, installed PostgreSQL or live provider acceptance.

## Execution evidence
- RED /tmp/og-1300-red.log:11 tests,10 expected failures (200 versus400),1 control pass,zero skips. Real Node GET body reproduction fails for the expected reason.
- GREEN /tmp/og-1300-green.log:21/21 zero skips including11 new transport tests and10 existing signed-JWT/embedded-SQL HTTP and durable-audit composition tests.
- Initial test-only typecheck errors (union return contextual inference and captured address narrowing) corrected with explicit result return type and immutable port; production behavior unchanged. Typecheck and lint PASS;42 existing warnings161 infos.
- Standard npm run check pending; no browser login, installed PostgreSQL or provider evidence is claimed.

## Owned-listener integration plan (2026-11-12 04:00 KST)

1. Reconcile existing PR859 with main and PR855 in an isolated worktree; preserve both appended documentation sections and the existing handler implementation. PR855 remains an independent merge prerequisite.
2. Extend the signed-JWT, migrated-PGlite owned runtime cases (API-only and public-browser shell variants) with fixed-length and chunked JSON/CSV GET bodies. Assert private 400 without usage SQL reads or durable read events; ordinary authorized reads remain successful.
3. Temporarily restore the pre-fix handler for meaningful RED, restore the security fix for GREEN, then run runtime regressions, typecheck, lint and contract checks. No new session or deployment authority.
4. Push to existing PR859, request exact-head formal review and hosted CI; do not merge before all gates.

### Integration evidence

- RED: restoring pre-fix main handler fails both owned runtime variants with HTTP200 instead of400; /tmp/og-0400-red.log. An earlier invocation used system Node18, then an x64 binary on arm64; those environment errors are not RED evidence.
- GREEN: original framing fix restored, 24/24 focused runtime and transport cases pass, zero skips; /tmp/og-0400-green.log. Both actual owned sockets use signed generated test JWTs and migrated embedded SQL; fixed-length/chunked JSON/CSV bodies produce private400 without ledger reads or durable read-access events. Ordinary reads, attribution, policy revocation and failures still pass.
- Full TypeScript, Biome597files (42 existing warnings/162infos, no errors), planning/link/contract checker, six offline compatibility pins and diff checks pass. Formatter invocation through bundled npm failed permission; direct Node invocation succeeded. No full local suite claimed.
- Existing PR859 updated, stacked on exact PR855 a6a0db5; no new duplicate PR. Browser login, session approval, installed PostgreSQL and provider/deployment acceptance remain open.
