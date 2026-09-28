# Load the Complete Bundled Migration Set

## Issue and problem

- Issue: #71
- The migration-gated server requires a complete trusted source array. Contiguous version validation cannot detect an omitted trailing file on an empty database. Deployment authors currently reproduce filesystem loading code.

## Scope and expected behavior

Provide an explicit manifest of all shipped SQL migrations and a loader that preserves their exact UTF-8 text. Reject missing, unexpected, nonregular, or empty SQL entries with a fixed safe error. Add an unbound server factory that loads the bundle before calling the existing migration-gated factory. No request contract, authorization, audit, or usage behavior changes.

## Design

`loadPostgresMigrationSources(directory?)` defaults to the repository migration directory relative to its module. A deployment may supply a trusted local directory URL containing the same complete manifest. SQL entries must be regular files and match the manifest exactly; unrelated non-SQL notes are ignored. Read each file in manifest order without trimming its returned content. Trim only to reject empty SQL. Errors carry no paths, SQL, filesystem details, or nested causes.

`createBundledNodePostgresDirectChatServer` accepts the existing migration-capable server ports without a source array, plus an optional trusted `migrationDirectory`. Loading completes before any database transaction or registration read. It then delegates to the existing schema-verifying factory. Callers still own listening, shutdown, database lifecycle, and serialized migration execution.

An explicit manifest detects a missing tail and makes additions reviewable; unconstrained directory scanning cannot establish completeness. Future migrations must update the manifest and ship the SQL alongside source modules. This is completeness validation, not artifact authenticity: trusted deployment provisioning, file permissions, and protection against concurrent filesystem modification remain required. Existing source-array and lower-level factories remain available.

See [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). Concurrent migrator coordination and packaging/process entry points remain open. Existing HTTP cases do not change.

## TDD plan

First add public loader/factory tests and confirm the absent module fails. Test the real bundle against all shipped filenames and original SQL bytes. Use disposable filesystem fixtures for missing tail, unexpected/duplicate-version SQL, SQL symlink/directory, nonexistent directory, empty content, and exact byte preservation. Test factory success/restart against embedded PostgreSQL and source failure before any SQL/provider/secret call. Implement the manifest, safe loader, and small factory composition. Run focused tests, formatting, and `npm run check`.

## Delivery

Issue, branch, plan, red tests, implementation, green evidence, updated documents, full gate, ready PR. Reverting the loader does not change schema; keep earlier factories available. CI also verifies the real PostgreSQL migration set. Document deployment ownership and bundle-trust limits in the PR.

## Verification

Pending implementation.

- Red: direct runs of `test/postgres-migration-sources.test.ts` and `test/bundled-postgres-server.test.ts` with `node --experimental-strip-types` failed with `ERR_MODULE_NOT_FOUND` for their absent public modules.
- Green: the same direct commands passed all six loader tests and both bundled-server tests after implementation.
- Full gate: `npm run check` passed TypeScript, Biome, 279 tests, and planning/link/contract/fixture checks. One real PostgreSQL integration test skipped locally without its explicit database URL; CI provisions that database.
- `git diff --check` passed. Trusted bundle provisioning and protection from concurrent modification, serialized migrators, listening, and shutdown remain deployment responsibilities.
