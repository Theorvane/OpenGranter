# Delegated reasoning summary configuration

Both chat bases accept optional reasoning objects containing supported optional effort and
summary preferences for delegated OpenRouter nonstream and existing ordinary text
streams. Supported exact values are auto, concise, detailed and null. Preserve
omission, {}, summary omission and summary null without defaults or alias rewriting.
The outer reasoning object is nonnullable. Reject malformed types, unknown strings,
case variants, explicit own undefined summary and extra keys before routing.
Plain objects and null-prototype records are copied into frozen configurations.

Capture the request field and nested summary once before async routing/credentials;
caller mutation cannot change the selected upstream body. Top-level reasoning_effort
is independent: summary-only objects have no duplicated nested effort field.
Nested effort is now supported under [its bounded alias contract](nested-reasoning-effort.md).
Budgets, enabled, exclude and legacy include_reasoning stay rejected.
All direct OpenAI/Anthropic/Gemini providers reject supplied configurations, including
{}, before credentials until explicit native mappings are defined.

This is an untrusted request preference, not authority to change model/provider,
region, limits or audit policy. Authentication, complete destination IAM and Deny,
limits, required selection/outcome audit and usage persistence keep their shared
order. Failed attempts retain possible-billing accounting; streamed final usage and
DONE require successful persistence. Fields, history, prompts, responses and keys
remain outside operational records/errors. No reasoning/token charge is inferred
from a preference, and output summaries are never fabricated or locally filtered.

Actual OpenRouter SDK 1.4.18 sockets cover both bases and both supported modes,
including exact empty/null/enum states and top-level effort coexistence. Function
and opaque reasoning histories preserve their established complete-group controls;
tool streams remain unsupported. Model support/defaults and summary availability
are not guaranteed by forwarding.

Sources: [official OpenAPI](https://openrouter.ai/openapi.json) and
[official SDK reference](https://openrouter.ai/docs/client-sdks/python/api-reference/chat).
ChatRequest.reasoning.summary references ChatReasoningSummaryVerbosityEnum, which
has auto/concise/detailed/null, no default and x-speakeasy-unknown-values:allow.
Our named-value subset rejects unknown strings despite the SDK open enum.
The official schema and SDK do not serialize legacy include_reasoning on ChatRequest;
that separately documented boolean is not accepted or silently rewritten here.
Structural pin v18 now selects the whole reasoning request field and referenced
summary enum; see [source contract](openrouter-schema-drift.md). Native summaries, broader nested controls, rich/tool streams and complete
named external-client certification remain under #116.

See [plan](../docs/plans/310-reasoning-summary.md),
[effort](client-reasoning-effort.md) and
[history](client-reasoning-details-history.md).
