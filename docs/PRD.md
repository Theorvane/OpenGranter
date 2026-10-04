# OpenGranter Product Requirements

Status: Dual routing direction, routing controls, fallback boundary, provider-level authorization, and first adapters are agreed; audit and operational settings remain open. Updated 2026-09-27.

## 1. Problem and goal

LLM subscriptions and API keys spread across teams make it difficult to revoke access, control models, attribute cost, and audit use. OpenGranter will expose approved models through one internal API and answer **who used which model, through which route, under which permission, and how much**. It can add IAM and audit controls in front of an existing OpenRouter account or route directly to registered model providers.

Success means unauthorized principals cannot obtain provider credentials or invoke models; administrators can inspect permissions and usage by principal, role, and model; and auditors can trace permission changes and denied calls.

## 2. Users

| User | Primary task |
| --- | --- |
| Platform administrator | Register provider subscriptions, model mappings, and secret references; manage policies and limits |
| Developer | Call authorized models through one internal endpoint |
| Service account | Let an internal application call authorized models without a human session |
| Team administrator | Inspect team users and usage; delegated administration scope remains undecided |
| Auditor | Review and export configuration changes, denials, credential events, and usage history |

## 3. Initial release scope

1. **Catalog and routes:** Register an OpenRouter upstream and direct OpenAI, Anthropic, and Google Gemini upstreams, their secret references, approved model aliases and routes, and versioned price information. Never redisplay a raw upstream credential in the UI.
2. **Identity:** Distinguish human users from service accounts. Human users sign in through company SSO; issue and revoke service-account credentials. Proxy tokens use an opaque versioned format with a random lookup ID and secret, a stored digest, explicit expiry, and immediate revocation. A trusted internal management coordinator evaluates `iam:Manage` on the token owner's `principal:<id>` before issue or revoke. The SSO protocol, HTTP management API, and maximum token lifetime are undecided.
3. **Authorization:** Attach policies to principals and roles. Evaluate principal, action, resource, and supported conditions on every request. Deny by default and give explicit Deny precedence. A PostgreSQL reader can load a principal's direct and inherited policy snapshot from one consistent SQL statement; an internal policy simulator can evaluate a current persisted principal/action/resource and return only the decision and policy versions. Simulation checks IAM only and does not grant execution; public simulator authentication, reader visibility, and access audit remain undecided. Policy-management writes remain separate work.
4. **Gateway and routing:** Provide the core OpenAI-compatible `POST /v1/chat/completions` and `GET /v1/models` shapes. A delegated route sends an authorized request to OpenRouter; a managed route has OpenGranter choose among registered direct OpenAI, Anthropic, and Google Gemini adapters. Both use the same proxy-token, policy, limit, and audit path. The routing controls resemble OpenRouter's: administrator-approved provider allowlists and order, price/latency/throughput preferences, health-aware selection, optional Jev-assisted selection, and bounded fallback. Jev may recommend only a destination that passed all OpenGranter eligibility checks. Fallback may try another authorized candidate of the same route kind; it cannot silently switch between delegated and managed routes. Reject unsupported fields and routing overrides clearly. Delegated text streaming is implemented; direct-provider, tool and complete external-client streaming remain required release work.
5. **Usage:** Record request ID, principal, credential ID, requested alias, route kind, upstream, actual model and provider when known, timestamp, status, latency, input and output tokens, estimated cost, and upstream-reported cost separately. Represent unavailable token usage as unknown.
6. **Audit:** Record authentication and credential events; policy, role, model, and provider changes; access decisions; and credential revocation. Include actor, target, time, outcome, and request ID. Make prompt and response retention configurable for company audit needs. Default behavior, configuration scope, retention, and reader permissions remain undecided.
7. **Review:** Filter usage and audit events by time, principal, and model, and export CSV. Ordinary users see only their own usage.

## 4. Authorization semantics

The initial resource formats include `model:<alias>` and `provider:<inference-provider-id>`. The starting action set is `llm:InvokeModel`, `llm:UseProvider`, `llm:ListModels`, `usage:ReadSelf`, `usage:ReadAll`, `audit:Read`, `iam:Manage`, and `catalog:Manage`. For usage history, `usage:ReadSelf` applies to the authenticated `principal:<id>` resource; specifying `principal_id` requires `usage:ReadAll` on that target resource, even when it names the caller. A candidate is eligible only when the principal may invoke its model and use its inference provider. A policy contains statements with `Allow` or `Deny`. Any matching Deny rejects that candidate; absent a matching Allow on either resource, that candidate is also denied. Evaluated candidates are immutable copies of known route fields, so later in-process source updates cannot change the request’s evaluated destination scope during asynchronous selection, mapping, or fallback. Roles reuse policies across principals. This is not an implementation of the full AWS IAM policy language.

For example, an `analyst` role may allow `model:approved-*`, while a policy attached directly to one principal denies `model:approved-expensive`. Internal denial details may identify the matching policy, but must not expose secrets.

## 5. Main flow

1. An administrator registers OpenRouter or direct provider upstreams, credential references, model aliases, approved routes, and prices.
2. The administrator creates policies and roles and attaches them to human users or service accounts.
3. A principal requests a model alias through the internal API. The gateway authenticates, resolves approved route candidates, evaluates policy, checks limits, and calls OpenRouter or a direct provider according to the selected route.
4. The gateway normalizes usage and records audit events. If content auditing is enabled for this request, it stores prompts and responses separately under the content-audit policy.
5. Authorized readers inspect usage, denials, and permission changes.

The current implementation has an HTTP slice for non-streaming text chat and delegated text streaming (`model`, string-content `messages`, optional `max_tokens`/`max_completion_tokens`, optional `stop`, optional `top_p`, optional `temperature`, and optional `n=1`) and an OpenAI-compatible `GET /v1/models` list of IAM-visible published aliases. Additional supported chat fields are documented below; unsupported fields fail validation, and the release-level supported-field list remains an open decision. Direct OpenAI, Anthropic, and Gemini adapters and a bounded OpenRouter chat adapter cover the chat subset through secret references. A managed route can omit Jev and select the first IAM-eligible direct candidate in administrator order, recording an ordered decision; price, latency, and throughput ranking remain open. The HTTP gateway dispatches a trusted delegated route through IAM filtering, a verified provider-slug mapping port, a limit check, attributed audit, and the OpenRouter adapter. An identity adapter resolves direct and role policy attachments from a trusted snapshot before the HTTP boundary evaluates model and provider permissions. A PostgreSQL-backed proxy-token primitive issues, verifies, and revokes opaque tokens with atomic nonsecret lifecycle events. A trusted internal coordinator checks `iam:Manage`, target ownership, and required decision audit before using that primitive; a PostgreSQL internal factory now composes it with credential storage and persists sanitized allow/deny decisions. An allowed decision does not certify a completed mutation; atomic credential lifecycle events record completion. An internal PostgreSQL service reloads the authenticated actor’s persisted direct and role policies for every token-management operation, so changes affect the next operation without caller-maintained snapshots. Actor IDs must come from trusted prior authentication; actor authentication and a public management API still need implementation. Concurrent policy changes after the snapshot read are not revalidated. Authenticated request and attempt audit events carry nonsecret principal, credential, and policy-version identifiers; unauthenticated failures remain anonymous. A PostgreSQL adapter can append allowlisted gateway and route audit metadata; retention, tamper-resistant export, and exactly-once delivery remain open. The gateway hands one normalized usage record per upstream attempt to an injected ledger port, including possibly billed failures and managed fallback attempts. A PostgreSQL adapter implements idempotent append for that port and is tested against embedded PostgreSQL. A failed handoff does not replay inference. A node-postgres connection factory provides query, dedicated-transaction, and shutdown ports. Deployment startup, recovery, pricing, and reconciliation are still missing. An authenticated `GET /v1/usage` extension supports IAM-scoped self and specified-principal history with bounded pagination validated against deterministic descending occurrence-time/UTF-8 attempt-ID order, exact model-alias filters, and occurrence-time ranges; A bounded CSV page format is available with explicit continuation headers; full-history export jobs and aggregates remain open. A PostgreSQL read adapter now supplies the injected published-model and active-route ports; catalog publication writes remain missing. A PostgreSQL resolver supplies exact model/provider OpenRouter slugs from enabled, administrator-verified mappings; mapping management and operational verification remain separate work. A dual-route handler and unbound server factory now compose both stored direct registrations and the fixed-host OpenRouter adapter with that resolver, sharing authentication, IAM, limits, audit, and usage on one socket. Unbound factories leave migrations and listening/database lifetime to callers. A dual-route owned runtime now loads and applies the complete migration bundle, opens a trusted connection, composes both route kinds, listens on an explicit host/port, and closes HTTP before DB; its lifecycle is shared with the existing direct runtime. A PostgreSQL composition function connects credentials, IAM, catalog, audit, and usage to the HTTP boundary. A Node server factory can expose that composition over HTTP without automatically listening. A migration-gated factory now verifies and applies trusted schema sources before loading registrations and returning an unbound server. A bundled-source loader and convenience factory supply the complete manifest automatically, rejecting missing or unexpected SQL entries before database activity. Deployment code ships the SQL files, owns listening and shutdown, and serializes migrators. A PostgreSQL reader supplies enabled direct-provider registration snapshots containing secret references and validated output limits. An asynchronous handler/server factory can load these snapshots and construct the direct invoker automatically; custom-invocation factories remain available. Live configuration reload and registration-management writes remain missing. A runtime function now loads bundled sources, opens an owned connection through a trusted port, verifies schema, starts HTTP on an explicit host/port, and closes HTTP before the database. CLI/environment configuration, process signals, TLS deployment, shutdown deadlines, limits, secret resolution, and upstream wiring remain deployment work.

