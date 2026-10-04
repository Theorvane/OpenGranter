# Delegated assistant reasoning details history

Both chat bases preserve optional assistant reasoning_details arrays for delegated
OpenRouter ordinary text histories (including existing text streams) and complete
nonstream function-call/result groups. The supported response subset is reused:

- reasoning.summary requires string summary; reasoning.encrypted requires string data.
- reasoning.text permits optional nullable string text and signature.
- All variants permit optional nullable string id/format and safe integer index.
  Unknown format strings remain opaque; no sorting by index or reconstruction.
- Omission stays omitted, empty arrays stay empty, and exact opaque strings and
  original item order survive HTTP/provider immutable snapshots. Unknown fields,
  unsupported server-tool-call variants, null/undefined arrays or entries, sparse
  arrays, invalid types and explicit own undefined fields reject before routing.

Ordinary assistant string/normalized text-part and null/missing content accept
even empty or metadata-only arrays independently of substantive payloads; missing
content normalizes to null. See [no-text history](no-text-history.md). Complete
function groups retain call IDs and required matching pending results; empty call
arrays accept null/missing content delegated nonstream. No tool stream/execution
is added. Other roles reject detail fields. History never grants authority.

Capture each detail field once and freeze projected arrays/records before async
routing or credentials. The upstream message uses that same validated snapshot.
All direct OpenAI/Anthropic/Gemini paths reject every supplied details marker,
including empty arrays, before secrets until explicit native mappings exist.
Do not silently discard, decrypt, interpret or authenticate history payloads.

Shared authentication, complete model/provider IAM with explicit Deny, limits,
required audit/usage persistence and safe upstream failure accounting retain their
order. Operational records/errors exclude prompts, responses, history/details and
credentials. Missing usage is never estimated from history or double counted.

Actual OpenRouter SDK 1.4.18 sockets replay supported returned details unchanged
on both bases with nonstream and ordinary text-stream continuation. The SDK maps
reasoningDetails to reasoning_details; its extra-property stripping and additional
server-tool variants do not expand the gateway allowlist. Preserve entire original
supported block sequences, particularly around tool continuations, as described in
[official reasoning guidance](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning).
Response/reference definitions are already selected by pin v16; no new structural
pin is needed, and full instance/reference conformance is not claimed. Native
thinking/history, structured reasoning controls, server tools, tool streams and
named external-client certification remain under #116.

See [plan](../docs/plans/306-assistant-reasoning-details-history.md),
[scalar history](client-reasoning-history.md) and
[response details](nonstream-reasoning-details.md).
