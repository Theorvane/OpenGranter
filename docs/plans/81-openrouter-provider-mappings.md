# Persisted verified OpenRouter provider mappings

## Issue and problem

- Issue: [#81](https://github.com/Theorvane/OpenGranter/issues/81).
- Delegated routing currently requires an externally supplied verified per-model provider-slug resolver. There is no PostgreSQL adapter for that trusted configuration.

## Scope and expected behavior

- Add migration `009` for administrator-controlled mappings keyed by inference provider ID and upstream model ID, with provider slug, enabled state, and explicit verified state.
- Read only enabled, verified mappings for the exact requested pair. Missing/disabled/unverified pairs yield no mapping; malformed or out-of-scope rows and database failures return fixed safe errors.
- Prevent two enabled, verified mappings from claiming the same model/slug under different IAM provider IDs.
- Validate lookup inputs before SQL and bind them as parameters. Return only a slug; no credential, arbitrary host, or caller override is accepted.
- Include migration `009` in the trusted bundle. Keep adapter injection explicit; no existing factory changes.
- Out of scope: management writes, automatic verification/discovery, mapping refresh orchestration, public authentication, and content-audit settings.

## Design

- A narrow PostgreSQL query adapter implements the existing `resolveVerifiedProviderSlug(providerId, upstreamModelId)` port. Validate requested IDs and returned row fields independently of SQL filters.
- Use per-call reads rather than a process cache, preserving exact model scoping and observing disablement on the next lookup. Multiple candidate lookups are not one atomic configuration snapshot.
- A partial unique index covers enabled/verified model-slug pairs. Disabled/unverified staging mappings cannot resolve; they may share a slug until enabled and verified.
- The verified flag is administrator attestation, not proof obtained by this reader. Operational verification and registration-change audit remain separate work.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [mapping contract](../../contracts/openrouter-provider-mappings.md).

## TDD plan

- Add a persisted exact-pair lookup test first; expect the new adapter module to be missing before implementation.
- Test missing/disabled/unverified/wrong-model pairs, immediate next-lookup disablement, conflicting mapping rejection, hostile-looking bound provider IDs, invalid IDs before SQL, malformed/duplicate/out-of-scope rows, and safe driver failures.
- Exercise the existing delegated coordinator with persisted mappings: IAM-denied providers never reach lookup/inference; only authorized slugs are forwarded; mapping failure stops upstream contact.
- Extend fresh/idempotent migration coverage and the bundled manifest.
- Implement the schema and minimal validating resolver; format and run focused tests, then `npm run check`.

## Delivery

- Issue and plan precede tests/code; update contracts; capture red/green evidence; publish a ready PR.
- Deploy the additive migration before supplying this adapter. Revert callers to the prior explicit resolver if needed; leave recorded migration history and the unused table intact.
- Report full validation, trusted administrator verification, per-call consistency limits, and remaining deployment wiring in the PR.

## Verification evidence

- Red: the new mapping test failed with `ERR_MODULE_NOT_FOUND` before the adapter existed.
- Red: after adding migration `009`, the migration-source test failed 3 cases against the old eight-file manifest (complete default/trusted bundles and rejection of a missing final file).
- Green: `node --experimental-strip-types --test test/postgres-openrouter-mappings.test.ts test/postgres-migration-sources.test.ts test/postgres-migrations.test.ts` passed all 17 cases.
- `npm run check` passed strict TypeScript, Biome, 312 tests, and planning/link/contract/fixture checks. One external PostgreSQL test was skipped locally because no database URL was configured; CI supplies PostgreSQL. Embedded PostgreSQL cases passed.
- `git diff --check` passed. Historical migration files and the `CLAUDE.md` symlink are unchanged.
