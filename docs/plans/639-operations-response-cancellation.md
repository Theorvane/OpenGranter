# Operations response cancellation

## Issue and problem
Refs #639, parent #637. Stale operations bodies are hidden but stalled and late response producers are not promptly cancelled.

## Scope and expected behavior
Cancel owned readers on logout, expiry, identity replacement, disposal and navigation. Cancel unread late headers and fresh denials. Preserve authority checks and generic errors. No authentication, IAM, API, entry activation or deployment change; cancellation is not revocation or mutation rollback.

## Design
Existing child disposal already cancels stalled readers. The reproduced gap is late headers from an abort-ignoring port: cancel their unread response body before rejecting stale authority. Do not await untrusted producer cancellation; preserve existing live response handling.

## TDD plan
RED: three late-header cases fail; seven existing stalled-body and denial cases already pass. GREEN: exact-once cancellation, replacement identity survives and denial remains terminal. Cover EOF, rejection and hanging cancellation. Run operations regressions, strict TypeScript, Biome, planning checks and full check.

## Delivery
Separate PR, exact-head CI and formal approval before merge. Risk: stream cleanup reentrancy. Installed SSO/provider evidence remains separate.

## Verification
Baseline original implementation: 9 pass / 12 fail / 0 skip, including three native HTTP connections left open. Fixed: 21/21 targeted and 58/58 focused operations/account tests pass. Native loopback HTTP proves late 200/401/403 fetch bodies close their upstream connection after logout. Strict TypeScript, changed-file Biome, planning/link/contract checks, pinned compatibility and diff checks pass. Full check started; result pending, not aggregate green. Synthetic local authority and loopback HTTP are not installed SSO or provider evidence.
