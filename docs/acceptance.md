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

The PostgreSQL migration runner applies versions `001` through `008` in order, records their checksums, and skips unchanged history on a second run. It refuses edited, missing, duplicate, skipped, and out-of-order versions before applying new SQL. A failing migration leaves neither its schema changes nor its history row, and driver errors expose no SQL text. Deployment connection provisioning and concurrent migrator coordination remain separate release work.

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
- An isolated real PostgreSQL database applies all eight migrations, skips unchanged history on the second run, binds hostile-looking literal values, and leaves no schema changes after a rolled-back transaction. CI supplies that database; local integration skips unless its explicit test database URL is set.


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

## Persisted direct gateway composition

- The async Node factory loads stored enabled registrations and returns an unbound server without retrieving provider secrets. An authenticated, authorized socket chat uses that stored secret reference and fixed provider host, then persists attributed content-free usage and audit history.
- Explicit model Deny and credential revocation stop requests before any additional secret lookup or provider call. Tokens, keys, prompts, and responses remain absent from history metadata.
- Unavailable or malformed registration storage rejects construction safely without secret lookup or transport. Empty registration snapshots still permit construction for delegated-only configurations.
- Callers supply connection, migrations, limits, secret resolution, transport options, and optional delegated/Jev ports, and own listening/shutdown. Configuration changes require rebuilding this snapshot; no live reload or process startup is provided.

## Audit occurrence-time filters

- Authorized audit readers can restrict attributed metadata by inclusive `from_ms` and exclusive `to_ms`. Boundary events and equal-time pagination remain correct under the existing descending event-ID order.
- Principal and cursor predicates remain bound alongside the range. Other principals' events never enter results, and default/explicit Deny prevents storage access.
- Noncanonical, unsafe, repeated, or reversed/empty two-bound time inputs return 400 before storage. Invalid direct reader range inputs reject before SQL.
- SQL and injected reader pages containing out-of-range records fail as a whole with safe errors and required unavailable-read audit. Successful filtered reads still require successful audit writes.

## Usage CSV page export

- An authorized `format=csv` read uses the same principal, model/time filters, bounded page, and IAM actions as JSON. The file contains only allowlisted metadata and keeps unknown usage/cost distinct from zero and estimated cost distinct from billed cost.
- Pagination is explicit through `X-Has-More` and optional `X-Next-Cursor`; an empty page has headers only. JSON stays the default, and invalid/repeated format values return 400 before storage.
- Commas, quotes, and multiline text remain inside quoted cells. Formula-looking text receives a documented apostrophe prefix; unmodified machine-readable identifiers remain available through JSON.
- Default/explicit Deny blocks storage. Storage failure, mixed-principal rows, and required audit failure return safe JSON errors rather than partial CSV. Successful downloads have a fixed filename and no-store cache policy.


## Audit CSV page export

- An authorized `format=csv` request exports only the same target-principal, occurrence-time range, event-ID page as JSON. It uses `audit:Read` with no administrator bypass.
- CSV columns contain projected attributed metadata; extra content/key/token fields are removed, and policy versions/details remain quoted JSON cells. Usage export regression tests preserve its existing shared encoding behavior.
- Continuation uses `X-Has-More` and optional `X-Next-Cursor`. Empty pages have headers only, attachment filenames are fixed, and responses use no-store caching.
- Default/explicit Deny blocks storage. Invalid/repeated formats return 400. Storage failure, wrong principal/time/order, and required audit failure return safe JSON errors rather than partial CSV.

## PostgreSQL token-management composition

- An authorized internal issuance persists an IAM grant, returns a verifiable opaque token, and records one atomic issued lifecycle event. Owner-scoped revocation persists its grant and makes the token unusable with a revoked lifecycle event.
- Default Deny, explicit Deny, inactive actors, and unknown credential owners persist denied decisions without credential changes. A denied revocation leaves an existing token active.
- Required decision-storage failure prevents issuance and revocation with a fixed availability error. A mutation failure after a stored grant leaves the grant without a successful lifecycle event; a grant does not certify completion.
- Decision storage binds values as SQL parameters, rejects malformed metadata or clocks before SQL, and projects only known fields. Tokens, digests, prompts/responses, and extra policy-statement fields never enter decision columns or driver errors.
- The factory remains internal: callers must supply authenticated actor context and resolved policy versions. No public management authentication or decision-history HTTP contract is settled by this slice.

