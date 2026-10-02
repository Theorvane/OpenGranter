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
- Version-4 selection detects structural and required-list changes to function-tool request controls, tool definitions, assistant tool calls and tool-result messages; missing/malformed selections reject safely and editorial changes remain ignored.
- Version-5 selection detects structural and required-list changes to four official streaming response definitions. Missing/malformed/rehashed maps fail safely; editorial and unrelated schemas are ignored.
- Other referenced schemas, full request/response instance validation and streaming/tool/client gates remain open. See [contract](../contracts/openrouter-schema-drift.md).

## Streaming SSE framing preparation

- A bounded parser yields complete data events with CR/LF/CRLF, split UTF-8, comments, multiline data and blank-line dispatch; incomplete EOF data is discarded.
- Invalid UTF-8, oversized lines/events and transport failures produce fixed diagnostics without upstream content. Early iteration cancellation closes the source; successful EOF releases its lock.
- Gateway `stream:true` requests remain rejected until provider chunk validation, HTTP delivery, usage and audit lifecycle are implemented. See [contract](../contracts/streaming-sse-framing.md).

## OpenRouter text-stream chunk validation

- A pure decoder identifies single-choice text deltas, supported finish reasons, OpenRouter's content-free usage chunk, an empty-choice usage compatibility variant, `[DONE]` and a top-level error even as the first payload.
- Wrong model, malformed identity, multiple choices, unsupported tool/rich deltas and ambiguous usage frames reject with a fixed message. Upstream error details never appear in returned error markers.
- Usage counters retain known, missing and invalid markers for later accounting. Stream ordering, native provider mappings, client SSE, IAM, limits, audit and usage persistence remain separate gates. See [contract](../contracts/openrouter-stream-chunks.md).

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

### Nullable top-k control

- Both compatible bases and SDK serialization preserve null/omission defaults and exact zero/positive safe integers across supported native mappings, retaining output-token, temperature, top_p, stop and text-format controls.
- Invalid client inputs reject before routing; direct OpenAI controls and out-of-int32 Gemini values reject before credentials/transport with no fabricated usage record.
- Native credential-await mutation cannot replace captured values. Gemini settings-only requests create generationConfig without other defaults. IAM implicit/explicit denial, limits and required audit still prevent provider calls; upstream failures preserve safe accounting.

### Nullable client seed

- Both base paths and actual SDK requests preserve omitted/null defaults and exact negative/zero/positive safe integer seeds on supported destinations, including existing output-format/sampling/token controls.
- Malformed or unsafe integers reject before routing. Native adapters repeat validation, retain pre-await values and prevent unsupported Anthropic or out-of-int32 Gemini calls before credentials.
- Gemini seed-only requests create generationConfig without other injected settings. IAM implicit/explicit denial, limits and required audit still prevent secrets and upstream usage; transport failures retain safe accounting.

### Seed/top-k official schema drift

- The exact thirteen-field source projection detects integer, nullability and structural-constraint changes to seed/top_k, and missing/malformed selected fields fail safely.
- Recomputed integrity hashes do not permit stale, extra or malformed selected-field maps. Annotation-only changes remain ignored.
- Explicit live comparison preserves bounded credential-free fixed-host fetching and never rewrites the pin. Runtime model support, native provider schemas and full instance/response/tool/stream/client conformance remain separate requirements.

### Optional message names

- Both compatible bases and actual SDK requests preserve optional names on system/developer/user/assistant text messages for OpenAI/OpenRouter, including text-array normalization and exact empty/space/Unicode values.
- Null/non-string names, unknown message keys and late instructions reject before routing. Direct Anthropic/Gemini supplied names reject before credentials/transport with no provider usage row.
- Credential-await mutation cannot replace captured name/content. Caller names cannot grant privileges, select a principal or alter limit/audit/usage attribution; metadata/errors never expose names or message text.
- Existing IAM denial, limits, required audit and safe failed-provider accounting remain effective.

### Referenced message-name drift

