# Audited Account identity contract

## Issue and problem
- Issue #774; parent #637, bounded #639 integration.
- Existing Account workspace PR762 calls GET /management/v1/me and accepts only {principalId}; the explicit SQL-audited read API PR773 supports /principal with {id,kind}. It cannot drive that Account view.

## Scope and expected behavior
- Support the existing /me contract using the same fresh registered-key authentication, exact active-human binding and mandatory durable identity audit as /principal.
- Preserve /principal and model behavior. No frontend/runtime edits, token writes, new grants, sessions, cookies, IdP/CORS/CSRF decisions, schema installation, providers or deployment.
- Both paths reject malformed shapes before private work; missing/revoked credentials and audit failure disclose no identity. Identity remains independent of catalog authorization.

## Design
- Select exactly two paths in the existing identity handler. Select only the existing successful payload shape by path after the same awaited audit. Never rewrite URLs or forward headers/body into a second request.
- Route /me to that handler in the explicit unbound read API. Unknown lookalikes and methods stay private zero-work 404.
- Alternative: change frontend to /principal; rejected because it breaks the existing exact Account contract and touches another owner. Do not mount or modify backend-owned legacy /me runtime.
- Dependencies: unmerged PR773/771/769. Branch is stacked and not independently mergeable; integration requires new exact-head CI/formal approval.
- Update contracts/sso-current-principal-http.md, contracts/sso-read-api.md, PRD, architecture and acceptance. No new domain decisions.

## TDD plan
- Add actual Node HTTP /me regression with signed JWT and migrated local SQL; expect current 404 instead of exact 200 Account payload.
- Verify successful audit, identity without IAM, original /principal, unauthorized/removed binding, failed audit privacy, and models remain separately denied.
- Check malformed shapes and unknown paths/methods before private SQL; callback pending/failure behavior retains the common audit boundary.
- Run serial affected suites, typecheck, lint, planning/compatibility checks and standard npm run check. Separate local SQL/HTTP from native browser, installed PostgreSQL, IdP/session and live deployment evidence.

## Delivery
- Commit with user author/committer, DCO and assistance disclosure; draft PR with RED/GREEN records.
- Require exact-head full CI and independent formal approval before merge. No data/config activation; rollback removes optional /me route only.

## Execution evidence
- RED: actual Node HTTP /me returned404 instead of200 after successful signed-token/SQL setup;0PASS1FAIL /tmp/og-1930-account-red.log. Initial x64 Node binary could not run on ARM host; corrected to existing ARM Node22 before behavioral RED. Shell syntax guard rejected initial embedded script before any write; preparation executed from a normal Python file.
- GREEN: four affected suites run serially:54PASS0FAIL0SKIP /tmp/og-1930-focused.log. Includes actual signed HTTP+SQL, exact payload without IAM, original principal/catalog, revoked credentials, SQL audit failure, pending audit and malformed-shape zero-private-work.
- Typecheck PASS; lint0errors42existingwarnings155infos; planning/link/contract checks and all6offline compatibility checks PASS. No native-browser/installed/session/IdP/liveprovider claim. Standard npm run check and CI are reported separately at delivery.
