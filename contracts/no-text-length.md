# No-text length completions

Direct OpenAI and delegated OpenRouter nonstream completions with finish_reason
length permit null/missing assistant content independently of request reasoning
controls or token-detail categories. Preserve explicit null; normalize missing
content to null consistently with the existing completion shape. Preserve length,
empty string and validated optional refusal/reasoning/details without fabricating
text, zero usage, reasoning, costs or a token-budget explanation.

Validate role, envelope, model identity, canonical finish and optional fields as
before. Malformed content/reasoning/details/refusal and inconsistent tool/finish
semantics still fail safely with possibly-billed failed accounting. Metadata-only
or empty valid details can accompany no-text length because the finish condition
itself permits absent content, not because metadata grants authority. Unsupported
stop/null-without-payload remains a local bounded response rule; official optional
nullable schema does not classify that case as structurally malformed.

Complete model/provider IAM with explicit Deny, limits, required audit/usage and
safe errors remain unchanged. Record a successfully delivered length completion as
succeeded only after required persistence; token counts remain actual or missing,
never inferred as zero from no text. Content/preferences/credentials remain outside
operational audit/ledger/errors. Empty response output does not waive usage/billing.
Both API bases and actual OpenAI/OpenRouter SDK sockets retain canonical null,
length and usage through both supported routes. Response acceptance does not widen
assistant-history input validation or guarantee that an empty response can replay.

The [official reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
documents exhausted output budgets returning length without visible text and ongoing
billing, including excluded reasoning. [Official OpenAPI](https://openrouter.ai/openapi.json)
and SDK 1.4.18 define optional nullable assistant content independently of finish
and reasoning; request flags/corroborating usage are not schema prerequisites.
This bounded length-only allowance does not certify all optional-content outcomes.
Pin v18 already selects the assistant shape and is unchanged. Empty stop/native
thinking/direct or tool streams and full external-client certification stay #116.

See [plan](../docs/plans/324-no-text-length.md),
[scalar reasoning](nonstream-reasoning.md), [details](nonstream-reasoning-details.md)
and [exclusion](client-reasoning-exclusion.md).
