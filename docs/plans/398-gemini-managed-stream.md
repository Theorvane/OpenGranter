# Managed Gemini public text streaming

## Issue and problem

Issue: #398. Managed OpenAI text/functions and Anthropic text are public. Google registrations currently fail managed streaming before credentials. Full external-client compatibility remains gated by #116.

## Scope and expected behavior

Add bounded native Gemini text SSE validation, an explicit registered Google streaming transport and generated managed text dispatch through both API bases and persisted direct/dual composition. Preserve exact approved version scope, stable response identity, native output caps, authentication, model/provider Deny, limits, required usage/audit and cancellable backpressure.

Out of scope: native functions/thought/signature/rich content, grounding/server tools, advanced block/finish categories, model snapshot equivalence, category accounting, named-client/live certification and unresolved architecture #7. No new domain term or costly ADR decision is required.

## Design

Use the fixed registered models endpoint with :streamGenerateContent?alt=sse and the existing request snapshot, headers and configuration. The first event must carry a bounded responseId and exact approved modelVersion; later omissions retain that identity and supplied values must match. Create one gateway timestamp because native output omits created. Validate one index-zero candidate with plain text parts, STOP/MAX_TOKENS and bounded prompt/candidate SAFETY mapping. Require a native terminal and clean fully framed EOF; partial/error/trailing events fail safely. Allow one post-terminal usage-only event with no content. Use only final request-level aggregate counters, never add snapshots or derive a missing Google total from prompt plus candidates because total may include hidden thoughts.

Official references: https://ai.google.dev/api/generate-content and https://github.com/googleapis/js-genai/blob/main/src/_api_client.ts . Preserve the shared order authenticate, approved scope, model/provider policy, limits, secret, native inference, required per-attempt usage/outcome audit, successful final usage/DONE. No retries after response output.

Affected documents: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/gemini-managed-stream.md).

## TDD plan

First add response tests and record missing-module red, then implement the smallest bounded consumer. Add a trailing partial-frame regression that fails with the permissive shared EOF parser, then add an opt-in strict EOF mode and retain other parser behavior. Add native invoker tests and record missing-module red before adding explicit Google mode/adapter. Add SDK/gateway and stored direct/dual tests: the Google dispatcher must fail with 502 before activation. Finally connect captured dispatch and retain all existing native text/function tests.

Verify successful text/safety/length, denied model/unsupported content/input, malformed/HTTP/EOF failure, cumulative missing/invalid usage, callback backpressure, pre-abort, hanging body, actual SDK disconnect, required persistence failure and newly stored provider Deny on both bases. Run npm run format, focused tests and full npm run check.

## Delivery

Issue/plan precede code. Record all red/green stages and full checks in the PR. Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge. Full #116 and unresolved #7 remain open.

## Verification evidence

Activate bounded managed Gemini text streaming end to end. The explicit Google mode uses the fixed registered :streamGenerateContent?alt=sse endpoint and key header with unchanged captured request/configuration. Native responses require exact initial modelVersion and stable responseId, map text and supported STOP/MAX_TOKENS/SAFETY outcomes, and finish only after a native terminal plus clean fully framed EOF. Final request-level Google totals remain reported-only; snapshots are never summed and missing totals are not derived from prompt/candidate counts because hidden thinking may contribute.

TDD evidence: response and invoker tests initially fail with their missing modules. A terminal-followed-by-partial-SSE regression then fails with Missing expected rejection against permissive EOF; opt-in strict parsing fixes it without changing other consumers. Before public dispatch, gateway/SDK/persisted tests have 12 expected failures and 9 passing denial cases (502 instead of success); after dispatch all 77 Google/Anthropic/OpenAI gateway and persisted regression cases pass. Native response/framing regression set passes 116 cases and native invoker/provider regression set passes 122. Actual OpenAI/OpenRouter SDKs consume streams on both bases; stored direct/dual registration, ignored overrides, fresh provider Deny, required usage/audit failure, partial error, SDK abort and partial ledger accounting are covered.

Limits: exact model-version aliases require explicit matching registration; native functions, thoughts/signatures, grounding/server tools, richer finish/block categories, category usage, named applications and live provider certification remain open. Full #116 is not complete. Review also identified the pre-existing Google nonstream missing-total derivation; follow-up issue #399 records that separate accounting correction.


Full npm run check passes strict types, lint, 2040 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
