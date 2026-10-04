# Legacy reasoning inclusion aliases

Both chat bases accept optional include_reasoning true/false for delegated
OpenRouter nonstream and existing ordinary text streams. Normalize true into
reasoning {} and false into reasoning {exclude:true}, as documented, removing the
legacy field before upstream dispatch. Omission/undefined leaves configuration
omitted. Independent top-level reasoning_effort remains captured/validated and
forwarded without defaults; generated configuration has no nested effort alias.

Reject null/malformed flags and any supplied raw reasoning configuration together
with a flag before routing/credentials. This is a local subset restriction because
mixed-field precedence is undocumented, not an official conflict prohibition.
No merging or winning field is inferred, even for apparently equivalent inputs.
Capture optional input fields once and freeze normalized configuration before async
work. Late mutation and accessor exceptions cannot change the payload or leak text.
HTTP and standalone delegated adapters apply the same boundary validation. Native
providers reject supplied aliases, including false, before secrets; do not silently
ignore them or enable native thinking. Existing complete history validation stays
intact. Preferences grant no model/provider/region, policy or tool authority.

Authentication, complete model/provider IAM with explicit Deny precedence, limits,
required audit/usage, persistence-gated streams, operational privacy and safe
possibly-billed failures remain shared. Normalization does not filter returned
reasoning, fabricate output, infer free/reduced usage or change aggregate accounting.
Preferences/history/content and credentials stay outside operational records/errors.

The [official reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
provides both legacy equivalents and recommends unified configuration. Null/defaults
and mixed-field precedence are unspecified. Current
[OpenAPI](https://openrouter.ai/openapi.json) and pinned OpenRouter SDK 1.4.18 omit the
ChatRequest flag despite the parameter catalog listing it. Actual compatible SDK
sockets send the raw extension and the gateway normalizes it on both bases/modes;
pinned OpenRouter SDK sockets demonstrate stripping while preserving independent
effort. Unchanged pin v18 cannot certify an absent field or documented alias rule.
Mixed configurations/null semantics, native mappings, tool streams and full external
certification remain open under #116.

See [plan](../docs/plans/322-legacy-reasoning-alias.md),
[exclusion](client-reasoning-exclusion.md) and [summary](client-reasoning-summary.md).
