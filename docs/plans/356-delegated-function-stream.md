# Internal delegated function stream accounting composition

## Issue and problem

- Issue: #356; release gate #116 remains open. Existing internal function
  stream stages require the next bounded integration boundary.

## Scope and expected behavior

- Compose internal function delivery with approved model and final-provider IAM, explicit Deny, limits, required selection audit, usage handoff and attempt audit.
- Deliver awaited function frames with frozen identity-only metadata; project the completed result to accounting-only fields without reading or retaining toolCalls.
- Return final usage and DONE only after required persistence succeeds. Missing usage stays unknown; dispatched, cancellation and output failures remain sanitized and possibly billed, without retry.
- Public HTTP function streams remain disabled; no function execution or new permission authority is introduced.

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

## Integration coverage

- The scoped real adapter feeds function SSE through the coordinator with exact
  approved provider-only transport. Tests cover complete usage and cancellation.
- Explicit Deny, absent invoker, limit denial and failed selection audit prevent
  upstream calls. Output/malformed-fragment failures record safe billed failures.
- Usage/success-audit persistence failures produce no final success frames;
  awaited output delays accounting. Missing usage remains unknown.
- A throwing assembled-call getter is never read by the summary projection; frame
  callback metadata is frozen identity-only and operational records omit content.

## Verification evidence

- Public entry-point regression red before implementation (missing module/export).
- Focused tests green; full npm run check passes strict types, lint, 1616
  tests with one existing PostgreSQL skip, planning/contracts and offline schema.
- Preserve existing public/text guards; full #116 remains open.
