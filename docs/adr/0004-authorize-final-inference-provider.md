# ADR 0004: Authorize the final inference provider as well as the model

Status: Accepted for product direction on 2026-09-27. OpenRouter provider-ID mapping remains to be verified.

## Context

One model can be served through several providers. A principal who may call the model may still be forbidden from sending data to one of those providers. This matters for both managed direct routing and OpenRouter-delegated routing. Checking the final provider only after a response would be too late to enforce the restriction.

## Decision

Evaluate `llm:InvokeModel` on `model:<alias>` and `llm:UseProvider` on `provider:<inference-provider-id>` before each candidate is used. A candidate needs both Allows and no matching Deny. For delegated routes, constrain OpenRouter's eligible providers to the authorized set with a server-generated provider allowlist and reject requests or configurations whose possible destinations cannot be bounded before sending. A fallback must be independently authorized and stay within the original route kind.

## Alternatives considered

- Model-only authorization: easier and closer to a simple proxy, but cannot enforce provider restrictions.
- Post-call provider verification: supplies a record, but does not prevent a prohibited data transfer.
- Disable delegated routing whenever provider restrictions exist: enforceable, but removes the OpenRouter control-layer use case for the customers who need it most.

## Consequences

The product needs a verified mapping between OpenRouter provider endpoint slugs and internal provider IDs. A broad OpenRouter fallback or preset cannot be forwarded if it escapes the authorized set. Provider restrictions can reduce availability. The policy simulator and gateway must evaluate the same pair of resources, and audit events must show the eligible provider set and actual provider when reported.
