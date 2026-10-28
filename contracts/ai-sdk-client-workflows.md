# OpenRouter AI SDK Client Workflows

Issue [#538](https://github.com/Theorvane/OpenGranter/issues/538). Plan: [538-ai-sdk-workflows](../docs/plans/538-ai-sdk-workflows.md).

## Measured client surface

Pin development-only @openrouter/ai-sdk-provider 3.1.0, ai 7.0.153 and zod 4.6.6 on Node 22.14. Use createOpenRouter with an explicit gateway baseURL and a proxy token, then its chat model with generateText/streamText. Actual sockets cover /v1 and /api/v1, delegated OpenRouter and registered direct OpenAI/Anthropic/Gemini. Text completion and a streamed function execution/result continuation preserve fixed approved destinations and per-attempt accounting. The client runs a deterministic fixture tool; the gateway never executes it.

Set maxRetries:0, an abort deadline and a bounded two-step tool loop in probes. Test fetch permits only the local gateway chat endpoint and a bounded request count. Gateway upstream transports remain mocked at their registered approved hosts. No caller request or response is rewritten to make the SDK succeed. Negative persistence probes may observe a response clone; ordinary success/cancellation paths consume the original streaming response normally.

## Correlated tool-result names

The actual provider adds name to tool-result messages. Accept this optional measured client extension only when an own supplied string exactly equals the function name of the still-pending tool_call_id in the immediately preceding assistant call group. Capture once before asynchronous routing and remove the redundant name from the immutable internal message. Omission remains valid; own undefined, null, nonstring, empty/mismatching names and orphan/duplicate/unresolved results fail safely before routing or credentials. Results may arrive in any order within the group. Inherited names are not projected or used as authority.

Removing the validated hint prevents native adapters from interpreting it as an unsupported speaker name. The internal ChatMessage shape and native/delegated upstream history formats are unchanged. Non-tool speaker names keep their existing provider restrictions. The official ChatToolMessage projection does not declare this property; existing source pins remain byte-identical. This is a measured client extension, not a fabricated change to the official schema.

## Controls and measured limits

Authentication, fresh model/final-provider IAM with explicit Deny, limits and required selection/outcome audit and usage remain shared. Preflight failures cannot execute a client tool or access provider credentials. A tool result continuation must authenticate and evaluate fresh policy again; an initial allowed tool may execute locally before a later request is denied. Streamed content can already have been delivered when persistence fails. Required persistence failures withhold the actual final usage/DONE frames; do not interpret a client-synthesized finish-step after an error as a server success acknowledgment.

Client abort after content records a failed possibly-billed attempt and interruption audit without final server usage. Actual tool IDs, names, arguments, content and credentials stay out of operational records/errors. No limits, usage or pricing values are inferred from client summaries.

When provider counters are absent, the pinned client presents zero token totals while the server ledger retains missing/null counts. Incomplete native Gemini counters are preserved as partial/null totals in the ledger. Both /v1 and /api/v1 now omit incomplete usage under #540 and this client displays zero; the previously measured legacy sparse-usage parser failure is resolved without inventing counts. Success probes use explicitly reported complete native totals, never invented counts. The client zero default remains a measured limitation rather than a server accounting rewrite; the measured nonstream fingerprint gap is resolved separately by #542, while other client schema gaps remain separate.

These probes do not certify model discovery, signed Gemini calls, images, reasoning, embeddings/completions/responses/Decisions APIs, live providers, other client versions or full #116. Jev #7 remains unresolved. Existing OpenCode/OpenAI/OpenRouter SDK contracts and signed-Google configuration remain separate. Primary source checked 2026-10-25: [OpenRouter-maintained provider](https://github.com/OpenRouterTeam/ai-sdk-provider); actual pinned installed code and socket measurements define this bounded result.

## Nonstream parallel continuations (#546)

Actual generateText also completes a two-request JSON function/result loop on both bases through delegated OpenRouter and all three managed native adapters. Two calls to the same function carry different arguments and stable IDs; controlled client execution finishes in reverse order, while exact native continuation assertions retain the correct call/result pairing. The gateway never executes the function. Native Gemini coverage here uses ordinary reported IDs without thought signatures; signed namespaces remain separately uncertified for this client.

Each request authenticates and evaluates current policy independently, checks limits and records its own usage identity. A provider Deny introduced for the second request prevents a second upstream/credential access even though both client functions already completed locally. Initial auth/implicit/model/provider Deny, limits and selection-audit failure prevent upstream execution. Outcome-audit or usage persistence failure withholds the initial tool response and prevents local execution. Outcome-audit failure can occur after a successful provider call and persisted successful usage record; a 503 is not proof that the provider did no work. No automatic client retries are permitted in these probes.

The pinned AI SDK asLanguageModelUsage computes totalTokens from input/output counters. Controlled OpenAI/delegated/Gemini responses with prompt 2/completion 3/reported total 7 therefore appear as 5 per step and 10 across two steps in the client, while unmodified HTTP responses and the server ledger preserve 7 per attempt. Native Anthropic supplies 2/3 and its existing adapter derives 5. Client aggregate totals must not replace server accounting or establish provider-billed cost. This is an observed client summarization limitation; no production counter behavior changes.

See [plan](../docs/plans/546-ai-sdk-nonstream-tools.md) and [reproduction](../docs/ai-sdk-conformance.md). Production code, six structural pins, dependencies and storage are unchanged. Full #116 and unresolved Jev #7 remain open.
