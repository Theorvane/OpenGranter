# Official OpenRouter SDK conformance subset

The development-only @openrouter/sdk client is pinned to 1.4.18. Local socket tests exercise the real Node/HTTP boundary and native delegated stream invoker with controlled upstream fixtures, not live provider calls. SDK serverURL selects the gateway base and fixture apiKey is a proxy credential, never a provider key.

Record supported streaming request/response/error cases from actual SDK validation and explicitly inventory gaps before claiming compatibility. SDK response validation does not establish trusted model capabilities, provider identity or prices. Named external-tool workflows, broader schema-instance conformance, native/tool/rich streams and discovery metadata remain separate release gates. This test package is not a production runtime dependency.

## Verified on merged main

Both bases deliver delegated streamed text with portable maxTokens/topP and streamOptions.includeUsage:false correctly serialized to external field names. Complete usage is SDK-visible; unknown usage produces no fabricated usage frame. Nonstream text succeeds when the real upstream supplies a string system_fingerprint. Authentication/IAM/limit denials and first-event upstream failures retain correct HTTP status, fixed safe messages and existing failed-attempt accounting.

## Explicit SDK validation gaps

- Nonstream ChatResult requires system_fingerprint; the gateway's omission-preserving contract fails SDK response validation when upstream omits it. Successful upstream accounting remains recorded despite client schema rejection.
- Compatible /api/v1 midstream errors deserialize as chunks with delivered identity, numeric safe error and finishReason:error, followed by EOF. The official SDK yields the error chunk; callers must inspect it rather than assume iteration throws. Failed-attempt accounting and interruption audit remain required. Legacy /v1 standalone symbolic errors still fail the official SDK stream parser and remain outside its numeric error schema. See [midstream contract](midstream-error-chunks.md).
- Official models.list requires richer catalog metadata, including context_length; the current basic OpenAI-style authorized alias list fails response validation. Do not invent trusted metadata to satisfy the client.
- The published stream schema accepts optional string fingerprints but rejects null. That restriction differs from the gateway's documented local null allowance. Present official usage requires complete prompt/completion/total counters; unknown stream usage is correctly omitted.

These are measured/explicit release gaps, not supported workflows or client-side success claims. Raw SDK validation errors can retain response/request data for debugging; tests never put those objects into gateway audit/logging stores. Primary [SDK documentation](https://openrouter.ai/docs/client-sdks/typescript/overview) and published 1.4.18 package were checked 2026-10-02.
