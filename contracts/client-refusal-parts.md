# Assistant refusal content-part translation

Both HTTP chat bases accept assistant content consisting of exactly one object
with type:refusal and a string refusal payload. Normalize it to the existing
canonical content:null/refusal:string history; preserve empty/Unicode/newline
values and supported message metadata/complete function groups. Direct OpenAI and
delegated OpenRouter then use their established scalar-refusal paths. No refusal
text is fabricated as visible assistant content. Typed raw adapters remain
canonical-only; this expands HTTP decoding rather than native input types.

Capture message own fields once before validation/projection and the sole refusal
payload once. Downstream snapshots freeze normalized fields before asynchronous
routing/credentials; late caller mutation cannot change the upstream payload.

Reject mixed text/refusal arrays, duplicate refusal parts, non-assistant roles,
null/nonstring payloads, unknown/missing part fields and simultaneous explicit
scalar refusal before routes/credentials. Any supplied scalar conflicts, including
null/empty/equal strings; this is a local ambiguity restriction, not an official
precedence rule. Pending tool groups still require complete matching results.
Refusal history grants no authentication, policy, routing or execution authority.

Existing delegated ordinary text streams accept translated histories; tool/direct
streams remain unsupported. Anthropic/Gemini reject the resulting refusal marker
before secrets. Shared IAM/Deny/limits, required usage/audit delivery, operational
privacy, safe possibly-billed failures and unknown usage remain unchanged.

Current [OpenAI assistant request reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
permits exactly one refusal content part. OpenRouter schema and pinned SDK omit
that raw variant: SDK serialization rejects it but accepts canonical scalar
refusal. This is OpenAI-client compatibility translation, not OpenRouter raw-array
conformance. Actual OpenAI SDK sockets cover both routes/bases and delegated
ordinary streams. Existing OpenRouter SDK scalar-history coverage stays valid.
Pin v18 is unchanged; no fresh OpenRouter full-source comparison or complete #116
certification is claimed. Mixed/duplicate scalar precedence and rich/native/tool
stream mappings remain open.

See [plan](../docs/plans/332-refusal-parts.md),
[scalar refusal history](client-refusal-history.md),
[text parts](client-user-text-parts.md), and [function groups](function-tool-history.md).

Fixed input part positions and each discriminator/payload are captured once under
the [capture contract](content-part-capture.md); normalization uses only validated
first captures without retry or coercion. Existing accepted JSON shapes stay fixed.
