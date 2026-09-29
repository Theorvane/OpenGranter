# Supported Request Schema Drift Coverage

## Issue and problem

- Issue: [#158](https://github.com/Theorvane/OpenGranter/issues/158).
- Current eight-field projection misses response-format/penalty changes and referenced supported format definitions.

## Scope and expected behavior

- Include response_format, frequency_penalty and presence_penalty plus exact text/json_object format definitions in a version-2 structural pin.
- Preserve provenance/integrity, canonical ordering, annotation removal and existing credential-free bounded fixed-host fetching. No auto-update and no inference calls.
- Reject missing/malformed selected fields or definitions; report safe fixed errors. Detect meaningful referenced-format drift even when request references are unchanged.
- Other referenced definitions, strict schema/grammar/python formats, instance validation, response/tool/stream conformance and complete compatibility remain out of scope. No IAM, secrets, audit or runtime request behavior changes.

## Design

- Extend explicit allowlists rather than traversing the full graph: bounded two-definition coverage is reviewable and avoids implying full reference validation.
- Add a definitions map to the structural projection with exact shape validation; increment pin version to reject stale eight-field pins.
- Refresh raw-source SHA and canonical projection SHA from [official source](https://openrouter.ai/openapi.json), checked 2026-09-29. No third-party schema is used.
- Update [contract](../../contracts/openrouter-schema-drift.md), [compatibility](../openrouter-compatibility.md) and [acceptance](../acceptance.md). Runtime format/penalty mappings retain their existing limitations.

## TDD plan

- Add source-field and selected-definition drift tests first: current projection ignores these changes.
- Test missing/malformed definitions, nullable penalty structure, discriminator/reference changes, annotation-only/unrelated changes and rehashed malformed pin shapes.
- Minimal allowlist/map validation implementation, reviewed pin refresh, focused green, full `npm run check`, and explicit live drift comparison.

## Delivery

- Ready issue-scoped PR with red/green evidence and full gates.
- Pin and projector must change together. Revert both for rollback; source outages fail safely without rewriting the pin.
- Remaining model/message references and unsupported format definitions are explicit detection gaps.

## Verification evidence

- Red: `node --experimental-strip-types --test test/openrouter-schema-drift.test.ts` reports 8 failures and 11 passes before projector changes; selected field/definition drift was ignored and the pin was still version 1.
- Green: 21 focused tests pass after the minimal projection, exact definition-map validation and version-2 pin refresh.
- Explicit live gate: `npm run compatibility:drift` passes against the official source without rewriting the pin.
- Full `npm run check`: 748 tests pass and 1 optional PostgreSQL integration test is skipped locally; typecheck, lint, planning/link/contract/fixture-secret checks and offline schema integrity pass.
- Touched-file lint with warnings treated as errors and `git diff --check` pass.
- Based on main with merged PR #155. Separate runtime penalty PR #157 is still awaiting approval; its implementation and combined tests are not part of this branch. Comparing its official declared fields does not add runtime capability guarantees.
