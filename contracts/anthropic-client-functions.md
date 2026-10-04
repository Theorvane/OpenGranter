# Managed Anthropic nonstream client functions

Issue: #402. Plan: [402-anthropic-client-functions](../docs/plans/402-anthropic-client-functions.md).

## Supported boundary

Both /v1/chat/completions and /api/v1/chat/completions support administrator-registered managed Anthropic custom functions without executing them. Authentication, complete model/final-provider IAM, explicit Deny, limits, registered fixed Messages host and required usage/audit remain shared gates. Persisted direct/dual generated invokers use the same adapter.

Portable function definitions become name, description, input_schema and optional strict. Omitted parameters use {"type":"object"}; supplied schemas require type=object. Preserve boolean strict, omit null. Names must satisfy ^[A-Za-z0-9_-]{1,128}$ in native histories/responses; portable declaration/choice names retain their existing 64-character maximum. JSON schemas remain bounded plain snapshots; schema semantics and model capabilities remain provider-owned.

Choice none/auto/required/named becomes native none/auto/any/tool. Invert parallel_tool_calls inside disable_parallel_tool_use, creating auto if choice is absent. Native none has no parallel field: it disallows every call under either parallel setting. Omitted controls remain omitted.

Assistant histories become optional text and tool_use blocks, preserving call IDs/names and parsing arguments as bounded JSON objects. Adjacent tool results become one immediately following user turn of tool_result blocks, preserving correlation and order. Existing complete-history validation rejects orphan, duplicate, interrupted or missing results. Invalid JSON, non-object arguments, excessive nesting/nodes, unsupported names/schemas and unsupported native stream modes fail before credentials. Prepared serialized bodies precede secret lookup and resist subsequent caller mutation.

Native stop_reason=tool_use requires actual bounded custom tool_use calls (at most 128 total response blocks), unique nonempty IDs, valid native names and bounded object inputs. Optional text concatenates in block order; tool-only content is null. Arguments serialize from objects, without claiming original whitespace. Exact custom call fields and plain text blocks only are supported in tool terminals; thinking, server tools, rich blocks and caller metadata fail safely. A tool terminal without calls, or calls under another terminal, fails safely. Existing text/refusal and cumulative aggregate usage normalization remain in place. Anthropic nonstream completions expose system_fingerprint:null, including text continuations, because the OpenRouter SDK requires this field on both bases; the value conveys no invented provider fingerprint. Missing, partial and invalid usage are not zero, and no billed cost is invented.

## Acceptance cases

- Both bases normalize mixed text and two calls with provider-attributed content-free accounting.
- Both installed OpenAI and OpenRouter SDKs complete parallel calls and correlated results against fixture upstreams.
- New Deny and limit failures occur before keys; failed upstream or malformed response remains possibly billed without content leakage.
- Required usage persistence failures return safe failure, not a tool success. Required audit retains its shared failure gate.
- Stored direct/dual servers replace runtime invocation overrides, retain output caps and both bases, and enforce fresh final-provider Deny.
- Explicit Anthropic text streaming and OpenAI-only function streaming continue rejecting Anthropic tools before keys.

Native Anthropic function streaming, native thinking/signatures, server tools, rich tool results, capability discovery and broader named external applications remain open. Fixture conformance is not live-provider certification. Full #116 and unresolved #7 remain open; pinned OpenRouter schema v19 is unchanged.
