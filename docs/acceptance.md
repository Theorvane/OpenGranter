# Acceptance and Verification Scenarios

## Policy evaluation

- An active principal with no matching policy cannot invoke a model.
- A direct Deny overrides an Allow inherited through a role.
- Allows from multiple roles combine, while any matching Deny takes precedence.
- Inactive principals and revoked credentials are rejected regardless of policies.
- Administrators are evaluated against an explicit system policy.
- The policy simulator and live gateway reach the same decision for the same input.
- A directly attached policy and policies inherited through assigned roles contribute to one decision. A matching Deny from either source overrides every Allow.
- If an assigned role or attached policy cannot be resolved uniquely, authorization fails closed without using a partial Allow.
- A decision records the IDs and versions of resolved policies for later audit attribution; the decision result does not expose policy statements.

## Gateway and credentials

- `GET /v1/models` lists only models the caller may use, and calls route only to approved models.
- The same proxy token can invoke an allowed delegated route and an allowed managed route without revealing either upstream credential.
- A socket-level request to the current managed text-chat boundary authenticates a proxy token, rejects unsupported fields before external calls, and returns a safe request ID with the direct adapter's completion. This is a component test with fake infrastructure ports, not a deployment acceptance test.
- A gateway request receives permissions from its authenticated principal's direct and role policy attachments. A direct Deny overrides an inherited Allow; revoked or inactive identities and unresolved attachments stop before route resolution. A missing or mismatched snapshot returns a safe service error. Only nonsecret credential and policy IDs/versions are available for later audit attribution.
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
- If a Jev-selected direct provider reports an explicitly classified failure before any upstream response starts, the coordinator tries the remaining authorized managed candidates once each in administrator order without asking Jev again. A received HTTP 429 or 5xx response stops automatic replay; a pre-response timeout may retry. It records every attempt and the final provider.
- A provider authentication/validation error, unclassified error, response-started failure, or failed audit write does not trigger another provider attempt. Possible duplicate billing is surfaced when a failed attempt may have incurred cost.
- Direct OpenAI, Anthropic, and Gemini adapters use their fixed official hosts, translate the supported text-chat request and response fields, report usage only when upstream counts are present, and classify 429, server errors, and timeouts without exposing upstream error bodies. Unsupported features are rejected before invocation.
- A policy Deny on any possible model, provider, or destination prevents an unreviewed fallback from reaching that destination. Unsupported routing overrides are rejected before any upstream call.
- A disabled route or unavailable registered credential fails closed; no silent switch to another route kind occurs.
- Unknown models, provider timeouts, provider 429/5xx responses, and redirects produce defined errors.
- Provider keys and user credentials do not appear in logs, audit events, or errors. Prompts and responses appear only in the protected content-audit store when enabled, never in operational logs or errors.
- After key rotation, old references are retired according to policy and the new calling path is verified.

## Usage and audit

- Successful calls, policy denials, and provider failures each have a request ID and audit event.
- Every post-authentication request, routing, decision, and attempt audit event includes the same principal ID, credential ID, and policy IDs/versions. Missing attribution fails before route lookup. Authentication failures include only a request ID; no raw token, policy statements, provider key, or content appears in ordinary audit events.
- Missing provider token counts are shown as unknown.
- Estimated cost and upstream-reported cost are separate; a delegated route retains OpenRouter generation identifiers for reconciliation when available.
- Reprocessing the same request ID does not create a duplicate usage-ledger row.
- Ordinary users cannot inspect other principals' usage or audit records.
- Administrative changes record actor and nonsecret identifiers of the prior and new configuration.
- Disabled content auditing stores no request or response body. When enabled, only authorized auditors can read retained bodies.

## Harness connection

`contracts/policy_cases.json` fixes policy-evaluator inputs and expected decisions. `contracts/attachment_cases.json` fixes principal and role policy resolution, including failure paths. `contracts/route_cases.json` fixes candidate authorization and model-specific provider bounds; these three contracts run against pure TypeScript functions. `contracts/gateway_cases.json` fixes expected HTTP behavior and still needs service-level tests against fake upstreams. `scripts/check.py` validates the original fixture structure and planning documents.
