# Compatible nonstream completion usage

Successful normalized object:chat.completion responses on /api/v1 include usage only when prompt_tokens, completion_tokens and total_tokens are safe nonnegative integers. Complete counters, including zero and a supplied total that differs from the sum, survive exactly. Existing provider normalization may derive total when prompt/completion are valid and total is omitted; this boundary adds no derivation and never replaces unknown values with zero.

Incomplete, null or malformed normalized usage is omitted as a whole. The official ChatResult permits absence, while ChatUsage requires all three integer counters. An otherwise valid response can therefore deserialize in the pinned official SDK without fabricated usage. Consumers needing partial reporting can inspect protected usage history according to existing IAM rules.

Projection occurs only after required ledger and outcome audit persistence on managed and delegated success. The native normalized response and accounting input retain missing/partial/invalid/reported status and exact known counters. Required ledger or outcome-audit failure still returns a safe error; authentication, model/final-provider IAM Deny and limits prevent upstream dispatch. Content/secrets never enter operational metadata.

The boundary clones adjusted completions and preserves supplied fingerprint values with the existing unknown-fingerprint null projection. /v1 sparse usage, opaque results without the completion discriminator, streaming and error envelopes keep their existing behavior. No detailed cost/token-category projection, server-tool support, full response validation or complete external-client certification is implied.

See [plan](../docs/plans/246-compatible-usage.md) and [compatibility inventory](../docs/openrouter-compatibility.md).
