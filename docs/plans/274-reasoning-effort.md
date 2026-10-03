# Delegated reasoning effort controls

## Issue and problem

- Issue: [#274](https://github.com/Theorvane/OpenGranter/issues/274), release gate #116.
- Strict chat validation rejects the documented reasoning_effort shorthand.

## Scope and expected behavior

- Both chat bases accept optional max/xhigh/high/medium/low/minimal/none for delegated nonstream and text streaming. Null/omission supply no field or default.
- Capture once before credential access and forward exact values with unchanged approved model/provider scope. Invalid types/strings reject before routing; native direct adapters reject supplied non-null values before credentials until their mappings are implemented.
- Preserve IAM, limits, output controls, required accounting/audit and safe possibly-billed failures. Effort changes no authenticated authority and is not a strict token budget.
- Structured reasoning and include_reasoning, direct mappings, richer responses and model capability certification are out of scope.

## Design

- Narrow string union/validator, gateway allowlist and projection, shared delegated capture/projection and explicit direct capability rejection.
- Fresh [official OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-03, defines seven strings plus null and no default. The installed SDK maps reasoningEffort to reasoning_effort with the same seven values. Parameter overview omits max from its list; source/SDK and reasoning guide include it. Do not silently narrow the authoritative enum.
- Structured reasoning.effort conflicts need no precedence rule while the entire structured reasoning field is rejected. Pending verbosity stays independent at gateway level; upstream documented behavior applies.
- Repository grill-with-docs read-only fact audit confirms these contracts. No new domain decision/ADR, no pending dependency. Source-drift selection remains separate release work.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/client-reasoning-effort.md).

## TDD plan

- First public request should fail red with 400 instead of 200.
- Cover all seven values/null/omission, malformed early rejection, direct unsupported destinations, immutable capture, combined sampling/tool history, both delegated modes, actual OpenAI/OpenRouter SDK sockets, IAM/Deny/limits and required audit/ledger failures.
- Minimum typed validation/projection, focused cases and npm run check.

## Delivery

- PR records red/green and validation; CI and approval required.
- No migration; rollback removes optional field. Native/provider capability, structured reasoning/history/response and source drift gates remain explicit. No complete compatibility claim.

## Verification evidence

- Red: both public modes returned 400 instead of 200 and native capture assertions observed omitted effort.
- Green: 16 focused tests pass, covering exact enum/null/omission, early invalid/direct rejection, single captures, tool/sampling history, security/accounting gates and actual SDK sockets. Both SDKs forward all seven streaming values; unknown runtime SDK strings fail safely at the gateway.
- npm run check passes 1,063 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- Fresh official source confirms max and no injected default. Source-drift selection remains separate work. Integrate alongside pending verbosity/sampling/response fields without widening the supported reasoning surface.

Merge preparation preserves the earlier verbosity capability guards and both independent immutable field captures/projections. A combined public HTTP regression covers both chat bases and delegated stream/nonstream modes with distinct verbosity/reasoning-effort values, one accounted attempt and no operational field retention. Full checks and required CI rerun on the actual rebased head.
