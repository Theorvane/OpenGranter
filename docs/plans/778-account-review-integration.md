# Opt-in durable Account identity in the existing review composition

## Issue and problem
Issue #778; refs #637/#639/#640, #763, #777. The existing browser review dispatcher uses legacy credential-management identity, while #777 has the independently gated identity-specific SQL audit and Account-compatible response. Users need one existing origin, not another server factory.

## Scope and expected behavior
Add optional principalAuditClient to the existing review/browser ports. An own supplied option selects the #777 principal handler for exact GET /management/v1/me; absence preserves legacy behavior and schemas. Explicit invalid values fail construction rather than fall back. No new routes, default migrations, runtime listeners, session/BFF/CSRF/CORS/IdP decisions, permissions, deployment or provider calls. Credential mutations retain their existing authority and transaction.

## Design
Reuse existing review dispatch and import the existing current-principal implementation from exact #777 (03b78979cbcef6bb59314570778e778900dd33b8), not another API host. Forward the explicit audit client through both existing browser compositions. Caller must own a committed/autocommit client and explicitly installed reviewed identity audit DDL; no certification of schema approval or exactly-once persistence. Existing backend owns administration/session files; integration is isolated in this worktree, with ownership coordination requested before adoption.
Alternative: replace all defaults or create a new host. Rejected because defaults and schema approval must not change and the existing UI already has a server. Open decisions: deployment, schema/security approval, company SSO/session and independent formal review remain unresolved. See contracts/sso-administration-browser.md, docs/PRD.md, docs/architecture.md and docs/acceptance.md.

## TDD plan
First public signed-SSO loopback test opts into a dedicated SQL audit client while removing the legacy gateway audit table; expect Account200 with a dedicated event; before implementation both existing hosts return200 but create zero dedicated audit rows. Additional cases: audit unavailable/malformed acknowledgement, fresh binding revocation, identity-store failure, anonymous audit, static assets without SQL, model empty/list/detail unaffected, mutation exclusion from read-only host and existing administration credential tests. Capture config once; reject explicit undefined/null audit option.
Run serial focused suites, typecheck, lint, planning/links and six compatibility checks; run standard npm run check and distinguish resource failure/skips from PASS.

## Delivery
Reuse only identity/audit dependency files and associated tests/contracts from #777; retain provenance and unmerged dependency gates. Implement existing dispatch integration and regression tests. PR against #763; no independent merge of dependency stack. New exact HEAD full CI and independent formal approval required after adoption/rebase. Rollback by omitting the option; no DDL installation in code. Report real Node HTTP plus migrated PGlite separately from browser, installed PostgreSQL and real SSO/provider acceptance.

## Evidence
- RED: both public same-origin host variants returned Account200 with no required dedicated audit row; 0PASS/2FAIL in /tmp/og-2100-red.log. This is a missing opt-in wiring defect, not a claim about a deployed instance.
- GREEN: 111PASS/0FAIL/0SKIP across dedicated audit, current-principal, existing review/browser/administration and source+built Account integration in /tmp/og-2100-focused-final.log. Includes existing legacy current-principal tests (preserved unchanged) and reused #777 tests renamed to avoid replacing them. New source/built emulated DOM tests have no read-response stubs; actual signed SSO HTTP success, audit failure, recovery and revoked-binding clearing. Test harness corrections: workspace uses clear(), and revoked-binding read is requested directly rather than reauthorizing Models first.
- Typecheck PASS; planning/docs/links/fixture scan PASS; all six pinned compatibility checks PASS. Full standard check and exact-head CI reported in PR, independently of these focused results. Native desktop unavailable:500 screen still being released; no native-browser or installed-provider claim.
