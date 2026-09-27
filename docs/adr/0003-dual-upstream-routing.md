# ADR 0003: Support delegated and managed upstream routes

Status: Accepted for product direction on 2026-09-27. Selection controls and fallback boundary were subsequently agreed; exact scores and retry triggers are open.

## Context

An OpenRouter user may need an added IAM and audit layer while keeping OpenRouter's routing and billing. Another organization may want OpenGranter to route directly among its own provider subscriptions. A product limited to the first case would make direct-provider use a separate architecture; a product limited to the second would require an existing OpenRouter user to abandon its routing setup.

## Decision

Expose one proxy-token API and one authorization and audit pipeline over two route kinds: a delegated route to OpenRouter and a managed route to a registered direct provider. Model aliases resolve to approved route definitions. An adapter boundary normalizes upstream requests, responses, usage, errors, and identifiers. Both route kinds are subject to the same principal policy and limits before an upstream call.

## Alternatives considered

- OpenRouter-only control layer: simpler gateway, but cannot operate independently of OpenRouter.
- Direct-provider router only: simpler ownership of final routing, but imposes migration on OpenRouter users.
- Two separate gateways: preserves specialization, but duplicates tokens, policy behavior, and audit records.

## Consequences

The gateway must clearly distinguish who selected the eventual provider and what policy could be enforced before the call. OpenRouter may route beyond what a local model-alias check covers, so delegated routes require constrained routing options or rejection of requests whose destinations cannot be bounded. Usage and cost reconciliation also differ by route kind. The first release targets OpenRouter plus direct OpenAI, Anthropic, and Google Gemini adapters. Fallback stays within one route kind. Exact selection scoring and retry triggers remain open; see the [routing contract](../routing.md).
