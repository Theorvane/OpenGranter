# Scalar reasoning-only non-streaming completions

## Issue and problem

- Issue: #294; release gate #116 remains open.
- Direct OpenAI/delegated OpenRouter responses with nonempty scalar reasoning
  and missing/null content currently fail despite the SDK's optional nullable
  assistant content schema.

## Scope and expected behavior

- Accept only stop/length completions with nonempty scalar reasoning and
  missing/null content; normalize missing content to null and preserve reasoning.
- Empty/null/malformed reasoning, malformed content, detail-only responses and
  incompatible tool/finish semantics do not gain a success path.
- Both bases keep authentication, model/provider IAM, limits, audit, required
  persistence and one per-attempt usage record. Missing usage remains unknown.
- Native thinking adapters, request/history controls and full conformance remain
  outside this issue. No new domain terms or costly irreversible decisions.

## Design

- Extend only the shared assistant response content guard using captured scalar
  reasoning and supported finish reason; do not interpret opaque detail payloads.
- Preserve existing filtered/refusal/tool responses and reject malformed fields.
- Update acceptance, compatibility inventory and scalar reasoning contract.
- Source: installed @openrouter/sdk ChatAssistantMessage schema and
  https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- Open dependencies: broader #116 gates and native adapter decisions remain open.

## TDD plan

- First add public HTTP cases for missing/null content, stop/length, both route
  kinds and prefixes; expect 502 instead of 200 before implementation.
- Cover empty/null/non-string reasoning, invalid content and finish semantics,
  authentication/IAM/limits, persistence failure, privacy and missing usage.
- Extend actual OpenRouter SDK socket cases to reasoning-only output.
- Run focused tests, then npm run check; record red/green evidence in the PR.

## Delivery

- Plan and tests first, minimal normalizer change, focused/full checks, review
  as sjungwon03-ai and merge as sjungwon03 after required CI.
- Risk: treating absent visible output as success; bounded nonempty scalar and
  stop/length guard prevent empty outputs and detail metadata granting success.
- Rollback: revert this bounded content guard and its contract change.

## Verification evidence

- Initial public HTTP/SDK red: 9 passed, 6 failed (expected 502 instead of
  reasoning-only success and failed accounting instead of accepted completion).
- Review regression red: inherited scalar reasoning granted success without
  projection; 0 passed, 1 failed. Require an own reasoning field in the guard.
- Focused reasoning/detail regression green: 32 passed, no failures.
- Full validation: npm run check; final results are recorded in the PR.
- SDK schema accepts missing/null content independently of stop/length and
  reasoning. The narrower nonempty scalar allowance is a gateway subset;
  the official guide documents empty length-terminated content without
  prescribing null/omission or reasoning-only stop behavior.
