# Compatible nonstream completion usage

Successful normalized object:chat.completion responses on both /v1 and /api/v1 include usage only when prompt_tokens, completion_tokens and total_tokens are safe nonnegative integers. Complete counters, including zero and a supplied total that differs from the sum, survive exactly. OpenAI/Anthropic/delegated provider normalization may derive total when prompt/completion are valid and total is omitted; Google totals remain reported-only because hidden thoughts may contribute; this boundary adds no derivation and never replaces unknown values with zero.

Incomplete, null or malformed normalized usage is omitted as a whole. The official ChatResult permits absence, while ChatUsage requires all three integer counters. An otherwise valid response can therefore deserialize in the pinned official SDK without fabricated usage. Consumers needing partial reporting can inspect protected usage history according to existing IAM rules.

Projection occurs only after required ledger and outcome audit persistence on managed and delegated success. The native normalized response and accounting input retain missing/partial/invalid/reported status and exact known counters. Required ledger or outcome-audit failure still returns a safe error; authentication, model/final-provider IAM Deny and limits prevent upstream dispatch. Content/secrets never enter operational metadata.

The boundary clones adjusted completions and preserves supplied fingerprint values. Both bases apply the [unknown-fingerprint null projection](compatible-completion-fingerprints.md) under #542 while preserving supplied values. Opaque results without the completion discriminator, streaming and error envelopes keep their existing behavior. The bounded [nonstream token-detail projection](nonstream-token-details.md) preserves recognized optional categories without adding them to aggregate accounting. Detailed cost projection, server-tool support, full response validation and complete external-client certification remain open.

See [plan](../docs/plans/246-compatible-usage.md) and [compatibility inventory](../docs/openrouter-compatibility.md).

## Both-base numeric usage omission (#540)

The same complete-counter requirement now applies to /v1. This intentionally replaces its prior sparse numeric usage output. Missing/partial/invalid usage is omitted as a whole, including associated token-detail groups, without changing the native normalized response or ledger input. Complete safe counters and admitted categories remain exact, including zero and independent provider totals. Required persistence still precedes projection; no cost or total is invented. Partial reporting remains available through existing protected history permissions. See [plan](../docs/plans/540-legacy-usage.md). The separate #542 fingerprint correction now covers both bases; error formats and other client schema cases remain separate from usage projection.
