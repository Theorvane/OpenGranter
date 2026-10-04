# Official SDK streamed function workflow conformance

## Issue and problem

- Issue: #362; release gate #116 remains open. Existing internal function
  stream stages require the next bounded integration boundary.

## Scope and expected behavior

- Installed OpenAI 7.23.0 and OpenRouter 1.4.18 clients are verified on real local sockets over both chat bases with interleaved indexed function fragments and a subsequent complete tool-result request.
- Re-evaluate authentication, model/provider IAM and limits on each request; verify Deny prevents the second call and secrets. Usage/audit persistence gates final success, missing usage stays unknown, safe failures do not replay, and SDK cancellation reaches the upstream read.
- Response arguments stay out of operational records. This test-only stage changes no production behavior, SDK versions or pin; broader external-tool certification, direct streaming and transitive schema drift remain open.

## Design

- Exercise the public handler, Node bridge and real scoped function adapter.
- Preserve installed SDK versions and production behavior.
- No new domain terms, costly decisions or schema pin changes. Further external-tool conformance
  and transitive schema drift remain subsequent work.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.

## TDD plan

- Test-only conformance: no production behavior changes, so a production
  regression red is not applicable. Exercise installed clients against actual
  sockets and deterministic upstream responses.
- Cover success, denial, malformed data and sanitized failures; preserve existing
  text coverage. Make the minimum implementation and run focused tests.
- Run format and full npm run check before review.

## Delivery

- Issue and plan before code; record red/green evidence in PR. Exact-head review
  by sjungwon03-ai and both CI checks precede sjungwon03 squash merge.
- Function fragments are response content, never operational audit/usage data.
- Missing usage remains unknown; do not claim complete #116 compatibility.

## Installed client error and cancellation behavior

OpenAI 7.23.0 may end iteration normally after explicit client abort; the gateway
still cancels the upstream read and records failed possibly-billed usage and an
interruption. OpenRouter 1.4.18 can yield a structured error chunk on /api/v1
after partial output, while its legacy /v1 parser rejects the legacy error
envelope. A yielded error must be treated as failure by consumers; the gateway
withholds final usage and DONE after required persistence or upstream failure.
Conformance verifies error signaling and server accounting, not identical SDK
exception behavior. No production or SDK version changes are made here.

## Verification evidence

- Test-only conformance; no production behavior changes or production red
  requirement. Installed SDK socket tests pass after adapting assertions to
  observed client error/abort signaling; no production changes were used.
- Focused tests green; full npm run check passes strict types, lint, 1653
  tests with one existing PostgreSQL skip, planning/contracts and offline schema.
- Validate the delegated public subset; full #116 remains open.

## Inventory review refinement

- Update the current compatibility matrix and checkpoint to distinguish supported
  delegated function streaming from remaining direct/server-tool/rich variants.
- Keep historical internal-stage records as staged evidence, and keep #116 open.
- This refinement is documentation-only after the recorded full test run; run
  the planning/contract checker and offline pin check before updating the PR.