- Detect name type/nullability/bounds/literal-default and required-status changes in each selected text-role definition with unchanged request references.
- Reject missing/malformed names, message containers, required lists and stale/rehashed malformed message maps with fixed diagnostics.
- Ignore annotations and unrelated message fields; retain thirteen request fields and two selected format definitions.
- Preserve credential-free bounded fixed-host retrieval, runtime IAM/usage/audit semantics and the explicit limits of structural subset coverage. See [plan](plans/168-message-name-schema.md).

### Non-streaming system fingerprints

- Preserve omitted/string/null fingerprints on both OpenAI/OpenRouter client prefixes, normal/refusal/filter responses and installed SDK bases.
- Reject malformed upstream types safely after the response with failed-attempt accounting and no fingerprint/content leakage.
- Deny IAM, limit and audit failures before transport; do not synthesize native Anthropic/Gemini fingerprints.
- Full response/stream conformance and deterministic behavior remain open. See [plan](plans/170-system-fingerprint.md).

### Unsupported upstream invocation responses

- Preserve validated non-streaming function tool_calls with matching tool_calls finish reason through both OpenAI/OpenRouter paths and actual SDK bases; reject malformed/mismatched calls and non-null legacy function_call safely.
- Preserve ordinary text/refusal/filter outcomes with omitted/null/empty modern fields and omitted/null legacy fields.
- Keep possibly-billed failure accounting and prevent function names/arguments/content in errors or metadata; IAM, limits and audit denials never call upstream.
- Full tool workflows remain open under #116. See [plan](plans/172-unsupported-tool-output.md).

### Upstream finish reason validation

- Preserve stop/length/content_filter/explicit null across both OpenAI/OpenRouter bases and SDK paths.
- Reject error, invocation/unknown, malformed and missing reasons safely with possibly-billed failure accounting and no reason/body leakage.
- Preserve ordinary/refusal/filter message validation and IAM/limit/audit denial gates before upstream transport.
- Streaming/tools, full response schema and precise retry categories remain open. See [plan](plans/174-upstream-finish-reasons.md).

### Direct native stop reasons

- Anthropic end_turn/stop_sequence/max_tokens and Gemini STOP/MAX_TOKENS retain stop/length semantics on both compatible paths and SDK bases.
- Existing bounded Anthropic refusal and Gemini SAFETY outcomes retain content_filter.
- Reject unsupported/malformed/missing native reasons, including tool, paused-turn, recitation and invalid-function outcomes, even when text is present; record possibly billed failures without exposing reason/body.
- IAM/limit/audit denial gates remain ahead of transport; full native blocked/tool/stream mappings remain open. See [plan](plans/176-native-stop-reasons.md).

### Nullable logit bias

- Preserve omitted/null and exact finite map values, including empty/Unicode keys and empty maps, across both HTTP prefixes and installed SDK bases.
- Reject malformed HTTP maps before routing and native malformed/unsupported maps before secrets; only direct OpenAI and delegated OpenRouter forward non-null maps.
- Capture maps before credential awaits. IAM, limits, required audit, principal attribution and safe failed-attempt usage remain effective without key/value leakage.
- Per-model native support, source-drift coverage for this field, tool/stream/client completeness remain open. See [plan](plans/178-client-logit-bias.md).

## Function-tool request and response subset

- Both chat paths and the installed OpenAI SDK carry validated function-tool declarations, choice and parallel-call flags to OpenAI/OpenRouter with exact nested schema snapshots.
- Malformed controls and OpenRouter server tools reject before HTTP routing; native malformed controls and direct Anthropic/Gemini supported controls reject before credential lookup.
- Both compatible bases and actual OpenAI SDK preserve valid non-streaming function call IDs, names, argument strings and tool_calls finish reason; string/null/omitted content normalizes safely.
- Malformed, duplicate, mismatched and legacy calls fail with possibly-billed usage and no sensitive metadata. Ordinary text/refusal/filter outcomes stay unchanged.
- IAM deny, explicit deny, limits and required audit prevent transport. Text-only tool-result history is covered separately; streaming and native Anthropic/Gemini mappings remain open. See [request plan](plans/180-function-tool-requests.md), [response plan](plans/182-function-tool-responses.md) and [response contract](../contracts/function-tool-responses.md).

