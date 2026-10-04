# Internal function stream client SSE projection

## Issue and problem

- Issue: #354; release gate #116 remains open. Existing internal function
  stream stages require the next bounded integration boundary.

## Scope and expected behavior

- A separate encoder preserves bounded indexed function fragments and tool_calls finish reasons using safe JSON framing. Partial arguments stay literal response content with no parsing or execution.
- Function fragments are forbidden on usage events and in the text encoder; malformed values fail with fixed errors. Missing usage emits no fabricated counts.
- Existing metadata, text, reasoning, usage and DONE projection stays shared; the public HTTP function-stream gate remains closed.

## Design

- Compose existing validated boundaries through a separate internal entry point.
- Preserve text and public HTTP guards, fixed destinations and immutable capture.
- No new domain terms, costly decisions or schema pin changes. Public HTTP tool
  stream activation and transitive schema drift remain subsequent work.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.

## TDD plan

- Add public behavior tests first; missing entry point is the expected red.
- Cover success, denial, malformed data and sanitized failures; preserve existing
  text coverage. Make the minimum implementation and run focused tests.
- Run format and full npm run check before review.

## Delivery

- Issue and plan before code; record red/green evidence in PR. Exact-head review
  by sjungwon03-ai and both CI checks precede sjungwon03 squash merge.
- Function fragments are response content, never operational audit/usage data.
- Missing usage remains unknown; do not claim complete #116 compatibility.

## Review refinement

- Sharing fragment validation with the public encoder requires single capture of
  fixed entries/scalars and a validated captured length. A local Proxy length
  regression first failed with a missing expected exception; integer/range
  validation fixes it. JSON cannot carry accessors/Proxies; no HTTP exploit is
  claimed. Exact-key, optional nonnullable fields and the 128-call subset persist.

## Verification evidence

- Public entry-point regression red before implementation (missing module/export).
- Focused tests green; full npm run check passes strict types, lint, 1601
  tests with one existing PostgreSQL skip, planning/contracts and offline schema.
- Preserve existing public/text guards; full #116 remains open.
