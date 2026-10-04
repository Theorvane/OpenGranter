# Non-streaming assistant reasoning content

The shared direct OpenAI/delegated OpenRouter normalizer preserves optional reasoning string/null on already-valid assistant text, refusal/filter and function-call responses. Both HTTP bases retain omission, null, empty, Unicode and newline values exactly. Supplied reasoning is captured once and projected in both existing normalization branches; no reasoning is fabricated when a provider omits it.

Stop/length completions may have null or omitted content independently of substantive reasoning; omitted content is normalized to null. Empty/null reasoning and valid detail metadata are preserved without granting authority; validated nonempty summary/text/encrypted payloads can independently satisfy the [detail-only contract](nonstream-reasoning-details.md). Malformed content and incompatible finish/tool semantics still fail; existing null-content filtered/refusal/tool-call outcomes remain valid. Empty text with length termination retains its existing meaning. Supplied malformed reasoning, including an explicitly present undefined at the normalizer boundary, fails safely after upstream dispatch with one possibly-billed failed attempt and unknown usage, rather than reporting success or exposing response text.

Authentication, model/final-provider IAM, limits and required selection audit precede credentials/inference. Required usage/outcome audit precede client delivery; their failures suppress success, including after usage persistence. Reasoning never enters operational audit, ledger metadata, logs or errors and grants no routing authority. Missing provider usage stays unknown; reasoning text is not a token counter or billed-cost estimate.

Official SDK 1.4.18 socket cases on both bases and supported route kinds deserialize omitted/null/string reasoning with supplied fingerprints. The direct adapter preserves the field if actually returned; this does not claim that OpenAI models expose reasoning. The supported reasoning_effort shorthand is defined in the [request contract](client-reasoning-effort.md). Summary/text/encrypted response details and delegated streamed reasoning follow their [non-streaming detail](nonstream-reasoning-details.md) and [streaming detail](stream-reasoning-details.md) contracts. Structured request controls and detailed history, native Anthropic/Gemini thinking responses, aggregation and full compatibility remain open.

Sources reviewed 2026-10-02: [official reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) and installed SDK ChatAssistantMessage schema. See [plan](../docs/plans/240-nonstream-reasoning.md), [refusal contract](refusal-outcomes.md) and [function response contract](function-tool-responses.md). No content-audit policy or source pin changes.

The installed SDK permits optional nullable assistant content independently of finish reason and reasoning. This bounded gateway allowance is schema-compatible, rather than a claim that upstream models always return reasoning-only results. See [follow-up plan](../docs/plans/294-reasoning-only-completions.md).

Delegated scalar reasoning in assistant request history now follows the separate [history contract](client-reasoning-history.md); direct native request mapping remains open.

Length-only null/missing content is now independently supported by [its contract](no-text-length.md), without a substantive reasoning payload. Stop optional content now follows its separate contract; malformed-field validation remains unchanged.

Optional stop content follows [its contract](no-text-stop.md), independent of substantive reasoning. Inherited fields stay unprojected; malformed fields, unsupported finishes and history-input guards remain effective.