## Migration-gated startup

- A fresh database applies the complete trusted migration source set before the first direct-registration read. The factory returns an unbound server; a real socket still rejects an unauthenticated model-list request with an anonymous audit record.
- Sequential reconstruction verifies history and skips unchanged migrations while loading a fresh registration snapshot.
- Edited/missing historical sources and invalid migration sets prevent configuration reads and server construction. Failed SQL rolls back that migration's schema/history together, retains earlier committed migrations, and never retrieves a provider key or calls a provider.
- Registration-storage failure after migration success returns a safe error while leaving migration history and the caller-owned connection intact.
- Trusted deployment code supplies the complete sources and serializes migration runs. Listening, shutdown, process configuration, and concurrent migration coordination remain deployment responsibilities.

## Bundled migration loading

- Default loading returns every shipped manifest version in order, retaining each SQL file's original UTF-8 text for checksum verification. A trusted alternate directory preserves comments and line endings and ignores non-SQL notes.
- Missing final files, unexpected/duplicate-version SQL, SQL symlinks/directories, whitespace-only SQL, and unavailable locations return a fixed safe error without filesystem paths or causes.
- Bundled server construction migrates an empty schema before its first registration read. Sequential restart verifies and skips unchanged history; construction never retrieves secrets or calls providers.
- Source-loading failure prevents any database or clock activity and returns no server. Caller owns the database, listening, shutdown, bundle integrity, and serialized migration execution.

## Owned gateway runtime

- Explicit valid bind configuration and the complete bundled schema produce a listening HTTP server. An unauthenticated model-list call returns 401 and persists its anonymous audit record; startup does not retrieve provider keys or call providers.
- Invalid bind input or source-loading failure opens no database connection. Connection-opening, migration, and occupied-port failures expose fixed safe errors; closure is attempted for every returned connection on failed startup.
- Shutdown stops accepting HTTP and waits for an active request's audit write before closing the database. Repeated/concurrent closes share one promise and close the connection once.
- Database-close failure returns a fixed safe shared rejection without automatic retry or nested driver causes. Failed startup cleanup leaves the public error safe and does not certify resource release.
- Deployment owns trusted infrastructure configuration, TLS, serialized migrations, process signals, and any shutdown deadline. Existing HTTP permissions and request contracts remain unchanged.

## Audit model-alias filters

- Authorized JSON and CSV reads accept an exact `model` alias together with principal, occurrence-time range, limit, and cursor. Both formats enforce target-principal `audit:Read`, including self, and required read auditing.
- SQL pages exclude other principals, other aliases, and events without a known alias; descending event-ID pagination and continuation remain stable within the combined filters. Hostile-looking values are literal bound parameters, never SQL or wildcard expressions.
- Empty/blank, overlength, control-containing, or repeated model filters reject before storage. Unknown aliases produce empty authorized pages.
- An out-of-model row, including lookahead, or an alias stripped during known-event projection rejects the entire SQL/HTTP page. JSON and CSV requests receive safe JSON availability errors without content or secrets.
- Model filtering does not grant audit access or require inference permissions. Content auditing and token-management decision history remain separate contracts.

## Complete usage pagination boundaries

- SQL and injected HTTP pages follow strictly descending occurrence time then UTF-8 attempt-ID order, including equal-time punctuation and non-BMP Unicode values.
- Malformed internal cursor objects fail before SQL. All SQL rows including lookahead must precede the cursor and previous row; duplicate IDs and repeated cursor attempts fail even if timestamps differ.
- Invalid injected JSON/CSV pages return safe JSON errors without partial history, continuation, or successful read audit. Required unavailable-read audit and existing principal/model/time permission checks remain in force.
- Clients restart pagination at rollout/revert of the deterministic tie order; opaque encoding remains unchanged. Query-index performance needs deployment measurement under non-C database locales.

## Current actor policies for token management

