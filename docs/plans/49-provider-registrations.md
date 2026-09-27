# Validate Direct Provider Registrations

## Issue and problem

- Issue: [#49](https://github.com/Theorvane/OpenGranter/issues/49)
- The invoker chooses the first matching registration; duplicate IDs and caller mutation can alter the credential/API kind without an explicit validated snapshot.

## Scope and expected behavior

- Validate administrator-provided registrations when constructing the invoker. Reject duplicate or invalid provider IDs, unknown API kinds, invalid credential references, and invalid Anthropic output-token limits with a fixed configuration error.
- Copy only known fields into a private snapshot; changes to the caller's array or objects cannot alter an existing invoker.
- Reject before secret lookup or network access. Never expose configuration input or secret values in errors. Preserve existing valid direct-provider calls.
- Out of scope: persistent registration writes, key rotation, model capability discovery, and provider pricing.

## Design

- Add a safe configuration error and a registration projection helper in the direct adapter. Keep the existing invocation and safe upstream failure contracts.
- Update [routing contract](../routing.md) and [acceptance](../acceptance.md). Existing HTTP contract remains unchanged.
- Open decisions: administrator registration management and capability discovery.

## TDD plan

- First reproduce duplicate registrations accepted by the constructor with a failing regression test.
- Test malformed values, no external contact, secret-free errors, and mutation after construction. Keep existing native adapter tests green.
- Implement validation and snapshot projection, then run focused tests and `npm run check`.

## Delivery

- Work on `fix/49-provider-registrations` with authorized DCO and assistance trailers, then open a ready PR linked to the issue and plan.
- Deployments with invalid registrations now fail at construction instead of silently selecting one. Valid configuration remains compatible.
