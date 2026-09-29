# Referenced Message Name Schema Drift

## Issue and problem

- Issue: [#168](https://github.com/Theorvane/OpenGranter/issues/168).
- The official request projection does not inspect message definitions. Supported optional names can drift without a changed ChatMessages reference.

## Scope and expected behavior

- Track the name property schema and name-required status for exactly ChatSystemMessage, ChatDeveloperMessage, ChatUserMessage and ChatAssistantMessage. Keep thirteen request fields and two format definitions.
- Fail safely on missing/malformed selected names, message containers, required lists and rehashed maps. Strip only annotations; preserve literal constraints.
- Explicit version-3 pin/projector upgrade; reject older pins. No runtime API, IAM, credentials, usage or audit change. This does not validate complete message instances or other referenced fields.

## Design

- Add a bounded messageNames projection with exact selected definition keys and exact schema/required entry keys. Read optional required arrays as empty; reject malformed/duplicate required entries. Capture only whether name is required, rather than unrelated content-required changes.
- Pin from the official raw snapshot retrieved 2026-09-29 with source SHA-256; compare the fixed official live endpoint before delivery. Source: https://openrouter.ai/openapi.json.
- Whole-definition traversal would imply broad unsupported schema coverage and unnecessarily include unrelated fields; keep the selection explicit.
- Update [compatibility](../openrouter-compatibility.md), [acceptance](../acceptance.md), [architecture](../architecture.md), [PRD](../PRD.md) and [contract](../../contracts/openrouter-schema-drift.md). Tool/multimodal/stream/full instance validation remains unresolved.

## TDD plan

- Add source fixtures and behavior tests before implementation: constraint/required drift currently compares equal; missing names currently project without error.
- Cover all four definitions, nullable/type/bounds changes, malformed required lists, stale/missing/extra/malformed rehashed maps, and annotation/unrelated/literal constraints.
- Implement the smallest projector validation/version upgrade and refresh the reviewed pin. Run focused tests, full npm run check and fixed-host live comparison.

## Delivery

- Ready issue-scoped PR with red/green, plan, source evidence and remaining gaps.
- Rollback projector and pin together; no persisted-data migration. Changes outside the selected projection remain intentionally undetected.

## Verification evidence

- Red: 11 expected failures and 26 passes before implementation; the previous projection ignored name constraints/required status and malformed message definitions.
- Green: all 37 focused drift tests pass. The test-only copied-array sort matches the configured TypeScript library without changing compiler settings.
- Final npm run check passes: 822 tests pass, one optional external PostgreSQL test skips. Type checking, lint, planning validation and offline pin integrity pass; local PGlite tests run.
- Fixed-host credential-free npm run compatibility:drift passes against the official live schema. Git diff whitespace checks pass.
