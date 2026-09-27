# Acceptance and Verification Scenarios

## Policy evaluation

- An active principal with no matching policy cannot invoke a model.
- A direct Deny overrides an Allow inherited through a role.
- Allows from multiple roles combine, while any matching Deny takes precedence.
- Inactive principals and revoked credentials are rejected regardless of policies.
- Administrators are evaluated against an explicit system policy.
- The policy simulator and live gateway reach the same decision for the same input.

## Gateway and credentials

- `GET /v1/models` lists only models the caller may use, and calls route only to approved models.
- The same proxy token can invoke an allowed delegated route and an allowed managed route without revealing either upstream credential.
- A socket-level request to the current managed text-chat boundary authenticates a proxy token, rejects unsupported fields before external calls, and returns a safe request ID with the direct adapter's completion. This is a component test with fake infrastructure ports, not a deployment acceptance test.
- Identity-store and route-store failures return safe service errors and write nonsecret audit events; their exception messages do not appear in responses.
- A delegated route calls OpenRouter; a managed route calls the registered direct provider selected by OpenGranter. Audit and usage records identify the route kind and actual upstream.
- Given approved OpenAI, Anthropic, and Gemini direct routes, the managed-route rule selects a permitted destination using the configured order or price/latency/throughput preference and records why it was selected.
- With Jev-assisted managed selection, the decision request contains only already eligible direct candidates; a denied or invented candidate ID cannot be invoked. A Jev failure or low-confidence choice follows the configured same-kind failure policy and is auditable.
- The Jev request excludes prompt text unless the route explicitly enables that disclosure; its credential and response body never enter operational logs or ordinary audit events.
- The Jev-managed invocation boundary checks IAM and limits before resolving its credential, writes a nonsecret start event before contacting Jev, and writes its decision before direct inference. A required audit failure before either external call prevents that call.
- When a direct provider may have processed a request but the outcome audit write fails, the result flags possible billing and does not replay the provider call automatically.
- A model Allow with a provider Deny cannot reach that provider in either mode. If another provider is allowed, it may serve the request; otherwise the request is denied before any upstream call.
- A delegated request sends only the principal's eligible providers in a server-generated OpenRouter `provider.only` restriction. Caller overrides and OpenRouter fallback models cannot widen the authorized model/provider pairs.
- If an eligible candidate fails, fallback can use another previously authorized candidate of the same route kind. It never silently moves between OpenRouter and direct-provider routes.
- If a Jev-selected direct provider reports a classified rate limit, transient server failure, or timeout before response bytes start, the coordinator tries the remaining authorized managed candidates once each in administrator order without asking Jev again. It records every attempt and the final provider.
- A provider authentication/validation error, unclassified error, response-started failure, or failed audit write does not trigger another provider attempt. Possible duplicate billing is surfaced when a failed attempt may have incurred cost.
- Anthropic and Gemini adapters translate the supported chat request and response fields; unsupported features are rejected before invocation.
- A policy Deny on any possible model, provider, or destination prevents an unreviewed fallback from reaching that destination. Unsupported routing overrides are rejected before any upstream call.
- A disabled route or unavailable registered credential fails closed; no silent switch to another route kind occurs.
- Unknown models, provider timeouts, provider 429/5xx responses, and redirects produce defined errors.
- Provider keys and user credentials do not appear in logs, audit events, or errors. Prompts and responses appear only in the protected content-audit store when enabled, never in operational logs or errors.
- After key rotation, old references are retired according to policy and the new calling path is verified.

## Usage and audit

- Successful calls, policy denials, and provider failures each have a request ID and audit event.
- Missing provider token counts are shown as unknown.
- Estimated cost and upstream-reported cost are separate; a delegated route retains OpenRouter generation identifiers for reconciliation when available.
- Reprocessing the same request ID does not create a duplicate usage-ledger row.
- Ordinary users cannot inspect other principals' usage or audit records.
- Administrative changes record actor and nonsecret identifiers of the prior and new configuration.
- Disabled content auditing stores no request or response body. When enabled, only authorized auditors can read retained bodies.

## Harness connection

`contracts/policy_cases.json` fixes policy-evaluator inputs and expected decisions. `contracts/route_cases.json` fixes candidate authorization and model-specific provider bounds; both now run against pure TypeScript functions. `contracts/gateway_cases.json` fixes expected HTTP behavior and still needs service-level tests against fake upstreams. `scripts/check.py` validates fixture structure and planning documents.
