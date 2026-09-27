# Track and Apply PostgreSQL Migrations

## Issue and problem

- Issue: [#37](https://github.com/Theorvane/OpenGranter/issues/37)
- Four ordered PostgreSQL SQL files are used separately in tests, but no reusable runner records applied versions or detects changed historical files.

## Scope and expected behavior

- In scope: a TypeScript programmatic runner for migration sources `{version, sql}` on a dedicated transaction-capable PostgreSQL connection. It creates a history table, validates a contiguous ordered source set, compares SHA-256 checksums with history, and applies each pending migration plus its history row in one transaction.
- Out of scope: database connection setup, CLI, automatic down migrations, cross-process locking, application startup wiring, and operator rollout policy.
- Re-running the same set is a no-op. Missing or modified applied versions, duplicates, reordered sources, bad version format, and database errors return fixed safe errors. A failed migration leaves neither its schema changes nor a history row.

## Design

- Keep SQL files as the source of truth. The runner receives their contents from a trusted caller; it never accepts request-supplied SQL.
- Use an injected `transaction(callback)` port so every migration's SQL and history insert share one real database transaction. Callers must provide a dedicated connection or transaction adapter, not a pool's unrelated `query()` calls.
- History stores version, checksum, and application time. Check all applied history against the complete supplied source list before any new migration. Deployment runs a single migrator per database until concurrency locking is designed.
- Update [architecture](../architecture.md) and [acceptance](../acceptance.md). No ADR is needed for checksum tracking and per-migration transactions in this initial runner.
- Open decisions: production connection manager, deployment sequencing, cross-process lock, and rollback strategy.

## TDD plan

- First test applying all existing SQL files to embedded PostgreSQL and re-running them without duplicate history; expect the runner module to be absent.
- Add drift, missing historical source, duplicate/out-of-order input, and failing migration rollback tests. Verify safe errors and no SQL content leakage.
- Implement minimal runner, refactor, then run focused red/green tests and `npm run check`.

## Delivery

- Commit on `feat/37-postgres-migration-runner` with authorized DCO and assistance trailers. Open a ready PR linked to #37 and this plan.
- The runner alone is not a deployment command; production connection and rollout wiring remain separate work.
