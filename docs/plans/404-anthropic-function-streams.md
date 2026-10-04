# Managed Anthropic client function streams

## Issue and problem

Issue: #404. Anthropic nonstream custom functions and text streams work, but the generated managed function-stream port is OpenAI-only. Compatible clients cannot stream native calls and complete their result continuation.

## Scope and expected behavior

Translate native text/tool_use blocks and input_json_delta into compatible indexed function deltas. Support both HTTP bases and installed SDK round trips, and generated persisted direct/dual handlers. Preserve registered fixed hosts, pre-secret captured definitions/choices/history, complete model/final-provider IAM, limits, safe usage/audit, cancellation and no inference replay. Never execute calls in the gateway. Thinking/signatures, server/rich/custom tools, model snapshot equivalence and Gemini functions remain open.

## Design

Reuse the existing bounded function sequence for dense tool indices, immutable identities, retained argument size, terminal consistency and private assembly disposal. Native block indices remain sequential independently of dense tool indices. Require empty initial tool input, parse accumulated partial JSON into a bounded object at block_stop; no deltas on an empty tool produce {}. Native cumulative usage maps once at message_stop. Require exact initial model identity, no native fallback, stable ID and generated timestamp. Text/length/filter streams remain supported when tools are declared but unused. Native tool_use terminals require calls and other terminals cannot contain calls. Explicit native function mode leaves existing text and OpenAI-only adapters restricted. Captured registration-kind dispatcher activates Anthropic only in generic persisted wiring.

Sources: https://platform.claude.com/docs/en/build-with-claude/streaming and the official TypeScript SDK. Existing shared function sequence, native text response and nonstream mapping contracts supply bounds and security behavior. No new glossary term or costly ADR decision is required. #116 and unresolved #7 remain open. Update PRD, architecture, acceptance and compatibility with the subset and tests.

## TDD plan

First exercise Anthropic through the existing public function port, expecting complete streamed calls and continuation: red must show pre-secret OpenAI-only rejection. Write native decoder cases before implementation for sequential text/two tools, split JSON, empty object, malformed JSON/types/IDs/indices, terminal/usage ordering, bounds, delivery failure and abort. Implement native consumer, invoker and generic dispatcher, then generated handler wiring. Cover both SDK bases, IAM/limit failures, required usage/audit failure, partial errors, missing usage, cancellation and persisted direct/dual provider Deny.

## Delivery

Run focused cases, npm run format and full npm run check. Record actual red/green and remaining limitations in the PR. Exact-head sjungwon03-ai review and both CI checks precede sjungwon03 squash merge. Fixture checks do not certify live providers or complete external-client compatibility.

## Verification evidence

Managed Anthropic client functions now stream on both compatible bases and through generated persisted direct/dual handlers. Native Messages text/tool_use blocks become dense indexed compatible calls, and input_json_delta fragments preserve their argument spelling while a bounded object validation at block stop rejects malformed/incomplete inputs. The shared sequence bounds retained private assembly and terminal consistency. Complete native message_stop produces cumulative final usage; required accounting/audit continue gating client usage/DONE. Tools execute only in the external client.

TDD: before implementation, 20 of 25 installed SDK public-boundary cases failed against the existing OpenAI-only native function port. The new consumer, explicit native transport mode, invoker and captured registration dispatcher passed 79 initial native/SDK/invoker/persisted cases. Added size/block/UTF-8/status and registration-snapshot cases expand this to 89 new cases. Final focused set including existing OpenAI function/text guards and Anthropic nonstream conformance: 168 passing. SDK cancellation tests drain bounded buffered chunks before expecting the SDK abort error, and do not count their own assertions as cancellation.

Coverage includes both installed OpenAI/OpenRouter SDKs on both bases with two Unicode calls and correlated result continuation; fresh model/provider Deny, authentication, limits, selection and required usage/audit failures; safe pre-frame/midstream errors, unknown usage and cancellation; persisted direct/dual generated ports replacing runtime overrides, capped output, grouped histories, usage failure and fresh provider Deny; invalid native JSON/type/identity/index/terminal, no-delta empty tools, cumulative counters, shared retained-size/object/node bounds and callback failure. Private arguments/results/keys stay outside operational audit and usage records. Existing text modes remain tool-free and the named OpenAI function adapter stays restricted.

Limitations: native text/tool indices are sequential, with at most 128 total blocks and a shared 1,048,576-string-unit retained-call bound. No-delta empty tools retain the official SDK placeholder {}; only-empty deltas and malformed objects fail safely. Tool-bearing max_tokens may be provider-valid but cannot satisfy this complete-call subset, so it fails possibly billed without terminal success. Thinking/signatures, server/rich tools, fine-grained settings, Gemini functions, model snapshot equivalence and broader external apps remain open. Fixture tests do not certify live providers. Full #116, unresolved #7 and pinned OpenRouter v19 remain unchanged.


Full npm run check passes strict types, lint, 2195 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