A PostgreSQL audit reader returns bounded, sanitized metadata history for one principal. The authenticated `GET /v1/audit` boundary requires `audit:Read` on `principal:<target-id>` even for the caller's own events, supports exact model-alias and occurrence-time range filters, validates the entire page, and records metadata for successful, denied, and unavailable reads. Authorized audit pages can also be downloaded as bounded CSV with explicit continuation headers; full-history/tamper-resistant export jobs remain open. Anonymous and organization-wide audit searches remain open.

## 6. Nonfunctional requirements

- Keep provider keys in a secret manager; keep only references in the application database. Retrieve secrets only for authorized calls.
- Include least privilege, credential rotation and immediate revocation, TLS, encryption at rest, and operator access control in release validation.
- Support export of audit events to tamper-resistant storage. A database row alone does not establish tamper resistance. Protect retained content under separate access and retention rules.
- Identify duplicate requests and disclose possible double billing on provider retries.
- Separate dashboard-reading permissions from model-invocation permissions.
- Support both AWS and on-premises deployment without making AWS IAM a runtime dependency.
- Apply PostgreSQL schema files in version order and verify historical checksums before database-backed adapters start. Production connection and rollout orchestration remain separate work.
- Implement the service and management UI in TypeScript, following [the coding rules](coding.md).

## 7. Out of scope and open decisions

Unrestricted cross-mode fallback, credit resale, every provider-specific API parameter, and multitenancy are outside the initial release. Price-aware managed routing across registered direct providers and an OpenRouter-delegated route are **in scope**. Optional content auditing is **in scope**.

| Decision | Current position |
| --- | --- |
| IAM integration | Internal IAM-style policy engine; no direct AWS IAM integration |
| First users | Internal developers and service accounts |
| First upstreams | OpenRouter plus direct OpenAI, Anthropic, and Google Gemini adapters |
| Managed route selection | OpenRouter-like health and price-aware selection with configurable order, price/latency/throughput preferences, and same-kind fallback. For Jev-assisted direct routes, only explicitly classified failures before any upstream response can retry through the previously authorized candidates once each. Current direct adapters stop after an HTTP 429/5xx response and may retry a pre-response timeout. Exact scoring and budget reservation remain open. |
| Jev-assisted managed selection | Optional TypeSafe Jev decision over already eligible direct candidates; OpenGranter validates the choice and makes the provider call. The authorized fallback policy is confirmed; the TypeSafe integration target and prompt-disclosure default remain provisional in [the routing contract](routing.md). |
| Delegated IAM | Require permission for the model and every eligible final inference provider; restrict OpenRouter to the authorized provider set before sending |
| Fallback boundary | Within delegated routes or within managed routes, never silently between the two kinds |
| Human sign-in | OIDC company SSO; identity binding and management authentication profile pending |
| Deployment | AWS and on-premises support; release order TBD |
| Content audit | Configurable; default, scope, retention, and readers TBD |
| Streaming and monthly limits | Streaming required for external-client compatibility; failure/accounting contracts and monthly limits remain to specify |

## 8. Release gate

The scenarios in [acceptance.md](acceptance.md) must pass, including unauthorized-call rejection, Deny precedence, non-disclosure of credentials, failure auditing, usage attribution, and isolation of each principal's view.

## References