- The internal PostgreSQL token-management service accepts an actor ID from prior trusted authentication and reloads the principal, direct policies, and role policies for every issue/revoke operation. Caller-supplied actor state or policy fields cannot affect decisions.
- A persisted role grant permits issuance and revocation on its target principal. Persisted direct Deny overrides an inherited Allow. Policy version, attachment removal, and active-state changes affect the next operation without rebuilding the service.
- Missing/inactive actors and active actors without grants produce required denied decisions without credential mutation. Missing/inactive actors have empty evaluated policy versions; inactive revocation does not resolve an owner.
- Revocation evaluates only the immutable stored credential owner; caller-nominated targets cannot widen authority. Unknown credentials deny without mutation.
- Malformed/incomplete or unavailable actor snapshots fail with a fixed availability error and no policy decision or mutation. Required decision-write failure also prevents mutation, leaving an existing token active.
- Invalid actor/operation IDs or nonnegative-safe-integer expiry reject before database reads. Decision audits contain only resolved policy IDs/versions and nonsecret operation metadata.
- Authentication and public management endpoints remain separate work. The consistent actor snapshot is read once per operation; concurrent changes after that read are not revalidated or locked across decision and mutation.

## Persisted verified OpenRouter provider mappings

- A PostgreSQL resolver returns only an enabled, explicitly verified slug for the exact inference-provider ID and upstream model ID. Missing, disabled, unverified, and wrong-model mappings do not resolve.
- Duplicate active verified mappings for the same model/slug under different IAM provider IDs are rejected by the schema. Disabled/unverified staging mappings do not grant eligibility.
- Invalid inputs reject before SQL. Out-of-scope, duplicate, malformed, and falsely activated rows or driver failures return a fixed safe error without partial mappings.
- Delegated IAM filtering precedes persisted lookup: denied providers are never looked up or sent upstream. Missing mappings stop before inference; successful requests send only authorized resolved slugs.
- Migration `009` ships in the complete manifest and applies idempotently. Administrator verification, audited configuration writes, and deployment adapter wiring remain separate work.

## Persisted dual-route gateway composition

- A dual-route PostgreSQL handler and unbound Node server use stored direct registrations and verified OpenRouter provider mappings without caller-supplied invokers. Construction retrieves no secret and performs no upstream call.
- The same proxy token reaches allowed managed and delegated aliases through one socket; both persist normalized per-attempt usage and attributed content-free audit.
- Delegated requests resolve only their stored secret reference and forward only IAM-allowed, enabled/verified provider slugs. Denied providers, missing mappings, limits, revocation, and required pre-call audit failure stop external contact.
- Missing secrets prevent transport. OpenRouter upstream failure exposes only the existing safe gateway response and never switches to a direct provider.
- Empty direct registrations permit delegated-only construction; malformed or unavailable registration storage rejects construction safely.
- Existing factories remain available. Migrations, listening, DB lifecycle, secret/limit implementations, and deployment runtime selection remain caller responsibilities.

## Persisted policy simulation

- An internal simulator loads one current PostgreSQL principal/direct/role policy snapshot for an exact action/resource and returns only effect, reason, and evaluated policy IDs/versions.
- Direct and inherited grants combine; explicit Deny wins, absent matching Allow defaults deny, and inactive principals deny with no evaluated policy versions. Missing principals return no result.
- Policy, version, attachment, and active-state changes affect the next simulation. Extra caller policy/state fields cannot override stored data; statements and unexpected stored fields are not returned.
- Invalid bounded inputs reject before SQL. Malformed/incomplete/unavailable snapshots fail safely without partial grants or driver details.
- Simulation and the live PostgreSQL gateway agree on model/provider IAM for the same persisted state. Simulation produces no inference, credential mutation, usage record, or decision audit; it does not certify catalog/credential/limit readiness.
- This remains a trusted internal diagnostic. Public authentication, reader scope, simulation-access audit, and hypothetical-policy editing remain open.

## Owned dual-route runtime

- `startPostgresDualRouteGateway` loads the complete trusted migration bundle before opening DB, applies/verifies schema before registration loading, and listens only after persisted dual composition succeeds.
- One owned socket supports allowed managed and OpenRouter-delegated routes without manually supplied invocation/mapping ports, with existing sanitized audit and per-attempt usage.
- Both runtime wrappers reject invalid bind/source configuration before DB opening, expose fixed safe startup errors, and clean up after migration/configuration/listen failures without secret/upstream activity.
- Shutdown returns one shared promise, waits for active HTTP work before DB close, and attempts DB cleanup exactly once; shutdown errors remain fixed and are not retried automatically.
- Existing direct/custom runtime behavior remains available. Network defaults, CLI/env parsing, signals, TLS, shutdown deadlines, migration serialization, secret/limit implementation, and live reload remain deployment responsibilities.

