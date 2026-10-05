# Bounded service-tier request plan

## Issue and problem

- Issue #454; release gate #116 remains open. Request service_tier is rejected even though served-tier response metadata is supported.
- Current OpenRouter tier selection admits separate tier endpoint slugs under base-provider matching. The existing final-provider mapping does not certify that expanded authorization scope. Native APIs have distinct tier contracts.

## Scope and expected behavior

- Both chat bases and supported nonstream/text/refusal/function streams accept nullable service_tier. Omission/null omit the upstream field and inject no default.
- Managed OpenAI forwards exact auto/default/flex/scale/priority/fast literals. Delegated OpenRouter forwards explicit default only. Other known delegated values reject before credentials; managed OpenAI ultrafast and Anthropic/Gemini supplied values reject before credentials. Unknown strings/types reject before routes or secrets.
- Capture a primitive once before routing/credential awaits. Do not trim, rewrite fast to priority, infer model capability, or echo a requested tier as a served tier.
- Fixed model/hosts/provider.only and final-provider IAM, Deny, limits, required audit/usage, private diagnostics, missing usage and possibly-billed failure/cancellation remain shared. Selection does not establish billed cost or change ledger keys/pricing sources.

## Design

- Shared seven-literal nullable snapshot at HTTP and adapter boundaries; provider-specific conservative admission before credentials. Direct OpenAI and delegated prepared bodies carry the captured field.
- Rejecting all values leaves a useful native contract gap. Forwarding all delegated values silently expands tier endpoint eligibility; reject that alternative until endpoint-scope authorization is designed. Existing trusted tier-suffixed slugs retain prior meaning; no default-versus-explicit-slug precedence or universal tier suppression is claimed.
- Native Anthropic auto/standard_only and Gemini serviceTier enums require separate reviewed mappings; no mapping is settled here. Tier eligibility, prices and guarantees remain upstream/model dependent. This reversible adapter subset adds no domain term or costly decision requiring an ADR.
- Add service_tier to the raw official schema projection: version 30, 34 fields, unchanged definitions. Preserve enum, nullable type and x-speakeasy-unknown-values extension; runtime rejects unrecognized values as a local subset. Removing the selection must reproduce version 29.
- Update PRD, architecture, acceptance, compatibility checkpoint and [contract](../../contracts/service-tier-requests.md). Sources: [OpenRouter schema](https://openrouter.ai/openapi.json), [tier routing](https://openrouter.ai/docs/guides/features/service-tiers), [provider matching](https://openrouter.ai/docs/guides/routing/provider-selection), [OpenAI Chat](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## TDD plan

- Public HTTP/adapter and actual SDK tests first expect forwarded supported literals and null omission; old HTTP returns 400 and adapters omit the field. Unsupported adapter fields currently pass silently. Record red failures before production edits.
- Both bases, kinds, modes/streams; malformed/unknown/boxed values; unsupported delegated/native values; getter captured once, throwing getter and credential-time mutation; auth/implicit/model/provider Deny, limits, selection/audit/usage failures; body bound, missing usage, opened failure and cancellation.
- Verify served-tier omission and differing upstream served tier independently from the request. Do not invent prices or counters.
- Schema selection/enum/type/nullability/unknown-extension/required/default drift; editorial invariance; missing/malformed/stale/rehashed maps and removal equality. Actual installed OpenAI 7.23.0/OpenRouter 1.4.18 sockets cover supported forwarding and pre-secret denial.
- Smallest implementation: shared snapshot, HTTP capture, prepared adapter fields/admission, exact pin/version selection. Format, focused tests, strict typing, npm run check and fresh compatibility:drift.

## Delivery

- Issue/new branch/plan, red tests, minimal implementation, full checks, exact published diff review, two green required CI jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risks: native tiers can alter upstream cost/latency; requested and served values differ. Captured mock-upstream SDK tests cannot certify live eligibility/prices. Roll back admission without migrations. Full delegated tier selection, native equivalents, compatibility #116 and unresolved #7 remain open.
- PR includes plan/contract, red/green/socket results, source/removal digests, full validation and material limits.

## Verification evidence

Requests now support a bounded nullable service_tier subset on both chat bases and supported nonstream/text/refusal/function streams. Managed OpenAI forwards exact auto/default/flex/scale/priority/fast values; delegated OpenRouter forwards explicit default only. Null/omission omit the field. Unknown values reject before route resolution; unsupported provider values reject before credentials. Preparation captures the primitive once, preserving literal fast rather than rewriting aliases.

OpenRouter's current official tier routing admits distinct tier endpoint slugs under base-provider matching, so forwarding priority/flex/ultrafast would expand an unreviewed endpoint pool. Other delegated values remain denied pending endpoint-scope authorization. Native Anthropic/Gemini mappings and OpenAI Chat ultrafast are excluded. Fixed hosts/models/provider.only, fresh IAM/Deny/limits and required audit/usage remain shared. Requested tiers never manufacture served-tier metadata, usage or billed prices; upstream omission and a differing served tier remain authoritative.

Red evidence: 70 initial public runtime/adapter tests produced 69 expected failures and one pass. The 32 initial SDK socket tests produced 24 expected failures and eight existing gateway-rejection passes. Twelve new schema cases produced ten expected failures and two existing invariant passes. Green evidence: all 70 runtime tests, 32 installed SDK socket tests (120 successful plus 16 denied SDK requests) and 340 focused runtime/schema tests pass. The obsolete response-only rejection fixture now covers an unrecognized tier instead of rejecting newly supported native auto; its isolated regression passes. Success, authentication/Deny/limits, persistence failures, Unicode-independent exact literals, safe getter/mutation, missing usage, opened failure and cancellation paths are covered.

Version 30 adds only service_tier to 34 fields with the same 22 request/history definitions. Preserve the raw nullable enum and x-speakeasy-unknown-values extension while documenting narrower runtime admission. Removing the selection reproduces version-29 projection SHA-256 b7c53ad02fc7fd222e659c3ea6ae76367f39c985a3cf4c063875c686629da71f. Source SHA-256: 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; new projection SHA-256: eb64c90de18df1e11f194f05293bcec6bf60c07f35ded16abdd1b632797a6705. Fresh compatibility:drift passes; the compatibility checkpoint reflects the current pin.

Material limits: installed OpenAI 7.23.0/OpenRouter 1.4.18 socket coverage uses captured mock upstreams. No live model eligibility, latency, SLA, cost or tier guarantees are certified. Default-versus-trusted-tier-slug precedence remains unverified. Expanded delegated tier authorization, native mappings, detailed billed-cost reconciliation, full release gate #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 5028 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
