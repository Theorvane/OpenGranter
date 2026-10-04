# Bounded managed Gemini function streams

## Issue and problem

Issue: #408. Native streamGenerateContent currently rejects custom functions through the generated direct/dual function dispatcher, so clients cannot complete streamed function/result round trips.

## Scope and expected behavior

Support signature-free complete custom functionCall objects and text deltas in native SSE on both compatible bases. Preserve exact registered model/response identity, stable gateway timestamps, fixed hosts, administrator caps, immutable pre-secret controls/history, model/final-provider IAM and Deny, limits, required usage/audit, cancellation and no replay. Tools execute only in external clients. Partial argument streaming, thinking/signature replay, rich/built-in tools, model capability equivalence and full #116 remain open.

## Design

Use an explicit google-function transport mode and dispatch from captured administrator registrations. Reuse existing nonstream declarations/history preparation, unsupported strict/parallel/effort rejection and thinkingBudget:0. Native GenerateContent FunctionCall args is a complete optional Struct; emit each complete call once with a dense compatible index and serialized bounded object args. Preserve native IDs and reuse reserved missing-ID correlation/replay semantics. Never merge repeated native call objects as undocumented argument fragments; duplicate IDs fail safely. At most 128 calls across the stream and bounded private retained assembly; unknown partialArgs/willContinue/signature fields fail safely.

Validate singleton candidate, model role, supported part fields and initial exact modelVersion/responseId; later omissions retain identity and conflicting values fail. Native STOP after calls maps to tool_calls; calls with MAX_TOKENS/SAFETY fail safely. Text-only STOP/MAX_TOKENS/SAFETY preserve existing terminal mappings. Require terminal then clean framed EOF, optionally one metadata-only usage tail; native [DONE], trailing data, missing terminal or reader failure cannot produce success. Usage uses final reported Google counters only, never an inferred total or earlier-counter carry-forward. Normalize through the shared bounded function sequence and discard private assembly on failure. Await callbacks and abort native readers.

Official sources: https://ai.google.dev/api/generate-content and https://raw.githubusercontent.com/googleapis/googleapis/master/google/ai/generativelanguage/v1beta/content.proto . Current Interactions delta examples and Vertex AI partial-argument options are distinct APIs and are not this contract. ThinkingBudget:0 does not guarantee every model is signature-free; retain the prior documented model/signature gaps. No new domain term or costly irreversible decision; #7 remains unresolved. Update PRD, architecture, acceptance, compatibility and a dedicated stream contract.

## TDD plan

Write native consumer, registered invoker, HTTP/SDK socket and persisted direct/dual cases before production changes. Expect missing consumer/invoker and current pre-key dispatcher rejection. Verify whole calls in separate/parallel events, mixed Unicode text, missing IDs and complete result replay, exact identity/caps/pre-secret snapshots, dense indices/bounds, duplicates and malformed objects, signatures/partial fields, terminal/usage/EOF order, HTTP errors, callback backpressure, abort/deadline, success/Deny/limit/audit/usage failures and operational privacy. Existing Google text-only modes remain closed to tools. Run npm run format and full npm run check.

## Delivery

Issue and plan precede code. Report observed red/green, full checks and bounded risks. Fixture conformance is not live-provider certification. Require sjungwon03-ai exact-head approval and both CI check jobs, then sjungwon03 squash merge and clean main synchronization. Full #116 stays open.

## Verification evidence

Managed Gemini streamGenerateContent previously rejected function requests in the registered dispatcher. This change adds an explicit native function mode, a bounded complete-function SSE consumer and generated persisted direct/dual support on both compatible bases. Whole calls preserve native IDs or use the existing reserved missing-ID convention; dense client indices, original part order, exact model/response identity, reported-only final Google counters and clean framed EOF are enforced.

The native consumer validates event structure, bounded object arguments, duplicate IDs and supported fields before delivering event content. It rejects unsupported signatures/partial fields and tool-bearing truncation/safety; the shared bounded sequence discards private call assembly on failure. Fixed hosts, pre-secret snapshots, administrator caps, IAM/Deny, limits, required aggregate audit/accounting, awaited delivery and cancellation remain enforced. Google text-only modes remain tool-free, and client tools never execute in the gateway.

TDD: before production changes, the new boundary/SDK/persisted suite reported 24 expected failures (missing consumer/invoker modules and the existing pre-key dispatcher rejection), with five existing security/capability gates already passing. After implementation, final focused checks pass 241 tests. Added 114 cases cover complete parallel/separate Unicode calls, missing IDs and result replay through both installed SDKs on both bases, exact count/assembly bounds, malformed/duplicate/signature/partial output, identity and terminal/EOF ordering, final reported usage, callback backpressure, abort/deadline, fresh Deny and persistence failure, and generated stored direct/dual wiring. The existing dispatcher rejection case now exercises Google's unsupported strict:true boundary.

Remaining risks: this accepts signature-free complete GenerateContent objects and a bounded terminal/optional-usage-tail/clean-EOF ordering, not arbitrary Google stream variants. Models unable to disable thinking may fail natively. Thinking/signature replay, partial argument streaming, built-in/rich tools, strict/single-call equivalence and broader named clients remain open. Fixture conformance is not live-provider certification; full #116 and unresolved #7 stay open, with pin v19 unchanged.


Full npm run check passes strict types, lint, 2370 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
