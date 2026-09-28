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
- A PostgreSQL identity reader loads a principal, direct policy attachments, assigned roles, and inherited versioned policies through one parameterized SQL statement. The attachment authenticator receives a complete snapshot and preserves direct Deny precedence over a role Allow.
- A missing principal yields no identity. An inactive principal is denied; malformed policy JSON, missing role or policy references, duplicate records, and database failure produce a safe unavailable result without granting a partial Allow. Extra stored JSONB properties never enter the returned snapshot.

## Gateway and credentials

- A trusted issuance call returns a new opaque proxy token once, persists only its digest and nonsecret principal/expiry metadata, and atomically records the actor and request ID in a credential event. Invalid identity or expiry input creates no credential.
- Malformed, unknown, wrong-secret, expired, and revoked tokens yield no authenticated identity. A revoked token stops working on the next verification. Repeated revocation leaves one revocation event.
- If credential storage or a required lifecycle audit write fails, issuance and revocation return a safe error and leave no unaudited credential change. The raw token never appears in database rows, lifecycle events, or errors.
- The credential verifier connects to the existing attachment authenticator so an issued token resolves its service principal and stops resolving after revocation. A trusted management boundary must check `iam:Manage` before exposing issuance or revocation.
- A trusted token-management coordinator evaluates the authenticated actor's resolved policies for `iam:Manage` on the token owner's `principal:<id>` before issuance or revocation. Default Deny, explicit Deny, an inactive actor, and missing actor attribution stop before mutation.
- Revocation derives the target principal from the stored credential owner. A credential owned by another principal cannot be revoked through a policy that grants management only for the caller's nominated target. Unknown credentials and owner-lookup failures do not call the revoke primitive.
- A required nonsecret decision audit succeeds before token mutation; its failure stops the mutation. The existing atomic credential lifecycle event records successful issue or revoke without the token body or digest. The coordinator remains internal until actor authentication and the HTTP management contract are implemented.
- A PostgreSQL model catalog reader supplies bounded published aliases and one active versioned route per alias through the existing gateway ports. It returns managed and delegated ordered candidates, accepts a managed route with all Jev settings absent after migration 006, rejects partial Jev settings and malformed or inconsistent snapshots without partial results, and returns no route for a disabled or unknown alias. The schema prevents a model from pointing at another alias's route. The reader strips unexpected stored fields and exposes no credential value. Publication writes and multi-route selection remain separate work.
- `GET /v1/models` lists only enabled published aliases with at least one model and final-provider IAM-allowed candidate, across managed and delegated routes. It returns the OpenAI list shape with alias IDs and no upstream identifiers, writes an attributed count event, and fails closed on catalog or required audit-write failure.
- The same proxy token can invoke an allowed delegated route and an allowed managed route without revealing either upstream credential.
- The OpenRouter adapter sends one registered model and only the supplied authorized provider slugs to the fixed endpoint; configuration, secret, HTTP, redirect, timeout, and malformed-response failures expose safe metadata. The delegated gateway filters model and final-provider IAM permissions, requires verified slug mappings, checks limits, and records selection and outcome audit before returning. Component tests include a socket request through the adapter; the concrete mapping store and deployment acceptance remain separate work.
- A socket-level request to the current managed text-chat boundary authenticates a proxy token, rejects unsupported fields before external calls, and returns a safe request ID with the direct adapter's completion. This is a component test with fake infrastructure ports, not a deployment acceptance test.
- A gateway request receives permissions from its authenticated principal's direct and role policy attachments. A direct Deny overrides an inherited Allow; revoked or inactive identities and unresolved attachments stop before route resolution. A missing or mismatched snapshot returns a safe service error. Only nonsecret credential and policy IDs/versions are available for later audit attribution.
- Identity-store and route-store failures return safe service errors and write nonsecret audit events; their exception messages do not appear in responses.
- A delegated route calls OpenRouter; a managed route calls the registered direct provider selected by OpenGranter. Audit and usage records identify the route kind and actual upstream.
- Given approved OpenAI, Anthropic, and Gemini direct routes, the managed-route rule selects a permitted destination using the configured order or price/latency/throughput preference and records why it was selected.
- A managed route without Jev selects the first IAM-eligible candidate in administrator order after the limit check, records an ordered decision, and calls no Jev or Jev secret port. Denied providers, limit failures, malformed Jev settings, and required audit failures cannot reach direct inference. Classified pre-response failures may fall back only to remaining authorized managed candidates with distinct attempt accounting.
- With Jev-assisted managed selection, the decision request contains only already eligible direct candidates; a denied or invented candidate ID cannot be invoked. A Jev failure or low-confidence choice follows the configured same-kind failure policy and is auditable.
- The Jev request excludes prompt text unless the route explicitly enables that disclosure; its credential and response body never enter operational logs or ordinary audit events.
- The Jev-managed invocation boundary checks IAM and limits before resolving its credential, writes a nonsecret start event before contacting Jev, and writes its decision before direct inference. A required audit failure before either external call prevents that call.
- When a direct provider may have processed a request but the outcome audit write fails, the result flags possible billing and does not replay the provider call automatically.
- A model Allow with a provider Deny cannot reach that provider in either mode. If another provider is allowed, it may serve the request; otherwise the request is denied before any upstream call.
- A delegated request sends only the principal's eligible providers in a server-generated OpenRouter `provider.only` restriction. Caller overrides and OpenRouter fallback models cannot widen the authorized model/provider pairs.
- If an eligible candidate fails, fallback can use another previously authorized candidate of the same route kind. It never silently moves between OpenRouter and direct-provider routes.
- If a Jev-selected direct provider reports an explicitly classified failure before any upstream response starts, the coordinator tries the remaining authorized managed candidates once each in administrator order without asking Jev again. A received HTTP 429 or 5xx response stops automatic replay; a pre-response timeout may retry. It records every attempt and the final provider.
- A provider authentication/validation error, unclassified error, response-started failure, or failed audit write does not trigger another provider attempt. Possible duplicate billing is surfaced when a failed attempt may have incurred cost.
- Direct invoker construction rejects duplicate and malformed registrations with a fixed nonsecret configuration error before external contact. Only known registration fields are copied; later array or object mutation cannot change an existing invoker. Valid OpenAI, Anthropic, and Gemini registrations retain their adapter behavior.
- Direct OpenAI, Anthropic, and Gemini adapters use their fixed official hosts, translate the supported text-chat request and response fields, report usage only when upstream counts are present, and classify 429, server errors, and timeouts without exposing upstream error bodies. Unsupported features are rejected before invocation.
- A policy Deny on any possible model, provider, or destination prevents an unreviewed fallback from reaching that destination. Unsupported routing overrides are rejected before any upstream call.
- A disabled route or unavailable registered credential fails closed; no silent switch to another route kind occurs.
- Unknown models, provider timeouts, provider 429/5xx responses, and redirects produce defined errors.
- Provider keys and user credentials do not appear in logs, audit events, or errors. Prompts and responses appear only in the protected content-audit store when enabled, never in operational logs or errors.
- After key rotation, old references are retired according to policy and the new calling path is verified.

