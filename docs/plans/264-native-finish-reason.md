# Preserve nonstream native finish reasons

## Issue and problem

- Issue: [#264](https://github.com/Theorvane/OpenGranter/issues/264), release gate #116.
- Response normalization drops the documented native_finish_reason choice field.

## Scope and expected behavior

- Preserve supplied optional string/null exactly for delegated OpenRouter and direct OpenAI-compatible nonstream choices on both HTTP bases. Missing stays absent; empty/Unicode values are valid.
- Canonical finish_reason keeps its existing validation and meaning. Malformed native metadata fails safely after dispatch with possibly-billed usage handling.
- Preserve IAM, limits, required accounting/audit and operational content secrecy. Metadata conveys no identity or policy authority.
- Streaming and native Anthropic/Gemini synthesis are out of scope.

## Design

- Extend the normalized choice; capture once and validate in the two compatible normalizers. Preserve only supplied values, including tool-call outcomes.
- The [official overview](https://openrouter.ai/docs/api_reference/overview), checked 2026-10-03, documents string/null raw reasons. Current official ChatChoice and pinned OpenRouter chat SDK omit this field. SDK stripping and source-schema absence remain explicit gaps; do not invent a source selection or claim chat SDK retention.
- Read-only fact audit confirms these differences and the public boundaries. No unresolved product decision, glossary change or ADR; no pending dependency.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/native-finish-reason.md).

## TDD plan

- First public HTTP regression should fail because a supplied reason is omitted.
- Cover absent/null/string, independent canonical reason, text/refusal/filter/tool outcomes, malformed safe 502/accounting, denial/limits and required ledger/audit failures; native adapters omit and actual OpenAI SDK retains the extra JSON field.
- Add minimum choice-level normalization and run focused tests plus npm run check.

## Delivery

- Include red/green, full checks and SDK/source limits in the PR. Require CI and approval.
- Rollback removes the optional choice field; no migration. No claim of complete response or streaming compatibility.

## Verification evidence

- Red: node --experimental-strip-types --test test/native-finish-reason.test.ts failed on both public provider paths because supplied null native reasons became undefined.
- Green: 16 focused tests pass across text/refusal/filter/tool outcomes, exact optional/null/empty/Unicode values, malformed safe accounting, denial/limit/required audit/ledger gates, immutable single capture, native omission and unchanged canonical rejection.
- Actual socket SDK tests confirm OpenAI raw JSON retention and the pinned OpenRouter chat SDK omission. This discrepancy is an explicit remaining gap.
- npm run check passes 1,063 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- No pending dependency; preserve metadata alongside other choice/response fields when integrating pending PRs. Streaming and full instance/source/SDK conformance remain open.

## Merge integration validation

Preserve nonstream tier, fingerprint and scalar reasoning while integrating native choice metadata. Extend the new issue fixture only with optional metadata defaults and add two public HTTP combined-metadata cases on both bases before resolving production conflicts. Record red on prior normalizers, retain canonical validation and independently captured scalars, then verify focused/full green.

Red on prior normalizers: both combined public metadata regressions failed because native_finish_reason was omitted (0 passed, 2 failed). Green after retaining independently captured native metadata with prior tier/fingerprint/scalar reasoning: all 60 focused native-finish/fingerprint/reasoning cases pass. All original sixteen native cases remain. Full final validation and required CI are reported in the PR.
