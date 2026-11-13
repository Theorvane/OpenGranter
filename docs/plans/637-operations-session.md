# Trusted-session lifecycle for management operations

## Issue and problem
- Issue: #637; related #639, #641.
- History/token navigation exists, but its approved caller must manually connect expiry and logout. A forgotten callback can leave an issued token visible after known expiry.

## Scope and expected behavior
- Add an opt-in DOM adapter consuming the existing CatalogAuthorityGrant (trusted request and absolute expiry). Begin locked without requests. On valid authorization mount existing operations. Expiry, logout, grant replacement and disposal abort and clear the child, including retained secret nodes.
- Check time before and after transport completion, not merely on timer delivery. Stale completions and stale timer callbacks must not affect a replacement grant. Re-arm early timers and cap platform delays.
- Scheduling/clock uncertainty fails closed with generic boundary text. Server 401/403 terminates the grant. Timer cleanup exceptions must not preserve private data.
- No authentication acquisition, public-entry activation, cookie/CSRF/IdP bridge, policy changes, persistence, production or paid calls. Caller remains responsible for supplying approved authority and calling clear on logout/identity change. Clearing is not token revocation or mutation rollback.

## Design
- New operations-session.ts composes existing operations-app and boundary-view. Reuse CatalogAuthorityGrant terminology and narrow clock/scheduler options; do not change catalog or frontend-owned entry files.
- Alternative: leave caller obligations entirely manual; rejected because known-expiry enforcement is reusable and testable without deciding authentication contracts.
- No new domain terms or irreversible decisions. Actual trusted session source and installed activation remain unresolved with backend/frontend owners.
- Contracts: contracts/management-operations.md; docs/PRD.md, docs/architecture.md and docs/acceptance.md.

## TDD plan
- Write tests against an inert exported adapter first: initial locked/no requests, authorization starts actual history GET, timer expiry removes retained issued-secret nodes, missed timer still blocks mutation, identity replacement aborts pending calls, late completion/timer isolation, server denial, invalid expiry/clock and scheduler failures, disposal and canonical browser build.
- Expected RED: behavioral assertions, not missing import. Implement the minimal epoch-guarded lifecycle; run focused tests, tsc, Biome, planning, compatibility and npm run check.

## Delivery
- Record RED/GREEN and exact validation limitations in PR. Obtain exact-head CI and formal independent approval before merge. Revert this opt-in adapter independently; existing entry and APIs remain unchanged.
