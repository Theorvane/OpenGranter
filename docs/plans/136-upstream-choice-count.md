# Upstream single-choice response validation

## Issue and problem

- Issue: [#136](https://github.com/Theorvane/OpenGranter/issues/136), compatibility parent #116.
- OpenAI/OpenRouter/Gemini normalizers project the first upstream result and silently discard additional choices/candidates. Direct OpenAI also ignores choice indices.

## Scope and expected behavior

- Require exactly one native choice/candidate for these three adapters. OpenAI/OpenRouter require index 0; optional Gemini index must be 0 when present.
- Reject extra/sparse/empty/malformed collections using existing safe post-response failures. No truncation, raw upstream response/error disclosure or replay is introduced.
- Preserve single-choice successes, omission of optional Gemini index, and Anthropic one-message responses containing multiple text blocks.
- Preserve authentication, IAM, limits, required audit and failed-attempt usage with possible billing. Out of scope: multi-choice support, n-field acceptance (pending PR #135), full response schemas, streaming and tools.

## Design

- Validate native collection length before projection and validate the enforceable choice index at the boundary. Existing adapter failure wrappers retain responseStarted/possiblyBilled metadata.
- Do not reject Anthropic multiple content blocks: they represent one message rather than multiple alternatives.
- Update [contract](../../contracts/upstream-single-choice.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility](../openrouter-compatibility.md).
- No new route/retry or billing policy. This enforces the existing one-choice response contract, not new multichoice semantics.

## TDD plan

- Actual adapter regressions use fake native response collections: valid singleton, multiple alternatives, extra null/malformed elements, empty/nonarray collections, wrong indices and sparse internal arrays.
- HTTP managed/delegated paths verify rejected post-response calls return safe errors, failed-attempt audit and possibly-billed usage, and do not leak content. Denied IAM/limits/required audit still prevent transport.
- Preserve valid Anthropic multi-block output and optional Gemini index. Record red, implement minimal boundary checks, then warning-free focused Biome and npm run check.

## Delivery

- No migration or live provider requests. A misbehaving upstream now produces safe failure instead of a truncated success; full multichoice support remains open.
- Record regression/full-check evidence and billing uncertainty in the PR.

## Verification evidence

- Red: `node --experimental-strip-types test/upstream-single-choice.test.ts` reproduced four failures and five passes against the prior implementation.
- Green: the same nine adapter/HTTP cases all pass after validation. Focused Biome with `--error-on-warnings` passed for both adapters and the new test.
- Six existing native OpenAI fixture files now supply required index 0; registration, timeout, usage and PostgreSQL boundary expectations are unchanged.
- `npm run check` passed: strict type checking, lint, 621 passing tests, one optional external PostgreSQL case skipped, and planning/link/contract/fixture checks. No live provider requests or credentials were used.