## Evaluated route candidate snapshots

- Authorization returns immutable copies of known candidate fields and an immutable ordered candidate array/result. Source objects/arrays remain mutable; extra runtime fields are stripped.
- Later source configuration mutation during async selection, limits, mapping, audit, or fallback cannot change evaluated candidate/provider/model IDs or invocation/audit attribution.
- Existing default/explicit Deny, route-kind isolation, order, and no-candidate behavior remain unchanged. New source values apply only on a new authorization call.
- This does not add live reload or cross-operation DB locking; returned readonly snapshots must not be mutated by consumers.

## Chat UTF-8 validation

- Malformed bytes and incomplete trailing UTF-8 return `400 invalid_request`, record a metadata-only denial, and perform no route/limit/secret/usage/inference work.
- Decoding errors cancel unread input; a cancellation error does not expose content or change the response. Audit failure returns `503 audit_unavailable`.
- Valid multibyte characters split across chunks and literal U+FFFD reach inference unchanged.

## Direct usage availability

- Through each direct adapter and the chat gateway, prompt-only, completion-only, and total-only reporting remain partial with supplied values preserved, including zero.
- Invalid supplied counters and unsafe derived totals produce sanitized null markers and invalid ledger availability; raw invalid strings/objects do not enter responses or records.
- Complete valid counters remain reported; absent counters remain missing. These accounting states do not turn a successful text completion into a provider failure.

## Delegated usage availability

- OpenRouter completions preserve partial and zero recognized counts through the gateway and ledger; all missing counts remain missing.
- Invalid supplied counters and unsafe derived sums are sanitized to null and recorded as invalid without exposing raw values.
- Complete valid counters and a safely derived missing total remain reported. Provider bounds, IAM denial, missing mappings, and upstream/secret failures retain their existing behavior.

## Direct timeout validation

- Each direct provider rejects zero, negative, fractional, overflow, non-finite, and nonnumeric supplied durations before secret lookup and fetch, using sanitized non-retryable, non-billable failure metadata.
- Default, minimum, and maximum valid durations accept normal provider completions. Source configuration mutation during secret lookup does not alter the captured duration.
- A managed gateway attempt with invalid timeout records a failed non-billable audit, performs no fallback or provider work, and creates no billable usage record.

## OpenRouter timeout capture

- Supplied and default delegated timeouts remain valid for the current attempt when source configuration changes during credential lookup.
- A subsequent call rejects the now-invalid source configuration before another credential lookup or fetch, with safe non-billable configuration metadata.
- Existing bounds, valid completions, credential failures, and upstream failures remain unchanged.

## Provider usage containers

- Across all four adapters and the chat gateway, string/array/number/boolean containers yield sanitized invalid usage and successful completion outcomes without exposing raw values.
- Absent/null/empty/unrecognized-only containers remain missing. Existing partial, valid, and invalid recognized-counter behavior is preserved.
- No malformed usage data or unrelated object fields enter normal audit events or usage records.

## Chat media type validation

- Unsupported JSON prefix lookalikes, suffix variants, comma-joined declarations, missing types, and unrelated types return invalid_request with metadata denial and no downstream work.
- Normal, uppercase, parameterized, and whitespace-trimmed application/json requests remain accepted.
- Authentication still precedes media validation; denial-audit failure retains audit_unavailable without exposing input.

## SSO management foundation (SSO pending; internal lifetime caps implemented)

- OIDC-authenticated human management callers still pass existing iam:Manage policy checks; authentication does not grant management authority. Service-account management authentication is excluded from the first slice.
- New human-owner proxy tokens cannot exceed 30 days; new service-owner tokens cannot exceed 90 days. Expiry remains mandatory.
- Identity binding and management authentication scenarios await the remaining planning answers. SSO scenarios remain pending implementation; internal lifetime cap scenarios are covered separately below.

## Internal proxy-token lifetime caps

