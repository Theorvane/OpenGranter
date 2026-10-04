# Delegated public function stream activation

## Issue and problem

- Issue: #360; release gate #116 remains open. Existing internal function
  stream stages require the next bounded integration boundary.

## Scope and expected behavior

- Both chat bases accept validated function declarations, choice, parallel controls and complete histories when a trusted function-stream invoker is installed. Text-only installations retain early tool rejection; managed direct streaming stays unsupported.
- Select the function coordinator for supplied tool controls/history, or for function-only installations; ordinary text requests retain the text path when installed.
- Persisted dual-route composition installs the function adapter using server credentials and verified mappings. Authentication, model/provider IAM including Deny, limits and required audit/usage precede or gate delivery as before.
- Safe errors, bounded flow control, cancellation, unknown usage and content-free operational records stay shared. Earlier internal-stage gate descriptions are superseded by this delegated activation; external SDK workflows and complete compatibility remain subsequent work.

## Design

- Compose existing validated boundaries through a separate internal entry point.
- Preserve text-only installation and managed-stream guards, fixed destinations
  and immutable capture.
- No new domain terms, costly decisions or schema pin changes. Further external-tool conformance
  and transitive schema drift remain subsequent work.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.

## TDD plan

- Add HTTP behavior tests first: valid function requests return 400 instead
  of the expected 200 before activation.
- Cover success, denial, malformed data and sanitized failures; preserve existing
  text coverage. Make the minimum implementation and run focused tests.
- Run format and full npm run check before review.

## Delivery

- Issue and plan before code; record red/green evidence in PR. Exact-head review
  by sjungwon03-ai and both CI checks precede sjungwon03 squash merge.
- Function fragments are response content, never operational audit/usage data.
- Missing usage remains unknown; do not claim complete #116 compatibility.

## Integration evidence

- Public and persisted focused suite: 44 passes before the additional ordinary
  stream adapter-selection regression. Full checks also cover this regression.
- Both bases complete function request and tool-result rounds using stored IAM,
  verified provider-only routes, server secrets and content-free audit/usage.
- Text-only tool rejection, managed streams, malformed histories/controls,
  authentication, explicit Deny, limits and persistence failures are covered.
- Trusted runtime wiring overrides a supplied function invoker; no fallback to
  the text or direct route occurs after a function-stream failure.

## Verification evidence

- HTTP regression red before implementation: valid tool streams returned 400
  instead of 200, and denial/persistence scenarios could not reach their gates.
- Focused tests green; full npm run check passes strict types, lint, 1629
  tests with one existing PostgreSQL skip, planning/contracts and offline schema.
- Text-only installation and managed-stream guards persist; #116 remains open.
