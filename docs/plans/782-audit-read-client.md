# Bounded audit history read client

## Issue and problem
Issue: #782; parent #637 / #642. Administrators need audit history data,
but the management modules have no client for the existing GET /v1/audit API.

## Scope and expected behavior
An opt-in client accepts an already-authorized request port. It constructs only
relative /v1/audit JSON reads, preserving exact principal/model/time filters and
opaque cursor values. It validates bounded JSON, event ordering, scope and
paging, projects allowlisted metadata, and exposes ready, invalid_query,
unauthenticated, denied, unavailable and cancelled states. It never obtains
credentials, retries, persists private data or supplies browser authority.
CSV, UI mounting, new endpoints, session/CSRF/CORS, SSO bridging, runtime
activation, retention and deployment are out of scope. Existing server IAM and
mandatory audit remain authoritative. A port is not a login implementation.

## Design
Reuse existing audit query and projection contracts, not a duplicate event
allowlist. Validate unknown response envelopes and event fields before the typed
projector. Cap body size at 1 MiB and duration at 30 seconds; reject malformed
UTF-8. Invalidation cancels outstanding work even when a port ignores AbortSignal.
No new architecture decision. UI integration depends on the unresolved session
contract; no automatic connection is permitted. See contracts/audit-read-client.md.

## TDD plan
First import the missing public client and exercise filtered reads: RED missing
module. Cover exact filters and cursors, projected event metadata, empty pages,
malformed/oversized bodies, scope/order/paging failures, status mapping, response
cancellation and a port ignoring cancellation. Run targeted tests, typecheck,
lint, planning checker and existing audit history cases. Add real loopback HTTP
acceptance without claiming real SSO or PostgreSQL.

## Delivery
Create issue-numbered worktree, plan, RED tests, minimum implementation, GREEN,
PR with exact revision evidence, independent review and required CI. Rollback is
removing the opt-in module; no installed state or schema changes exist. Base
15c74bc includes unmerged prerequisite work; this branch does not approve or
merge those dependencies. Exact-head review and CI gates remain mandatory.