- For both persisted owner kinds, exact maximum future expiry succeeds and one millisecond beyond fails without credential or lifecycle writes; caller kind/cap fields cannot widen it.
- Policy Deny and decision-audit failure stop before target-kind lookup. Missing/malformed/duplicate/unavailable owner data fails safely after authorized decision persistence.
- Cap validation and credential creation use one issuance timestamp. Previously issued long-lived credentials remain revocable.
- These scenarios concern the trusted internal service; SSO identity binding and public management authentication remain pending.

## Token-management operation snapshots

- Original service issue/revoke fields survive caller updates during actor lookup and reach storage/audit unchanged.
- Coordinator targets, expiry, credential IDs, actor identity, active state, statements, and evaluated versions survive source updates during owner lookup and decision audit.
- Inactive/default/explicit Deny remains effective; extra actor fields are omitted, snapshots/events are immutable, and audit failure prevents mutation.
- Original caller objects remain mutable; later operations inspect current values. Existing success/denial/failure contracts remain unchanged.

## Gateway principal snapshots

- Source updates during managed/delegated route or model-catalog lookup preserve initial Allow/default/explicit Deny.
- Limit checks and all request attribution retain authenticated identity and versions; subsequent requests may observe source updates.
- Malformed snapshot and required failure-audit errors stop downstream work with existing safe errors.
See [contract](../contracts/gateway-principal-snapshots.md).

## Authenticated policy data validation

Malformed active authentication fails before routing, catalog, history, limits and inference, with required anonymous safe failure audit. Valid Allow/Deny, wildcard, empty-policy and inactive behavior remains unchanged. See [contract](../contracts/gateway-policy-validation.md).

## OpenRouter client paths and compatibility gate

Exact /api/v1 chat/models aliases use the same security and execution pipeline as /v1. Managed/delegated chat, filtered discovery, denial, limit and required audit failures agree across paths; wrong methods and near-miss paths remain 404. Full external-tool compatibility requires the pending schema, streaming, tool-call and integration cases in the [compatibility matrix](openrouter-compatibility.md). See [path contract](../contracts/openrouter-client-paths.md).

## Client output token limits

Both chat paths accept positive safe-integer max_tokens. Native adapters map a captured limit and retain direct registration caps and existing defaults; invalid supplied values fail before external work. IAM, limits, required audit and usage are unchanged. See [contract](../contracts/client-output-limits.md).

## Safe external-client errors

All gateway errors and Node pre-header internal failures include fixed allowlisted English messages, preserving status/reason semantics and required audit behavior without exposing private details. See [contract](../contracts/safe-client-errors.md).

## OpenRouter numeric errors

/api/v1/ failures use numeric status codes with fixed messages and allowlisted metadata.opengranter_code. Legacy /v1 codes, successful payloads and all security controls remain unchanged. Format selection does not expose additional endpoints. See [contract](../contracts/openrouter-error-schema.md).

## Client stop sequences

Both chat paths support literal stop strings or dense arrays of up to four strings, with null/omission preserved as no explicit condition. Adapters capture and map native stop fields while retaining output limits and existing security/accounting. Malformed values fail before external work. See [contract](../contracts/client-stop-sequences.md).

## Completion-token alias

- Both chat paths and four adapters accept alias-only and equal paired positive safe-integer maxima; invalid or conflicting pairs fail before route/credential/transport work.
- Direct configured caps and omission defaults remain effective; input changes during credential lookup cannot change the maximum.
- IAM denial, limits, required audit failures and upstream failures preserve safe errors and usage accounting. The alias adds no access or budget reservation.
- Explicitly document the local conflict restriction and native reasoning-model capability gap. See [contract](../contracts/client-output-limits.md).

## Client temperature sampling

- Both client paths and four adapters preserve valid bounds/fractions, omit defaults, and retain combined stop/output settings and configured direct caps.
- Malformed values reject with required audit before routes. Source mutation during credential lookup cannot change outgoing temperature.
- Direct Anthropic temperature above one fails without secret lookup/transport and with safe non-billable failed-attempt audit without a usage ledger entry. Model-specific upstream restrictions remain documented.
- IAM, request limits, required audit failure and upstream failure retain existing safe responses and usage semantics. See [contract](../contracts/client-temperature.md).

## Client top_p sampling

