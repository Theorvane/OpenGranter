# Delegated reasoning token budget

Both chat bases accept optional reasoning.max_tokens for delegated OpenRouter
nonstream and existing ordinary text streams. Supplied values must be positive safe
integers as an explicit local subset, not asserted official generic numeric bounds.
Preserve exact values/omission alongside optional supported exclusion and summary.
Null, zero, negatives, fractions, unsafe/nonfinite numbers, own undefined, malformed
values and unknown controls reject before routing/credentials.

A supplied budget with any nested effort (including null), forwarded named shorthand
or supplied enabled is outside this local subset pending conflicting/unspecified
interaction guidance. This scope restriction does not establish official precedence.
Top-level reasoning_effort null normalization and existing effort/activation-only
contracts stay intact. No effort/defaults/provider clamps are injected. Keep the
outer output maximum independent and unchanged; do not derive or increase it from
the reasoning budget or imply that every model enforces exact token allocation.

Capture each preference once and freeze before async work. Late caller mutation or
accessor exceptions cannot alter the upstream payload or leak private error text.
Preferences grant no model/provider/region, policy or tool authority. All native
structured configurations still reject before secrets. This is a delegated raw
request subset, not native thinking support or a provider-specific budget mapping.

Authentication, full model/provider IAM with explicit Deny precedence, limits,
required audit/usage, persistence-gated streams and safe possibly-billed failures
remain shared. Preserve actual aggregate usage and existing unknown usage; never
infer charges/counts from budget or rewrite returned reasoning. Preferences, content,
history and credentials stay outside operational records/errors.

The [official reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
documents budgets and exclusion, but provides no generic null/zero/default/bounds
schema. It describes budget/effort as alternatives while another passage mentions
coexistence; activation/budget precedence and summary interactions remain unclear.
Anthropic-specific minimum/cap/output-budget relationships are not imposed globally.
Gemini can translate budgets into thinking levels rather than exact token control.
Current [official OpenAPI](https://openrouter.ai/openapi.json) and pinned OpenRouter
SDK 1.4.18 omit this field. Actual SDK sockets prove budget stripping, while the
OpenAI-compatible SDK forwards the raw extension through both bases/modes. Unchanged
pin v18 cannot certify an absent child field. Mixed controls, null/zero semantics,
provider capabilities/native mappings, tool streams and complete external-client
certification remain open under #116.

See [plan](../docs/plans/320-reasoning-budget.md),
[activation](client-reasoning-activation.md), [exclusion](client-reasoning-exclusion.md)
and [effort](nested-reasoning-effort.md).