## Function-tool history subset

- Both chat bases and the installed OpenAI SDK complete a non-streaming function declaration, assistant call, tool result and second model response on direct OpenAI and delegated OpenRouter.
- Multiple call IDs preserve exact arguments and match one result each in either order; text-part tool results normalize to strings, omitted assistant call content becomes null, and an empty call array preserves ordinary text history.
- Orphan, duplicate, interrupted and unresolved call groups reject before routing; valid history on direct Anthropic/Gemini rejects before credentials.
- Continuation requests retain IAM, limits, required audit and usage accounting without tool payloads in metadata or errors. Streaming, server tools, rich content and native tool translation remain open. See [plan](plans/184-function-tool-history.md) and [contract](../contracts/function-tool-history.md).

## Internal OpenRouter text-stream sequence

- Decoded text deltas with stable response ID and client model alias, one terminal finish reason, one final usage frame and `[DONE]` produce a complete immutable summary with normalized usage and no retained response text.
- The empty-choice usage variant may omit a repeated finish reason; when present it must match. Missing and invalid usage counters remain explicit.
- Identity changes, out-of-order or duplicate terminal/usage/done events and incomplete EOF fail with one fixed safe error marked possibly billed. The first invalid event permanently invalidates the sequence.
- First-event and midstream upstream error events produce a distinct safe possibly billed failure. Neither result contains upstream error details or response content.
- This is an internal validator only. Client `stream:true` remains rejected pending transport, IAM/limits, usage/audit and provider/client stream integration. See [plan](plans/192-openrouter-stream-sequence.md) and [contract](../contracts/openrouter-stream-sequence.md).

## Internal OpenRouter byte-stream consumption

- Fragmented upstream SSE bytes are framed and decoded under a captured authorized model scope; each validated text delta reaches an awaited callback in order. Terminal usage and `[DONE]` produce a complete immutable summary.
- `[DONE]` and first/midstream upstream errors stop reading and cancel the remaining source. Upstream errors return a distinct safe possibly-billed outcome.
- Malformed framing/chunks/order, interrupted transport, incomplete EOF and callback rejection fail with a fixed possibly-billed error, release the reader, and omit sensitive causes and response content.
- The internal consumer does not call a provider, send client SSE, persist usage/audit or enable `stream:true`. See [plan](plans/196-openrouter-stream-consumer.md) and [contract](../contracts/openrouter-stream-consumer.md).

## Internal OpenRouter stream HTTP response validation

- HTTP 200 with an SSE media type and body enters the bounded stream consumer; a complete terminal/usage/done sequence returns normalized usage and delivers only validated text deltas.
- HTTP 429, 5xx and other statuses receive existing safe delegated failure categories without reading upstream bodies. Wrong/missing media type or body, upstream SSE error, invalid/truncated stream and callback failure remain possibly billed upstream failures.
- Rejected unread response bodies are cancelled, and errors never include response content, callback causes or credentials. Non-streaming behavior remains unchanged.
- Provider HTTP invocation, client SSE, usage/audit persistence and direct-provider streaming remain future work. See [plan](plans/198-openrouter-stream-response.md) and [contract](../contracts/openrouter-stream-response.md).

## Delegated OpenRouter attempt scope snapshot

- The delegated adapter copies and validates the selected upstream model and exact authorized provider slug set before credential resolution.
- Mutating model or provider slugs, including array elements or replacement, during the credential await cannot change the outgoing HTTP scope or the accepted response model.
- Invalid initial attempts stop before secret/network access; existing safe failure, IAM, limits, audit and usage behavior remains in force. The same scope boundary is available to the future streaming invoker. See [plan](plans/200-openrouter-attempt-snapshot.md) and [contract](../contracts/openrouter-attempt-snapshot.md).

## Internal delegated OpenRouter text-stream invocation

