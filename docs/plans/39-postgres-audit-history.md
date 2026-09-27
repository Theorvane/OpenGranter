# Read Principal Audit History from PostgreSQL

## Issue and problem

- Issue: [#39](https://github.com/Theorvane/OpenGranter/issues/39)
- Gateway metadata audit events can be stored durably, but there is no reader for inspection or later authorized APIs.

## Scope and expected behavior

- In scope: a bounded PostgreSQL reader for one non-anonymous principal's audit history. It uses descending event ID keyset pagination, returns only allowlisted event metadata, and fails the whole page on malformed or mixed-principal storage rows.
- Out of scope: HTTP endpoint, `audit:Read` caller authorization, anonymous-event search, organization-wide search, CSV export, retention, and tamper-resistant replication.
- The caller supplies a trusted target principal after authorization. The reader still binds that principal in SQL and validates each returned row against it. An opaque decimal event-ID cursor cannot change the principal scope.

## Design

- Reuse the existing gateway audit event projector for stored-row validation and field allowlisting. Reconstruct a known event from fixed SQL columns and JSONB details, with database columns taking precedence over any nested keys.
- Parse PostgreSQL bigint IDs as canonical decimal strings and reject values outside signed bigint or unsafe occurrence timestamps. Return at most 100 events and a cursor based on the last returned event ID.
- Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). No ADR is needed for this bounded read adapter.
- Open decisions: audit-reader IAM resource semantics, anonymous/admin search, retention, export, and deployable connection management.

## TDD plan

- First write a PostgreSQL-backed test with multiple events at the same timestamp, paging within one principal, and no other-principal rows; expect the reader module to be absent.
- Add forged cursor, mixed-principal row, malformed JSONB metadata, oversized page, and database-failure tests. Confirm safe errors and no unexpected content fields.
- Implement the reader, then run focused red/green tests and `npm run check`.

## Delivery

- Commit on `feat/39-postgres-audit-history` with authorized DCO and assistance trailers. Open a ready PR linked to #39 and this plan.
- A future authenticated audit API must check `audit:Read` before calling this storage reader.
