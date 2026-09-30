# OpenRouter text-stream payload validation

## Issue and problem

- Issue: [#190](https://github.com/Theorvane/OpenGranter/issues/190).
- The SSE framing parser yields data strings, but there is no boundary that validates their OpenRouter chat semantics. A future streaming gateway must not forward malformed or unsupported provider chunks and must recognize post-commit errors and usage frames.

## Scope and expected behavior

- Decode one bounded SSE data payload as `[DONE]`, a supported text/terminal delta, OpenRouter's final usage chunk, or a safe upstream error marker.
- Require a previously selected upstream model and emit the authorized client alias in normalized chunks. Validate one choice at index zero, identity, timestamps, role/content fields and supported finish reasons. Reject tool/rich deltas until their mappings are designed.
- Preserve valid usage counters or the existing missing/invalid usage markers. Do not interpret sequence order in this slice.
- This pure decoder does not call upstream, emit HTTP SSE or enable `stream:true`; IAM, secrets, limits, audit and usage persistence are unchanged.

## Design

- Accept a data string plus expected upstream model and client alias. Return a closed tagged union with immutable normalized values. Handle a top-level error before ordinary chunk validation and never copy its details.
- Reuse existing provider usage normalization to preserve missing/invalid counter semantics. A usage frame must carry a terminal finish reason and content-free delta. The repeated finish reason will be checked against prior frames by a later stream coordinator.
- Treat malformed JSON, multiple choices, wrong model, unknown finish reasons and unsupported delta fields as fixed safe failures.
- Separating single-payload validation from sequence and transport control makes it reusable for delegated OpenRouter without implying end-to-end streaming support.
- See [stream chunk contract](../../contracts/openrouter-stream-chunks.md), [compatibility inventory](../openrouter-compatibility.md) and [acceptance](../acceptance.md).

## TDD plan

- First test documented text, usage and error payloads through the public decoder and record the missing-module red result.
- Add wrong-scope, malformed, multi-choice, tool/rich, invalid-usage and no-leak cases; then implement the smallest decoder and run focused tests.
- Run `npm run check`, inspect the diff, and report remaining integration gates in the PR.

## Delivery

- Issue and plan; red; decoder and contract; green/full checks; ready PR.
- Risk: real providers may emit more OpenRouter fields. The decoder supports a declared text subset only and stays disconnected from client streaming until conformance cases and accounting are complete.
- PR evidence: red/green tests, full gate, and explicit unsupported cases.
