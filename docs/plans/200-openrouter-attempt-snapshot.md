# Snapshot delegated OpenRouter attempt scope

## Issue and problem

- Issue: [#200](https://github.com/Theorvane/OpenGranter/issues/200).
- The delegated invoker validates a caller-owned model ID and authorized provider slugs before awaiting a secret, but later reads the same mutable object for the HTTP body and response check. The values can change after policy evaluation.

## Scope and expected behavior

- Capture the exact upstream model and authorized provider slug list before the first await. Validate that snapshot and use it for the HTTP request and response model check.
- Reject invalid initial scope before credential or network access. Later changes to the source object cannot widen or replace the approved destination.
- Keep non-streaming request controls, failure categories, usage and audit semantics unchanged. Export a narrow snapshot helper for the later streaming invoker to use.

## Design

- Copy the model string and provider slug array, validate the copied values, freeze both, and pass that snapshot through invocation and normalization.
- A secret-resolver mutation test uses the public invoker boundary to prove the HTTP request and accepted response stay inside the initial scope.
- No new domain term or ADR is needed. See [contract](../../contracts/openrouter-attempt-snapshot.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility inventory](../openrouter-compatibility.md).

## TDD plan

- First add a regression test that changes model and provider slugs during the credential await. Expect the original approved scope to reach HTTP and response normalization; capture the red result.
- Cover provider array element changes, replacement and invalid initial attempts. Keep existing safe failure suites green.
- Implement the smallest immutable attempt snapshot and run focused tests, formatting and `npm run check`.

## Delivery

- Issue and plan; red regression; implementation; green/full checks; reviewable PR.
- Risk: this protects values already passed into the adapter; prior route selection and verified mapping snapshots are separate boundaries.
- PR evidence: red/green outputs, full check and remaining stream integration work.
