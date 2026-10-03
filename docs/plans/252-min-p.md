# Support delegated min-p sampling

## Issue and problem

- Issue: [#252](https://github.com/Theorvane/OpenGranter/issues/252), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Compatible HTTP paths reject the optional official min_p sampling control, and delegated request preparation omits it.

## Scope and expected behavior

- Optional nullable finite number in inclusive 0..1. Preserve supplied zero/fractions/one; null/omission preserves upstream defaults. Invalid HTTP inputs reject before route lookup.
- Delegated OpenRouter forwards exact captured min_p for nonstream and existing text-stream requests. Registered direct OpenAI/Anthropic/Gemini adapters reject non-null controls before credentials/transport; null/omission stays unchanged.
- Preserve approved model/final-provider scope, IAM, limits, required audit/accounting and safe post-dispatch failures. No clamping, injected defaults, capability rerouting or universal model-support guarantee.

## Design

- Pure validator, optional typed request field, HTTP normalization, pre-secret delegated scalar capture/frozen request body and explicit direct pre-secret rejection.
- Sources checked 2026-10-02: [official parameters](https://openrouter.ai/docs/api_reference/parameters) defines 0..1; [official schema](https://openrouter.ai/openapi.json) permits optional number/null with double format; SDK maps minP to min_p. Repository-required read-only fact audit confirms native unsupported paths and obsolete rejection fixtures.
- Do not silently add min_p to native requests with no supported mapping. No new domain term or ADR.
- No pending PR dependency. The structural source pin remains a selected subset and does not yet select min_p; track that gap explicitly rather than claim full drift coverage.
- Update PRD, architecture, acceptance, compatibility and the dedicated client contract.

## TDD plan

- Public delegated HTTP regression first fails with 400 instead of passing/forwarding exact min_p.
- Cover boundaries/defaults, malformed/nonfinite native inputs, unsupported direct rejection, both actual SDKs/bases, immutable single-read/credential-await capture, delegated streaming shared preparation and native null defaults.
- Verify denial/limit and required ledger/audit failures, safe transport failure accounting and no content/secret disclosure. Update obsolete valid-min_p rejection with unknown top_a and invalid min_p cases.
- Implement minimum changes, format and run focused tests plus npm run check.

## Delivery

- PR links plan, red/green and full validation; CI/approval before merge.
- Risks: individual upstream models may ignore/reject min_p. No provider capability promise or complete compatibility claim. Rollback removes optional request field/projection; no data migration.

## Verification evidence

- Red: delegated public HTTP regression failed with 400 instead of 200 for valid min_p before implementation.
- Green: 24 focused client/official-SDK tests pass, including 12 new min-p tests across both bases, boundaries/defaults, pre-secret native rejection, malformed/nonfinite values, single-read/credential-await capture, shared streamed preparation and denial/required accounting failures.
- npm run check passes 1,059 tests with one existing skip, strict types/lint, planning/link/contract/fixture checks and offline schema integrity.
- Replaced the obsolete valid-min_p rejection fixture with genuinely unsupported top_a and out-of-range min_p; other malformed-input scenarios remain.
- Current source projection does not select min_p. Explicit structural drift coverage and model capability validation remain separate follow-up work, not certified by this runtime subset.

## Merge integration validation

Retain merged verbosity/reasoning-effort controls and all provider capability guards while integrating min_p. Before production resolution, add a public combined-control regression across both bases/modes and immutable credential-await snapshots. Run it against prior production code for meaningful red, then retain the minimal min_p changes and verify focused/full green.

Red on prior production: combined min_p/verbosity/reasoning-effort HTTP regression returned 400 instead of 200 (0 passed, 1 failed). Green after minimal min_p integration: all 28 focused min_p/reasoning-effort cases pass, including both bases/modes and immutable credential-await values. Prior native capability guards and original SDK cases remain intact; full validation and required CI are reported in the PR.
