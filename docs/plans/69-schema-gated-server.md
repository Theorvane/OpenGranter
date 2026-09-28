# Gate Server Construction on Schema Verification

## Issue and problem

- Issue: #69
- Deployment code currently invokes migrations and the persisted-direct server factory separately. There is no composition boundary that guarantees migration verification precedes loading configuration.

## Scope and expected behavior

Add an asynchronous server factory that verifies and applies trusted SQL migration sources before loading direct registrations and composing an unbound HTTP server. All existing authentication, IAM, audit, usage, and secret-handling contracts remain in force. Startup never retrieves provider secrets or calls providers. Lower-level factories remain available for deployments with a separate migration phase.

## Design

`createMigratedNodePostgresDirectChatServer` accepts the existing direct-server ports plus a transaction-capable query client and the complete trusted migration source set. It awaits `applyPostgresMigrations`, then invokes the existing persisted-direct server factory. Use the same database port and clock for both phases. Preserve fixed migration/configuration errors without attaching SQL or driver causes. Caller owns database closure, server listening, and shutdown even on failure.

Reusing these ports avoids opening a hidden connection or choosing process configuration. Each migration commits independently: a later migration or configuration failure does not undo earlier committed migrations. A sequential restart skips unchanged history. Deployment operators must serialize migrators; concurrent migration coordination remains open. Migration source provisioning and completeness are trusted deployment responsibilities, not caller-controlled HTTP options. No process entry point, SSO, content audit defaults, or new HTTP routes are introduced.

Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). Existing HTTP contract cases remain applicable because runtime behavior is unchanged.

## TDD plan

First test the absent factory through its public boundary. Migrate a fresh embedded PostgreSQL database, load registrations only afterwards, expose a real socket, and verify an unauthenticated call is denied with persisted anonymous audit. Restart with unchanged sources and check no new migration clock calls. Cover edited/missing history, invalid sources, failed migration rollback, and configuration failure after migration success. Assert no provider or secret call on startup/failure and caller-owned database remains available.

Implement the small composition function without changing lower-level behavior. Run focused tests followed by `npm run check`; verify real PostgreSQL migrations in CI.

## Delivery

Issue and branch, plan, red tests, minimum implementation, green tests, documentation, full gate, ready PR. Rollback can revert the factory while keeping already applied schema; deployments must not drop history automatically. Include red/green commands and any skipped local integration in the PR.

## Verification

Pending implementation.

- Red: `node --experimental-strip-types test/migrated-postgres-server.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the absent factory.
- Green: the same focused command passed all six tests after implementation (socket tests require local network permissions).
- The first full check identified two missing explicit query-result types in tests; both were corrected without weakening strictness.
- Full gate: `npm run check` passed type checking, Biome, 271 tests, and planning/link/contract/fixture checks. One real PostgreSQL integration skipped locally without its explicit database URL; CI provisions PostgreSQL.
- `git diff --check` passed. Caller-owned migration source provisioning/completeness, migration serialization, listening, and shutdown remain required deployment responsibilities.