- A fixed-endpoint `stream:true` POST uses the captured authorized model/provider set, server-held key, redirect rejection, bounded timeout and shared text/sampling request snapshots. The response reaches the bounded SSE validator; validated deltas arrive in order and final usage is returned only after terminal/usage/`[DONE]`.
- Invalid scope, tool controls, request shape, timeout and missing credential fail before HTTP. Mutating model/provider inputs during credential resolution does not change the outgoing scope.
- HTTP errors, malformed/incomplete SSE, redirect/transport failures and pre-/post-header timeouts remain fixed safe possibly-billed failures. A partial response cannot be replayed.
- The public chat handler still rejects client `stream:true`. Gateway IAM, limits, required audit, usage persistence, client SSE and direct-provider stream mappings remain integration gates. See [plan](plans/202-openrouter-stream-invoker.md) and [contract](../contracts/openrouter-stream-invoker.md).

## Internal OpenRouter client text SSE encoding

- A decoded authorized text delta yields one `chat.completion.chunk` SSE data frame with the client model alias, supported role/content and exact finish reason; embedded newlines cannot create a second frame.
- Complete valid final usage yields the documented usage shape, including the repeated finish reason or accepted empty-choice variant. Missing or invalid counters yield no usage frame and remain visible to later accounting without invented values. `[DONE]` emits the exact terminal marker.
- Upstream error and unsupported events fail with a fixed local error. The encoder does not open a public stream or bypass IAM, limits, usage or audit integration. See [plan](plans/204-openrouter-client-sse.md) and [contract](../contracts/openrouter-client-sse.md).

## Controlled delegated text-stream composition

- Model/final-provider IAM, verified provider mapping, limits and required selection audit run before any scoped upstream stream or client delta frame. Deltas use the authorized client model alias and awaited output callback.
- A complete validated attempt records usage and a success audit before the composition returns final usage and `[DONE]` frames. Missing/invalid usage is retained in accounting without fabricated client counters.
- Denial, upstream/output failure, invalid trusted outcome and required usage/audit failure return no terminal success frames. Possibly billed failures use the existing failed-attempt record and audit path. Public `stream:true`, HTTP delivery, interruption and direct-provider streams remain open. See [plan](plans/206-delegated-text-stream.md) and [contract](../contracts/delegated-text-stream.md).

## HTTP client disconnection

- A client disconnect before response creation aborts the Fetch Request signal. Interrupted uploads and disconnects during progressive response delivery do the same; downstream loss cancels the active response body.
- A normally completed response does not abort the signal. The bridge removes lifecycle listeners and never writes a JSON fallback to a destroyed socket or after streaming headers.
- This socket boundary does not enable chat streaming or replace required usage and interruption audit. See [contract](../contracts/http-client-disconnection.md).

## Internal OpenRouter stream cancellation

- Already aborted and credential-await cancellation prevent HTTP and billable attempt creation. A pending fetch or stalled body abort is safe, possibly billed once dispatched, and never retried.
- Cancellation after headers keeps response-started metadata, stops buffered delta delivery and cleans up reader locks/listeners. Caller reasons and provider content remain outside error, audit and usage metadata.
- The delegated composition records a dispatched cancellation as one failed attempt with unknown usage and emits no terminal success frames. Omitted signals and timeouts retain existing behavior. See [contract](../contracts/openrouter-stream-cancellation.md).

## Delegated client HTTP text streaming

- Both bases and the pinned SDK receive incremental delegated text frames only after authentication, model/provider IAM, verified mapping, limits and selection audit. Slow body consumers bound pending output to one frame.
- Pre-frame denials/failures retain safe JSON statuses. Started upstream, usage or required audit failures emit one sanitized SSE error, EOF and no DONE. Final usage/DONE follow successful required handoffs.
- Request/body cancellation stops pending writes and upstream work. Interrupted delivery emits metadata-only audit. Cancellation after accounting preserves one successful attempt without replay/duplicate accounting.
- Managed/tool streaming and unknown stream options reject before inference; non-streaming behavior remains covered. See [contract](../contracts/delegated-http-stream.md).

## Delegated stream usage options

- Both bases and the pinned SDK accept null/empty/true/false options on delegated streams. False retains final usage, required handoffs and all denial/limit/interruption controls; missing usage remains unknown.
- Malformed, unknown-field and non-null nonstream options reject before routing/secrets. Native requests retain frozen values across credential awaits.
- Source drift detects the request reference and nested option type/deprecation changes. See [contract](../contracts/stream-usage-options.md).

