# Bounded managed Gemini nonstream client functions

Issue: #406. Plan: [406-gemini-client-functions](../docs/plans/406-gemini-client-functions.md).

## Supported request boundary

Registered native generateContent routes accept bounded custom function declarations and complete text-only result histories on /v1 and /api/v1. Keep fixed registered model URLs and x-goog-api-key headers, administrator output caps, immutable bodies before secret lookup, complete model/final-provider IAM and Deny, limits, required usage/audit and no local execution.

Declarations use functionDeclarations with name, description (empty when absent) and supplied object parametersJsonSchema. Omitted schemas remain omitted; do not convert JSON Schema into the narrower parameters/OpenAPI vocabulary. Portable definitions retain the 64-character limit, and this subset allows only letters/digits/underscore/dash native names (up to 128 in history/output). Provider schema/model capability semantics remain provider-owned. Omit false/null strict; reject strict:true before keys because there is no established equivalent guarantee. Choices none/auto/required/named map to NONE/AUTO/ANY/ANY plus one allowedFunctionNames entry. Omitted/true parallel controls allow native parallel calls; false rejects before keys except NONE, whose no-call semantics already satisfy the control.

Actual function declarations or call/result histories request generationConfig.thinkingConfig.thinkingBudget:0. Simultaneous explicit reasoning_effort rejects before keys. Ordinary text requests keep their existing effort behavior. Models that cannot disable thinking may fail natively; no hardcoded model eligibility or name equivalence is introduced. Signature/thought responses are unsupported failures rather than silently unusable continuations. Gemini 3 signature replay and models requiring thinking remain release gaps.

Portable assistant arguments parse as bounded plain JSON objects. Native model parts retain optional text and functionCall id/name/args. Tool results resolve names by exact preceding assistant IDs, wrap the original string as response:{output:string} without interpreting JSON-looking text, and form one user functionResponse group in original call order. Complete shared history validation rejects orphan, duplicate, interrupted or missing results before native credentials.

## Response and ID contract

A singleton STOP candidate with model content and actual custom functionCall parts becomes tool_calls, with concatenated optional text (null for tool-only output) and JSON-serialized object arguments. Omitted args become {}. Require at most 128 plain parts, valid names, unique nonempty supplied IDs, bounded object inputs and exact supported fields. Reject signatures, thought:true, rich/server output, simultaneous text/function data, malformed role/envelopes and calls under MAX_TOKENS/safety. Text parts with signatures/rich fields also fail safely, preserving the no-signature continuation boundary.

Preserve a native ID. Missing IDs receive opaque client correlation IDs og_google_missing_id_<UUID>. On replay these reserved IDs are omitted from both native functionCall and functionResponse; original order supplies native correlation. Provider-reported IDs in the reserved namespace fail safely to avoid ambiguous origin. ID content is never authorization or operational metadata. No inference provider identity or signature is fabricated.

Google totals remain reported-only; known components survive missing totals without guessing prompt+candidate sums. Missing/partial/invalid aggregate data and actual supplied totals retain their ledger status; no monetary amount is invented. Google nonstream tool/text completions expose system_fingerprint:null on both bases for actual SDK conformance, ignoring similarly named native fields. This represents unavailable metadata, not a provider fingerprint. Opened malformed/native HTTP failures remain sanitized and possibly billed. Required persistence/audit failures cannot return tool success.

## Verification and gaps

Both installed OpenAI/OpenRouter SDKs exercise parallel calls, complete result continuation and fresh provider Deny on both bases. HTTP tests verify native controls, original result order, ID-less replay, immutable schemas/history, rejection before keys, signature/malformed response failure, ledger privacy and reported-only totals. Generated persisted direct/dual servers use stored registrations, enforce output caps and replace runtime overrides; usage failures and fresh Deny remain safe. Existing Google text streams and generic function dispatcher remain closed to function requests.

Thinking/signature replay, strict guarantees, single-call enforcement beyond NONE, partial argument streams, built-in/rich tools and broader named clients remain open. Fixture tests are not live-provider certification. Full #116 and unresolved #7 stay open; OpenRouter pin v19 remains unchanged.

Registered signature-free complete function SSE and result continuation are now supported separately by [Gemini function streams](gemini-function-streams.md). The historical nonstream scope above remains the initial implementation record; thinking/signature replay and partial argument streaming stay open.
