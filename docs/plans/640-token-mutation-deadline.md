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
