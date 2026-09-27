# PostgreSQL Usage Ledger Append

## Issue and problem

- Issue: [#25](https://github.com/Theorvane/OpenGranter/issues/25)
- The gateway emits normalized usage records, but its `writeUsage` port has no concrete durable implementation. A write with an ambiguous outcome may be retried, so attempts must be keyed atomically without double counting or overwriting a different record.

## Scope and expected behavior

- In scope: a PostgreSQL migration and TypeScript append adapter using parameterized SQL and the existing `UsageRecord` contract. Exact repeats are no-ops; an attempt ID reused for different data raises a fixed safe conflict. Database failures raise a fixed safe availability error.
- Out of scope: connection provisioning, migration runner, recovery queue/worker, retention, bill reconciliation, aggregates, and reader APIs.
- The adapter stores only allowlisted, content-free normalized metadata. It never receives provider keys or prompts from the gateway and does not serialize unexpected properties on its input.
- A unique attempt ID is the idempotency key. Index principal and occurrence time for later scoped reads. The ledger row is append-only at the application boundary.

## Design

- Define a narrow SQL query client so a managed PostgreSQL instance on AWS or on-premises can supply the connection. Use `INSERT ... ON CONFLICT DO NOTHING RETURNING` followed by a JSONB equality check for an existing attempt; a conflicting payload never updates the original.
- Test the migration and adapter with PGlite as an embedded PostgreSQL engine. PGlite is a test dependency, not the deployment database. This is a concrete ledger storage choice only; identity, audit, catalog, and secret stores remain undecided.
- Update [architecture](../architecture.md), [PRD](../PRD.md), and [acceptance](../acceptance.md). No ADR is needed for an adapter behind an existing port; the persistence boundary remains replaceable.
- Open decision: a real connection pool, backups, encryption, access controls, migration lifecycle, and replay worker must be specified before deployment.

## TDD plan

- First test first append and identical replay against a real embedded PostgreSQL schema; expect the adapter module to be missing.
- Add conflict preservation, concurrent duplicate writes, retry after an ambiguous committed write, injected content exclusion, principal/time indexing, and database failure tests.
- Implement migration and adapter, format, run focused tests and `npm run check`.

## Delivery

- Commit on `feat/25-postgres-usage-ledger` with the authorized DCO and assistance trailers; open a ready PR linked to #25 and this plan.
- The adapter provides durable append only when its caller supplies a properly configured PostgreSQL client and has applied the migration. A failed connection still returns a safe error and no inference replay.
