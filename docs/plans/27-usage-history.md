# IAM-Scoped Usage History

## Issue and problem

- Issue: [#27](https://github.com/Theorvane/OpenGranter/issues/27)
- The usage ledger stores attempts but has no authorized read path. A caller must never be able to widen a principal-scoped read through query parameters, cursors, or malformed stored rows.

## Scope and expected behavior

- In scope: authenticated `GET /v1/usage`, self and specified-principal IAM checks, bounded keyset pagination, a principal-scoped PostgreSQL reader, safe stored-record projection, and nonsecret read audit events.
- Out of scope: CSV export, aggregates, team-scoped delegation, content audit, retention, and a deployed connection pool.
- Without `principal_id`, use `usage:ReadSelf` on `principal:<authenticated-id>`. A present `principal_id` uses `usage:ReadAll` on `principal:<target-id>`, even if the target is the caller. Default and explicit Deny apply to the evaluated action and resource.
- Accept `limit` from 1 to 100 (default 50) and an opaque keyset cursor. Return a list of allowlisted usage records, `has_more`, and `next_cursor`. Invalid query or cursor fails before storage access. No path returns partial data from a malformed or cross-principal ledger result.

## Design

- The HTTP gateway authenticates and checks IAM before calling a narrow read port fixed to one principal. The port returns the next page ordered by occurrence time and attempt ID descending. The handler validates every returned record and principal ID before responding, then writes an attributed read audit event.
- The PostgreSQL reader parameterizes principal ID, cursor, and limit. A keyset tuple handles equal timestamps without repeats or skips. It reads only the requested principal's rows and does not accept SQL fragments or raw filters from callers.
- A stored-record parser copies only known usage fields and rejects invalid structure. It never forwards unexpected JSONB properties, raw content, or secrets.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and the HTTP contract cases. No ADR is needed for this scoped endpoint.
- Open decision: whether later administrative views should support broader organizational filters or role-based team scopes. This issue only supports one principal per request.

## TDD plan

- First add an HTTP test showing a self-authorized principal can read only their own history; expect failure because the endpoint does not exist.
- Add explicit and implicit Deny, cross-principal ReadAll, forged cursor, malformed query, malformed or mixed-principal store results, storage failure, audit failure, equal-timestamp pagination, and PostgreSQL `bigint` string-result tests.
- Implement the smallest parser, reader, and gateway wiring. Run focused red/green tests, formatting, and `npm run check`.

## Delivery

- Commit on `feat/27-usage-history` with the authorized DCO and assistance trailers; open a ready PR linked to #27 and this plan.
- Read results are only as durable as the configured PostgreSQL ledger. Connection provisioning and operational controls remain later work.
