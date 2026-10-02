# Omit incomplete compatible completion usage

## Issue and problem

- Issue: [#246](https://github.com/Theorvane/OpenGranter/issues/246), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Partial/invalid normalized usage makes the pinned official SDK reject an otherwise successful nonstream completion: ChatUsage requires three integer counters, while ChatResult permits usage omission.

## Scope and expected behavior

- On /api/v1 normalized chat.completion success only, omit usage unless prompt_tokens, completion_tokens and total_tokens are all safe nonnegative integers. Preserve complete values, including zero, without inferring or fabricating missing counts.
- Apply after required ledger/outcome audit persistence. Retain native output, /v1 partial reporting and internal missing/partial/invalid statuses. Preserve fingerprint projection, opaque generic responses and streaming behavior.
- No IAM, limits, secrets, usage estimation/billing or supported provider/model scope changes.

## Design

- Extend the existing shared client completion projection with a cloned object only when fingerprint/usage needs adjustment. Never mutate the provider response or accounting input.
- Official [schema](https://openrouter.ai/openapi.json), checked 2026-10-02, and pinned SDK 1.4.18 require all three counters when usage is present. Repository-required read-only fact audit confirms both route kinds project only after accounting.
- Alternative: fabricated counters obscure unknown usage; rejecting the completion loses successful text unnecessarily. Optional usage omission follows the schema and existing streaming incomplete-usage policy.
- No new domain terms, ADR or unresolved product decision. No dependency on pending schema/metadata/reasoning PRs.
- Update PRD, architecture, acceptance, compatibility and the dedicated contract; broader detailed usage projection remains open.

## TDD plan

- First public SDK socket regression receives prompt-only usage through the real delegated adapter and fails with ResponseValidationError before projection changes.
- Cover complete/zero, partial, absent and malformed usage for direct OpenAI/delegated OpenRouter; native Anthropic/Gemini normalization; immutable/opaque projection; authentication/IAM/model-provider Deny/limits and required ledger/outcome audit failure paths.
- Assert internal statuses/counters remain independent of client omission, metadata contains no content/secrets, and legacy /v1 remains unchanged.
- Add the smallest projection change, then format, focused tests and npm run check.

## Delivery

- Link this plan and red/green evidence in the issue PR. Require CI and approval before merge.
- Risk: clients cannot read partial counters on /api/v1, but the protected usage history retains their reported state. This does not claim complete usage or client conformance. Rollback is the shared boundary projection change.

## Verification evidence

- Red: actual delegated SDK socket regression failed with ResponseValidationError on prompt-only usage before production changes.
- Green: all 10 focused public-boundary tests pass, covering direct/delegated complete/zero/sparse/invalid usage, native sparse usage, immutable/opaque projection, denials and required ledger/outcome-audit failures.
- npm run check passes 1,057 tests with one existing skip, strict types/lint, planning/link/contract/fixture checks and offline source-pin integrity. This branch starts from merged main and excludes pending schema/reasoning/catalog PRs.
- No runtime/provider/schema pin dependency. Existing incomplete streaming usage remains separate from this nonstream fix.
