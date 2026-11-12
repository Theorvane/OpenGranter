# CSV page client continuation progress

## Issue and problem
- Issue: #642 (parent #637).
- The browser CSV transport accepts equal or regressing continuation keys as ready. A caller following them can repeatedly display/export duplicate pages. The server export job guard does not protect an independently consumed browser page.

## Scope and expected behavior
- Validate continuation progress against the exact serialized request cursor; reject stalled or regressing keys as unavailable before exposing CSV.
- Retain the descending occurredAt / UTF-8 attemptId order already required by JSON and SQL. Cursor strings remain opaque for navigation: return the received value unchanged, never invent one.
- No CSV row parsing, authorization, session, DOM, provider, budget, database or runtime activation changes.

## Design
1. Capture the request cursor once before asynchronous transport, using the serialized query as the immutable source.
2. Decode only already-validated cursor tuples and compare timestamps and UTF-8 bytes without locale collation.
3. Reject equal/newer continuation keys before consuming response body; keep first-page and terminal-page semantics.
- Alternatives: equality alone misses backwards navigation; lexical base64 comparison disagrees with domain order. Reusing server modules would enlarge the browser dependency surface.
- No new product decisions; this enforces existing pagination order. Dependencies: none; based on actual main, not pending #880/#882/#883.
- Contract: [CSV transport](../../contracts/management-usage-export.md).

## TDD plan
1. Add public-client failures for equal, newer-time, newer UTF-8 ID and shorter-prefix request keys. Expect ready versus unavailable failures.
2. Cover valid older time, valid lower UTF-8 key, first/terminal pages, immutable input across await, and unread-body cancellation.
3. Implement the minimal tuple comparison. Preserve bounded UTF-8 reads, cancellation/deadlines and fixed error states.
4. Run focused tests, typecheck, lint, planning checks and npm run check; report resource or other failures separately.

## Delivery
1. Commit on fix/642-csv-client-progress with sjungwon03 identity.
2. Open PR targeting main, request independent exact-head review and wait for all required CI and formal approval before merge.
- Rollback: revert this transport guard only; no schema or deployed configuration changes.
- Browser login/installed/live-provider acceptance remains unverified.
