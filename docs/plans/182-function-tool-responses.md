# Function Tool Call Responses

## Issue and problem

- Issue: [#182](https://github.com/Theorvane/OpenGranter/issues/182).
- Direct OpenAI and delegated OpenRouter discard all upstream function-call responses as safe failures. Clients need the assistant invocation before they can continue the tool lifecycle.

## Scope and expected behavior

- Accept a non-streaming assistant response with one or more valid function `tool_calls`, string/null content and `finish_reason: "tool_calls"`. Preserve call IDs, function names and serialized argument strings exactly through both client bases and the installed OpenAI SDK.
- Reject malformed/mismatched calls, duplicate IDs, non-null legacy `function_call`, contradictory refusal and tool outcomes. Ordinary no-invocation text/refusal/filter outcomes remain unchanged.
- Existing IAM, limit and required audit gates stay ahead of upstream transport. Metadata audit/errors exclude tool names, arguments and response content. Invalid upstream responses retain possibly-billed failure accounting.
- Tool-result history, streaming, OpenRouter server tools and native Anthropic/Gemini tool mapping are outside this issue. Request controls were implemented separately in #180. Full external-tool compatibility stays open under #116.

## Design

- Extend the shared assistant normalizer with a narrow function-call response validator and explicit tool completion variant. Keep provider adapters responsible for post-response failure categories and billing uncertainty.
- Require `tool_calls` and `finish_reason` to agree; preserve serial arguments as strings without parsing or executing. Do not treat upstream metadata as authenticated authority.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility matrix](../openrouter-compatibility.md) and [contract](../../contracts/function-tool-responses.md). Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), raw snapshot retrieved 2026-09-29.
- This branch started from main before PR #181 merged, then integrated its approved merge commit and reconciled the combined request/response compatibility matrix.

## TDD plan

- First add HTTP/SDK/native response cases that fail with current safe 502 on valid `tool_calls`.
- Cover exact call data, null/string content, multiple calls, malformed/duplicate/mismatched calls, legacy fields, safe failure accounting and IAM/limit/audit denial.
- Implement the smallest shared normalization change; update the prior unsupported-output tests to retain their malformed/mismatched guard; run focused tests and `npm run check`.

## Delivery

- Ready issue-scoped PR with plan, red/green evidence and full-check results.
- Roll back response normalization and contract together if necessary; no stored-data migration or change to provider credentials.

## Verification evidence

- Red: four expected HTTP/SDK cases failed with safe 502 on valid function-call responses before implementation; four existing invalid/denial cases already passed.
- Green: 16 focused response/guard tests pass across both paths and SDK bases, including the merged #180 request controls and exact call-response round trip.
- Integrated `npm run check` passes: 894 tests pass and one optional external PostgreSQL test skips. Type checking, lint, planning validation and pinned OpenRouter schema integrity pass.
