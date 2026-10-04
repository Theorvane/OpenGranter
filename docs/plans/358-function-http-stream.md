# Controlled function HTTP stream responses

## Issue and problem

- Issue: #358; release gate #116 remains open. Existing internal function
  stream stages require the next bounded integration boundary.

## Scope and expected behavior

- A separate function HTTP response entry point uses the existing awaited bounded body handoff, cancellation and safe JSON or SSE error envelopes.
- Function fragments are delivered as response content with identity-only error metadata; failure after delivery records a content-free stream interruption without replay.
- Required usage/audit persistence precedes final usage and DONE. IAM/limit denial emits safe JSON before frames. Public request activation remains subsequent work.

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

## Shared controller design

- Keep separate text/function entry points and inject their typed coordinator
  into one private HTTP handoff. Reuse cancellation, bounded demand, safe errors,
  usage completion tracking and interruption audit without response buffering.
- Focused text/function HTTP suite: 37 passes including existing socket SDK cases.

## Verification evidence

- Public entry-point regression red before implementation (missing module/export).
- Focused tests green; full npm run check passes strict types, lint, 1621
  tests with one existing PostgreSQL skip, planning/contracts and offline schema.
- Preserve existing public/text guards; full #116 remains open.
