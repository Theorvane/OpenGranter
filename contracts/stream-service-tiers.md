# Delegated stream service tier metadata

Delegated OpenRouter text streaming preserves optional service_tier string/null/omission exactly in upstream deltas and client SSE frames on both chat bases. The official ChatStreamChunk allows string/null with no enum; whole-event parser limits remain the existing bound. Decoder and independent encoder capture scalar values once and reject malformed supplied types with fixed safe errors. JSON framing prevents tier strings from injecting additional SSE events.

The sequence records final tier metadata only from the actual usage event, independently of prior text/terminal tiers. The delegated composition captures this outcome scalar once and emits it on a complete final usage frame only after required ledger/outcome audit persistence. If final usage omits tier, the final frame omits it. Missing/partial/invalid usage still has no fabricated frame; no earlier metadata is replayed.

First-event failures retain safe JSON/status; later malformed values retain safe error framing, interruption audit, possibly-billed failed-attempt accounting and no DONE. IAM, final-provider permissions, limits, required ledger/audit failures, backpressure and cancellation retain existing behavior. Tier is untrusted response metadata, cannot alter routing/authority/costs and stays out of operational audit/usage/errors and frozen identity callback metadata.

No direct/tool/native stream mapping, tier request control or full external-client compatibility claim is added. Nonstream tier support is separate. The existing source pin already selects the complete ChatStreamChunk shape; no pin refresh is required. See [plan](../docs/plans/250-stream-service-tier.md).