- Both chat paths and four real adapters preserve valid zero/one/fractional top_p and omit it when absent; malformed values reject before route/credential/transport work with required denial audit.
- Mutation during credential resolution cannot change the outgoing primitive. Combining stop and output maxima retains all native settings and configured direct caps.
- IAM denial, limits, required audit failures and upstream rejection retain safe errors and usage accounting. Model-specific limitations remain documented. See [contract](../contracts/client-top-p.md).

## Single-choice SDK requests

- Both paths and four adapters accept omitted/numeric n=1, reject malformed or unsupported counts before credentials/transport, and preserve captured count plus all native settings.
- Actual pinned OpenAI SDK discovers authorized models and consumes one normalized text choice through local managed/delegated gateway sockets.
- SDK-denied/failed calls preserve authentication, IAM, limits, required audit, safe request IDs and existing usage accounting without content/key exposure. No live upstream call occurs.
- Streaming, tools, broader response conformance and named external-tool workflows remain release gaps. See [contract](../contracts/client-single-choice.md).

## Typed compatible errors

- Every compatible local error reason includes the documented fixed error_type and preserves status, message, local reason and request ID. Legacy /v1 shape remains identical.
- Node internal fallback uses server without exception content; errors, audits and histories do not acquire raw upstream data, prompts or keys.
- Query text and numeric envelope selection do not expand endpoint eligibility. History reasons are validated through the serializer without adding history aliases.
- Unknown provider causes remain unmapped and do not invent retryability. See [contract](../contracts/openrouter-error-schema.md).

## Official request schema drift

- Offline validation rejects corrupted pins and records fixed official provenance. Explicit network checks compare selected request constraints with bounded time/bytes and no credentials or redirects.
- Type, required-field and request-reference changes fail; editorial/unrelated changes do not. Transport/malformed/oversized/time failures do not expose source content.
- Referenced schemas, full request/response instance validation and streaming/tool/client gates remain open. See [contract](../contracts/openrouter-schema-drift.md).

## Nullable optional chat controls

Both chat paths and four adapters normalize optional null token/sampling controls to omission. Null+numeric aliases preserve the numeric maximum and configured caps; mutation cannot add fields after capture. IAM/limits/audit denials prevent transport and upstream failures retain safe accounting. See [plan](plans/140-nullable-chat-controls.md) and [output contract](../contracts/client-output-limits.md).

## Upstream single-choice responses

- Valid native singleton responses normalize unchanged; OpenAI/OpenRouter index is 0 and optional Gemini index is either omitted or 0.
- Extra/sparse/empty/malformed alternatives and wrong indices fail safely without content disclosure or silent truncation.
- Failed response validation retains possibly-billed failed-attempt usage and audit through managed/delegated paths; IAM, limits and required audit still prevent unauthorized transport.
- Anthropic multi-text-block messages remain supported. See [contract](../contracts/upstream-single-choice.md).

## User text content parts

Four-provider HTTP/SDK cases verify user text-array concatenation through both paths, string parity and combined controls. Malformed/mixed/non-user arrays reject before routes with safe audit; IAM/limits/audit denial and failed-attempt usage remain intact. See [plan](plans/144-user-text-parts.md) and [contract](../contracts/client-user-text-parts.md).

## Developer instruction prefix

Both chat paths and four adapters accept the developer instruction prefix, preserve ordering/native text and snapshot before secret lookup. Malformed or late instructions reject without credential/transport activity; IAM/limits/audit denials and upstream failures retain safe records. SDK cases verify the same public path. See [plan](plans/142-developer-messages.md) and [contract](../contracts/client-developer-messages.md).

## Instruction and assistant-history text parts

- Both client prefixes and the actual SDK deliver exact text arrays on system/developer/user/assistant as literal concatenated strings through four adapters; string parity and capture during credential awaits hold.
- Empty/sparse/malformed/mixed/refusal arrays, unknown keys/roles and late instruction arrays reject before routing or secret resolution.
- Implicit/explicit IAM Deny, limits and required audit prevent invocation; transport failures retain safe usage accounting. No content or credentials appear in metadata audit, usage or errors.
- Native block/cache semantics, multimodal and tool/stream workflows remain open. See [contract](../contracts/client-user-text-parts.md).

## Non-streaming refusal outcomes

