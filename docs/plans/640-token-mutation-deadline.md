# Bounded proxy-token mutation lifetime

## Issue and problem
- Issue: #640, parent #637.
- Existing issuance/revocation clients await the authorized request and response body indefinitely. Abort-ignoring ports can leave confirmation UI pending forever, including after caller cancellation.

## Scope and expected behavior
- Bound each client operation to 10 seconds, consistent with existing management read safety bounds. Timeout is uncertain: a server commit may already exist. Never retry or claim rollback.
- Caller cancellation returns cancelled promptly even if the port ignores its signal. Abort upstream and cancel late response bodies without publishing late credentials.
- Preserve request shape, validation, authentication/denial outcomes, secret handling and server lifetime/IAM/audit authority.
- Out of scope: navigation, session authority, backend endpoints, provider calls, deployment and policy changes.

## Design
- Add one internal lifetime helper shared by issuance/revocation. Race the whole operation against interruption, not only fetch; own and clear timer/listeners. Pass an internal abort signal through the request and reader cleanup.
- Reuse existing clients rather than add a transport/schema. No glossary or costly domain decisions change. Caller teardown contract remains mandatory. Browser/installed live acceptance remains separate.
- Update contracts/token-mutation-deadline.md and bounded PRD/architecture/acceptance notes.

## TDD plan
- Reproduce through both public clients using controlled timers: stalled request, stalled body, caller abort ignored by port, late success, successful completion timer cleanup, fresh 401/403, invalid input and no retries.
- RED must demonstrate the returned promise remains pending, not fail an import. GREEN then run issuance/revocation and SSO management regression, typecheck, lint, check.py and full npm check where available.

## Delivery
- Plan and red tests first; helper and minimal client adaptation; regression and reviewable PR with exact HEAD CI and independent approval before merge.
- Timeout cannot establish revocation/issuance outcome. Caller must use existing reconciliation/operator workflow, never automatic retry. Rollback is code-only and does not roll back server mutations.

## Recovery 2026-11-17
1. Preserve older uncommitted worktrees. Recover the bounded mutation implementation into the current #948 dependency base; preserve newer token validation and Account handoffs.
2. Run original deadline cases as meaningful RED before adapting production clients.
3. Verify client, UI and actual owned HTTP/SQL token regressions, then submit an exact-head draft PR and independent review request.

## Canonical integration 2026-11-19 16:00 KST
- Reconcile the existing PR with current #948/main, preserving newer management, Account/history and transport safeguards. Do not duplicate the feature stack or change session/runtime activation.
- Verify the bounded request/body lifetime, cancellation, secret disposal, and issue/revoke UI uncertainty against the integrated tree, including owned HTTP/SQL committed-outcome cases. Refresh exact-head CI and independent review after integration; parent #948 must merge first.

## Integrated verification
- Canonical #948/main integration: 72 focused public-client, panel, Account handoff and owned HTTP/synthetic JWT/PGlite tests passed with zero failures or skips; strict TypeScript, full Biome and planning/fixture checks passed.
- Bundled production Operations in native Chromium with a synthetic abort-ignoring request port: issuance and revocation left pending state at the real ten-second deadline, displayed existing uncertainty warnings, made exactly one request, cancelled late response bodies, never displayed the late synthetic credential, and disposed cleanly. This is not actual IdP/login, installed PostgreSQL, TLS deployment or provider acceptance.

## Parent reconciliation 2026-11-19 16:30 KST
- Parent #948 advanced to integrate main 292e106 usage-review sessions, cursor progress and Operations stream disposal. Carry the canonical changes into the existing token deadline PR without changing the deadline/uncertainty contract. Re-run all deadline client/panel/owned HTTP and stale-body regression cases, strict types, lint and document checks.
- Parent must merge first; old approvals and CI do not certify this integration. No session/runtime activation, API, DDL or deployment expansion.

Parent-refresh evidence: 86 focused deadline, panel, Account handoff, owned HTTP/synthetic JWT/PGlite and Operations response-disposal regressions PASS, zero FAIL/SKIP; strict full TypeScript, full Biome and planning/link/fixture checks PASS. No fresh installed browser/live acceptance claimed.
