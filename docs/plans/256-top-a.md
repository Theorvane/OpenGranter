# Support delegated top-a sampling

## Issue and problem

- Issue: [#256](https://github.com/Theorvane/OpenGranter/issues/256), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Compatible HTTP paths reject the optional official top_a sampling control, and delegated request preparation omits it.

## Scope and expected behavior

- Optional nullable finite number in inclusive 0..1. Preserve supplied zero/fractions/one; null/omission preserves upstream defaults. Invalid HTTP inputs reject before route lookup.
- Delegated OpenRouter forwards exact captured top_a for nonstream and existing text-stream requests. Registered direct OpenAI/Anthropic/Gemini adapters reject non-null controls before credentials/transport; null/omission stays unchanged.
- Preserve approved model/final-provider scope, IAM, limits, required audit/accounting and safe post-dispatch failures. No clamping, injected defaults, capability rerouting or universal model-support guarantee.

## Design

- Pure validator, optional typed request field, HTTP normalization, pre-secret delegated scalar capture/frozen request body and explicit direct pre-secret rejection.
- Sources checked 2026-10-02: [official parameters](https://openrouter.ai/docs/api_reference/parameters) defines 0..1; [official schema](https://openrouter.ai/openapi.json) permits optional number/null with double format; SDK maps topA to top_a. Repository-required read-only fact audit confirms native unsupported paths and obsolete rejection fixtures.
- Do not silently add top_a to native requests with no supported mapping. No new domain term or ADR.
- No pending PR dependency. The structural source pin remains a selected subset and does not yet select top_a; track that gap explicitly rather than claim full drift coverage.
- Update PRD, architecture, acceptance, compatibility and the dedicated client contract.

## TDD plan

- Public delegated HTTP regression first fails with 400 instead of passing/forwarding exact top_a.
- Cover boundaries/defaults, malformed/nonfinite native inputs, unsupported direct rejection, both actual SDKs/bases, immutable single-read/credential-await capture, delegated streaming shared preparation and native null defaults.
- Verify denial/limit and required ledger/audit failures, safe transport failure accounting and no content/secret disclosure. When integrated with #253, replace its now-obsolete valid-top_a rejection fixture with an unknown field and retain invalid min_p coverage. The current main fixture remains valid.
- Implement minimum changes, format and run focused tests plus npm run check.

## Delivery

- PR links plan, red/green and full validation; CI/approval before merge.
- Risks: individual upstream models may ignore/reject top_a. No provider capability promise or complete compatibility claim. Rollback removes optional request field/projection; no data migration.

## Verification evidence

- Red: node --experimental-strip-types --test --test-name-pattern='delegated top_a passes both' test/client-top-a.test.ts failed with 400 instead of 200 before implementation.
- Green: 24 focused client/official-SDK tests pass, including 12 new top-a tests across both bases, numeric boundaries/defaults, malformed and nonfinite values, pre-secret direct rejection, single-read/credential-await capture, shared streaming preparation and denial/required accounting failures.
- npm run check passes 1,059 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline schema integrity.
- No dependency on pending min_p changes. Their valid-top_a rejection fixture must be replaced when integrating the two PRs; retain all invalid min_p cases.
- Source pin does not select top_a. Source drift coverage and model capability certification remain explicit follow-ups.

## Merge integration validation

Retain min_p, verbosity and reasoning_effort when integrating top_a. Add a combined public HTTP and credential-await snapshot regression across both bases/modes before production resolution; record red, retain independent controls and verify green. Update any earlier unsupported-field fixture only when its formerly unsupported field becomes valid, preserving malformed-control and unrelated-field rejection coverage.

Red on prior production: combined min_p/top_a/verbosity/effort request returned 400 instead of 200. After integrating top_a, the prior unsupported-field scenario correctly changed to 200 and exposed its stale top_a:0.1 fixture; replace it with unrelated_field:0.1 and add top_a:-0.1 while retaining invalid min_p. Green: all 56 focused min_p/top_a/reasoning-effort/gateway cases pass, including both bases/modes and immutable independent captures. Full validation and required CI are reported in the PR.
