# Managed Anthropic nonstream client functions

## Issue and problem

Issue: #402. Registered Anthropic routes currently reject portable function controls and complete tool histories before credentials and reject native tool_use responses. Compatible clients cannot complete a function round trip.

## Scope and expected behavior

Support nonstream custom function definitions, none/auto/required/named choices, parallel controls, mixed text/tool responses and correlated result histories on both compatible bases. Never execute tools. Keep native function streaming, thinking, server tools and model capability discovery open. Preserve complete IAM and limits, fixed hosts, immutable pre-secret requests, safe failure, aggregate usage and required audit.

## Design

Map bounded portable object schemas to required input_schema; omitted parameters default to an unconstrained object schema. Reject supplied schemas whose type is not object before keys. Omit strict:null and preserve booleans. Map required to any and named to tool. Parallel controls are inverted inside tool_choice, creating auto when otherwise omitted; none has no parallel field because it forbids all calls. Validate native names against the documented identifier grammar, retaining the portable definition limit of 64. Parse history arguments as bounded JSON objects before secrets and group adjacent tool results into one user message. Normalize native tool_use input objects to JSON argument strings, preserving IDs and names. Reject malformed, duplicate, rich or unsupported response blocks and mismatched terminal reasons with safe possibly-billed accounting. Do not claim argument whitespace preservation or locally enforce provider JSON Schema/model capability semantics.

Sources: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools , https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use , https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts . Existing snapshot and assistant validators define bounds. No costly domain decision or ADR is needed. #116 and #7 remain open. Update [compatibility](../openrouter-compatibility.md), PRD, architecture, acceptance and the issue contract.

## TDD plan

First add boundary tests expecting native declarations, grouped history and normalized calls: they must fail against the existing pre-key guards and text-only decoder. Cover malformed object inputs, names and schemas before keys; malformed/duplicate calls and terminal mismatches after fetch; request mutation during key lookup; both HTTP bases, SDK round trips and IAM/limits/accounting/audit failures. Keep explicit text-stream and OpenAI-only stream guards closed. Run focused tests, npm run format and npm run check.

## Delivery

Issue and plan precede production edits. Report observed red/green evidence and full checks. sjungwon03-ai reviews the exact head; both CI checks and approval precede sjungwon03 squash merge. Rollback removes this adapter subset. No live Anthropic certification is claimed.

The installed OpenRouter SDK exposed a second red regression: /v1 Anthropic responses omitted its required system_fingerprint. Normalize Anthropic nonstream tool and text continuation responses with null, conveying an unavailable fingerprint without inventing a value. Both SDK bases must pass before delivery.

## Verification evidence

Managed Anthropic nonstream clients can declare custom functions, choose none/auto/required/named calls, control parallel generation, receive mixed text/tool_use responses and continue with complete correlated results. Native requests preserve bounded object schemas/arguments and group adjacent results into one user turn. No tool is executed in the gateway. Native text-stream and OpenAI-only function-stream guards remain closed to Anthropic functions.

TDD: before production edits, 31 of 47 new boundary cases failed as expected against pre-key rejection/text-only decoding. Native mapping then passed 102 focused new/existing declaration, history, stop-reason and stream-guard regressions. Expanded actual SDK conformance exposed a separate /v1 OpenRouter response-schema failure: Anthropic omitted the required system_fingerprint. Anthropic nonstream tool/text responses now supply null rather than an invented fingerprint; final checks cover both installed SDKs on both bases.

Fifty-four new cases cover controls/defaults, mixed and parallel calls, result grouping, immutable pre-secret capture, invalid native schemas/names/JSON before keys, malformed rich/duplicate/mismatched responses with safe billed failure, IAM/limits/required persistence gates, missing/partial/invalid usage, SDK round trips and fresh provider Deny, and persisted direct/dual generated handlers with capped output, usage failures and sanitized reads. Existing portable tests now assert Anthropic native mappings, preserving Google rejection.

Risks and limits: input schemas/model capabilities remain provider-owned; unsupported supplied non-object schemas fail before keys. Nullable strict is omitted, omitted parameters use an unconstrained object schema, and none suppresses the unnecessary native parallel field. Argument whitespace cannot survive object normalization. Native function streaming, thinking/signatures, server/rich tools, Gemini functions and broader named-client conformance remain open. Fixture tests are not live-provider certification. Full #116 remains open; unresolved #7 and pinned schema v19 remain unchanged.


Full npm run check passes strict types, lint, 2106 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
