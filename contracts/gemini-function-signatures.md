# Managed Gemini nonstream function thought signatures

Issue: #410. Plan: [410-gemini-function-signatures](../docs/plans/410-gemini-function-signatures.md).

## Exact protocol and association

Managed native Gemini nonstream function calls on both compatible bases preserve Part.thoughtSignature as tool_calls[].extra_content.google.thought_signature, matching Google's documented OpenAI-compatible wire shape. The field belongs to the original function-call part, beside its functionCall; replay attaches it to that exact call, never the functionResponse or another call. Preserve native IDs or existing reserved missing-ID correlation. Parallel calls may have a signature on only one call; sequential steps preserve each earlier step's exact signature and complete correlated results.

Signatures remain opaque original strings, never decoded/re-encoded, decrypted, verified, fabricated or used as identity/authorization. The extension contains exactly google:{thought_signature:nonempty-string}; null/empty/nonstring/unknown shapes fail. Bound each signature and the aggregate per assistant call group to one MiB of string units, and freeze nested snapshots before asynchronous work. Native malformed/oversized signatures fail safely as opened possibly-billed attempts. Invalid request shapes reject at the public boundary; unsupported adapter paths reject before credentials.

## Shared controls and exclusions

Keep administrator registrations, fixed hosts/model scope, output caps, pre-secret immutable controls/history, model/final-provider IAM and explicit Deny, limits, required usage/audit, reported-only totals and privacy. Required persistence failure cannot return usable signed-call success. The gateway never executes tools or stores signatures in ledger/audit/errors. Content audit remains a separate explicitly protected opt-in store.

Other native providers, delegated paths and native text/function streams reject this extension in request history before key lookup. Non-Google normalized responses carrying tool-call extra_content fail safely after response start instead of silently stripping it; only the explicit native Gemini nonstream mapper projects supported signatures. Signed native stream output remains rejected. Signed text and visible thought content remain unsupported: the current flattened text representation cannot reconstruct original part boundaries safely. No inference from reasoning_details.id or index to a tool call is introduced; OpenRouter defines reasoning-detail identity/order, not native tool association. No new model capability/name equivalence, reasoning-effort mapping or request default is introduced. Function requests retain thinkingBudget:0 and explicit-effort conflict, so models unable to disable thinking may fail natively.

## Verification and SDK gap

Raw HTTP and installed OpenAI 7.23.0 socket tests on both bases preserve signature-bearing function responses and complete result continuation, including fresh provider Deny. The generated TypeScript SDK types omit this provider extension while runtime JSON preserves it. Installed OpenRouter 1.4.18 strips tool-call extra_content on inbound and outbound schemas; real socket probes demonstrate lost signatures and safe native failure when required signatures are not replayed. Therefore this extension does not establish signed Gemini OpenRouter SDK compatibility. No encrypted-detail bridge or dummy signature is invented to hide the gap.

Boundary tests cover exact call association/order, parallel/sequential steps, missing IDs, immutable capture, malformed/aggregate bounds, signed-text rejection, non-Google/delegated/stream denial before keys, accounting/audit failures and privacy. Stored direct/dual server tests retain stored registration authority, override replacement, usage failure and fresh Deny. Fixture conformance is not live-provider certification. Signed streams/text, models requiring thinking, an evidenced OpenRouter representation and broader named clients remain open; full #116 and unresolved #7 remain open, with pin v19 unchanged.

Sources: [Google thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures), [native Part](https://ai.google.dev/api/generate-content#Part), [OpenRouter reasoning identity/order](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Installed SDK source/runtime evidence is version-specific.
