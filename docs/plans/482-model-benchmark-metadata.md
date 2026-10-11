# Model benchmark metadata plan

## Issue and problem

- Issue #482; compatibility release gate #116 and unresolved #7 stay open.
- Administrator snapshots reject standard optional benchmarks. Authorized external clients cannot receive published Artificial Analysis indices or Design Arena rows.

## Scope and expected behavior

- Own optional benchmarks must be non-null and requires own design_arena array of 0..64 non-null rows. Optional own artificial_analysis is a non-null object requiring own intelligence_index/coding_index/agentic_index, each finite number|null.
- Each arena row requires own arena/category strings of 0..256 UTF-16 units, finite elo/win_rate numbers and signed safe-integer rank. Preserve exact strings/numbers, null/omission, empty arrays, duplicate rows and order. Do not impose unencoded score/percentage/rank ranges, scaling, normalization, deduplication or sorting.
- Reject own undefined, wrong/nonfinite scalar types, unsafe/fractional rank, null objects, missing own required fields, unknown keys, array holes (including inherited fillers) and excessive bounds with fixed errors. Capture once and freeze root/nested/row/array values; use bounded own indices without executing a supplied iterator. Inherited optional fields are omitted.
- Keep complete-catalog validation before enabled model AND final-provider IAM, existing query/order/paging, fresh page policy and required private audit. Basic/legacy rows remain unchanged; no operational benchmark data or inference/routing/secret/limit/usage listing calls.
- No benchmark fetching, freshness/accuracy verification, provider/model ranking, route selection, query sort, capability grant, token estimation or billed-cost authority. Existing nullable JSONB object/64 KiB cap and migrations remain unchanged; independently valid field limits may still exceed the aggregate storage cap.

## Design

- Extend TypeScript metadata/interface allowlist with a conditional own benchmark snapshot. Add required-known-object validation, finite score/signed-safe-rank validation, and nested row/list freezing; reuse exact bounded text handling. HTTP projection and PostgreSQL listing/route boundaries already share the snapshot validator.
- Fresh read-only factual sub-agent checks on 2026-10-11 confirm these selected definitions match the existing model-response pin. The [official schema](https://openrouter.ai/openapi.json) has no score ranges, array uniqueness/length, string minimum length or defaults. Installed OpenRouter 1.4.18 accepts finite negative/fractional scores, percentages above 100, signed safe ranks, duplicates and blank text; it maps artificialAnalysis/designArena and camelCase score/rate fields. OpenAI 7.23.0 preserves additional raw JSON fields.
- Scores are source-relative informational evaluations, not instructions to alter organizational policy or routing. Bounds/own-required/unknown-key rules are explicit local restrictions. All three schema pins stay byte-identical; no new glossary term or irreversible trade-off/ADR is needed.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [base contract](../../contracts/model-discovery-metadata.md) and [benchmark contract](../../contracts/model-benchmark-metadata.md).
- Publication/refresh, accuracy/aggregation, ranking/route policies and live provider certification remain separate decisions.

## TDD plan

- First public/storage/actual SDK probes expect valid benchmark rows; current validator returns 503. Record behavioral red before production changes, then add the smallest snapshot implementation.
- Cover absent/empty/nullable AA, score signs/fractions/extreme finite values, rank safe signed limits, exact/blank/Unicode names, duplicate row ordering, field/count boundaries and malformed/unknown/incomplete/nonfinite data including hidden entries.
- Verify authentication before catalog, implicit/model/provider Deny, required dependency failure, legacy/basic/query/order behavior, fresh SDK paging and private errors. Getters read once, inherited optional fields omitted, throwing getters private, source mutation harmless across audit; arrays ignore iterators and reject inherited holes.
- PostgreSQL fake list/route capture retains approved routes and deeply frozen snapshots; migrated PGlite JSONB round trips retain no-backfill and aggregate-cap behavior. Format changed files and run focused tests plus full npm run check.

## Delivery

- Issue/new branch/plan before production code. PR links the plan and reports red/green, full-check results and limitations. Review the exact published diff; both exact-head check jobs and sjungwon03-ai approval precede sjungwon03 squash merge.
- Downgrade requires removing newly supported stored fields. Administrator benchmark data may be stale, inaccurate or semantically unusual despite valid shapes. Publication/refresh, remaining discovery/pricing fields, full #116 and unresolved #7 stay open.

## Verification evidence

Publish optional administrator benchmark snapshots on compatible rich model discovery. Require Design Arena rows and optionally accept Artificial Analysis indices; preserve exact finite scores/rates, nullable indices, signed safe-integer ranks, blank/Unicode labels, empty arrays, duplicates and supplied order. Local bounds are 64 rows and 256 UTF-16 units per label. Capture nested fields, validated array length and own indices once, deeply freeze the snapshot and reject incomplete/unknown/malformed values privately without invoking supplied iterators.

The shared HTTP/PostgreSQL validator retains complete hidden-catalog validation, enabled model/final-provider IAM, required private audit, fresh paging policy, unchanged basic/legacy/query/order behavior and approved routes. Benchmarks never fetch evaluations, normalize scores, rank/select providers, grant capabilities or change token/limit/billing authority. Existing JSONB object/64 KiB cap, migrations and all three schema pins remain unchanged. Product, architecture, acceptance and contracts document the subset and its restrictions.

TDD: node --experimental-strip-types --test test/model-benchmark-metadata.test.ts test/sdk-model-benchmark-metadata.test.ts initially produced 79 passes and 24 expected behavioral failures (valid snapshots returned 503, storage validation rejected them and actual SDKs received catalog_unavailable). The minimal shared snapshot extension makes all 103 new public/storage/SDK tests pass. Full npm run check passes strict types, lint, 5959 tests with one existing PostgreSQL skip, planning/contracts/fixture scans and offline schema integrity.

Risks/remaining scope: administrator evaluations may be stale, inaccurate or semantically unusual despite valid shapes. No unencoded score/rate/rank ranges, scaling or sorting policy is inferred. Field/count/own-required/unknown-key bounds are local restrictions; individually valid maximum rows/labels can exceed the aggregate storage cap and be rejected. Downgrading requires removing newly supported stored fields. Publication/refresh, remaining pricing/discovery fields, full #116 and unresolved #7 remain open.

