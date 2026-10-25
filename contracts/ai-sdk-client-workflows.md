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

When provider counters are absent, the pinned client presents zero token totals while the server ledger retains missing/null counts. Incomplete native Gemini counters are preserved as partial/null totals in the ledger: legacy /v1 sparse numeric usage causes this provider's response validation to fail; /api/v1 omits incomplete usage and the client displays zero. Success probes use explicitly reported complete native totals, never invented counts. These measured client limitations remain compatibility gaps and are not a server accounting rewrite.

These probes do not certify model discovery, signed Gemini calls, images, reasoning, embeddings/completions/responses/Decisions APIs, live providers, other client versions or full #116. Jev #7 remains unresolved. Existing OpenCode/OpenAI/OpenRouter SDK contracts and signed-Google configuration remain separate. Primary source checked 2026-10-25: [OpenRouter-maintained provider](https://github.com/OpenRouterTeam/ai-sdk-provider); actual pinned installed code and socket measurements define this bounded result.
