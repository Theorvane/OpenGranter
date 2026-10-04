# Delegated function stream chunk preparation

The separate internal decodeOpenRouterFunctionStreamPayload entry point validates
one framed chat.completion.chunk payload inside the approved upstream model scope
and projects the local model alias. It shares existing text/refusal/reasoning,
metadata, usage, single-choice and sanitized error behavior with the text decoder.
Only this entry point accepts tool_calls deltas and tool_calls finish reason.

Each optional tool_calls array contains zero to 128 fragments. A fragment requires
a safe integer index from zero to 127, unique within that chunk. Optional id is a
string; optional type is function; optional function is an object with optional
string name and arguments. Empty objects/strings and omitted fragment fields are
preserved without defaults. Unknown keys, null fields, legacy/server tools,
malformed/count/index/duplicate cases reject with the fixed chunk error. Arrays,
fragment records and nested function records are frozen. Arguments remain opaque
exact strings: no JSON parsing, execution, transcript assembly or authority.

The official cached ChatStreamToolCall schema and pinned SDK define the optional
nonnullable fields and required integer index. Count/index bounds and exact keys
are a narrower local subset, not official generic constraints. In particular, the
SDK accepts index 128 while this internal subset rejects it. Pin v18 tracks the
parent reference but not this transitive definition; that drift gate remains open.

Usage-only chunks reject any supplied tool_calls, including [], rather than
silently discarding it. Existing repeated-terminal and empty-choice usage shapes
remain valid; missing/invalid usage stays classified by shared normalization.
Top-level upstream errors project only a safe error event. Wrong model, multiple
choices, rich unsupported fields and malformed payloads fail without call data.

This boundary validates individual fragments only. It does not prove stable IDs,
nonempty completed names, complete arguments, tool/finish consistency or proper
sequence termination. The original text decoder and all client HTTP/provider
stream guards continue rejecting tools. No new credential, routing, IAM, audit or
usage execution occurs. Later assembly/sequence validation, accounting integration,
SSE delivery, cancellation and complete SDK/external-tool workflows are required
before enabling public tool streams. Keep #116 open.

Sources: cached official OpenRouter OpenAPI retrieved 2026-10-04 and installed
OpenRouter SDK 1.4.18; [tool calling documentation](https://openrouter.ai/docs/guides/features/tool-calling).
See [plan](../docs/plans/344-function-stream-chunks.md).
