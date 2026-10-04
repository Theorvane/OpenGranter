# Capture content parts before normalization

## Issue and problem

- Issue: #334. Public normalization checks part.text then reads it again for
  concatenation, allowing an unvalidated coercible second value into output.
- Sole assistant parts also read index/type during refusal inspection and again
  during text iteration. Local getters reproduce all three repeated reads.
- HTTP JSON cannot contain accessors; this is a public helper correctness defect,
  without a claimed network exploit or credential disclosure.

## Scope and expected behavior

- Capture the fixed part sequence once before field validation, then capture each
  discriminator and supported payload once and normalize only validated values.
- Preserve exact order/empty/Unicode text and sole assistant refusal translation,
  dense arrays, exact keys, own refusal fields and existing inherited text behavior.
- Reject invalid first captures without retries/coercion; no arbitrary toString or
  primitive conversion of rejected payloads. Mutation cannot replace captured
  array positions or append later parts during validation.
- No new JSON shapes/provider mappings/typed adapter fields, policy/schema pin or
  domain semantics. Auth/full IAM/Deny/limits/persistence/privacy/accounting remain
  unchanged; richer/native/tool-stream/full #116 certification stays open.

## Design

- Snapshot fixed indexed array entries before reading any part discriminator.
  Iterate captured entries once; text uses one captured string for type checking
  and concatenation. Refusal uses one captured own payload with existing restrictions.
- Retrying getters or coercing values would bypass validation; reject first invalid
  capture. Preserve inherited text compatibility instead of silently narrowing it.
- Keep normalization internal to HTTP decoding and public helper; downstream
  immutable message snapshots and provider guards continue unchanged. No new ADR
  or glossary term; update acceptance/contracts and documentation of capture.

## TDD plan

- Public text getter first valid/second coercible must yield the original string
  with one read and no coercion; currently fails. Sole type/index getters and
  array position/length mutation must use first captured sequence/values.
- Invalid-first text/type/refusal remains rejected even if later values are valid;
  malformed/sparse/unknown/mixed/duplicate and inherited boundaries stay covered.
- Run existing HTTP normalization/security/provider/SDK suites for both bases and
  supported modes; add public helper-to-HTTP coverage for canonical payload and
  no operational content leakage. Run format and full npm run check.

## Delivery

- Issue/plan, meaningful regression red, smallest capture fix, focused/full checks,
  exact-head AI approval, required CI, human-account merge and clean main sync.
- Risk: capture timing changes for accessor-backed objects; first validated capture
  is intentional and deterministic. No JSON contract expansion; rollback restores
  prior implementation but would reopen repeated-read bug.

## Verification evidence

- Public regression red: 1 passed, 4 expected failures for payload coercion,
  sole index/type rereads, array replacement/append and invalid-first type retries.
- Focused normalizer/history/function/SDK green: 61 passed. Capture-to-HTTP test
  covers both bases/all four established text mappings and operational privacy.
- Strict type checking initially rejected closure access through mutable unknown
  content; use a stable readonly unknown array reference without weakening settings.
- Final npm run check passed strict types, linting, 1,512 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. Evidence-only
  plan update also passes the planning checker. No accepted JSON/schema expansion.
