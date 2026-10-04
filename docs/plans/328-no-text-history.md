# Delegated no-text assistant history

## Issue and problem

- Issue: #328. Supported no-text stop/length responses cannot be replayed without
  substantive reasoning under the current assistant history input guard.
- Previously retrieved official assistant request schema requires only role and
  pinned SDK preserves null/omitted content independently of reasoning. Fresh
  source retry timed out; no fresh full-source comparison is asserted.

## Scope and expected behavior

- Delegated OpenRouter accepts null/missing ordinary assistant history and empty
  tool-call lists on both bases; missing normalizes to null. Existing ordinary text
  streams accept ordinary histories; histories with tool fields remain nonstream.
- Preserve validated empty/scalar/detailed metadata, exact fields, immutable capture,
  assistant-only relaxation and complete pending tool-result groups.
- Direct providers reject null ordinary/empty-call assistant histories pre-secret;
  native empty history mapping remains outside this bounded compatibility slice.
- Keep authentication, full model/provider IAM/Deny, limits, required usage/audit
  delivery gates, safe failures, possible billing and operational privacy unchanged.
  History grants no authority; missing usage remains unknown.

## Design

- Relax the shared assistant-only content condition independently of substantive
  reasoning. Remove the empty-call content requirement, retaining field validation.
- Add an explicit direct guard for null assistant content without nonempty calls;
  existing direct OpenAI nonempty function groups remain supported.
- Exact SDK omission would change established normalized message shape; keep null.
  No new domain term or costly trade-off ADR. Native/rich/tool-stream decisions stay
  unresolved under #116. Update PRD, architecture, acceptance and contracts.

## TDD plan

- Public delegated null/missing history success fails 400 before implementation.
- Cover optional empty/metadata-only fields, empty calls, mutation snapshots,
  malformed/non-assistant/pending-result rejection, direct pre-secret rejection,
  auth/model/provider/explicit Deny, limits and required persistence failures.
- Actual pinned OpenRouter SDK sockets on both bases for ordinary nonstream/stream.
- Smallest shared relaxation/direct guard; replace obsolete payload expectations
  with exact accepted projection while retaining invalid fields and own capture.
- Run focused tests, format and full npm run check.

## Delivery

- Issue/plan, red, green, docs/full check, exact-head AI review, required CI,
  authorized human-account merge and clean main sync.
- Risk: widened history acceptance; direct guard and tool integrity bound scope.
  Rollback restores payload gate. Pin v18 unchanged; #116 remains open.

## Verification evidence

- Public red: 1 passed, 4 expected failures before implementation, including SDK
  rejection and the earlier HTTP content guard. Socket-enabled run confirmed red.
- HTTP normalization required the same assistant-only relaxation as shared parsing.
  Updated obsolete empty-payload history rejection expectations to exact valid
  projection; malformed fields, inherited detail exclusion and tool integrity remain.
- Focused history/function green: 36 passed. Supplemental missing-usage assertion
  initially addressed the wrong ledger level; corrected to usage.totalTokens null.
- Final npm run check passed type checking, linting, 1,493 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. Actual pinned
  SDK sockets cover both bases/modes; direct guards reject pre-secret at HTTP and
  adapter boundaries. Fresh full-source comparison is not asserted.
