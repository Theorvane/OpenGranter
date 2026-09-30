# Function Tool Result History

## Issue and problem

- Issue: [#184](https://github.com/Theorvane/OpenGranter/issues/184).
- OpenRouter-compatible clients cannot continue an assistant function call because the request boundary rejects assistant call history and `tool` result messages.

## Scope and expected behavior

- Accept complete non-streaming assistant function-call groups followed by matching tool result messages. Preserve exact IDs, names and serialized arguments to direct OpenAI and delegated OpenRouter.
- Normalize text-part arrays to strings on tool-result content; assistant call content may be string or null. Reject malformed, duplicate, orphan, unresolved and out-of-order call/result histories before routing or native credential access.
- Direct Anthropic/Gemini reject valid tool history before credentials until native mapping is designed. IAM, limits, audit, usage and final-provider scopes remain unchanged; tool payloads never enter metadata audit or errors.
- Streaming, server tools, native Anthropic/Gemini mapping, rich content and full external-client conformance remain open under #116.

## Design

- Extend the shared chat-message snapshot validator with exact assistant function-call and tool-result variants. Maintain pending IDs while reading history; no later conversation message may skip unresolved results. Return immutable copies before asynchronous route lookup.
- Extend external text-part normalization for tool-result content while preserving exact-key validation. Keep existing text roles and early instruction ordering.
- OpenAI/OpenRouter forward captured history. Native Anthropic/Gemini reject history before credential lookup. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility matrix](../openrouter-compatibility.md), and [contract](../../contracts/function-tool-history.md).
- This branch started from main while #182/PR #183 awaited review, then integrated its approved merge commit and reconciled the combined tool lifecycle documentation.

## TDD plan

- First add public HTTP/SDK/native cases reproducing current 400 and missing native history support.
- Cover complete multi-call groups, text-part tool results, malformed/orphan/duplicate/unresolved histories, direct unsupported-provider denial, mutation during secret awaits, IAM/limit/audit denial and safe failed-attempt accounting.
- Implement smallest shared snapshot/normalization and adapter guard; run focused red/green and `npm run check`.

## Delivery

- Ready issue-scoped PR with linked plan, red/green evidence, validation and remaining risks.
- Roll back message variants and adapter gating together; no stored-data migration.

## Verification evidence

- Red: seven initial HTTP/SDK/native/security cases failed because valid history returned 400 or native direct calls rejected it; malformed-history cases already passed. A later empty-list case also failed with HTTP 400 before the focused fix.
- Green: 14 focused cases pass, including both prefixes, native snapshot timing, installed SDK two-request function lifecycle, unsupported native providers, denial and safe failure accounting.
- Integrated `npm run check` passes: 908 tests pass and one optional external PostgreSQL test skips. Type checking, lint, planning validation and pinned OpenRouter schema integrity pass.