## Usage and audit

- A PostgreSQL audit adapter appends gateway and managed/delegated route metadata events with request ID, occurrence time, and only allowlisted details. Attributed events retain nonsecret principal, credential, and policy-version identifiers; anonymous authentication failures have no invented identity.
- A PostgreSQL audit reader returns at most 100 nonsecret events for one bound principal, ordered by event ID. An opaque cursor continues the same principal's history without gaps when events share a timestamp. Malformed cursors, mixed-principal or anonymous rows, malformed details, and storage failures reject the whole page with a safe error; unexpected JSONB fields do not appear in results.
- `GET /v1/audit` accepts an omitted or explicit `principal_id`, bounded `limit`, and descending event-ID `cursor`. Both self and specified-principal reads require `audit:Read` on the target `principal:<id>`. Default or explicit Deny stops before storage. Malformed queries and storage pages produce no partial data; successful, denied, and unavailable reads create attributed nonsecret events. Required audit-write failure prevents a successful response. Anonymous and organization-wide audit search remain separate decisions.
- The adapter never serializes the original event object. Extra prompt, response, token, provider-key, and upstream-error fields do not enter SQL rows. Unknown kinds and malformed nested details fail before SQL, while database errors expose only fixed safe errors.
- The append adapter alone does not establish tamper resistance, reader authorization, retention, or exactly-once delivery after an ambiguous write. Those remain release gates.
- Successful calls, policy denials, and provider failures each have a request ID and audit event.
- Every post-authentication request, routing, decision, and attempt audit event includes the same principal ID, credential ID, and policy IDs/versions. Missing attribution fails before route lookup. Authentication failures include only a request ID; no raw token, policy statements, provider key, or content appears in ordinary audit events.
- Missing provider token counts are shown as unknown.
- A per-attempt usage record distinguishes reported, partial, missing, and invalid provider token counts; missing values are `null`, never zero. It keeps distinct attempt IDs for a possibly billed retry and never copies prompts, responses, proxy tokens, or provider keys.
- After each managed or delegated upstream attempt, the gateway hands off one normalized record with a stable attempt ID. A denied call or a known preflight failure before upstream contact creates none. A possibly billed managed fallback has a distinct second attempt marked for possible duplicate billing. A failed handoff stops fallback, records a nonsecret failure event where possible, returns a safe service error, and never replays inference.
- A delegated OpenRouter call with several authorized final-provider candidates leaves its selected candidate and actual provider unknown until verified upstream attribution is available; it does not claim that the first allowed candidate was used.
- Estimated cost and upstream-reported cost are separate; a delegated route retains OpenRouter generation identifiers for reconciliation when available.
- Reprocessing the same request ID does not create a duplicate usage-ledger row.
- A PostgreSQL usage-ledger append creates one row per attempt ID. Identical retries, including after an ambiguous committed write, leave one row; conflicting retries preserve the original and raise a safe conflict. Only allowlisted metadata is stored, and database failures expose no driver details.
- `GET /v1/usage` returns at most 100 records for one principal in stable descending keyset order. An omitted `principal_id` requires `usage:ReadSelf` on the authenticated principal; an explicit `principal_id` requires `usage:ReadAll` on that target, including self. Default or explicit Deny stops before storage. A forged cursor cannot widen the SQL principal filter; malformed and mixed-principal rows produce no partial response. Successful, denied, and unavailable reads have attributed nonsecret audit events, and a required audit-write failure prevents a successful response.
- Ordinary users cannot inspect other principals' usage or audit records.
- Administrative changes record actor and nonsecret identifiers of the prior and new configuration.
- Disabled content auditing stores no request or response body. When enabled, only authorized auditors can read retained bodies.

