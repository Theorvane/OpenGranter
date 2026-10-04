# Bounded managed Gemini nonstream client functions

## Issue and problem

Issue: #406. Native generateContent currently rejects custom function controls/history and functionCall responses, preventing compatible client tool round trips.

## Scope and expected behavior

Support bounded custom declarations, none/auto/required/named choices, signature-free mixed text/function responses and complete text result histories on both compatible bases. Preserve IAM, limits, fixed hosts, immutable requests before secrets, reported-only Google totals, required usage/audit and no local tool execution. Thinking/signature replay, Gemini function streaming, built-in/rich tools and full #116 remain open.

## Design

Use parametersJsonSchema for supplied object schemas without lossy OpenAPI schema conversion; omit absent parameters and use empty description when absent. Omit false/null strict, reject strict:true. Map choices NONE/AUTO/ANY, named ANY with allowedFunctionNames. True/omitted parallel control allows native parallel calls; false fails before keys except NONE, which forbids calls altogether. Do not infer a model capability catalog or strict equivalent.

For requests containing actual custom declarations or calls/results, set thinkingBudget:0; reject simultaneous explicit reasoning_effort. Models unable to disable thinking may return native errors; unexpected thought/signature output fails safely rather than dropping continuation data. Do not introduce model-name equivalence or hardcoded eligibility. Normal text requests keep existing effort behavior.

Parse history arguments as bounded objects. Resolve tool-result names from exact correlated assistant IDs; wrap original result strings as response:{output:string}, without parsing JSON-looking text. Group all results in original call order. Preserve native IDs; absent IDs become reserved gateway correlation IDs og_google_missing_id_<UUID>. For these reserved IDs omit native id on both replayed call/result; reject provider IDs in that reserved namespace to avoid ambiguity. IDs remain opaque client content, never authorization or operational metadata.

Native STOP with actual functionCall parts maps to tool_calls. Calls require valid names, unique IDs, object args (omitted args becomes {}), at most 128 plain parts and no thought/signature/rich metadata. Calls under MAX_TOKENS/safety or malformed output fail safely possibly billed. Plain response normalization remains unchanged; Google tool/text continuations expose an unavailable fingerprint as null for actual OpenRouter SDK conformance on both bases, without trusting similarly named provider fields.

Sources: https://ai.google.dev/api/generate-content , https://raw.githubusercontent.com/googleapis/googleapis/master/google/ai/generativelanguage/v1beta/content.proto , https://ai.google.dev/gemini-api/docs/generate-content/thinking and thought-signatures. This is a reversible adapter subset, not a settled provider capability/catalog decision. No new domain term or costly ADR is needed. #7 remains unresolved. Update PRD, architecture, acceptance, compatibility and fingerprint contracts.

## TDD plan

Write HTTP and actual SDK tests before coding; expect red from existing pre-key rejection and text-only response normalization. Cover definitions/modes/history/result order, ID-preserving and ID-less calls, immutable pre-secret capture, unsupported controls/names/schema/JSON before keys, rich/signature/malformed output, IAM/limits/required usage/audit failures and missing/partial/reported Google totals. Keep Google text streams and generic function dispatcher closed to tools. Verify generated persisted direct/dual servers, then npm run format and full npm run check.

## Delivery

Issue and plan precede code. Report observed red/green and bounded limitations, no live-provider certification. Exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge. Full #116 stays open.

## Verification evidence

Native managed Gemini generateContent routes previously rejected custom function requests/history and could not return portable function calls. This change maps bounded object declarations, none/auto/required/named choices, complete correlated result histories and mixed text/function STOP responses on both compatible bases. Preserve supplied native IDs; issue reserved client correlation IDs for missing IDs and omit those IDs on native replay. Result groups retain original call order and exact result strings.

Unsupported strict:true, parallel_tool_calls:false except NONE, and simultaneous explicit reasoning effort fail before key lookup. Function requests disable thinking; thought/signature/rich responses fail safely rather than discard required continuation data. Google nonstream completions expose unavailable fingerprints as null on both bases for installed SDK continuation conformance. IAM, fixed hosts, output caps, reported-only totals, required audit/accounting and content privacy remain enforced.

TDD: the initial 57-test boundary suite produced 39 expected failures from existing tool rejection and missing native mappings. An additional malformed model-role regression failed with actual 200 versus expected 502 before the normalization guard was added. Final focused verification passes 156 tests. Added 61 cases cover HTTP, both installed SDKs on both bases, missing-ID replay, immutable pre-secret capture, unsupported inputs, malformed/signature output, reported-only usage and generated persisted direct/dual servers including fresh Deny and usage failure.

Remaining risks: fixture conformance is not live-provider certification. Models unable to disable thinking can fail natively. Signature replay, Gemini function streaming, strict guarantees, single-call enforcement beyond NONE and built-in/rich tools remain unsupported; full #116 and unresolved architecture #7 remain open. No model capability catalog or provider-name equivalence is introduced.


Full npm run check passes strict types, lint, 2256 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