## Delegated stream fingerprints

- Both bases and SDK streamed text/terminal/final usage frames preserve exact string/null metadata and omission; source usage metadata may differ from prior text/terminal metadata.
- Malformed first/later values produce safe JSON/SSE failures with failed-attempt accounting and no DONE; IAM/limits and required audit/ledger controls remain enforced.
- Fingerprint framing text cannot inject SSE, and fingerprint values never appear in operational audit, ledger metadata or errors. Missing token usage still produces no fabricated usage frame. See [contract](../contracts/stream-fingerprints.md).

## Official SDK socket conformance

- The exact pinned official OpenRouter TypeScript SDK is exercised against actual local sockets on both bases, with deterministic fake upstream responses through the real delegated invoker.
- Streamed request controls, text/usage/termination, unknown usage and safe denial/failure cases retain security/accounting; upstream request contents and secrets never enter operational metadata.
- Actual SDK nonstream/discovery schema gaps are documented explicitly without fabricated metadata or complete-compatibility claims. See [plan](plans/224-official-sdk.md) and [contract](../contracts/official-openrouter-sdk.md).

## Compatible midstream error chunks

- /api/v1 started upstream/ledger/audit failures include delivered chunk identity and one index-zero content-free finish_reason:error choice. Numeric safe error/request_id remain; EOF and no DONE follow.
- Pre-frame invalid deltas retain JSON/status; invalid later deltas cannot replace delivered identity. Legacy /v1 has no added chunk fields.
- Callback metadata is frozen and contains only id/created/model. Actual SDK failures retain safe error messages, failed-attempt accounting and interruption audit. See [contract](../contracts/midstream-error-chunks.md).

## Unknown compatible completion fingerprint

- Omitted/undefined native fingerprints become null on /api/v1 normalized nonstream completions and deserialize in the pinned official SDK. Supplied exact strings/null survive; /v1 and native omission remain unchanged.
- Managed/delegated success returns clone rather than mutate response objects; opaque payloads, SSE and errors are unchanged. Native malformed failures, IAM/limits and required audit/ledger failures retain safe accounting. See [contract](../contracts/compatible-completion-fingerprints.md).


## Delegated streaming refusal outcomes

- Both chat bases and SDK streaming preserve exact refusal string/null/omission, content coexistence and content_filter termination, with successful usage persistence before final frames.
- Malformed first/later refusal values and substantive refusal in usage-only chunks fail safely with possible-billing accounting and no DONE.
- IAM/limits and required audit/ledger failure gates still apply; refusal text and framing tokens stay out of operational metadata/errors and cannot inject SSE. Missing usage stays unknown. See [contract](../contracts/stream-refusals.md).

## Logit-bias schema drift

