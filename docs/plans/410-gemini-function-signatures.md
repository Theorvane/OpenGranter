# Managed Gemini nonstream function thought signatures

## Issue and problem

Issue: #410. Managed native Gemini function responses reject Part.thoughtSignature, making signed tool-result continuation unusable. Official Google OpenAI-compatible clients attach signatures to tool_calls[].extra_content.google.thought_signature. Installed OpenAI 7.23.0 preserves this at runtime; installed OpenRouter 1.4.18 strips the extension. OpenRouter reasoning detail IDs/indices do not establish native tool association, so no invented encrypted-detail bridge is justified.

## Scope and expected behavior

Support exact bounded opaque signatures on complete nonstream Gemini function calls and complete correlated replay history on both bases, including missing native IDs, parallel calls and sequential signed steps. Preserve original function-part association, values, argument objects and result ordering. Raw HTTP and installed OpenAI SDK can round-trip the documented extension. Measure and disclose OpenRouter SDK stripping; full #116 remains open.

Keep signed text, thought text, signed native streams and native stream histories closed to this extension. Keep other native and delegated paths closed before credentials rather than drop unsupported signature content. No new request thinking defaults, model capability catalog or reasoning effort semantics. Existing thinkingBudget:0 and explicit-effort conflict remain; models unable to disable thinking may fail natively. No signature verification/decryption, dummy signature, execution, provider authority or charged-cost inference.

## Design

Add a narrow protocol snapshot for extra_content with exactly google:{thought_signature:nonempty-string}. Preserve the opaque native base64 representation without decoding/re-encoding or treating it as proof of authenticity. Reject null/empty/nonstring/unknown shapes; bound signatures to one MiB of string units per value and aggregate per assistant call group. Freeze nested snapshots before async work. Shared call-history validation admits this shape only on assistant function calls and retains complete result correlation.

Google nonstream response normalization opts into function-part signatures; its existing streaming consumer keeps the default rejection. Project the exact signature onto its call; on replay put it beside that exact native functionCall, never onto the result, another call, text or a reconstructed signature. Reject signed text because current text flattening loses part boundaries. Preserve prior native IDs or reserved missing-ID conventions. Do not map reasoning_details.id/index to tool IDs: official OpenRouter documents reasoning-detail identity/order, not that association. Add explicit non-Google/delegated/stream pre-key guards.

Official sources: https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures and https://ai.google.dev/api/generate-content#Part . Installed SDK probes and OpenRouter reasoning documentation demonstrate the release gap, not a settled representation bridge. This is a reversible documented protocol subset; no new glossary term or costly ADR is required. #7 remains unresolved. Update PRD, architecture, acceptance, compatibility and function contracts without claiming pin expansion or SDK certification.

## TDD plan

Before production changes, write public HTTP and actual SDK socket tests for signed parallel/sequential calls, missing-ID replay, signature association/order/immutability, rejection of malformed/oversized metadata, success/Deny/limit/audit/usage/upstream failure, pre-key denial on other adapters and streams, text/signature failure and privacy. Record expected red from native response rejection and strict history shape rejection. Measure OpenRouter stripping via real SDK sockets and safe failed native continuation. Verify persisted direct/dual routes, then npm run format and full npm run check.

## Delivery

Issue and plan precede code. Report red/green, full verification and material limitations. Require exact-head sjungwon03-ai approval and both CI check jobs, then sjungwon03 squash merge and clean synchronized main. Fixture conformance is not live-provider certification. OpenRouter SDK stripping, signed text/streams, thinking model constraints and full #116 remain explicit.

## Verification evidence

Managed native Gemini nonstream function responses previously rejected thought signatures required for result continuation. This change preserves the documented Google OpenAI-compatible tool_calls[].extra_content.google.thought_signature shape and replays each exact opaque value on its original native functionCall part. Parallel/sequential steps and missing-ID correlation retain their existing native association and result order.

Validate exact nested shape, nonempty string signatures and one-MiB per-value/group string-unit bounds; freeze pre-secret history snapshots. Non-Google/delegated/native-stream request paths reject this extension before keys. Unsupported normalized response extensions fail safely possibly billed instead of silently stripping signatures. Signed text/visible thoughts remain closed because flattened text cannot reconstruct native part boundaries. IAM/Deny, fixed registered hosts, output caps, limits, required usage/audit, reported-only totals and operational privacy remain enforced.

TDD: before implementation the new signature suite reported 19 expected failures from response/history rejection and 23 passing existing denial/malformed boundaries. Two additional regression cases reproduced OpenAI/delegated response normalization silently stripping signature metadata (missing expected rejection) before the shared guard was added. Final focused verification passes 184 tests. Added 46 cases cover raw HTTP and installed SDK socket probes on both bases, exact signature association, parallel/sequential history, immutable capture, missing IDs, malformed/aggregate limits, non-Google/delegated/stream pre-key rejection, response failure/privacy, usage/audit/Deny gates and stored direct/dual servers.

Compatibility limits: OpenAI 7.23.0 preserves the extension at runtime, although generated types omit it. OpenRouter 1.4.18 strips tool-call extra_content; real socket probes observe lost signatures and safe native continuation failure. No reasoning-detail ID/index association or encrypted bridge is invented. This is not complete signed Gemini OpenRouter SDK compatibility or live-provider certification. Signed streams/text, thinking-model constraints and broader named clients remain open. Existing thinkingBudget:0 and effort conflict remain unchanged; full #116 and unresolved #7 stay open, with pin v19 unchanged.


Full npm run check passes strict types, lint, 2416 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