- Through both client prefixes, direct OpenAI and delegated OpenRouter return HTTP 200 with preserved null/string content, optional string/null refusal and content_filter where supplied. The actual SDK reads the same fields.
- A valid refusal/filter response retains provider usage with one upstream invocation and no fallback. IAM implicit/explicit Deny, limits and required audit still block invocation.
- Malformed refusal types, missing content and null content without nonempty refusal/filter signal produce safe 502 failures with possible billing recorded. Response/refusal text and credentials do not enter metadata audit, usage or errors.
- Native Anthropic/Gemini refusal mappings, streaming and tool lifecycles remain incomplete. See [contract](../contracts/refusal-outcomes.md).

## Native Anthropic refusals

- Both prefixes and actual SDK receive content=null, refusal=null and finish_reason=content_filter for explicit empty/text-only refusal content. A configured fallback is not invoked after delivery.
- Provider usage/missing/invalid accounting and normal text mappings remain effective; empty non-refusals and malformed/mixed/tool/thinking refusal content fail safely with possible billing.
- IAM implicit/explicit Deny, limits and required audit block invocation. No incomplete text, stop_details or keys enter metadata audit, usage or errors. See [contract](../contracts/anthropic-refusals.md).

## Gemini SAFETY completions

- Both prefixes and actual SDK receive null-content/content_filter for documented empty SAFETY blocks. Usage is preserved or marked missing/invalid; a configured fallback is not invoked after delivery.
- Multi-candidates, bad indexes, populated/malformed content, contradictory prompt block/candidates and empty no-signal responses fail safely with possible billing. Other native reasons remain deferred.
- IAM implicit/explicit Deny, limits and required audit prevent upstream calls. No feedback/content/keys enter metadata audit, usage or errors. See [contract](../contracts/gemini-safety.md).

## Frequency and presence penalties

- Both prefixes and SDK preserve independent/combined negative/zero/positive values, null/omission defaults and native field mapping. Google penalty-only calls create only requested generation settings.
- Malformed HTTP values reject before routes; native invalid/nonfinite values and unsupported Anthropic controls reject before secrets. Scalar capture prevents secret-await mutations from changing native payloads.
- IAM, limits and required audit block invocation; provider failures preserve safe usage and metadata. Model-dependent support and capability selection remain pending. See [contract](../contracts/client-penalties.md).

## Portable response formats

- Both prefixes and actual SDK map text/JSON on supported adapters with omission parity and immutable capture during credentials; combined controls remain intact.
- Malformed/null/extra-key/unsupported formats reject before routing; native invalid formats reject before secrets. Anthropic JSON fails before secret/transport, with possiblyBilled=false and no fabricated usage row.
- IAM/limits/required audit continue to block invocation. Upstream failures retain safe usage accounting and no content/key exposure.
- Model-dependent native generation, JSON schemas, Anthropic JSON and capability-aware selection remain incomplete. See [contract](../contracts/client-response-formats.md).

### Supported-format schema drift

- The selected official projection includes all eleven declared request fields plus the exact text/json_object format definitions; changing a selected field or either supported definition must fail comparison even if request references are unchanged.
- Annotation-only or unrelated-definition changes do not produce drift. Missing/malformed selected definitions and rehashed malformed definition maps fail safely; stale version-1 pins reject.
- Offline checks never download a source or rewrite pins; explicit live comparison retains the fixed official host and bounded credential-free transport. Other referenced definitions and full instance/response/tool/stream conformance remain open.

### Combined format and penalty controls

- Given supported OpenAI/OpenRouter/Gemini routes, when an SDK sends text/json_object response format with frequency and presence penalties through either client base path, then all supplied controls reach the native payload and normal usage accounting remains effective.
- Credential resolution must not permit caller mutations to replace any validated format or penalty.
- Direct Anthropic text format with null/omitted penalties succeeds; JSON format or supplied non-null penalties fail before credentials with no provider usage record.

### Nullable client seed

- Both base paths and actual SDK requests preserve omitted/null defaults and exact negative/zero/positive safe integer seeds on supported destinations, including existing output-format/sampling/token controls.
- Malformed or unsafe integers reject before routing. Native adapters repeat validation, retain pre-await values and prevent unsupported Anthropic or out-of-int32 Gemini calls before credentials.
- Gemini seed-only requests create generationConfig without other injected settings. IAM implicit/explicit denial, limits and required audit still prevent secrets and upstream usage; transport failures retain safe accounting.