- Source object/null, additionalProperties numeric type/format and key/count/value constraints cause drift; missing/malformed fields fail safely. Editorial annotations/unrelated source fields are ignored while literal defaults remain data.
- Version 7 requires an exact eighteen-field map and valid provenance/integrity. Rehashed missing/extra/malformed maps and stale versions reject. Runtime IAM/limits/audit/usage behavior is unchanged. See [plan](plans/220-logit-bias-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Streaming native finish reason scenarios

Delegated text streaming preserves exact optional native_finish_reason string/null on choices through both HTTP bases, including the actual repeated-finish usage event. Final metadata never falls back to earlier deltas, and empty-choice usage supplies none. Incomplete usage remains unknown to clients; malformed metadata fails safely even with incomplete usage. Canonical reasons, IAM, limits, required usage/audit gates and operational secrecy remain unchanged. Ordinary and terminal chunks, safe first/later failures, denial paths and actual OpenAI SDK retention are covered by [contract](../contracts/stream-native-finish-reason.md) and [plan](plans/266-stream-native-reason.md). Current official ChatStreamChoice and the pinned OpenRouter SDK omit this extension; SDK stripping and source coverage remain explicit gaps. Managed/tool streaming, full instance conformance and release gate #116 remain open.

## Delegated verbosity scenarios

Both chat bases accept optional nullable verbosity with low/medium/high/xhigh/max for delegated nonstream and text streaming. Capture and forward supplied values exactly without defaults; null is a local omission allowance. Invalid values reject before routing, and native Google Gemini rejects supplied non-null values before credentials; direct OpenAI supports low/medium/high and Anthropic maps all five levels to effort. Existing IAM, limits, required accounting/audit, fixed destination scope and operational secrecy remain unchanged. Public HTTP, immutable request, tool-history and SDK cases are covered by [contract](../contracts/client-verbosity.md) and [plan](plans/268-client-verbosity.md). Current official ChatRequest and pinned OpenRouter SDK omit this documented field; SDK stripping, native capability mappings and source drift selection remain explicit gaps. No complete compatibility claim; release gate #116 remains open.

## Direct OpenAI verbosity scenarios

Registered direct OpenAI nonstream chat forwards optional low/medium/high verbosity at top level on both HTTP bases. Null/omission inject no field/default; xhigh/max on direct OpenAI and non-null Gemini values reject before credentials; Anthropic maps all five levels to effort. Exact capture, sampling/output/tool controls, IAM, limits, required ledger/audit and safe possibly-billed failures remain effective. HTTP and actual SDK cases are covered by [contract](../contracts/client-verbosity.md) and [plan](plans/270-openai-verbosity.md). Model capability differences, Google mapping, native thinking/rich responses, managed streaming and OpenRouter source/SDK gaps remain explicit. Depends on PR #269; release gate #116 remains open.

## Direct Anthropic verbosity scenarios

Registered direct Anthropic nonstream chat maps optional low/medium/high/xhigh/max verbosity to output_config.effort through both HTTP bases. Null/omission inject no output_config/default; no beta header or thinking configuration is added. Preserve native output caps, sampling/instruction translation, immutable capture and IAM/limits/required ledger/audit controls. Model support differs; existing non-text/thinking blocks still fail safely with possibly-billed accounting. Tests cover HTTP, actual compatible SDK sockets and that response limitation. See [contract](../contracts/client-verbosity.md) and [plan](plans/272-anthropic-verbosity.md). Depends on #271/#269; Google/native stream/thinking response/source/SDK compatibility and release gate #116 remain open.

## Delegated reasoning effort scenarios

Both chat bases accept optional nullable reasoning_effort with max/xhigh/high/medium/low/minimal/none for delegated nonstream and text streaming. Capture and forward exact supplied values without defaults; approved model/provider scope, IAM, limits, output controls and required accounting/audit stay unchanged. Invalid values reject before routing, while direct Anthropic and unsupported Gemini values reject before credentials; direct OpenAI and the bounded Gemini subset map native fields. Actual SDK mapping and public-boundary cases are covered by [contract](../contracts/client-reasoning-effort.md) and [plan](plans/274-reasoning-effort.md). Fresh official OpenAPI and pinned SDK include max, unlike the shorter parameter overview. Structured reasoning, other native mappings, richer request/history/response and structural drift selection remain explicit gaps; request forwarding alone does not certify full reasoning compatibility. The direct OpenAI extension depends on PR #275; release gate #116 remains open.

## Direct OpenAI reasoning effort

Direct OpenAI forwards optional none/minimal/low/medium/high/xhigh/max as native reasoning_effort on nonstream requests through both bases. Null/omission inject no field or default; capture occurs once before credentials. Anthropic and unsupported Gemini non-null values reject before secrets, and managed streaming remains unsupported. IAM, Deny, limits, required audit/ledger and safe possibly-billed errors retain existing behavior. Model support/defaults differ; forwarding does not certify native reasoning response/history/usage capabilities or structured reasoning. See [plan](plans/278-openai-reasoning-effort.md) and [contract](../contracts/client-reasoning-effort.md).

## Direct Gemini thinking levels

Direct Gemini maps optional minimal/low/medium/high to generationConfig.thinkingConfig.thinkingLevel without changing maxOutputTokens or other native settings. Null/omission add no thinking config/default; none/xhigh/max reject before credentials. No budget or nearest-level alias is invented. Models support different levels and Gemini 2.5 requires separate budgets; upstream capability rejection remains safely accounted. Returned thought:true or malformed thought flags fail safely instead of merging thinking into visible text; absent/false flags retain ordinary text behavior. IAM, Deny, limits, required audit/ledger and billing uncertainty remain shared. Thinking signatures/history/token details and managed streams remain gaps. Anthropic reasoning-effort mapping and its interaction with verbosity remain unresolved. See [plan](plans/280-gemini-reasoning-effort.md) and [contract](../contracts/client-reasoning-effort.md).

## Trusted OpenRouter discovery metadata

- Complete administrator snapshots persist and deserialize through the exact official SDK socket client; empty IAM-filtered lists have count zero. Legacy/missing metadata behavior stays explicit.
- Alias and provider explicit Deny, disabled entries and both route kinds retain filtering; no secret/limit/inference/usage ports run. Filtered counts do not leak hidden aliases.
- Partial/unknown/malformed snapshots, including disabled or denied entries, fail safely before a partial listing. Required audit failure suppresses metadata; mutation during audit cannot alter client output. SQL reads and route resolution reject invalid stored snapshots.
- Metadata prices/capabilities are informational, never billing/routing authority. Source refresh, broader query filters and complete external-client conformance remain open; bounded paging is covered below. See [contract](../contracts/model-discovery-metadata.md).

## Compatible model-list paging

- Actual official SDK iteration handles explicit/default/null-offset requests, exact multiples with a terminal empty request and a 501-model no-argument response. No-query full listing and legacy query rejection remain covered.
- Denied/disabled/provider-denied aliases never consume offsets or leak counts/links; both route kinds retain explicit Deny. Complete invalid out-of-page configuration and required audit failure suppress successful responses.
- Malformed/duplicate/unknown/unsafe query values reject before catalog reads with safe audit; anonymous requests reject before query/catalog access. Relative links never use the incoming host.
- Every SDK page reevaluates current IAM; newly denied metadata disappears. Cross-request snapshot stability and broader filters remain open. See [contract](../contracts/model-list-paging.md).

## Official SDK function-tool lifecycle

- Actual SDK sockets on both bases and both supported route kinds serialize function declarations, named choice and parallel controls, deserialize exact call IDs/names/arguments, and send returned calls with complete text-only results to obtain a final text response.
- Each inference request authenticates/checks limits and records separately attributed usage. Fresh authentication, explicit model/provider Deny, limits and required selection audit prevent a second dispatch; orphan results reject before route lookup.
- Malformed upstream calls fail with safe possibly-billed accounting. Required outcome-audit failure suppresses success after upstream usage persistence. Operational metadata excludes credentials, prompts, tool arguments/results and response content. See [contract](../contracts/official-sdk-tools.md).

## Referenced finish-reason schema drift

- Changing enum membership, nullability/type, constraints, unknown-value extension or literal defaults causes drift even when ChatStreamChoice.finish_reason keeps the same reference. Editorial annotations and unrelated definitions remain ignored.
- Missing/malformed source definitions and rehashed invalid selected maps fail safely. Version 8 retains eighteen request fields and exactly seven selected definitions, rejects versions 1..7 and preserves prior projections/provenance. No runtime reason is newly accepted. See [plan](plans/236-finish-reason-schema.md).

## Delegated streaming reasoning deltas

- Both bases and official SDK sockets preserve reasoning string/null/omission, Unicode/framing text, content/refusal coexistence and complete/unknown usage with include_usage:false. Final usage never replays reasoning.
- Malformed first/later reasoning fails safely with possible-billing accounting and no terminal success; substantive reasoning on a final usage-only event rejects instead of disappearing. reasoning_details stays unsupported.
- Authentication/IAM/limits and required audit/usage failure gates remain effective. Reasoning text stays out of operational metadata, errors and completed summaries. See [contract](../contracts/stream-reasoning.md).

The independent SSE encoder rejects substantive or malformed reasoning on injected usage events before missing-token early returns, preserves absent/null/empty markers without transcript replay, and projects the same once-captured delta value it validated. See [review correction](plans/238-stream-reasoning.md).

## Non-streaming assistant reasoning content

- Both supported route kinds/prefixes preserve omitted/null/empty/Unicode reasoning on already-valid text/refusal/filter/tool responses. Empty length-terminated text remains valid; reasoning-only null/missing-content output remains rejected.
- Malformed values fail safely after dispatch with failed possible-billing accounting and no content in errors/metadata. Fresh authentication, explicit model/provider Deny, limits and required selection/outcome audit/usage failures retain delivery gates. Missing usage stays unknown.
- Actual official SDK sockets receive omitted/null/string reasoning on both bases and supported route kinds. No native/request/structured reasoning support is claimed. See [contract](../contracts/nonstream-reasoning.md).


## Nonstream response source drift

Required-field, fingerprint nullability, choice references and assistant content/reasoning/refusal/tool-call structure changes cause drift even when references remain unchanged. Editorial annotations remain ignored and literal defaults remain data. Missing/malformed paths or selected definitions, rehashed incomplete/extra/malformed maps and stale versions 1..8 reject safely. Version 9 preserves prior projections and source provenance. See [plan](plans/242-response-schema.md).


## Chat usage source drift

Token counter type/required/bounds, inline cached/reasoning details, nullable cost/format, cost/server-tool references and counters cause drift. Annotation-only and unrelated native usage changes remain ignored; literal default keys remain data. Missing/malformed source definitions and rehashed absent/incomplete/extra/malformed maps fail safely. Version 10 rejects versions 1..9 and preserves every prior projection. See [plan](plans/244-usage-schema.md).


## Compatible nonstream usage availability

Actual official SDK sockets accept missing/partial/invalid normalized usage on /api/v1 with usage omitted and exact text preserved. Complete/zero counters survive; /v1 sparse counters and ledger missing/partial/invalid states remain. Managed/delegated and native normalization, immutable projection, authentication/model-provider Deny/limits and required ledger/outcome-audit failures retain public-boundary security and privacy behavior. See [plan](plans/246-compatible-usage.md).


## Nonstream service tier metadata

Both public chat bases and pinned SDK sockets preserve exact service-tier string/null/omission in text/refusal/filter/tool outcomes. Malformed values fail safely with failed-attempt/possibly-billed accounting. Denials, required ledger/outcome-audit failures and metadata privacy remain shared. Scalars are captured once; native unrelated fields stay omitted and client tier controls reject before dispatch. See [plan](plans/248-service-tier.md).


## Delegated stream service tier metadata

Both bases and actual official SDK sockets preserve exact streamed tier string/null/omission with safe JSON framing and independent final usage metadata. Missing usage emits no invented frame. Malformed first/later values fail safely with possible-billing accounting and no DONE; denial/limit/required ledger/audit gates remain. Callback identity and operational metadata contain no tier. See [plan](plans/250-stream-service-tier.md).


## Delegated min-p sampling subset

Both prefixes and actual OpenRouter/OpenAI SDKs preserve min_p zero/fractions/one on delegated nonstream and text-stream requests; null/omission retains defaults. Malformed HTTP/native/nonfinite values reject before routes/secrets, unsupported direct mappings fail before transport, and single-read/credential-await capture remains immutable. Denial/limits/required ledger/audit and safe transport accounting remain shared. Source pin does not yet select min_p. See [plan](plans/252-min-p.md).

## Min-p request source drift

Changes to min_p type/nullability/format, future bounds and literal defaults cause drift. Annotation-only changes are ignored. Missing/malformed sources, rehashed missing/extra/malformed field maps and stale versions 1..10 reject safely; all prior selections remain unchanged. See [plan](plans/254-min-p-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated top-a sampling subset

Both prefixes and actual OpenRouter/OpenAI SDKs preserve top_a zero/fractions/one on delegated nonstream and text-stream requests; null/omission retains defaults. Malformed HTTP/native/nonfinite values reject before routes/secrets, unsupported direct mappings fail before transport, and single-read/credential-await capture remains immutable. Denial/limits/required ledger/audit and safe transport accounting remain shared. Source pin does not yet select top_a. See [plan](plans/256-top-a.md).
