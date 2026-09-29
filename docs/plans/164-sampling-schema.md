# Seed and Top-K Schema Drift

## Issue and problem

- Issue: [#164](https://github.com/Theorvane/OpenGranter/issues/164).
- Current eleven-field official projection ignores seed/top_k structure despite recent runtime delivery.

## Scope and expected behavior

- Extend the exact request map to thirteen fields; seed/top_k source structure joins existing fields and two supported format definitions.
- Refresh the reviewed version-2 pin; its projection format is unchanged. Exact selected-field validation rejects stale eleven-field maps, missing fields and rehashed malformed maps.
- Keep canonical integrity/provenance, annotation handling, safe fixed errors and bounded credential-free official-host transport. No auto-update, inference call or runtime IAM/audit/usage change.
- Other references, native provider schema drift, instance/response/tool/stream conformance and complete external-client certification remain open. Tracking declared fields does not guarantee model support or OpenRouter enforcing locally defined native ranges.

## Design

- Extend the explicit field allowlist instead of broad schema traversal. Preserve the bounded two-definition coverage introduced in [plan](158-schema-drift-coverage.md).
- Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), raw snapshot retrieved 2026-09-29; revalidate the reviewed projection with explicit live comparison.
- Update [contract](../../contracts/openrouter-schema-drift.md), [compatibility](../openrouter-compatibility.md) and [acceptance](../acceptance.md).
- Runtime top_k PR #163 is independent; source coverage does not settle provider capability choices.

## TDD plan

- First add field-structure drift and missing/malformed field tests; current projector ignores them.
- Cover integer/nullability/constraint changes, exact-map tampering with recomputed integrity hash, annotations/unrelated structure and safe fixed-source fetch/CLI regressions.
- Minimal allowlist and reviewed pin update, focused green, explicit live comparison, strict touched lint and full npm run check.

## Delivery

- Ready issue-numbered PR with red/green and full evidence.
- Pin and field selection must be reverted together for rollback. Source outages never rewrite the pin.

## Verification evidence

- Red: 4 new tests fail and 21 existing tests pass before projector changes; sampling-field changes and malformed/missing fields were ignored.
- Green: 27 focused public-boundary tests pass after the minimal allowlist/pin refresh, including recomputed-hash map rejection and annotation-only changes.
- Explicit `npm run compatibility:drift` passes against the official live source without changing the pin.
- `npm run check`: 785 tests pass and 1 optional PostgreSQL integration is skipped locally. Typecheck, lint, planning/link/contract/fixture-secret checks and offline source integrity pass.
- Touched-file warnings-as-errors lint and diff whitespace validation pass.
- Based on main with merged schema PR #159 and seed PR #161. Runtime top_k PR #163 is independently updated and awaits its latest checks/review; combined source/runtime validation must follow merge, including removing its obsolete not-yet-tracked documentation statements.

## Approved runtime top-k integration

- PR #163 is merged. Integrate its runtime controls with the thirteen-field source projection and keep both acceptance/compatibility scenarios.
- Remove obsolete source-coverage statements from the current top-k contract and compatibility inventory. Historical plans keep their delivery-time evidence; this section supersedes earlier pending-runtime statements.
- Revalidate all tests on the combined branch before publication. Source comparison still does not guarantee model support, native provider ranges or complete client/tool/stream conformance.

- Combined full `npm run check`: 799 tests pass and 1 optional PostgreSQL integration is skipped locally. Typecheck, lint, planning/link/contract/fixture-secret checks and offline thirteen-field pin integrity pass.
- Strict touched-file lint and diff whitespace validation pass. Both source tracking and runtime top-k cases are included; current contract/inventory statements now reflect the tracked fields.
