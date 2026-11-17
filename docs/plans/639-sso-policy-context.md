# Fresh SSO policy context (#639)

1. Supply the missing identity-to-IAM composition for a trusted SSO catalog/session adapter. Verify the access token and current pre-registered human binding using the existing authenticator, then load the current consistent PostgreSQL principal/role/policy snapshot. Never manufacture a proxy credential ID or equate successful authentication with permission.
2. Return only principal id, active=true, resolved statements and policy versions to trusted server code. The input is an access-token string, not an actor id or browser claims object. No HTTP route, cookie, browser persistence, session issuance, audit success claim, provider call or deployment activation is added. Existing RFC 9068 factory performs real local-key verification.
3. RED: add tests against the missing module covering signed JWT + migrated embedded SQL and hostile dependency results. Preserve the real failure log before implementation.
4. GREEN: reuse existing verifier, SSO human authenticator, consistent snapshot reader and attachment resolver. Recheck active human kind after binding to catch intervening disable/kind changes; missing/inactive/nonhuman returns fixed unauthenticated. Broken snapshots and dependencies return fixed unavailable without private causes. Do not cache contexts or policies across calls.
5. Verify direct/role policy resolution, immediate version and Deny changes, removed binding, changed principal kind/active status, malformed/missing attachments, dependency failures, no credential/token/claims leakage, and no SQL writes. Run dependent tests, full typecheck, lint and planning checks.
6. Require exact-head all-required CI and independent formal approval before merge. This is an internal composition, not browser login/session acceptance or installed/live-provider evidence. Fresh binding and snapshot reads are separate statements, not an atomic transaction; the caller must still authorize each model and final provider and persist correct SSO-specific required audit before responding.

## Delivery evidence

- Added the server-only SSO policy authenticator and registered-key RFC 9068 factory in src/identity/postgres-sso-policy-context.ts. Browser session and SSO-specific catalog audit composition remain separate owner work. No public endpoint or production activation.
- RED: Node 22.23.4 missing module, zero passes and one failed file (/tmp/og-1400-red.log).
- GREEN: focused 12/12, zero skips (/tmp/og-1400-final.log); prior dependent suite 58/58, zero skips (/tmp/og-1400-suite.log). Initial SQL assertion assumed alphabetical policy order; corrected to existing direct-then-role resolution without changing resolver semantics.
- Actual local signed JWT verification and migrated PGlite tested role/direct Deny, current policy version, binding removal, principal disable/kind changes, and expiry. PGlite is not installed PostgreSQL, a real IdP login or browser E2E.
- Full typecheck passed; full lint passed with 42 existing warnings and 148 infos. Planning/link/fixture scan and whitespace checks passed. Review and exact-head CI gates remain mandatory.