## Harness connection

The PostgreSQL migration runner applies versions `001` through `007` in order, records their checksums, and skips unchanged history on a second run. It refuses edited, missing, duplicate, skipped, and out-of-order versions before applying new SQL. A failing migration leaves neither its schema changes nor its history row, and driver errors expose no SQL text. Deployment connection provisioning and concurrent migrator coordination remain separate release work.

`contracts/policy_cases.json` fixes policy-evaluator inputs and expected decisions. `contracts/attachment_cases.json` fixes principal and role policy resolution, including failure paths. `contracts/route_cases.json` fixes candidate authorization and model-specific provider bounds; these three contracts run against pure TypeScript functions. `contracts/gateway_cases.json` fixes expected HTTP behavior and still needs service-level tests against fake upstreams. `scripts/check.py` validates the original fixture structure and planning documents.

## PostgreSQL gateway integration

- Applying all migrations and issuing an opaque token allows an authorized principal to list stored aliases, invoke an ordered managed route, and inspect attributed audit and usage metadata through the composed HTTP handler. Prompts, responses, and raw tokens remain absent from metadata history.
- Generated credential IDs beginning with `-` or `_` remain valid audit attribution. Stored explicit/default Deny and token revocation stop inference.
- Unavailable IAM and required audit storage return safe service errors before inference. A usage handoff failure after inference returns unavailable without replaying the provider call.

- A real local HTTP socket served by the PostgreSQL factory authenticates an issued token, lists stored aliases, invokes a registered direct adapter, and returns persisted attributed usage/audit metadata. Revocation returns 401 before any second upstream call. The factory leaves listening and connection lifecycle to its caller, and tests close both resources.

## PostgreSQL driver connection

- Pool queries bind values separately from SQL. Migration transactions execute BEGIN, callback queries, and COMMIT on one dedicated client, release it, and reject escaped transaction handles.
- Application failures roll back and preserve their original error. Driver acquisition/query/begin/commit/rollback and shutdown failures expose fixed safe availability errors. Failed rollback, checked-out connection loss, and uncertain commit discard the connection; no retry occurs. Even a query failure caught by the callback prevents successful commit.
- Idle pool failures notify with a safe error; a failing notification cannot crash the listener. Shutdown is idempotent, drains active clients, and rejects new queries and transactions.
- An isolated real PostgreSQL database applies all seven migrations, skips unchanged history on the second run, binds hostile-looking literal values, and leaves no schema changes after a rolled-back transaction. CI supplies that database; local integration skips unless its explicit test database URL is set.


## Persisted direct providers

- Enabled OpenAI, Anthropic, and Google registrations load from PostgreSQL in stable provider-ID order. Disabled rows are excluded. Returned snapshots contain only provider ID, kind, secret reference, and configured output limit; extra database fields and subsequent row mutations do not leak into them.
- Unsupported kinds, invalid/duplicate IDs, malformed secret references, missing Anthropic limits, invalid numeric limits, non-row data, and SQL failures reject the entire snapshot with a fixed safe error. No partial configuration is returned.
- A direct invoker built from the snapshot contacts only its fixed registered provider host and resolves the matching secret reference. Disabled and unknown providers reach neither the secret resolver nor the transport. Database constraints reject invalid Anthropic registrations, and PostgreSQL bigint limits decode without precision loss within the supported safe-integer range.
- Configuration loading remains an explicit trusted operation; live reload, registration writes, and HTTP management are not provided by this reader.

## Usage history filters

- Authorized self or specified-principal usage reads accept an exact `model` alias and inclusive `from_ms`/exclusive `to_ms` occurrence-time bounds. Equal-timestamp keyset pagination returns only matching records without gaps when clients repeat the filters.
- A principal predicate always applies alongside all filter values. Hostile-looking aliases are bound as SQL literals; foreign-principal and other-model records remain excluded.
- Default/explicit Deny still prevents storage access. Unknown/repeated parameters, malformed model aliases, noncanonical or unsafe timestamps, and reversed/empty two-bound ranges return 400 before storage.
- Storage adapters reject malformed filter inputs before SQL and reject out-of-filter results. The HTTP boundary also rejects out-of-filter pages with a safe unavailable error and required audit. Successful filtered reads still require successful audit writes.
