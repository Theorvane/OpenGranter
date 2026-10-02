# Track logit bias source drift

## Issue and problem

- Issue: [#220](https://github.com/Theorvane/OpenGranter/issues/220); release requirement [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Runtime nullable logit_bias support exists, but its official structure is missing from selected source drift tracking. Numeric map/nullability/constraint changes evade the gate.

## Scope and expected behavior

- Select ChatRequest.logit_bias with nullable object and numeric additionalProperties/format, retaining structural constraints and literal defaults. Ignore editorial annotations and unrelated fields.
- Expand the exact selected field map from seventeen to eighteen, explicitly refresh provenance/hash/version 7 and reject stale or rehashed missing/extra/malformed maps. Retain all other selections unchanged.
- No runtime request/provider behavior change, IAM/limits/audit/usage effects, secret exposure or per-model certification. Instance validation, other fields/native schemas and full client conformance remain open.

## Design

- Add one field to the existing bounded structural projector and bump the reviewed pin version. Verify official fixed-host source against old selected structures before refreshing canonical source/projection digests.
- Official [OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02, declares object/null with number/double additionalProperties and no key pattern or numeric bounds. Do not turn common provider ranges into local requirements.
- Existing exact-map/integrity gates enforce pin structure; new tests exercise the map's source-specific constraints. No new glossary terms or ADR. This work is independent of approval-pending stream PRs #217/#219.
- See [schema contract](../../contracts/openrouter-schema-drift.md), [runtime contract](../../contracts/client-logit-bias.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md).

## TDD plan

- First regression explicitly selects the source logit_bias structure; expect undefined before projector expansion. Drift replacements change nullability, map numeric type/format, key/count/value bounds or literal default.
- Reject missing/null/array/string selected fields and rehashed missing/extra/malformed maps. Ignore annotations while retaining literal data. Reject versions 1 through 6.
- Add the one selected field/version gate, explicitly refresh the pin, update exact-map fixtures/assertions, format and run npm run check plus live compatibility:drift.

## Delivery

- Issue/plan before code, new branch/PR with red/green evidence and source provenance. Merge only after CI and approval.
- Risks: this is partial structural tracking, not schema-instance validation, provider capability approval or complete compatibility. Refreshed pin must not silently accept unrelated selected drift; keep unsupported behavior explicit.

## Validation evidence

- Red before implementation: logit_bias projection returned undefined instead of the expected nullable numeric map. Command: node --experimental-strip-types --test --test-name-pattern='logit_bias projection' test/openrouter-schema-drift.test.ts.
- Green: all 53 schema-drift tests passed, including nullability/type/format/constraint/literal drift, missing/malformed source fields, rehashed invalid maps and stale version rejection.
- npm run check passed against merged main: 1,011 tests passed and one existing test was skipped; strict types, lint, planning/link/secret checks and offline pin integrity passed. npm run compatibility:drift passed against the current official fixed-host schema.
- The explicit refresh confirmed all prior selected structures unchanged after removing the new field. The canonical source hash is unchanged from version 6; the new projection hash reflects only logit_bias selection. PRs #217/#219 have green CI and remain approval-pending.
