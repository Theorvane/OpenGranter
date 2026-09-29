# Instruction and Assistant Text Parts

## Issue and problem

- Issue: [#148](https://github.com/Theorvane/OpenGranter/issues/148).
- External SDK clients can send system/developer instruction or assistant-history text arrays declared by the official OpenRouter schema. The current user-only normalizer rejects them.

## Scope and expected behavior

- Extend exact text-only array decoding to all four supported roles, preserving literal concatenation, whitespace, Unicode and empty segments.
- Keep the existing leading system/developer prefix, strict role/message/part validation, immutable capture and provider-specific instruction mapping.
- Native typed adapters still accept string messages. Multimodal/refusal/tool arrays, cache boundaries, streaming and separate native developer priority remain out of scope.
- IAM, limits, required audit and usage remain shared; content and credentials stay out of metadata and errors.

## Design

- Reuse the existing HTTP part normalizer and final shared message validator; remove only the user-specific array restriction. The protocol validator continues to reject unsupported roles and late instructions after normalization.
- Concatenate exact text arrays rather than introducing native block contracts. This retains current portable mapping and its explicit loss of block/cache boundaries.
- Source: [official OpenRouter schema](https://openrouter.ai/openapi.json), ChatSystemMessage, ChatDeveloperMessage and ChatAssistantMessage, inspected 2026-09-29.
- No new product decisions. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-user-text-parts.md).

## TDD plan

- First add HTTP and actual SDK cases with leading instruction and assistant arrays through both paths and four adapters; expect 400 before implementation.
- Cover string parity, secret-await mutation capture, malformed/mixed/unknown fields and roles, late instruction arrays, default/explicit Deny, limits, required audit and transport failure accounting.
- Change only array decoding and update the superseded non-user rejection assertions. Run focused suite, touched-file lint and npm run check.

## Delivery

- Record red, implement minimal decoding change, record green, update documents, run full checks, publish ready PR.
- Risk: concatenation loses native part boundaries; no multimodal/cache semantics are claimed. Rollback restores prior rejection.
- PR includes test evidence and remaining compatibility gaps.

### Verification results

- Red: `node --experimental-strip-types test/user-text-parts.test.ts`: 10 expected failures, 12 passes; new instruction/history HTTP, SDK and capture/gate cases rejected with 400.
- Green: same command: 22 passes.
- `npm run check`: 706 passes, 1 optional external PostgreSQL integration skipped, 0 failures. Typecheck, lint, document/link/contract/fixture checks and pinned schema integrity passed.
- Touched-file Biome with warnings as errors and whitespace checks passed. One formatting gate failure was fixed before the successful complete run.
