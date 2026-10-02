# Preserve delegated streaming reasoning deltas

## Issue and problem

- Issue: [#238](https://github.com/Theorvane/OpenGranter/issues/238), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- The decoder rejects reasoning despite its optional string/null definition already selected in the official ChatStreamDelta pin. Valid provider reasoning streams fail at the HTTP boundary.

## Scope and expected behavior

- Preserve exact optional string/null reasoning on delegated deltas, including omission, empty, Unicode/newlines, reasoning-only and content/refusal coexistence. Keep one validated frame per callback and no aggregation.
- Validate malformed first/later values using existing safe JSON/SSE failures and conservative billing. Usage-only events allow omission/null/empty but reject substantive reasoning rather than silently discard it; final usage never replays earlier reasoning.
- Existing authentication, model/provider IAM, limits, cancellation/backpressure, required usage/outcome audit and no replay remain shared. Reasoning is provider response content and stays outside operational metadata/errors.
- Exclude request reasoning controls, reasoning_details/encrypted blocks, non-streaming/native/tool/rich mappings, new content-audit policy and full conformance claims.

## Design

- Add one optional scalar to normalized deltas, decoder allowlist/type/usage validation and independent encoder projection. Sequence state and complete outcomes remain transcript-free; no accounting schema change.
- [Official OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02, defines optional string/null reasoning. A read-only fact audit confirms SDK 1.4.18 preserves delta.reasoning. Existing pin selects this structure; no pin refresh is needed.
- Follow the established refusal-content projection contract without widening destination scope or interpreting reasoning as authority. No new glossary terms or ADR. Independent from pending PRs.

## TDD plan

- Add decoder/encoder and native public HTTP regressions first; expect Invalid OpenRouter stream chunk / HTTP 502 before implementation.
- Verify exact nullable/omitted/empty/Unicode values, content/refusal coexistence, independent encoder failures, usage-only rejection, malformed first/later responses, complete/missing usage, required persistence failure and authentication/IAM/limits.
- Test the official SDK on actual sockets on both bases. Make the smallest decoder/encoder change, format and run npm run check.

## Delivery

- Issue/plan before code, new branch/PR with red/green and full validation evidence. Update PRD, architecture, acceptance, compatibility and relevant stream contracts.
- Risk: reasoning is sensitive response content. Do not put it in usage/audit metadata, error messages or completed sequence summaries. Raw SDK debug objects remain caller-owned. Other reasoning schemas and full external-client workflows remain open.

## Validation evidence

- Red before implementation: decoder/encoder regression raised Invalid OpenRouter stream chunk; native HTTP regression returned 502 instead of 200. Green: nine reasoning-focused regressions cover projection/type/framing, both HTTP bases, actual official SDK with complete/missing usage, malformed first/later values, usage-only substantive rejection and denial/persistence boundaries.
- npm run check passed with 1,056 tests passing and one existing skip, strict types, lint, planning/link/contract checks and offline pin integrity. This independent branch starts from merged main and excludes pending discovery, SDK tool and finish-reason pin changes.
- No schema pin, completed sequence summary or accounting schema changed. git diff --check passed; final documentation checks pass separately.

## Review correction: encoder usage-only reasoning

The independent public SSE encoder ignored injected substantive/malformed reasoning on usage events, including incomplete token counters, although the decoder rejects that content. Reproduce through the exported encoder with complete/missing usage, retain allowed absent/null/empty markers, then reject invalid content before the missing-usage early return. Capture delta reasoning once so validation and projection use the same value. Preserve actual usage metadata, accounting, fixed errors and no transcript replay.
