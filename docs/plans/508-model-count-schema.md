# Pin official model count schema drift

## Issue and problem

- Issue: [#508](https://github.com/Theorvane/OpenGranter/issues/508), part of #116.
- Count runtime/SDK/audit support is merged through PR #507, but the three existing official structural pins omit /models/count. Compatibility checks cannot detect count-specific request or envelope drift.

## Scope and expected behavior

- Add a separate version1 pin for GET /models/count operation identity, complete output_modalities parameter, HTTP200 application/json schema and complete selected ModelsCountResponse definition.
- Preserve required/type/null/reference/default/bounds/serialization/vendor extensions; ignore editorial annotations with the existing structural normalizer. Preserve annotation-named literal/default/enum/property data. Do not manufacture runtime text defaults, modality vocabulary, IAM rules or nonnegative/safe-integer restrictions in the official shape.
- Validate all four pins before an optional single fixed-host bounded credential-free download. Compute all comparisons before printing results. Report valid count drift separately; malformed pins/source/transport failure exposes only the existing safe diagnostic and never writes pins.
- Existing three pins remain byte-identical. No runtime API, authentication, authorization, metadata, audit, migration or provider behavior changes.

## Design

- Follow the existing query/response projector pattern in a separate count module and pin: exact envelope/parameter/definition maps, strict version/date/digests/source URL and selected identities, normalized canonical structural capture.
- Select inline operation parameters only, rejecting missing/duplicate supported names, malformed/reference/content-based parameters and selected-name inherited parameters. Unrelated inherited references are outside selection. Select the response reference and one complete component definition without following remote/new references automatically.
- Reuse the existing bounded structural normalizer and fetcher. Extend the CLI with a fourth independent result and reuse the controlled-download harness for drift, atomic failure, no-write and one-download assertions.
- Fresh official OpenAPI is retrieved from its fixed HTTPS host on 2026-10-18 and hashed canonically. Update PRD, architecture, acceptance, compatibility, [count contract](../../contracts/model-count.md) and [schema contract](../../contracts/model-count-schema.md). No glossary/ADR decision is required for this reversible harness extension.

## TDD plan

- First require the fourth offline result and count projection/validation/comparison in independent source tests. Record missing result/module failures before implementation.
- Test query/operation/envelope/nested integer/required/nullable/default/bounds/reference/extension drift, editorial independence, missing/duplicate/malformed/inherited inputs, provenance and rehashed exact-map guards with safe errors.
- Controlled CLI cases cover count-only and simultaneous drift, invalid count pin before fetch, invalid count source after one fetch, safe transport failure, fixed host/credentials/redirect options and all pin bytes unchanged.
- Implement the minimal module/pin/CLI change, format, run focused guard and runtime regressions, then plain npm run check. Do not refresh unrelated pins to conceal drift.

## Delivery

- Issue branch from current main, English plan-linked ready PR, red/green/full-check evidence and authorized contributor/DCO identity. Require CI and current-head approval before merge.
- Limits: structural comparisons do not validate runtime instances or live provider capabilities, prove source authenticity offline, certify policy/default semantics, traverse unselected reference targets or cover other status/media/header/endpoints. Full #116 and unresolved #7 remain open.
- A real live check found pre-existing request/model-response drift while model-query and count matched. The exact additions/removals are tracked in [#509](https://github.com/Theorvane/OpenGranter/issues/509). Preserve all three existing pins in this change; do not report the whole live command as passing or refresh those pins without a separate reviewed plan.

## Verification evidence

- Red before implementation: the independent count-schema suite failed because its projector module did not exist. The offline CLI test separately failed because the fourth integrity line was missing.
- Green: all 58 count-schema/controlled-CLI cases pass. Expanded query/response/count runtime and audit regressions pass all 219 tests. Controlled CLI cases preserve every pin byte and verify prefetch validation, one fixed credential-free download, independent count/simultaneous drift and atomic private failures.
- Fresh official source projection matches the count pin. The actual live CLI reports query/count unchanged and request/model-response drift with overall exit1; #509 records the exact changes. Existing three pin files remain byte-identical.
- Initial full check reached a 15-second timeout in an existing SSO shutdown test (one cancellation, no failed assertions). Its unchanged isolated suite passed all five tests; a clean complete retry passes strict types, lint, 6,807 tests (one optional external PostgreSQL test skipped, zero failures/cancellations), planning/link/contract/fixture-secret checks and all four offline pin integrity checks. Global warning overrides were unset. No test timeout/assertion or runtime code was weakened.
- Require CI and review of the published head before merge. The live drift in #509 is a remaining release gate, distinct from this count-guard implementation.
