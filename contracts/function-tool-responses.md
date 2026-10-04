# Function Tool Call Response Contract

For non-streaming direct OpenAI and delegated OpenRouter responses, an assistant message with `finish_reason: "tool_calls"` must contain one to 128 function `tool_calls`. Each call has a nonempty unique string ID, `type: "function"`, and a function with a nonempty string name and string `arguments`. The argument string is preserved exactly, without parsing or execution. Assistant content may be a string, null or omitted (normalized to null); nonempty refusal alongside calls is contradictory and rejects.

A populated call array with another finish reason, an empty/missing call array with `tool_calls` finish reason, malformed calls, duplicate IDs and any non-null legacy `function_call` fail as an invalid upstream response. Omitted/null/empty `tool_calls` with ordinary stop/length/content_filter/null finish reasons retain existing text/refusal/filter behavior. The current response subset does not claim support for multimodal assistant content, streamed call deltas, provider-specific server tools or native Anthropic/Gemini call translation.

Both compatible HTTP bases and the installed OpenAI SDK receive the same normalized call IDs, names, serialized arguments and finish reason. Metadata audit and errors never include those values or assistant content. IAM, limits and required audit remain before transport. An invalid upstream response retains possibly-billed failed-attempt usage accounting; a valid delivered call uses the existing successful usage path. A subsequent text-only `tool` result and assistant call history are supported by the separate history contract, completing the bounded non-streaming function lifecycle. Request controls are separately tracked in #180; full compatibility remains tracked in #116.

Source: https://openrouter.ai/openapi.json, raw snapshot retrieved 2026-09-29.

## Capture consistency

The public assistant response normalizer captures one validated call-array length
and fixed indexed entries before reading call fields. The same captured ID, type,
function reference, name and arguments are used for validation, uniqueness and
projection. Legacy function_call is read once; a non-null first capture rejects.
Unknown response keys remain omitted and inherited required scalar fields remain
accepted. Invalid first values reject without rereading or coercion. Local getter
and Proxy regressions exercise this boundary; HTTP JSON cannot carry accessors.

Direct OpenAI and delegated OpenRouter adapters sanitize exceptions from response
normalization into response-started, possibly-billed failures. Both compatible
HTTP paths retain failed-attempt usage and keep call arguments, names, credentials
and exception text out of errors and metadata audit. Snapshot timing does not
promise atomic arbitrary object graphs. See [plan](../docs/plans/340-function-response-capture.md).
