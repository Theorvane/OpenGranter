# Support delegated repetition-penalty sampling

## Issue and problem

- Issue: [#260](https://github.com/Theorvane/OpenGranter/issues/260), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Compatible HTTP paths reject the optional official repetition_penalty sampling control, and delegated request preparation omits it.

## Scope and expected behavior

- Optional nullable finite number in inclusive 0..2. Preserve supplied zero/fractions/one/two; null/omission preserves upstream defaults. Invalid HTTP inputs reject before route lookup.
- Delegated OpenRouter forwards exact captured repetition_penalty for nonstream and existing text-stream requests. Registered direct OpenAI/Anthropic/Gemini adapters reject non-null controls before credentials/transport; null/omission stays unchanged.
- Preserve approved model/final-provider scope, IAM, limits, required audit/accounting and safe post-dispatch failures. No clamping, injected defaults, capability rerouting or universal model-support guarantee.

## Design

- Pure validator, optional typed request field, HTTP normalization, pre-secret delegated scalar capture/frozen request body and explicit direct pre-secret rejection.
- Sources checked 2026-10-03: [official parameters](https://openrouter.ai/docs/api_reference/parameters) defines 0..2; [official schema](https://openrouter.ai/openapi.json) permits optional number/null with double format; SDK maps repetitionPenalty to repetition_penalty. Repository-required read-only fact audit confirms native unsupported paths and unchanged rejection fixtures.
- Do not silently add repetition_penalty to native requests with no supported mapping. No new domain term or ADR.
- No pending PR dependency. The structural source pin remains a selected subset and does not yet select repetition_penalty; track that gap explicitly rather than claim full drift coverage.
- Update PRD, architecture, acceptance, compatibility and the dedicated client contract.

## TDD plan

- Public delegated HTTP regression first fails with 400 instead of passing/forwarding exact repetition_penalty.
- Cover boundaries/defaults, malformed/nonfinite native inputs, unsupported direct rejection, both actual SDKs/bases, immutable single-read/credential-await capture, delegated streaming shared preparation and native null defaults.
- Verify denial/limit and required ledger/audit failures, safe transport failure accounting and no content/secret disclosure. Existing unsupported-field fixtures remain valid.
- Implement minimum changes, format and run focused tests plus npm run check.

## Delivery

- PR links plan, red/green and full validation; CI/approval before merge.
- Risks: individual upstream models may ignore/reject repetition_penalty. No provider capability promise or complete compatibility claim. Rollback removes optional request field/projection; no data migration.

## Verification evidence

- Red: node --experimental-strip-types --test --test-name-pattern='delegated repetition_penalty passes both' test/client-repetition-penalty.test.ts failed with 400 instead of 200 for 1.25 before implementation.
- Green: 24 focused client/official-SDK tests pass, including 12 new cases for both bases, 0/1/2 boundaries, defaults, malformed/nonfinite inputs, pre-secret native rejection, single-read/credential-await capture, SDK stream preparation and denial/required accounting failures.
- npm run check passes 1,059 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline schema integrity.
- No pending dependency or obsolete repetition fixture. Source selection and model capability validation remain separate follow-ups; no default value is injected.

## Merge integration validation

Preserve independently captured min_p, top_a, verbosity and reasoning_effort when integrating repetition_penalty. Add a public combined-control regression across both bases/modes and credential-await mutation before production resolution, record meaningful red, then retain the minimal new control and verify focused/full green.

Red on prior production: combined sampling/verbosity/effort HTTP regression returned 400 instead of 200 (0 passed, 1 failed). Green after minimal repetition_penalty integration: all 50 focused min_p/top_a/repetition/effort cases pass, including both HTTP bases, both modes and independent snapshots surviving credential-await mutation. Full validation and required CI are reported in the PR.
