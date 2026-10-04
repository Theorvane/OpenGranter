# Internal scoped function stream invoker

## Issue and problem

- Issue: #352; release gate #116 remains open. Existing internal function
  stream stages require the next bounded integration boundary.

## Scope and expected behavior

- A separate function invoker accepts validated function declarations, choice,
  parallel controls and complete history, captured before credential awaits.
- Fixed approved upstream model/provider slugs, server-only secrets, cancellation
  and timeout handling compose the existing function HTTP response boundary.
- Invalid requests reject pre-secret; dispatched failures remain safely possibly
  billed with no retry. Existing text controls and public HTTP guards stay closed.

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

## Verification evidence

- Public entry-point regression red before implementation (missing module/export).
- Focused tests green; full npm run check passes strict types, lint, 1595
  tests with one existing PostgreSQL skip, planning/contracts and offline schema.
- Preserve existing public/text guards; full #116 remains open.
