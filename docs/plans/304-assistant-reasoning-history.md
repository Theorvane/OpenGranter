# Scalar assistant reasoning history

## Issue and problem

- Issue: #304; release gate #116 remains open.
- Clients cannot replay supported scalar reasoning responses as assistant history
  because reasoning is currently an unknown message field.

## Scope and expected behavior

- Assistant history preserves optional string/null reasoning on delegated OpenRouter, including existing ordinary delegated text streams.
- Ordinary string/text-part assistant content retains its behavior. Null/missing
  content requires nonempty reasoning; missing content normalizes to null.
- Existing complete function-call/result groups preserve assistant reasoning
  without changing pending-ID validation or enabling tool streams/execution.
- Other roles and malformed reasoning reject before routing. Unsupported direct
  OpenAI/Anthropic/Gemini reject supplied reasoning before credentials.
- IAM, limits, required audit/usage, safe failures and operational privacy remain
  shared. History text is untrusted data, not an authentication or routing claim.
- Detailed reasoning history, native thinking, structured request controls and
  full #116 workflows remain outside this bounded implementation.

## Design

- Extend assistant message types and strict history snapshots; capture scalar
  reasoning once before asynchronous work and freeze projected messages.
- Allow the HTTP text-part normalizer to retain null/missing assistant content;
  the strict snapshot validates the nonempty reasoning/tool-call condition.
- Extend direct unsupported-message guard rather than silently dropping reasoning.
- Update scalar history contract, PRD, architecture, acceptance and compatibility.
- No new glossary terms or costly irreversible decisions; no ADR is necessary.

## TDD plan

- HTTP history success cases should initially fail 400, across both delegated
  prefixes, optional scalar states, text parts and reasoning-only output.
- Function history lifecycle, malformed/non-assistant fields, empty null-content
  output, pending results, unsupported native paths, once-captured getters,
  secret-await mutation, SDK sockets and delegated text streams.
- Verify authentication/Deny/limits and required persistence/upstream failures.
- Focused history/message tests then npm run check; response/source pin unchanged.

## Delivery

- Issue/plan, tests/red, minimal snapshots/native guard/green, full checks,
  exact-head review and CI, authorized merge and clean main synchronization.
- Risk: client-supplied reasoning can be fabricated; preserve it as untrusted
  opaque conversation data without authenticity, token or policy authority.
- Report validation and remaining gaps in PR; rollback by reverting this subset.

## Source boundary clarification

Official OpenRouter ChatMessages references the same assistant definition selected
by pin v16 and permits scalar reasoning. OpenAI SDK has no typed reasoning history
field. Direct provider mapping stays open instead of forwarding an unsupported
extension. The nonempty content-free history guard is a local bounded subset.

## Verification evidence

- Initial public HTTP/SDK/snapshot red: 1 passed, 7 expected failures (unknown
  reasoning fields or content-free histories rejected before the intended path).
- Focused history/function/developer green: 41 passed. Independent model/provider
  Deny and failed/successful persistence accounting are covered in final fixtures.
- Actual OpenRouter SDK covers both bases and delegated nonstream/text streams;
  complete function groups remain nonstream only.
- Response/source pin unchanged; final npm run check results are in the PR.