- [AWS IAM default denial and explicit Deny](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)
- [OpenRouter's unified API format](https://openrouter.ai/docs/quickstart)
- [AWS Secrets Manager's credential storage and rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)

## Chat input encoding

Chat JSON must be well-formed UTF-8; reject malformed or incomplete byte sequences before routing and inference. Preserve valid Unicode across request chunks. See [encoding contract](../contracts/chat-utf8.md).

## Direct usage availability

Preserve partial direct-provider token counts and distinguish invalid supplied counters from missing ones without retaining their raw values. See [usage availability contract](../contracts/direct-usage-availability.md).

## Delegated usage availability

Preserve partial and invalid recognized token reporting from OpenRouter using the same sanitized projection as direct routes. Billing reconciliation remains separate. See [contract](../contracts/delegated-usage-availability.md).

## Direct timeout configuration validation

Validate and capture direct-provider attempt timeouts before resolving secrets, rejecting invalid durations through the existing non-retryable, non-billable failure contract. See [contract](../contracts/direct-timeout-validation.md).

## Delegated timeout snapshot

OpenRouter attempts use the timeout value validated before credential lookup, retaining it across asynchronous configuration changes. Subsequent calls validate the current setting. See [contract](../contracts/openrouter-timeout-snapshot.md).

## Provider usage container validation

Distinguish malformed usage containers from absent reporting across all four adapters without storing their raw values. Preserve successful completion outcomes and existing ledger statuses. See [contract](../contracts/provider-usage-containers.md).

## Chat JSON media type

Require the exact case-insensitive application/json type, preserving existing parameter handling. Unsupported prefix lookalikes fail through existing request denial before downstream work. See [contract](../contracts/chat-media-type.md).

## Agreed SSO management foundation (implementation pending)

Company SSO uses OIDC. The first management API authenticates SSO human users only; services remain proxy users. New proxy-token lifetime caps are 30 days for human owners and 90 days for service owners, with expiry mandatory. SSO identity binding and management API authentication remain pending decisions. Existing IAM and mandatory decision audit apply. See [planning contract](../contracts/sso-management-foundation.md) and [plan](plans/105-sso-management-foundation.md).

## Internal proxy-token lifetime enforcement

New issuance through the internal PostgreSQL management service now enforces the agreed owner limits: human 30 days, service 90 days. Trusted owner-kind lookup follows IAM and required audit; the cap uses the same timestamp as credential creation. Existing credentials are not retroactively changed. SSO and public management authentication remain pending. See [contract](../contracts/proxy-token-lifetimes.md).

## Internal management operation snapshots

Capture each token-management operation and actor policy context before asynchronous work so decision audit and credential mutation retain the same values. Caller updates affect later operations. See [contract](../contracts/token-management-snapshots.md).

## Gateway authenticated context

Capture immutable known-field principal and policy context immediately after authentication, retaining it through asynchronous HTTP request processing. No database policy revalidation is added.
See [contract](../contracts/gateway-principal-snapshots.md).

## Authenticated policy data validation

Malformed active authentication fails before routing, catalog, history, limits and inference, with required anonymous safe failure audit. Valid Allow/Deny, wildcard, empty-policy and inactive behavior remains unchanged. See [contract](../contracts/gateway-policy-validation.md).

## OpenRouter external-tool compatibility requirement

External tools must be able to register and use OpenGranter through OpenRouter-compatible model APIs, including streaming and tool-call workflows. The current subset does not meet full compatibility. Exact /api/v1 chat/models aliases share existing authorization and execution; further gaps remain explicit release gates in the [compatibility matrix](openrouter-compatibility.md).

## Client output token limits

Both chat paths accept positive safe-integer max_tokens. Native adapters map a captured limit and retain direct registration caps and existing defaults; invalid supplied values fail before external work. IAM, limits, required audit and usage are unchanged. See [contract](../contracts/client-output-limits.md).

## Safe external-client errors

All gateway errors and Node pre-header internal failures include fixed allowlisted English messages, preserving status/reason semantics and required audit behavior without exposing private details. See [contract](../contracts/safe-client-errors.md).

## OpenRouter numeric errors

/api/v1/ failures use numeric status codes with fixed messages and allowlisted metadata.opengranter_code. Legacy /v1 codes, successful payloads and all security controls remain unchanged. Format selection does not expose additional endpoints. See [contract](../contracts/openrouter-error-schema.md).

## Client stop sequences

Both chat paths support literal stop strings or dense arrays of up to four strings, with null/omission preserved as no explicit condition. Adapters capture and map native stop fields while retaining output limits and existing security/accounting. Malformed values fail before external work. See [contract](../contracts/client-stop-sequences.md).

## Completion-token alias

The chat subset accepts max_completion_tokens as an alternative name for the output maximum. Equal simultaneous values are accepted; conflicting or invalid supplied values reject clearly. Existing administrator caps and security/accounting behavior apply. This adds a client parameter alias, while reasoning-model capabilities and other compatibility work remain open. See [output-limit contract](../contracts/client-output-limits.md).

## Client temperature sampling

The chat subset accepts optional finite temperature in 0..2 and maps native fields across four adapters without injecting defaults. Direct Anthropic enforces 0..1 before credential lookup; values are never silently clamped. Existing stop/output settings and IAM, limits, audit and usage controls remain effective. Per-model restrictions and supported sampling combinations remain open. See [contract](../contracts/client-temperature.md).

## Client top_p sampling

The current chat subset accepts optional top_p as a finite number in 0..1 and maps it across four adapters without injecting an omission default. Existing stop/output settings and authorization, limits, audit and usage controls remain effective. Per-model parameter restrictions remain open; unsupported upstream values use safe provider failure handling. See [contract](../contracts/client-top-p.md).

## Explicit single-choice client requests

The text-chat subset accepts optional n=1; other counts reject clearly until multi-choice response/accounting behavior is implemented. Four adapters retain the one-choice contract and native settings. Pinned OpenAI SDK smoke tests cover local discovery/chat/error handling; they do not establish full external-tool compatibility. See [contract](../contracts/client-single-choice.md).

## Typed compatible client errors

Compatible /api/v1 failures expose fixed metadata.error_type alongside local opengranter_code. Known local causes use the documented vocabulary; dependency/internal failures use server and undifferentiated upstream failures use unmapped. Statuses, messages, legacy errors and security/accounting remain unchanged. Precise provider diagnostics and streaming remain open. See [contract](../contracts/openrouter-error-schema.md).

## Nullable optional chat controls

Optional max_tokens, max_completion_tokens, temperature and top_p accept explicit null as omission. Existing numeric validation, alias conflict handling, native mappings and security/accounting remain effective. See [plan](plans/140-nullable-chat-controls.md) and [output contract](../contracts/client-output-limits.md).

## Native single-choice response enforcement

The current response contract rejects OpenAI/OpenRouter/Gemini responses with unexpected alternative counts or indices rather than silently selecting their first result. Anthropic multi-text-block messages remain one response. Post-response rejection preserves safe audit and possibly-billed usage without exposing content. See [contract](../contracts/upstream-single-choice.md).

## User text content parts

Both chat paths accept user text-part arrays and normalize their ordered text into the existing string-content native path. All security/accounting controls remain effective; this is a text-only subset. See [plan](plans/144-user-text-parts.md) and [contract](../contracts/client-user-text-parts.md).

## Developer instruction prefix

The text subset accepts leading string-content developer instructions alongside system instructions. Four adapters preserve or explicitly translate them while authorization and accounting remain shared. See [plan](plans/142-developer-messages.md) and [contract](../contracts/client-developer-messages.md).

### Instruction and history text arrays

Both client prefixes accept exact text-only arrays on system/developer/user/assistant roles, normalized to literal strings for the existing four provider mappings. Leading instruction order, IAM and metadata secrecy remain enforced. Native block/cache semantics and mixed modalities are not implemented. See [contract](../contracts/client-user-text-parts.md).

### Non-streaming provider refusals

OpenAI and delegated OpenRouter preserve optional refusal text/null and content_filter finish reasons through both client prefixes. Assistant null content requires a nonempty refusal or content_filter. These are successful response deliveries with provider usage, not IAM denials. See [contract](../contracts/refusal-outcomes.md). Native Anthropic/Gemini blocked-outcome mappings remain pending.

### Native Anthropic refusals

Direct non-streaming Anthropic refusal outcomes with empty/text-only content are delivered as null-content/content_filter with refusal=null. Discard incomplete text and keep stop_details outside the client envelope and metadata. Preserve existing usage/accounting and no fallback after delivery. See [contract](../contracts/anthropic-refusals.md).

### Gemini SAFETY completions

Direct Gemini SAFETY prompt/singleton candidate blocks without output are compatible null-content/content_filter completions with existing usage accounting and no fallback. Contradictory/malformed block data remains safe failure. Other filtering/refusal mappings remain incomplete. See [contract](../contracts/gemini-safety.md).

### Portable frequency and presence penalties

Both client paths accept nullable penalty controls in [-2,2]. OpenAI/OpenRouter forward them and Gemini maps native fields; direct Anthropic rejects supplied non-null controls before credentials/transport. Preserve omission defaults and exact zero/negative values. Per-model capabilities remain pending. See [contract](../contracts/client-penalties.md).

### Portable response formats

Both client paths support exact text/json_object format controls. OpenAI/OpenRouter forward them; Gemini maps native MIME; direct Anthropic supports text only and rejects JSON before credential/transport. Direct OpenAI and delegated OpenRouter also forward the bounded json_schema format with required name and optional schema/description/strict, preserving schema omission without a default; unsupported direct Anthropic/Gemini reject before credentials. Native output generation is model-dependent; local schema enforcement, native schema mappings and capability selection remain pending. See [contract](../contracts/client-response-formats.md).

### Nullable top-k sampling

Both chat prefixes accept nullable nonnegative safe-integer top_k. OpenRouter/Anthropic preserve supplied values, Gemini maps native topK with int32 bounds, and direct OpenAI rejects supplied values before credentials. Omission preserves defaults; model-dependent support remains explicit. See [contract](../contracts/client-top-k.md).

### Client seed controls

Both compatible chat paths support nullable safe-integer seed values. OpenAI/OpenRouter preserve them, Gemini applies native int32 bounds and Anthropic rejects supplied seeds before credentials. Omission keeps native defaults. Reproducibility and per-model support are not guaranteed. See [contract](../contracts/client-seed.md).

### Named text messages

Both chat bases accept optional string names on the four supported text roles. OpenAI/OpenRouter preserve names; native Anthropic/Gemini reject supplied names before credentials. Names never override authenticated identity, IAM or usage/audit attribution. Provider-specific named-message semantics and full tool/stream workflows remain open. See [contract](../contracts/client-message-names.md).

### Referenced name drift subset

The version-3 official schema pin tracks name constraints and name-required status for four supported text-message definitions. This quality gate changes no runtime API or security controls and does not certify full message/client conformance. See [plan](plans/168-message-name-schema.md).

### Non-streaming backend fingerprints

Compatible OpenAI/OpenRouter responses retain optional string/null system_fingerprint so clients can observe upstream backend changes. No identity or deterministic-output guarantee follows from it. Native Anthropic/Gemini omit the field. See [plan](plans/170-system-fingerprint.md).

### Function invocation responses

OpenAI/OpenRouter preserve validated non-streaming function tool-call responses with their IDs, names, serialized arguments and tool_calls finish reason. Malformed, mismatched and legacy invocations fail safely rather than dropping semantics. No-invocation defaults retain existing text outcomes. Streaming and native tool mappings remain open. See [plan](plans/182-function-tool-responses.md) and [contract](../contracts/function-tool-responses.md).

### Upstream termination semantics

Non-streaming OpenAI/OpenRouter preserve supported finish reasons and explicit null; error/unsupported/malformed/missing reasons fail instead of becoming successful null outcomes. Full response/tool/stream conformance remains open. See [plan](plans/174-upstream-finish-reasons.md).

### Direct native termination semantics

Anthropic and Gemini text responses retain only supported completed/truncated stop mappings plus their existing bounded refusal/SAFETY outcomes. Other, malformed or missing native reasons fail instead of becoming successful null-finish text. See [plan](plans/176-native-stop-reasons.md).

### Client token-bias maps

Both compatible chat bases accept nullable logit_bias maps. Direct OpenAI and delegated OpenRouter preserve them; direct Anthropic/Gemini reject supplied maps before credentials. IAM, limits and usage/audit attribution remain based on authenticated authority. See [plan](plans/178-client-logit-bias.md).

## Function-tool request subset

Both OpenRouter-compatible chat paths accept validated non-streaming function-tool declarations, selection and nullable parallel-call controls. Delegated OpenRouter and direct OpenAI receive captured requests; direct Anthropic/Gemini reject supplied controls before credential access. Existing IAM, limits, audit and usage remain authoritative. Text-only tool-result history is supported separately; streaming and OpenRouter server tools remain unsupported. See [plan](plans/180-function-tool-requests.md) and [contract](../contracts/client-function-tools.md).

## Function-tool continuation subset

OpenRouter-compatible clients can return a completed assistant function-call group and matching tool results through either chat prefix. Direct OpenAI and delegated OpenRouter receive an immutable, ordered history; direct Anthropic/Gemini reject that history before credentials. Each model request repeats IAM, limits, audit and usage controls. The gateway never executes a function. Streaming, server tools, rich content and native tool mappings remain release gaps. See [plan](plans/184-function-tool-history.md) and [contract](../contracts/function-tool-history.md).

## HTTP client disconnection prerequisite

The Node transport supplies a per-request signal for interrupted uploads and premature response disconnections, preserves progressive body delivery, and avoids fallback writes after socket loss. Upstream cancellation and audited client chat streaming remain release work; this transport prerequisite alone does not enable stream:true. See [contract](../contracts/http-client-disconnection.md).

## Internal delegated streaming cancellation

An optional per-call signal stops internal OpenRouter text-stream work before HTTP or during fetch/body consumption. Pre-dispatch cancellation is non-billable; dispatched attempts retain possible billing, unknown usage and the existing failure accounting path without replay. Client HTTP wiring and audited interruption remain pending. See [contract](../contracts/openrouter-stream-cancellation.md).

## Delegated client text streaming

Both chat paths support delegated text-only stream:true through the same IAM, limits, usage and audit controls. First-frame errors remain JSON; later failures use fixed SSE errors without DONE. Client cancellation stops upstream work, with separate interruption metadata preserving already accounted successes. Managed/tool streams and unknown stream options remain unsupported; incomplete usage remains unknown. See [contract](../contracts/delegated-http-stream.md).

## Delegated stream usage options

Nullable stream_options and exact optional boolean include_usage are supported on delegated streams. The deprecated OpenRouter flag does not suppress final usage or any ledger/audit control, including when false. Non-null nonstream options and unknown fields reject explicitly. See [contract](../contracts/stream-usage-options.md).

## Delegated streaming fingerprint metadata

Delegated text and final usage frames preserve optional opaque system_fingerprint strings; null is a local OpenAI compatibility allowance. Final usage preserves its own source metadata rather than borrowing a previous fingerprint. Malformed values fail safely with possible-billing accounting. Fingerprints cannot establish authority and remain outside operational metadata. See [contract](../contracts/stream-fingerprints.md).

## Compatible midstream failure delivery

Started /api/v1 delegated failures retain delivered chunk identity and one content-free finish_reason:error choice alongside fixed safe errors. Pre-frame JSON and legacy errors remain unchanged; no DONE or fabricated usage follows failure. See [contract](../contracts/midstream-error-chunks.md).

## Unknown compatible completion fingerprints

Normalized /api/v1 nonstream completions represent absent upstream fingerprint as null so compatible clients can deserialize unavailable metadata. Exact supplied fingerprints, native/legacy omission, streaming and accounting remain unchanged. See [contract](../contracts/compatible-completion-fingerprints.md).


## Delegated streaming refusal deltas

Delegated streamed refusal string/null deltas are delivered as successful upstream responses under existing IAM, limits, required accounting/audit and cancellation controls. Refusal text remains response content, never operational metadata. Malformed values fail safely; usage-only chunks reject substantive refusal text rather than silently discard it. See [contract](../contracts/stream-refusals.md).

## Logit-bias source drift coverage

The reviewed structural pin tracks the already-supported logit_bias request field, including object/null and numeric-map structure. This does not expand runtime capabilities or assert provider/model support. See [plan](plans/220-logit-bias-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Streaming native finish reasons

Delegated text streaming preserves exact optional native_finish_reason string/null on choices through both HTTP bases, including the actual repeated-finish usage event. Final metadata never falls back to earlier deltas, and empty-choice usage supplies none. Incomplete usage remains unknown to clients; malformed metadata fails safely even with incomplete usage. Canonical reasons, IAM, limits, required usage/audit gates and operational secrecy remain unchanged. Ordinary and terminal chunks, safe first/later failures, denial paths and actual OpenAI SDK retention are covered by [contract](../contracts/stream-native-finish-reason.md) and [plan](plans/266-stream-native-reason.md). Current official ChatStreamChoice and the pinned OpenRouter SDK omit this extension; SDK stripping and source coverage remain explicit gaps. Managed/tool streaming, full instance conformance and release gate #116 remain open.

## Delegated verbosity controls

Both chat bases accept optional nullable verbosity with low/medium/high/xhigh/max for delegated nonstream and text streaming. Capture and forward supplied values exactly without defaults; null is a local omission allowance. Invalid values reject before routing, and native Google Gemini rejects supplied non-null values before credentials; direct OpenAI supports low/medium/high and Anthropic maps all five levels to effort. Existing IAM, limits, required accounting/audit, fixed destination scope and operational secrecy remain unchanged. Public HTTP, immutable request, tool-history and SDK cases are covered by [contract](../contracts/client-verbosity.md) and [plan](plans/268-client-verbosity.md). Current official ChatRequest and pinned OpenRouter SDK omit this documented field; SDK stripping, native capability mappings and source drift selection remain explicit gaps. No complete compatibility claim; release gate #116 remains open.

## Direct OpenAI verbosity controls

Registered direct OpenAI nonstream chat forwards optional low/medium/high verbosity at top level on both HTTP bases. Null/omission inject no field/default; xhigh/max on direct OpenAI and non-null Gemini values reject before credentials; Anthropic maps all five levels to effort. Exact capture, sampling/output/tool controls, IAM, limits, required ledger/audit and safe possibly-billed failures remain effective. HTTP and actual SDK cases are covered by [contract](../contracts/client-verbosity.md) and [plan](plans/270-openai-verbosity.md). Model capability differences, Google mapping, native thinking/rich responses, managed streaming and OpenRouter source/SDK gaps remain explicit. Depends on PR #269; release gate #116 remains open.

## Direct Anthropic verbosity controls

Registered direct Anthropic nonstream chat maps optional low/medium/high/xhigh/max verbosity to output_config.effort through both HTTP bases. Null/omission inject no output_config/default; no beta header or thinking configuration is added. Preserve native output caps, sampling/instruction translation, immutable capture and IAM/limits/required ledger/audit controls. Model support differs; existing non-text/thinking blocks still fail safely with possibly-billed accounting. Tests cover HTTP, actual compatible SDK sockets and that response limitation. See [contract](../contracts/client-verbosity.md) and [plan](plans/272-anthropic-verbosity.md). Depends on #271/#269; Google/native stream/thinking response/source/SDK compatibility and release gate #116 remain open.

## Delegated reasoning effort controls

Both chat bases accept optional nullable reasoning_effort with max/xhigh/high/medium/low/minimal/none for delegated nonstream and text streaming. Capture and forward exact supplied values without defaults; approved model/provider scope, IAM, limits, output controls and required accounting/audit stay unchanged. Invalid values reject before routing, while direct Anthropic and unsupported Gemini values reject before credentials; direct OpenAI and the bounded Gemini subset map native fields. Actual SDK mapping and public-boundary cases are covered by [contract](../contracts/client-reasoning-effort.md) and [plan](plans/274-reasoning-effort.md). Fresh official OpenAPI and pinned SDK include max, unlike the shorter parameter overview. The current schema pin tracks reasoning_effort. Structured reasoning, other native mappings and richer request/history/response remain explicit gaps; request forwarding alone does not certify full reasoning compatibility. The direct OpenAI extension depends on PR #275; release gate #116 remains open.

## Direct OpenAI reasoning effort

Direct OpenAI forwards optional none/minimal/low/medium/high/xhigh/max as native reasoning_effort on nonstream requests through both bases. Null/omission inject no field or default; capture occurs once before credentials. Anthropic and unsupported Gemini non-null values reject before secrets, and managed streaming remains unsupported. IAM, Deny, limits, required audit/ledger and safe possibly-billed errors retain existing behavior. Model support/defaults differ; forwarding does not certify native reasoning response/history/usage capabilities or structured reasoning. See [plan](plans/278-openai-reasoning-effort.md) and [contract](../contracts/client-reasoning-effort.md).

## Direct Gemini thinking levels

Direct Gemini maps optional minimal/low/medium/high to generationConfig.thinkingConfig.thinkingLevel without changing maxOutputTokens or other native settings. Null/omission add no thinking config/default; none/xhigh/max reject before credentials. No budget or nearest-level alias is invented. Models support different levels and Gemini 2.5 requires separate budgets; upstream capability rejection remains safely accounted. Returned thought:true or malformed thought flags fail safely instead of merging thinking into visible text; absent/false flags retain ordinary text behavior. IAM, Deny, limits, required audit/ledger and billing uncertainty remain shared. Thinking signatures/history/token details and managed streams remain gaps. Anthropic reasoning-effort mapping and its interaction with verbosity remain unresolved. See [plan](plans/280-gemini-reasoning-effort.md) and [contract](../contracts/client-reasoning-effort.md).

## Trusted discovery snapshots

Administrator-published aliases can carry bounded informational OpenRouter metadata in the persistent catalog. /api/v1 models exposes reviewed context/capability/price data after unchanged model/final-provider IAM filtering and required audit; alias IDs and publication timestamps remain gateway-owned. Missing snapshots retain basic-list behavior, and /v1 remains basic. No price inference, route aggregation or catalog fetching is introduced. See [contract](../contracts/model-discovery-metadata.md).

## Compatible discovery paging

/api/v1 model lists accept bounded offset/limit within the IAM-filtered visible sequence and expose only visible total_count and relative next links. No-query lists remain complete; legacy queries and unknown filters still reject. Every request reevaluates current authorization/catalog, retaining required audit and no inference-side effects. See [contract](../contracts/model-list-paging.md).

## Official SDK tool lifecycle evidence

The existing bounded non-streaming function-tool subset is validated through the pinned official OpenRouter SDK on both client bases and delegated OpenRouter/direct OpenAI. Caller-supplied results form a separate authenticated inference request with unchanged IAM, limits, audit and usage controls. No gateway tool execution or runtime behavior is added. See [contract](../contracts/official-sdk-tools.md).

## Referenced finish-reason source drift

The version-8 structural pin tracks the shared official finish-reason definition so enum/nullability changes cannot evade detection through an unchanged reference. This guards existing runtime contracts without accepting new reasons or certifying full response conformance. See [plan](plans/236-finish-reason-schema.md).

## Delegated streaming reasoning text

Optional upstream reasoning string/null deltas are preserved as response content on both client bases through unchanged IAM, limits, audit, usage and cancellation controls. No transcript enters operational metadata or completed summaries. Structured/native/non-streaming reasoning and request controls remain separate work. See [contract](../contracts/stream-reasoning.md).

## Non-streaming reasoning response content

Already-valid direct OpenAI/delegated OpenRouter assistant outcomes preserve optional reasoning string/null on both client bases. It remains response content under existing authentication/IAM/limits/audit/usage controls, with malformed values rejected safely and no operational retention. Reasoning alone does not relax content validation or infer usage. See [contract](../contracts/nonstream-reasoning.md).


## Nonstream response source drift

The version-9 source guard tracks successful nonstream response, choice and assistant-message structures, including required fields and nullable fingerprints/reasoning. This improves drift detection without expanding runtime capabilities or resolving remaining compatibility requirements. See [plan](plans/242-response-schema.md).


## Chat usage source drift

The version-10 structural source guard tracks chat token and cost usage definitions shared by nonstream and stream responses. Existing unknown usage, estimated versus provider-billed cost and supported field projection remain unchanged; full usage/client conformance remains open. See [plan](plans/244-usage-schema.md).


## Compatible nonstream usage availability

Normalized /api/v1 nonstream completions omit incomplete/invalid usage instead of making compatible clients reject successful text or inventing token counters. Internal missing/partial/invalid accounting and protected usage history retain the reported state. Complete counters, legacy /v1 and required security/accounting gates remain unchanged. See [contract](../contracts/compatible-completion-usage.md).


## Nonstream service tier metadata

Direct OpenAI/delegated OpenRouter nonstream completions preserve optional exact string/null service_tier response metadata. It cannot change permissions, destinations, limits or usage/cost accounting. Native/request/stream tier semantics remain separate. See [contract](../contracts/service-tier-responses.md).


## Delegated stream service tier metadata

Delegated OpenRouter text streams preserve optional string/null service_tier response metadata, including the actual final usage event, without changing IAM, limits or accounting. Reported tiers cannot establish authority or price. Direct/tool/native stream and tier request semantics remain separate. See [contract](../contracts/stream-service-tiers.md).


## Delegated min-p sampling subset

Optional nullable finite min_p in 0..1 is accepted on both chat bases and forwarded exactly for delegated OpenRouter nonstream/text streams. Registered direct adapters reject supplied non-null controls before credentials rather than silently discard them. Defaults and security/accounting remain shared; model support and structural drift selection remain open. See [contract](../contracts/client-min-p.md).

## Min-p request source drift

The version-11 source guard tracks optional nullable min_p request structure without changing runtime sampling controls or provider capabilities. Existing security and accounting contracts remain unchanged. See [plan](plans/254-min-p-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated top-a sampling subset

Optional nullable finite top_a in 0..1 is accepted on both chat bases and forwarded exactly for delegated OpenRouter nonstream/text streams. Registered direct adapters reject supplied non-null controls before credentials rather than silently discard them. Defaults and security/accounting remain shared; model support and structural drift selection remain open. See [contract](../contracts/client-top-a.md).

## Top-a request source drift

The version-12 source guard tracks optional nullable top_a request structure without changing runtime sampling controls or provider capabilities. Existing security and accounting contracts remain unchanged. See [plan](plans/258-top-a-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated repetition-penalty sampling subset

Optional nullable finite repetition_penalty in 0..2 is accepted on both chat bases and forwarded exactly for delegated OpenRouter nonstream/text streams. Registered direct adapters reject supplied non-null controls before credentials rather than silently discard them. Defaults and security/accounting remain shared; model support and structural drift selection remain open. See [contract](../contracts/client-repetition-penalty.md).

## Repetition penalty request source drift

The version-13 source guard tracks optional nullable repetition_penalty request structure without changing runtime controls, provider capabilities, security or accounting contracts. See [plan](plans/262-repetition-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Nonstream native finish reasons

Nonstream OpenAI-compatible/OpenRouter choices preserve supplied optional native_finish_reason strings/null independently of the canonical reason. Security/accounting remain shared; streaming, native synthesis and complete compatibility remain open. See [plan](plans/264-native-finish-reason.md) and [contract](../contracts/native-finish-reason.md).

## Reasoning-effort source tracking

The version-14 source guard tracks optional nullable reasoning_effort without changing runtime controls, provider capabilities, security or accounting. See [plan](plans/276-reasoning-effort-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Referenced reasoning-detail source drift

Version 15 adds exactly eight reasoningDefinitions for nonstream/stream arrays, their shared union, summary/encrypted/text/server-tool-call variants and ReasoningFormat. Track structure, references, discriminator mappings, required lists, types/nullability, constraints, extensions and literal defaults while ignoring annotations. Missing/malformed source definitions and rehashed invalid exact maps fail safely; versions 1..14 reject. All version-14 selections and source provenance remain unchanged. Existing whole assistant/stream delta selections retain parent field/reference/required tracking. This does not enable runtime reasoning details, server tools, signatures/history, or complete reasoning/client compatibility. IAM, credentials, usage and audit behavior are unchanged. See [plan](plans/282-reasoning-details-schema.md).

## Nonstream reasoning-detail subset

Direct OpenAI and delegated OpenRouter preserve optional reasoning_details arrays, including empty arrays, with validated summary/text/encrypted items. Preserve opaque payloads, optional nullable string metadata and safe integer indices without parsing/verifying them. Unknown fields, malformed data and unsupported server-tool-call items fail safely with possibly-billed failed accounting. Existing finish/content/refusal/function rules, IAM/Deny/limits, required audit/ledger and missing usage remain unchanged. Operational records/errors exclude details and credentials. This response subset does not enable server tools or native thinking; delegated history details are covered by the separate history contract below. Delegated streamed details are implemented under their separate contract below. See [plan](plans/284-nonstream-reasoning-details.md) and [contract](../contracts/nonstream-reasoning-details.md).

## Delegated stream reasoning details

Both chat bases preserve validated reasoning_details arrays on delegated text-stream deltas, including empty arrays and omitted fields, in frame and item order. The summary/text/encrypted subset uses immutable snapshots and preserves opaque nullable metadata without interpretation or reconstruction. Malformed items, unknown fields and server-tool-call items fail safely with possibly-billed accounting. Any supplied detail field on a usage-only event rejects, including empty arrays and incomplete token counts, as an explicit local content-free-frame restriction. IAM/Deny/limits, required audit/ledger, cancellation and unknown usage remain shared; details stay outside operational records and errors. Direct/tool streams, structured reasoning request controls, native thinking and full external-client conformance remain open; delegated history details are covered separately below. See [plan](plans/286-stream-reasoning-details.md) and [contract](../contracts/stream-reasoning-details.md).

## Independent SSE content validation

The client encoder captures delta content/refusal once and rejects injected substantive or malformed fields on usage-only events before incomplete-count suppression. Absent/null/empty usage fields remain permitted without replay; exact delta strings/null/omission and JSON frame escaping remain intact. Authentication, IAM/Deny, limits, required audit/usage and operational content exclusion remain unchanged. This bounded validation does not certify all fields or complete external-client conformance. See [plan](plans/288-sse-content-validation.md) and [contract](../contracts/openrouter-client-sse.md).

## Nonstream token usage details

Direct OpenAI and delegated OpenRouter preserve recognized prompt/completion detail categories with exact omission/null/empty/zero semantics on both chat bases. Immutable allowlisted projection omits malformed groups independently and preserves aggregate accounting; details never fabricate totals or add ledger charges. Compatible incomplete usage remains omitted. Authentication/IAM/Deny/limits and required audit/usage gates stay unchanged. Native category mappings, detailed ledger/cost projection and complete certification remain open; delegated final stream categories follow their separate contract below. See [plan](plans/290-nonstream-token-details.md) and [contract](../contracts/nonstream-token-details.md).

## Final stream token usage details

Delegated streaming preserves the bounded prompt/completion categories from actual final usage events on both bases, with immutable allowlisted snapshots and independent malformed-group omission. Snapshots never derive missing totals or replay earlier content/metadata; categories do not change aggregate accounting. Complete usage and DONE remain gated by required persistence. IAM/Deny, limits, cancellation/backpressure and interruption audit remain unchanged. Native/direct/tool streams, category ledger/cost reporting and complete certification remain open. See [plan](plans/292-stream-token-details.md) and [contract](../contracts/stream-token-details.md).

### Detail-only assistant reasoning completions

Direct OpenAI/delegated OpenRouter preserve supported nonempty summary/text/encrypted detail payloads even when stop/length completions omit visible content, normalized to null. Metadata/signature-only details do not certify a successful output. No decryption, signature verification or complete native thinking compatibility is claimed. Existing IAM, audit and usage controls remain required. See [contract](../contracts/nonstream-reasoning-details.md).

### Scalar assistant reasoning history

Delegated OpenRouter accepts optional string/null reasoning in assistant conversation history, preserving ordinary text and complete function-call groups. Null/missing ordinary content requires nonempty scalar reasoning; unsupported direct OpenAI/Anthropic/Gemini reject the field before credentials. Client reasoning stays untrusted data and retains IAM, limits, audit and usage controls. Detailed history/native thinking and complete compatibility remain open. See [contract](../contracts/client-reasoning-history.md).

### Delegated assistant reasoning details history

Delegated OpenRouter accepts assistant reasoning_details history with validated summary/text/encrypted arrays on both chat bases, including existing ordinary text streams and nonstream complete function groups. Preserve omission, empty arrays, opaque payloads/signatures, nullable metadata and item order in immutable snapshots before asynchronous routing. Ordinary null/missing assistant content is accepted independently of scalar or detailed payloads under the delegated no-text history contract. Malformed/non-assistant fields and incomplete tool results reject before routing; all direct providers reject supplied details before credentials. Authentication, complete destination IAM/Deny, limits, required persistence and safe failure accounting remain shared; history never enters operational records/errors. No decryption, authenticity, token inference, server tools, tool streams or native mapping is enabled. Actual SDK sockets replay returned details through both bases; full #116 certification stays open. See [plan](plans/306-assistant-reasoning-details-history.md) and [contract](../contracts/client-reasoning-details-history.md).

### Delegated reasoning summary configuration

Both chat bases accept an optional reasoning object with optional summary auto/concise/detailed/null for delegated OpenRouter nonstream and existing ordinary text streams. Preserve omission, empty object and null summary without defaults. Immutable single captures precede routing/credentials; malformed/unknown keys and values reject early. Top-level reasoning_effort and nested effort follow the bounded alias rules below; legacy inclusion, budget, exclusion and activation follow their documented subsets below. All direct providers reject supplied configurations, including {}, before secrets. Shared authentication, full destination IAM/Deny, limits, required audit/usage, safe possible-billing outcomes and operational privacy remain intact; stream final success still requires persistence. Actual SDK sockets cover both bases/modes and effort coexistence. Forwarding does not guarantee summaries, authenticate history, infer costs or enable native/tool streams. Pin v18 now selects the reasoning request field and summary enum; broader controls and complete #116 certification remain open. See [plan](plans/310-reasoning-summary.md) and [contract](../contracts/client-reasoning-summary.md).

### Reasoning summary source validation

Pin/projector v18 selects ChatRequest.reasoning and ChatReasoningSummaryVerbosityEnum, preserving all prior structures. Unchanged-parent summary enum/reference/null/default/constraint/extension and inline required/effort changes cause drift; annotations remain ignored while literal data remains structural. Malformed/missing source containers, invalid rehashed exact maps and older versions reject. The explicit fixed-host refresh preserves the prior source digest; offline checks do not fetch or rewrite pins. Runtime scope, destination IAM, credential access, audit and accounting are unchanged. Broader nested controls, native mapping and full instance/external-client certification remain open. See [plan](plans/312-reasoning-summary-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

### Delegated nested reasoning effort

Delegated OpenRouter now accepts optional reasoning.effort max/xhigh/high/medium/low/minimal/none/null beside optional summary on both chat bases, nonstream and existing ordinary text streams. Preserve omission/empty/null and exact values in immutable single captures before async routing/credentials. Equal simultaneously forwarded named aliases are preserved; differing strings reject early without precedence. Nested null plus a forwarded shorthand string stays an unsupported local subset pending clarification; existing top-level null omission remains unchanged. Direct structured configurations still reject before secrets. IAM/Deny/limits, complete history validation, required audit/usage, safe failures and operational privacy stay shared. Actual SDK sockets cover supported nested/equal aliases and differing-alias denial. Pin v18 is unchanged; alias prose is outside structural drift. Broader budget controls, broader legacy controls, native mappings and full #116 certification remain open. See [plan](plans/314-nested-reasoning-effort.md) and [contract](../contracts/nested-reasoning-effort.md).

## Delegated reasoning exclusion preference

Both chat bases accept optional reasoning.exclude true/false for delegated nonstream and existing ordinary text streams, alongside supported effort/summary and unchanged alias conflict rules. Immutable single capture preserves omission/exact booleans without defaults before async work; null/own undefined/malformed controls reject early. Native structured configurations stay pre-secret unsupported. This forwards the documented preference without locally filtering returned reasoning/details, inferring free/reduced usage or promising summary precedence. Empty-string length responses remain successful; no-text length responses follow the supported subset below; other null/missing-content outcomes remain bounded. Authentication, complete IAM/Deny, limits, required audit/usage, persistence-gated streams and operational privacy stay shared. Actual OpenAI-compatible SDK sockets preserve the extension on both bases/modes; pinned OpenRouter SDK sockets expose stripping. The current official OpenAPI omits exclude, so unchanged pin v18 does not certify it. Null semantics, broader budget/broader legacy controls, native mappings, tool streams and full #116 certification remain open. See [plan](plans/316-reasoning-exclusion.md) and [contract](../contracts/client-reasoning-exclusion.md).

## Delegated reasoning activation preference

Both chat bases accept optional reasoning.enabled true/false for delegated nonstream and existing ordinary text streams, preserving exact booleans/omission and optional summary/exclusion without default effort injection. Supplied enabled plus any nested effort (including null) or forwarded named shorthand is outside this local subset pending raw-chat interaction clarification; this is not an official conflict rule. Existing top-level null omission and effort-only alias rules remain unchanged. Immutable single captures precede async work; null/own undefined/malformed controls reject early and native structured configurations stay pre-secret unsupported. Forwarding does not guarantee activation, filter returned reasoning or infer reduced/free usage. Authentication, complete IAM/Deny, limits, required audit/usage, stream persistence, operational privacy and safe possible-billing failures remain shared. Actual OpenAI-compatible SDK sockets preserve the extension on both bases/modes; pinned OpenRouter SDK sockets demonstrate stripping. Current OpenAPI omits enabled and unchanged v18 cannot certify it. Effort interactions, null/summary precedence, broader budget/broader legacy controls, native mappings, tool streams and full #116 certification remain open. See [plan](plans/318-reasoning-activation.md) and [contract](../contracts/client-reasoning-activation.md).

## Delegated reasoning token budget

Both chat bases accept optional reasoning.max_tokens as positive safe integers for delegated nonstream and existing ordinary text streams. Numeric bounds are an explicit local subset, not official generic constraints. Preserve exact values/omission and optional summary/exclusion without effort/default/clamp injection. A supplied budget with any nested effort, forwarded named shorthand or supplied enabled remains outside the local subset pending conflicting/unspecified source guidance; no precedence is invented. Existing top-level null normalization and effort/activation-only contracts stay intact. Immutable single captures precede async work; invalid/null/zero/negative/fraction/unsafe controls reject early, native structured configurations reject pre-secret, and the outer output maximum remains independent and unchanged. IAM/Deny/limits, required audit/usage, stream persistence, operational privacy, actual/unknown usage and safe possible-billing failures stay shared; budget does not fabricate charges or filter responses. Actual compatible SDK sockets preserve the raw extension on both bases/modes; pinned OpenRouter SDK sockets demonstrate stripping. Current OpenAPI omits this child field and unchanged v18 cannot certify it. Provider-specific constraints/exact-token guarantees, mixed controls/null/zero semantics, native mappings, tool streams and full #116 certification remain open. See [plan](plans/320-reasoning-budget.md) and [contract](../contracts/client-reasoning-budget.md).

## Legacy reasoning inclusion aliases

Both chat bases accept optional include_reasoning true/false for delegated nonstream and existing ordinary text streams, normalizing the documented equivalents true to reasoning {} and false to reasoning {exclude:true} while removing the legacy field upstream. Preserve omission and independent named shorthand without defaults. Null/malformed flags and simultaneous supplied reasoning configurations reject before routing/credentials as an explicit local subset restriction; no mixed-field precedence is invented. HTTP and adapter boundaries capture once and freeze before async work; native providers reject supplied flags, including false, pre-secret with safe accessor errors. IAM/Deny/limits, complete history validation, required audit/usage, stream persistence, operational privacy and safe possible-billing failures remain shared; no local response filtering or usage inference. Actual compatible SDK sockets send raw aliases and gateway normalization works on both bases/modes; pinned OpenRouter SDK sockets demonstrate stripping with independent effort preserved. Current OpenAPI omits the flag and unchanged v18 cannot certify it. Mixed configurations/null semantics, native mappings, tool streams and complete #116 certification remain open. See [plan](plans/322-legacy-reasoning-alias.md) and [contract](../contracts/client-legacy-reasoning.md).

## No-text length completions

Direct OpenAI and delegated OpenRouter nonstream preserve null/missing assistant content with finish_reason length on both bases, independently of request flags or reasoning token details. Missing content normalizes to null consistently with existing response shape; preserve length and valid optional fields without fabricating text/usage/costs. Existing role/envelope/model/finish/tool/refusal/reasoning validation remains enforced; malformed values and tool mismatches fail safely. Stop without payload follows the optional-content contract below; unsupported finishes remain rejected. IAM/Deny/limits, required audit/usage, operational privacy and safe failures stay shared; delivered length outcomes record success only after required persistence and missing usage stays unknown. Actual OpenAI/OpenRouter SDK sockets retain canonical null/length on both bases/routes. Response acceptance does not widen history inputs or native/stream thinking. Pin v18 already selects the assistant shape and is unchanged. Broader no-content/native/tool-stream cases and full #116 certification remain open. See [plan](plans/324-no-text-length.md) and [contract](../contracts/no-text-length.md).

## Optional content on stop completions

Direct OpenAI and delegated OpenRouter nonstream stop responses accept null/missing assistant content on both bases independently of substantive reasoning/refusal, request controls or usage categories. Preserve canonical missing-to-null shape, stop and validated optional fields without fabricated text/reasoning/zero usage/costs. Valid empty/metadata-only details may accompany supported stop/length; inherited reasoning/details stay unprojected and no metadata grants authority. Existing malformed field/role/envelope/model/tool/finish checks, IAM/Deny/limits, required usage/audit delivery gates, privacy and safe possible-billing failures remain intact. Delivered stop records success only after persistence and does not guarantee visible text; missing usage stays unknown. Actual OpenAI/OpenRouter SDK sockets retain canonical null/stop on both bases/routes. Current optional nullable assistant schema/SDK supports this; unchanged v18 already selects the shape and no fresh full-source comparison is asserted. History input/native thinking/stream rules are unchanged. Broader optional-content/rich/native/tool-stream/history cases and full #116 certification remain open. See [plan](plans/326-no-text-stop.md) and [contract](../contracts/no-text-stop.md).

## Delegated no-text assistant history

Both chat bases accept delegated OpenRouter null/missing ordinary assistant histories independently of substantive reasoning, including existing ordinary text streams. Missing content normalizes to null; validated empty/metadata-only fields remain preserved without authority. Empty tool-call lists also accept null/missing content nonstream; tool fields remain unsupported in streams and complete pending-result integrity stays enforced. Direct providers reject bare-null ordinary/empty-call histories before secrets; direct OpenAI supplied refusal follows the separate refusal history contract below, and complete nonempty function groups stay supported. Malformed/non-assistant content rejects early. Immutable capture, authentication, full destination IAM/Deny, limits, required usage/audit delivery gates, privacy and possible-billing failures remain shared; missing usage stays unknown. Actual pinned SDK sockets cover both bases/modes. Earlier schema retrieval and SDK support this subset; unchanged v18 and timed-out fresh retrieval do not establish fresh source comparison. Native/rich/tool-stream and full #116 certification remain open. See [plan](plans/328-no-text-history.md) and [contract](../contracts/no-text-history.md).

## Assistant refusal history

Both chat bases preserve optional assistant refusal string/null on delegated OpenRouter and direct OpenAI ordinary and complete nonstream function histories. Omission/null/empty/Unicode remain exact in immutable single captures; missing content normalizes to null. Direct OpenAI permits canonical null with a supplied validated refusal, while bare-null history stays unsupported. Anthropic/Gemini reject all supplied markers pre-secret. Existing delegated ordinary text streams carry refusal history; tool/direct streams stay open; refusal content parts follow the translation contract below. Malformed/non-assistant/own undefined markers, unknown fields and incomplete tool groups reject early. History grants no authority; IAM/Deny/limits, required usage/audit gates, safe possibly-billed failures, unknown usage and operational privacy remain shared. Actual OpenAI/OpenRouter SDK sockets cover both bases, with delegated ordinary streams. Current OpenAI reference/installed SDK and earlier OpenRouter schema support the subset; unchanged v18 does not assert fresh source comparison or full #116 certification. See [plan](plans/330-refusal-history.md) and [contract](../contracts/client-refusal-history.md).

## Assistant refusal content-part translation

Both chat bases translate exactly one assistant refusal content part with string payload into canonical content:null/refusal:string for direct OpenAI and delegated OpenRouter history. Preserve empty/Unicode/newline payloads and supported metadata/function groups in single captures; downstream immutable snapshots resist mutation. Mixed/duplicate/malformed/nonassistant/unknown parts and simultaneous explicit scalar refusal reject early as a bounded local ambiguity restriction without invented precedence. Native Anthropic/Gemini reject canonical refusal pre-secret; existing delegated ordinary streams remain supported, tool/direct streams remain open. Pending tool integrity, auth/IAM/Deny/limits, required usage/audit, safe failures, unknown usage and operational privacy remain shared. Actual OpenAI SDK sockets cover both routes/bases and delegated ordinary streams. OpenRouter SDK rejects raw parts but accepts canonical scalar refusal, so this is client translation rather than raw-array conformance. Pin v18 is unchanged; no fresh OpenRouter full-source comparison or complete #116 certification is asserted. See [plan](plans/332-refusal-parts.md) and [contract](../contracts/client-refusal-parts.md).

## Content-part capture consistency

The public HTTP content normalizer captures fixed indexed part positions before validation and each supported discriminator/payload once. Normalization uses only the first validated value; no second-value coercion or retry occurs, and array replacement/append during field validation cannot change captured positions. Preserve exact text/refusal JSON shapes, own refusal fields, existing inherited text behavior, dense/exact validation and downstream immutable snapshots. HTTP JSON cannot contain getters; public helper regressions reproduce the defect without a claimed network exploit. Existing provider/SDK/security/accounting/privacy paths stay unchanged, and all four established text mappings retain canonical values over both bases. Pin v18 stays unchanged; full #116 certification remains open. See [plan](plans/334-content-part-capture.md) and [contract](../contracts/content-part-capture.md).

## Function history capture consistency

Public history snapshots capture fixed message/call positions and used fields once. The same validated call IDs drive uniqueness, pending registration and output, and the same result ID drives matching and output; function names/arguments and own call arrays retain their first captures. Invalid first values reject without retries. Dense/exact/bounded arrays, complete groups, own optional markers and existing inherited required fields remain unchanged; immutable snapshots resist credential-await mutation. Public accessor and direct/delegated adapter regressions verify exact payloads or safe pre-secret failure. HTTP JSON has no getters, so no network exploit is claimed. Existing auth/IAM/Deny/limits/persistence/privacy/accounting/SDK behavior and pin v18 stay fixed; full #116 certification remains open. See [plan](plans/336-function-history-capture.md) and [contract](../contracts/function-history-capture.md).

## Function tool control capture consistency

Public tool declaration/choice snapshots capture fixed positions/length and used definition fields once, validating and freezing only first values. Declared/selected names, descriptions, strict and parameter references cannot drift between checks and projection. Optional undefined omission, exact/plain/dense/name/count limits and deep frozen schema copies stay unchanged. Shared JSON arrays use one length while descriptor-based nested accessors, cycles, depth/node budgets and response-format consumers retain their gates. Direct/delegated regressions verify exact payloads through credential mutation or safe pre-secret failure. HTTP JSON has no accessors, so no network exploit is claimed. Existing provider/policy/auth/IAM/limits/persistence/privacy/accounting/SDK contracts and pin v18 stay fixed; full #116 certification remains open. See [plan](plans/338-function-tool-capture.md) and [contract](../contracts/function-tool-capture.md).

## Assistant function response capture consistency

The shared non-streaming assistant normalizer captures the call count, fixed entries and used call/function fields once, then validates and projects the same values. Legacy function_call is captured once. Preserve unique IDs, the 128-call cap, exact argument strings, unknown-field omission, inherited scalar projection and existing finish/content/refusal gates. Both provider adapters sanitize normalization exceptions with possibly-billed failure accounting. Regressions exercise local accessor-backed provider responses on both HTTP bases; JSON itself cannot contain accessors. IAM, explicit Deny, limits, persistence, privacy, SDK behavior and pin v18 stay unchanged. Full #116 compatibility, native and tool-stream support remain open. See [plan](plans/340-function-response-capture.md) and [contract](../contracts/function-tool-responses.md).

## Stop sequence capture consistency

The shared stop snapshot uses one validated zero-to-four array count and reads indexed strings once, ignoring caller iterators. Length changes/appended entries cannot expand the captured range, and invalid/throwing captures fail safely before secrets across all four adapters. Preserve literal Unicode/string/null/empty behavior, inherited indexed lookup for local arrays, frozen copies and existing native stop/output-limit mappings. HTTP JSON cannot carry the local accessor/Proxy/iterator inputs used in regressions; no network exploit is claimed. Shared IAM/Deny/limits/persistence/privacy/accounting and pin v18 remain unchanged. Model-specific stop capabilities and complete #116 compatibility remain open. See [plan](plans/342-stop-capture.md) and [contract](../contracts/client-stop-sequences.md).

## Internal streamed function fragments

A separate internal function-stream decoder validates partial tool_calls alongside existing delegated chunk metadata and model/alias scope. Required indices and optional nonnullable IDs/type/function name/arguments preserve empty fragments without assembly or execution. The 128-entry/index subset, per-chunk uniqueness and exact keys are explicit local restrictions. Deeply frozen fragments, tool-bearing usage rejection, fixed errors and bounded SSE/SDK regressions are covered. Existing text decoder and public HTTP/provider tool-stream guards stay closed; authorization, limits, audit/usage and privacy execution remain unchanged. Sequence assembly/termination, call/finish consistency, accounting integration, client SSE/cancellation and external-tool workflows remain under #116. Pin v18 is unchanged and the transitive ChatStreamToolCall drift gate stays open. See [plan](plans/344-function-stream-chunks.md) and [contract](../contracts/function-stream-chunks.md).

## Internal function stream sequence assembly

A separate sequence assembles decoded argument fragments by index and validates stable IDs/type/names, dense complete unique calls, tool/finish and cross-chunk refusal consistency. Success requires terminal, matching usage and DONE; errors/incomplete ordering stay safely possibly billed. A shared 1,048,576 UTF-16-unit local budget bounds retained call data; private state clears on failure/end. Completed calls are frozen response content, never operational audit/usage metadata; missing/invalid usage stays unknown. Existing text/public HTTP/provider stream guards and IAM/limits/persistence/privacy/accounting execution remain unchanged. Consumer/transport/SSE/cancellation/accounting integration, transitive tool schema drift and full #116 workflows remain open. See [plan](plans/346-function-stream-sequence.md) and [contract](../contracts/function-stream-sequence.md).

## Internal function stream consumer

The internal function consumer composes bounded SSE, decoded fragments and complete sequence assembly with awaited delta delivery and a captured model scope. It returns calls/usage only after terminal/usage/DONE, cancels/releases readers on early termination and sanitizes framing/order/transport/callback/cancellation failures. Explicit discard clears private calls on external failure. Pending reads/callbacks honor cancellation; late callback rejections stay observed. Response-bearing calls/deltas never become operational audit/usage metadata. Original text consumer and public tool-stream guards, IAM/limits/persistence/accounting/privacy execution remain unchanged. Transport/accounting/client SSE integration, transitive schema drift and complete #116 workflows stay open; pin v18 is unchanged. See [plan](plans/348-function-stream-consumer.md) and [contract](../contracts/function-stream-consumer.md).

## Internal function stream HTTP response boundary

A separate upstream response boundary admits only HTTP 200 SSE bodies to the scoped function consumer and preserves frozen calls/usage after complete termination. Status failures classify 429/5xx/other safely without reading bodies; malformed streams, delivery failures and cancellation retain fixed response-started/possibly-billed errors. Best-effort cleanup cannot stall safe HTTP failure. Completed calls/deltas remain response content, never operational audit/usage metadata. Original text response and public/request tool-stream guards, IAM/limits/persistence/accounting execution remain unchanged. Request adapter/client SSE/accounting integration, transitive schema drift and #116 remain open; pin v18 is unchanged. See [plan](plans/350-function-stream-response.md) and [contract](../contracts/function-stream-response.md).

## Internal scoped function stream invoker

- A separate function invoker accepts validated function declarations, choice,
  parallel controls and complete history, captured before credential awaits.
- Fixed approved upstream model/provider slugs, server-only secrets, cancellation
  and timeout handling compose the existing function HTTP response boundary.
- Invalid requests reject pre-secret; dispatched failures remain safely possibly
  billed with no retry. Existing text controls and public HTTP guards stay closed.

See [plan](plans/352-function-stream-invoker.md) and [contract](../contracts/function-stream-invoker.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Internal function stream client SSE projection

- A separate encoder preserves bounded indexed function fragments and tool_calls finish reasons using safe JSON framing. Partial arguments stay literal response content with no parsing or execution.
- Function fragments are forbidden on usage events and in the text encoder; malformed values fail with fixed errors. Missing usage emits no fabricated counts.
- Existing metadata, text, reasoning, usage and DONE projection stays shared; the public HTTP function-stream gate remains closed.

See [plan](plans/354-function-stream-sse.md) and [contract](../contracts/function-stream-sse.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Internal delegated function stream accounting composition

- Compose internal function delivery with approved model and final-provider IAM, explicit Deny, limits, required selection audit, usage handoff and attempt audit.
- Deliver awaited function frames with frozen identity-only metadata; project the completed result to accounting-only fields without reading or retaining toolCalls.
- Return final usage and DONE only after required persistence succeeds. Missing usage stays unknown; dispatched, cancellation and output failures remain sanitized and possibly billed, without retry.
- Public HTTP function streams remain disabled; no function execution or new permission authority is introduced.

See [plan](plans/356-delegated-function-stream.md) and [contract](../contracts/delegated-function-stream.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Controlled function HTTP stream responses

- A separate function HTTP response entry point uses the existing awaited bounded body handoff, cancellation and safe JSON or SSE error envelopes.
- Function fragments are delivered as response content with identity-only error metadata; failure after delivery records a content-free stream interruption without replay.
- Required usage/audit persistence precedes final usage and DONE. IAM/limit denial emits safe JSON before frames. Public request activation remains subsequent work.

See [plan](plans/358-function-http-stream.md) and [contract](../contracts/function-http-stream.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Delegated public function stream activation

- Both chat bases accept validated function declarations, choice, parallel controls and complete histories when a trusted function-stream invoker is installed. Text-only installations retain early tool rejection; managed direct streaming stays unsupported.
- Select the function coordinator for supplied tool controls/history, or for function-only installations; ordinary text requests retain the text path when installed.
- Persisted dual-route composition installs the function adapter using server credentials and verified mappings. Authentication, model/provider IAM including Deny, limits and required audit/usage precede or gate delivery as before.
- Safe errors, bounded flow control, cancellation, unknown usage and content-free operational records stay shared. Earlier internal-stage gate descriptions are superseded by this delegated activation; external SDK workflows and complete compatibility remain subsequent work.

See [plan](plans/360-public-function-stream.md) and [contract](../contracts/public-function-stream.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Official SDK streamed function workflow conformance

- Installed OpenAI 7.23.0 and OpenRouter 1.4.18 clients are verified on real local sockets over both chat bases with interleaved indexed function fragments and a subsequent complete tool-result request.
- Re-evaluate authentication, model/provider IAM and limits on each request; verify Deny prevents the second call and secrets. Usage/audit persistence gates final success, missing usage stays unknown, safe failures do not replay, and SDK cancellation reaches the upstream read.
- Response arguments stay out of operational records. This test-only stage changes no production behavior, SDK versions or pin; broader external-tool certification, direct streaming and transitive schema drift remain open.

See [plan](plans/362-sdk-function-stream.md) and [contract](../contracts/sdk-function-stream.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Streamed function fragment schema drift selection

- Extend selected streaming definitions from four to five by pinning the entire ChatStreamToolCall definition, including its inline function name and arguments. Keep 23 request fields and all other selected maps unchanged.
- Preserve verified canonical source provenance from the cached 2026-10-04 official document; version 19 records the expanded projection, not a fresh full-source comparison.
- Detect unchanged-parent nested structural drift and malformed or rehashed stale/extra/missing maps; editorial annotations remain ignored. Runtime bounds and exact-key rules remain local restrictions without invented source limits.
- No service, IAM, audit, usage or request behavior changes. Named external-tool and broader structural coverage remain open under #116.

See [plan](plans/364-stream-fragment-drift.md) and [contract](../contracts/stream-fragment-drift.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v19 tracks five selected stream definitions.

## Isolated OpenCode text conformance

Register a custom @ai-sdk/openai-compatible provider with an explicit proxy-token environment reference and chosen model. Verify installed OpenCode 1.18.5 with an opt-in local socket runner over both bases, fresh temporary config/data/cache/work directories, bounded lifetime and cleanup. Do not write real user configuration or call a real upstream. Named-client model registration is explicit and does not claim automatic GET models discovery. This first test subject is reversible; broader clients and #116 remain open.

See [plan](plans/366-opencode-text-conformance.md) and [contract](../contracts/opencode-text-conformance.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v19 tracks five selected stream definitions.

## OpenCode streamed tool lifecycle and controls

Extend installed OpenCode 1.18.5 conformance over both bases with incremental read-function fragments, an actual temporary fixture-file read and correlated tool-result continuation. Evaluate fresh IAM and limits for every request; verify explicit model and provider Deny before secrets and process-termination cancellation with failed accounting. Restrict reads to the single temporary fixture, deny all other tools and external skills, and retain bounded child lifetime/output and cleanup. No product API, provider routing or schema behavior changes; broader app cancellation/failure semantics, direct streaming and full #116 remain open.

See [plan](plans/367-opencode-tool-conformance.md) and [contract](../contracts/opencode-tool-conformance.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v19 is unchanged.

## Direct OpenAI text-stream transport preparation

Expose an internal fixed-host direct OpenAI text-stream transport. Reuse existing native request controls and administrator output caps; capture approved candidate identity, client alias and complete prepared body before awaiting secrets. Nonstream adapters use the same captured scope. Always request include_usage for internal streams; reject other provider kinds and tool declarations/history before credentials. Support cancellation/deadline while awaiting secrets and fetch without inference retry. Response consumption and public managed streaming follow separately.

See [plan](plans/370-direct-stream-transport.md) and [contract](../contracts/direct-stream-transport.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Native direct OpenAI text-stream response boundary

Consume an already-opened direct OpenAI SSE response with native text/refusal guards, usage:null ordinary chunks and exactly one empty-choice final usage event before DONE. Reuse bounded framing and validated sequence primitives while rejecting delegated reasoning/native-finish extensions and tools. Capture exact approved model scope; require stable response identity and preserve unknown final usage. Await delivery, interrupt on cancellation and classify HTTP/stream failures as response-started and possibly billed without reading failure bodies. Unsuffixed-to-snapshot identity mapping, other native modalities/providers and public managed streaming remain open.

See [plan](plans/371-direct-openai-stream-response.md) and [contract](../contracts/direct-openai-stream-response.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Internal direct OpenAI text-stream invoker

Compose the captured direct OpenAI transport and native SSE response boundary into an internal text/refusal invoker. Preserve fixed registered host, exact approved upstream identity and immutable client alias, existing controls/caps, forced native final usage, awaited callback delivery and deadline/cancellation. Return a content-free native completion only after terminal/usage/DONE; failures retain sanitized categories and response-started/possibly-billed semantics with no inference replay. Unsupported providers/tools reject before secrets. The caller must already authorize the managed candidate; public managed IAM/limits/usage/audit streaming composition, identity alias equivalence and other native providers remain subsequent work.

See [plan](plans/373-direct-openai-stream-invoker.md) and [contract](../contracts/direct-openai-stream-invoker.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Managed text stream coordination

Compose authorized managed candidates with the trusted direct OpenAI text stream port. Preserve model and final-provider IAM, limits, Jev/order selection, per-attempt metadata-only usage and required audit. Deliver scoped text frames with awaited backpressure; expose final usage/DONE only after successful usage and audit. Never retry after any emitted delta or cancellation. Public HTTP activation remains a subsequent increment.

See [plan](plans/376-managed-text-stream.md) and [contract](../contracts/managed-text-stream.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Controlled managed HTTP stream delivery

Reuse the existing single-pending-frame HTTP controller for managed text streams. Preserve awaited delivery, zero high-water mark, cancellation, metadata-only interruption audit and post-accounting final frame gates. Project managed provider/credential/usage/audit failures safely for OpenAI and OpenRouter formats; public gateway activation is a subsequent increment.

See [plan](plans/378-managed-http-stream.md) and [contract](../contracts/managed-http-stream.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Public managed OpenAI text streaming

Activate managed OpenAI text/refusal streaming through an optional trusted gateway port on both /v1 and /api/v1 and generate that port from stored native registrations in persisted direct/dual servers. Retain complete model/final-provider IAM, limits, Jev/order selection, required usage/audit and bounded cancellation. Reject managed tools/tool histories before inference; unsupported native registrations fail before provider-key lookup without silently changing candidate selection. Exact upstream model IDs remain required. Native tools, Anthropic/Gemini streaming and full #116 remain open.

See [plan](plans/380-managed-gateway-stream.md) and [contract](../contracts/managed-gateway-stream.md).
Managed OpenAI text streaming is activated; broader native streaming and full #116 remain open. Pin v19 is unchanged.

## Native OpenAI function stream response validation

Consume native OpenAI indexed function deltas through bounded framing and the existing function sequence. Preserve exact model scope and stable response identity/timestamp. Ordinary usage:null is a delta extension, final empty-choice usage is required before DONE. Completed calls remain response content; rich/custom/deprecated fields fail safely. Classify opened-stream failures as possibly billed and cancel body on delivery failure or abort.

See [plan](plans/382-native-function-response.md) and [contract](../contracts/native-function-response.md).
Managed OpenAI text streams remain supported. Public managed function streaming and full #116 remain open; pin v19 is unchanged.

## Registered OpenAI function stream invoker

Introduce an explicit function-stream mode on captured direct request transport. Reuse validated OpenAI tools/choice/parallel controls and correlated result history, fixed registered host, output caps, immutable pre-secret scope/body, timeout and cancellation. Compose native function response validation. Preserve text-only rejection and fail unsupported kinds/invalid controls before keys. No inference retry in the adapter.

See [plan](plans/384-native-function-invoker.md) and [contract](../contracts/native-function-invoker.md).
Managed OpenAI text streams remain supported. Public managed function streaming and full #116 remain open; pin v19 is unchanged.

## Managed function stream coordination and HTTP delivery

Compose trusted native function streams with existing managed IAM, limits, Jev/order selection, per-attempt usage and required audit. Explicitly exclude completed tool calls from routing/accounting responses. Gate usage/DONE after required handoffs, retain safe pre-output fallback accounting and prohibit retry after output/cancellation. Add a function entry point on the shared bounded HTTP controller with safe interruption projection.

See [plan](plans/386-managed-function-stream.md) and [contract](../contracts/managed-function-stream.md).
Managed OpenAI text streams remain supported. Public managed function streaming and full #116 remain open; pin v19 is unchanged.

## Public managed OpenAI function streaming

Activate the trusted native function stream port on both chat bases and generate it from stored native registrations in direct/dual PostgreSQL servers. Preserve authentication, complete model/final-provider IAM, limits, Jev/order selection, accounting/audit gates, no replay and cancellation. Both installed SDKs must complete two interleaved calls and correlated tool-result continuation on both bases with fresh Deny, persistence errors, unknown usage and abort. Keep exact native model IDs and rich/custom/server-tool/other-native-provider gaps open.

See [plan](plans/388-public-managed-functions.md) and [contract](../contracts/public-managed-functions.md).
Managed OpenAI text streams remain supported. Managed OpenAI function streams are activated; broader compatibility and full #116 remain open. Pin v19 is unchanged.

## OpenCode managed native streaming conformance

Extend isolated OpenCode 1.18.5 probes from delegated routes to managed OpenAI text/function streams on both bases. Verify explicit custom-provider/model registration, text rendering, real fixture-only read-function execution and correlated result continuation, fresh IAM/limits, model/provider Deny and process-disconnect billed/missing accounting. Preserve fixed mocked upstream, isolated temporary Git/config/env and bounded process output/time. Default CI verifies both fixture route kinds; the installed-client gate runs 20 probes.

See [plan](plans/390-opencode-managed-streams.md) and [contract](../contracts/opencode-managed-streams.md).
Managed OpenAI text/functions remain supported. Broader named-client cases and full #116 remain open; pin v19 is unchanged.

## Native Anthropic text response validation

Internal response-only preparation validates native Anthropic text SSE, exact model identity, sequential blocks, cumulative aggregate usage, safe failure and cancellation. Anthropic transport, public activation, functions, reasoning and server tools remain follow-up work.

See [plan](plans/392-anthropic-text-response.md) and [contract](../contracts/anthropic-text-response.md). OpenAI managed text/function support remains in place; full #116 compatibility and #7 unresolved decisions remain open. Pin v19 is unchanged.
