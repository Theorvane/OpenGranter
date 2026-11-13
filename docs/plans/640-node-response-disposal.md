# Dispose rejected HTTP responses

## Issue and problem

- Issue: #640, parent #637.
- Invalid response headers cause a safe fallback, but leave the discarded response producer running. This affects private management response cleanup.

## Scope and expected behavior

- Cancel rejected normal and custom fallback bodies without exposing their bytes or errors.
- Cancellation must not delay the safe fallback, including rejection and never-settling cleanup.
- Preserve successful streaming, IAM, audit, credentials, status envelopes and connection handling. No browser/session/SQL/runtime or deployment changes.

## Design

- Track each response before validation; initiate best-effort cancellation on rejection. Catch cleanup failures without awaiting producer completion.
- Awaiting disposal was rejected because producer cleanup is not a response prerequisite. Do not alter public API or permissions.
- No unresolved domain decision is implemented. Browser session supply remains a separate gate.
- References: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/sso-management-http.md).

## TDD plan

- Real HTTP tests observe producer cancellation for invalid normal/custom fallback headers; RED must show zero disposal calls.
- Successful/rejected/stalled cancellation must preserve bounded generic fallback with no private bytes. Valid streams remain unchanged.
- Run focused transport and SSO tests, TypeScript, Biome, planning checks and npm run check. Disclose environment failures.

## Delivery

- Plan, failing socket regression, minimal disposal implementation, docs, verification, PR.
- Risk: cancellation cannot force an uncooperative producer to stop. Locked/consumed bodies can refuse cancellation; cleanup is best-effort.
- Rollback: revert this slice without modifying authentication or persisted state. No mutation retry or rollback is introduced.
