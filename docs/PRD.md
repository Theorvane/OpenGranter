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

## Registered Anthropic text stream invocation

Internal native Anthropic text invocation uses an explicit transport mode, captured administrator registration and Messages request, fixed host and headers, capped output, timeout and caller cancellation. Existing OpenAI-only stream modes remain restricted. This stage does not yet wire persisted public Anthropic streams or tools.

See [plan](plans/393-anthropic-text-invoker.md) and [contract](../contracts/anthropic-text-invoker.md). OpenAI managed text/function support remains in place; full #116 compatibility and #7 unresolved decisions remain open. Pin v19 is unchanged.

## Managed Anthropic public text streaming

Public managed Anthropic text streaming is activated through a captured registration-kind dispatcher and generated persisted direct/dual handlers. Both API bases and actual OpenAI/OpenRouter SDK text consumption preserve authentication, model/provider Deny, limits, required usage/audit, cancellation and safe partial failure. Gemini and Anthropic functions/thinking/server tools remain unsupported.

See [plan](plans/395-anthropic-managed-stream.md) and [contract](../contracts/anthropic-managed-stream.md). OpenAI managed text/function support remains in place; full #116 compatibility and #7 unresolved decisions remain open. Pin v19 is unchanged.

## Managed Gemini public text streaming

Add bounded native Gemini text SSE validation, an explicit registered Google streaming transport and generated managed text dispatch through both API bases and persisted direct/dual composition. Preserve exact approved version scope, stable response identity, native output caps, authentication, model/provider Deny, limits, required usage/audit and cancellable backpressure.

See [plan](plans/398-gemini-managed-stream.md) and [contract](../contracts/gemini-managed-stream.md). Exact native version identity and final reported Google totals are required; functions/thoughts/signatures/server tools and full #116 remain open. Pin v19 is unchanged.

## Gemini reported-only aggregate totals

Native Google nonstream text and supported prompt/candidate safety outcomes preserve only supplied totalTokenCount. Missing total stays partial despite known prompt/candidate counters; hidden thinking prevents deriving their sum. Both API bases, known/invalid counters, provider regressions and operational secrecy are covered. See [plan](plans/399-google-reported-totals.md) and [contract](../contracts/direct-usage-availability.md). Full #116 remains open.

## Managed Anthropic nonstream client functions

Registered Anthropic nonstream routes now map bounded custom function declarations, choice/parallel controls, mixed text/tool_use responses and complete correlated tool-result histories on both API bases. Adjacent parallel results form one native user turn; argument inputs are bounded JSON objects. Preserve immutable pre-secret bodies, authentication, model/final-provider IAM, limits, required aggregate usage/audit and safe failures. Tools execute only in the external client. Persisted direct/dual servers and both installed SDKs are covered by fixture tests.

See [plan](plans/402-anthropic-client-functions.md) and [contract](../contracts/anthropic-client-functions.md). Anthropic function streaming, native thinking/server tools, Gemini functions and broader named-client conformance remain open. No live-provider certification or complete #116 compatibility is claimed; #7 remains unresolved and pin v19 is unchanged.

## Managed Anthropic client function streaming

Activate registered Anthropic Messages function streams on both compatible bases and in generated persisted direct/dual handlers. Validate exact native model identity, sequential text/tool blocks, bounded JSON-object argument assembly, dense compatible tool indices and cumulative usage; require complete native terminal order. Preserve authentication, complete model/final-provider IAM and Deny, limits, immutable pre-secret requests, required usage/audit, cancellation and no replay. Completed calls remain private response content; the gateway never executes them. Both installed SDKs complete two Unicode calls and correlated result continuation through fixture sockets.

See [plan](plans/404-anthropic-function-streams.md) and [contract](../contracts/anthropic-function-streams.md). No-delta empty tool inputs retain the official SDK placeholder; incomplete/invalid arguments and tool-bearing max_tokens responses fail this complete-call subset safely. Native thinking/server/rich tools, Gemini functions, model equivalence and broader named-client conformance remain open. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

## Bounded managed Gemini nonstream client functions

Registered generateContent routes now translate bounded custom declarations, choice modes, signature-free mixed text/function calls and complete correlated text-result histories on both API bases. Results preserve exact strings and original call order; native IDs remain exact and missing IDs use reserved local correlation IDs omitted on native replay. Function paths request thinkingBudget:0 and reject explicit reasoning conflicts, strict:true and unenforceable parallel:false controls before keys (NONE remains valid). Signature/thought/rich or incomplete native calls fail safely; no tool executes inside the gateway. Preserve complete model/provider IAM, limits, immutable secret boundaries, reported-only Google totals and required usage/audit.

See [plan](plans/406-gemini-client-functions.md) and [contract](../contracts/gemini-client-functions.md). Both installed SDKs and persisted direct/dual servers exercise fixture round trips and fresh Deny. Native function streams, thinking/signature replay, models requiring thinking, strict/single-call equivalence and broader named clients remain open. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

## Bounded managed Gemini function streaming

Registered streamGenerateContent routes now emit bounded complete custom function objects and text on both compatible bases through the captured registration dispatcher and generated persisted direct/dual servers. Validate exact initial model/response identity, whole events before delivery, dense indices, unique native IDs, reserved missing-ID replay, bounded objects and clean terminal/EOF. Preserve existing signature-free thinking controls, fixed hosts, administrator caps, model/final-provider IAM and Deny, limits, pre-secret immutability, cancellation, required usage/audit and reported-only Google totals. Tools execute only in external clients.

See [plan](plans/408-gemini-function-streams.md) and [contract](../contracts/gemini-function-streams.md). Both installed SDKs cover Unicode calls, results, missing IDs, fresh Deny, failure gates and abort through fixture sockets. Partial argument streaming, thinking/signature replay, models requiring thinking, strict/single-call equivalence and broader named clients remain open. This is not live-provider certification. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

## Managed Gemini nonstream function thought signatures

Managed Gemini nonstream function calls now preserve exact bounded Part.thoughtSignature metadata as the documented tool_calls[].extra_content.google.thought_signature extension and replay it on the same native call part. Preserve parallel/sequential call association, reserved missing-ID semantics, immutable pre-secret history, complete model/provider IAM and Deny, limits, required usage/audit, reported-only totals and metadata privacy. Invalid/oversized signatures fail safely; other native/delegated adapters and native text streams reject this extension before keys. Signed text and visible thought content remain unsupported.

See [plan](plans/410-gemini-function-signatures.md) and [contract](../contracts/gemini-function-signatures.md). Raw HTTP and installed OpenAI SDK socket/persisted direct/dual probes exercise exact replay and fresh Deny. Installed OpenRouter 1.4.18 strips tool-call extra_content; socket tests measure lost-signature continuation failure, so signed Gemini SDK compatibility is still incomplete. No reasoning-detail/tool association is invented. Existing thinkingBudget:0 and effort conflict remain; signed text, standalone signature chunks, models requiring thinking and broader clients stay open. Full #116 and unresolved #7 remain open; pin v19 is unchanged and fixture tests do not certify live providers.

## Managed Gemini function signature streams

For #412, native Google function streams preserve complete same-part thoughtSignature values as tool_calls[].extra_content.google.thought_signature in client deltas, completed calls and signed history replay on both bases. Retain original parallel/sequential association and missing-ID semantics. Trusted outbound projection admits this exact frozen extension; unrelated inbound decoders and adapter histories remain closed. The shared one-MiB retained string-unit budget now includes signatures with IDs, names and arguments; conflicts and malformed/overflow content discard private assembly.

Raw HTTP, installed OpenAI 7.23.0 raw SDK streams and stored direct/dual probes cover signed calls, fresh Deny, limits, required usage/audit failure and privacy. Installed OpenRouter 1.4.18 strips the extension; measured missing-signature continuation fails safely, so signed Gemini OpenRouter SDK compatibility remains incomplete. Native signed text, thoughts, partial arguments and standalone late signatures remain unsupported; no reasoning-detail/tool bridge or model eligibility/default change is inferred. Function requests retain thinkingBudget:0 and effort conflict. Completion still requires supported terminal and clean framed EOF; signatures stay out of operational errors, ledger and audit metadata.

See [plan](plans/412-gemini-signature-streams.md) and [contract](../contracts/gemini-signature-streams.md). This supersedes the prior nonstream signature contract's native function-stream exclusion only. Full #116 and unresolved #7 remain open; pin v19 is unchanged and fixture conformance is not live-provider certification.

## OpenCode managed Anthropic and Gemini conformance

For #414, extend the pinned OpenCode 1.18.5 conformance harness to administrator-registered managed Anthropic/Gemini fixtures on both API bases, retaining delegated/OpenAI probes. Verify explicit custom-provider/model registration, rendered text, real fixture-only read execution, native correlated result continuation, administrator output caps, fresh per-request IAM/limits, initial model/provider Deny, follow-up provider Deny, cancellation with possibly-billed missing usage and private operational metadata. Fixed mocked hosts, secret references, environment allowlist, isolated temporary Git/config/data, exact read permission, disabled plugins/external config, bounded process output/time and cleanup remain enforced.

The pinned OpenCode OpenAI-compatible SDK loses signed Google call metadata with the default custom-provider namespace. Explicit provider.opengranter.options.name="google" preserves complete same-part signatures while keeping model="opengranter/chat", the gateway baseURL and proxy token. This selects the SDK metadata namespace only; it grants no model/provider IAM authority, changes no registered destination and is not a universal client default. Probe both safe failed native default continuation and configured successful signed replay. OpenCode's outer session policy retries 5xx without a cap; deliberately terminate the default negative probe at the existing five-second process deadline and verify unsigned result replay plus failed possibly-billed missing accounting, without claiming immediate terminal client error or normal completion. Later signature-only chunks, thinking-model eligibility, automatic discovery, other clients/versions and live-provider certification remain outside this subset. Installed OpenRouter 1.4.18 signature stripping remains an independent gap.

See [plan](plans/414-opencode-native-providers.md) and [contract](../contracts/opencode-native-providers.md). Full #116, unresolved #7 and pin v19 remain unchanged.

## Gemini informational cached and reasoning usage

For #416, supported managed Google nonstream text/safety/function completions and text/function streams preserve supplied cachedContentTokenCount as prompt_tokens_details.cached_tokens and thoughtsTokenCount as completion_tokens_details.reasoning_tokens on both chat bases. Accept nonnegative safe integers including zero; native absent/null/invalid categories remain omitted independently. Ignore native modality/tool/cost fields and OpenAI-shaped groups. Capture immutable allowlisted snapshots.

Preserve native aggregate availability and reported totals without derivation, sum/subset inference, cached subtraction or thought addition. Details alone cannot manufacture usage. Compatible nonstream /api/v1 omits incomplete usage; legacy sparse usage remains available. Final streams take details only from terminal usage or its allowed replacement tail, never earlier snapshots or merged groups, and emit final usage/DONE only after required ledger/audit persistence. Existing IAM, limits, registered hosts, cancellation and per-attempt aggregate accounting remain shared; categories are client-only and stay out of operational records.

No thinking/default/eligibility, cached-content request, native thought-body, category ledger, SDK or schema pin change. Anthropic/modality/server-tool categories, detailed billing, full #116, live-provider certification and unresolved #7 remain open. See [plan](plans/416-gemini-token-details.md) and [contract](../contracts/gemini-token-details.md). Source: [Gemini UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata).

## Anthropic cache-aware native usage

For #418, managed Anthropic nonstream text/refusal/functions and text/function SSE include reported disjoint cache_creation_input_tokens and cache_read_input_tokens in native prompt normalization once, then derive prompt+output total within safe integer bounds. Expose valid cache reads/writes as optional prompt_tokens_details.cached_tokens/cache_write_tokens without adding projected categories again. New per-attempt aggregate ledger records receive the corrected totals; category fields stay client-only and establish no billed-cost authority.

Both cache fields wholly absent retain the historical bounded input/output-only mapping, which does not certify complete cache reporting. If initial/nonstream cache reporting is present, missing/null components leave prompt/total unavailable; malformed/overflow counts or sums make prompt invalid. Known cache details alone cannot manufacture input or total usage. Stream input/cache counters preserve prior values across omitted/null deltas and replace supplied nonnull cumulative updates, never sum event snapshots. Final output comes from the latest message_delta, without initial-estimate fallback.

Shared authentication, complete model/provider IAM/Deny, limits, fixed hosts, cancellation, privacy and required usage/audit before final usage/DONE remain enforced. Historical records, pricing, cache requests/defaults, thinking/models, schema/SDK pins, live-provider certification, full #116 and unresolved #7 remain outside this bounded fix. See [plan](plans/418-anthropic-cache-usage.md) and [contract](../contracts/anthropic-cache-usage.md). Sources: [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [official accumulator](https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/lib/MessageStream.ts).

The bounded nonstream probability subset accepts nullable logprobs/top_logprobs on managed OpenAI/delegated OpenRouter and preserves reported content/refusal tokens, alternatives and bytes. Unsupported native controls fail before credentials; #424 extends supported streaming paths and #426 adds nonstream Gemini normalization; metadata never creates usage or enters operational records. Per-model support, remaining native probability maps and other unselected schema targets remain unresolved compatibility work. See [contract](../contracts/nonstream-logprobs.md).

The reviewed version-20 probability source guard tracks both supported request controls and the complete referenced token/group structures. It does not itself enable native probabilities or replace the bounded runtime contract and full compatibility release gate. See [contract](../contracts/logprob-schema.md).

## Streamed chat token probabilities (#424)

Both API bases extend nullable logprobs/top_logprobs controls to managed OpenAI/delegated OpenRouter text/refusal/function streams with exact pre-secret capture. Preserve bounded immutable choice-level content/refusal probabilities, alternatives and bytes without synthesis or usage derivation. Native Anthropic and streaming Gemini controls still reject before secrets; #426 extends nonstream Gemini. Native OpenAI usage:null delta and empty-choice final usage conventions remain unchanged.

Delegated final content-free usage choices retain only one private bounded probability snapshot outside routing summaries, ledger and operational audit/error data. Release it after required usage/outcome audit succeeds; missing aggregate usage permits a metadata-only frame without fabricated counters. Invalid data and persistence failures withhold final metadata/DONE and preserve safe possibly-billed accounting. Existing IAM/Deny, limits, fixed hosts, backpressure and cancellation stay effective. Per-model guarantees, remaining native probability mappings, live-provider certification, full #116 and unresolved #7 remain open. See [plan](plans/424-stream-logprobs.md) and [contract](../contracts/stream-logprobs.md).

## Nonstream Gemini token probabilities (#426)

Both API bases accept the same nullable probability controls on nonstream managed Google, mapping captured exact values to responseLogprobs/logprobs without changing model, output or function thinking defaults. Preserve reported chosen tokens and available aligned alternatives as bounded immutable choice-level content probabilities. Native bytes are unavailable (null); no text/bytes/refusal/function-argument probabilities, usage or costs are inferred. Missing native token/logProbability fields cannot default to empty/zero. ProtoJSON empty repeated fields and entirely absent alternative lists produce no alternative records; nonempty mismatched steps fail safely.

Prompt/candidate SAFETY suppresses probability metadata with existing empty output. IAM/Deny, limits, fixed hosts, required usage/audit before content, reported-only aggregate accounting and operational privacy remain shared. Google streams and all Anthropic supplied probability controls still reject before credentials. This supersedes earlier nonstream Google exclusions only; native stream semantics, per-model/live-provider guarantees, full #116 and unresolved #7 remain open. See [plan](plans/426-gemini-logprobs.md) and [contract](../contracts/gemini-logprobs.md).

## Client end-user request metadata (#428)

Both API bases preserve an optional non-nullable client user string for upstream attribution on managed OpenAI/delegated OpenRouter nonstream/stream text/refusal/function requests. Exact empty, Unicode and case-sensitive strings are captured before credential awaits; no trimming, hashing, derived defaults or response echoing. Null/malformed values reject before route work. Native Anthropic/Gemini supplied strings reject before secrets because no exact unrestricted mapping is verified. Authenticated principal/credential/policy identities still govern IAM, limits, audit and ledger attribution; the caller field cannot override them or enter operational records. Existing delivery, cancellation, missing usage and safe failure accounting remain shared.

Version 21 now selects exactly 26 request fields, adding user while retaining every prior selected definition/map. Fresh fixed-host retrieval and canonical source/projection digests verify prior selections; nullable/type/required/default/bounds/extension drift is detected without source-invented runtime limits. OpenAI HTTP nullable user, native identity mappings, safety_identifier/prompt_cache_key, registration APIs, full #116 and unresolved #7 remain open. See [plan](plans/428-client-user.md) and [contract](../contracts/client-user.md).

## Prompt cache request keys (#430)

Both API bases capture nullable optional prompt_cache_key once before credentials and preserve exact string preferences for managed OpenAI/delegated OpenRouter nonstream/stream text/refusal/function requests. Null/omission leaves the upstream field unset; empty/Unicode/whitespace/case-sensitive strings remain exact, and malformed types reject before route work. Native Anthropic/Gemini supplied strings reject before secrets; no cache_control/cachedContent translation or prompt-context change is inferred. User attribution and cache preferences remain independent, with authenticated principal/credential/policy IAM, limits and operational attribution unchanged. Keys are not echoed or logged and do not create cache-hit, usage, savings or billed-cost claims. Existing body bounds, missing usage and required delivery handoffs remain enforced.

Version 22 selects exactly 27 fields, adding only nullable string prompt_cache_key while retaining all prior definitions/maps. Fresh source/projection digests and canonical removal equality are verified, with explicit fixed-host live drift checks. Native cache semantics/retention/resource ownership, provider/model guarantees, full #116 and unresolved #7 remain open. See [plan](plans/430-prompt-cache-key.md) and [contract](../contracts/prompt-cache-key.md).

## Bounded client request metadata (#432)

Both API bases preserve optional non-nullable metadata string dictionaries on managed OpenAI/delegated OpenRouter nonstream/stream text/refusal/function requests. Enforce published 16-pair/64-key-character/512-value-character bounds with a documented local Unicode-code-point interpretation (upstream counting is unspecified); preserve exact strings, empty maps and arbitrary JSON keys. Capture immutable own entries before credentials. Null/malformed/exceeded values reject before routes; native Anthropic/Gemini supplied maps reject before secrets without inequivalent user_id/labels translation. Authenticated attribution, approved destinations, IAM/Deny, limits, usage and required persistence remain shared. Tags are excluded from operational records/errors and response echoes and cannot enable storage, content auditing or trace/broadcast.

Version 23 selects 28 request fields, adding only object/string-dictionary metadata without inventing prose bounds in the structural pin. Earlier maps/definitions remain canonically identical; fresh source/projection provenance and explicit drift checks are verified. OpenAI nullable metadata, native mappings, upstream storage/query semantics, live certification, tier routing, full #116 and unresolved #7 remain open. See [plan](plans/432-client-metadata.md) and [contract](../contracts/client-metadata.md).

## Explicit prompt cache request controls (#434)

Both chat bases capture optional non-nullable cache_control={type:"ephemeral",ttl?:"5m"|"1h"} once before credentials and forward it exactly to delegated OpenRouter/managed Anthropic nonstream/stream text/refusal/function paths. Omission injects no directive/TTL default. Null/malformed/extra fields and unknown TTL reject before routing; native OpenAI/Gemini supplied directives reject before secrets without inequivalent cache-key/options/resource translation. Anthropic nullable extension, explicit block markers and mixed TTLs remain outside this bounded subset. Existing output caps and version header remain shared; no beta header or prompt-content transformation is added.

Provider/model availability, minimum prompt sizes, TTL pricing and cache effectiveness remain upstream behavior. Request preferences never prove hits, savings, billed cost or usage, and never enable local content auditing. Preserve existing reported cache-aware aggregate/category rules, authenticated attribution, approved models/providers/hosts, IAM/Deny/limits, required persistence before final frames and safe failure/cancellation accounting. Controls remain outside operational records/errors and response echoes.

Version 24 selects 29 fields/16 request-history definitions, adding only cache_control and whole directive/TTL targets. Fresh canonical provenance and removal equality preserve version 23; source TTL open-enum semantics stay tracked while unknown runtime strings are unsupported. Actual SDKs exercise captured fixture requests; live cache/model certification, broader native/block-level semantics, full #116 and unresolved #7 remain open. See [plan](plans/434-cache-control.md) and [contract](../contracts/cache-control.md).

## Bounded predicted text outputs (#436)

Both chat bases preserve nullable optional prediction={type:"content",content:string|text-parts} on managed OpenAI/delegated OpenRouter nonstream and text/refusal streams. Null/omission injects no field; exact empty/Unicode/whitespace strings, empty arrays and part order survive immutable pre-secret capture. The local text-only subset rejects unknown fields/malformed parts and more than 128 parts under existing complete body limits. Reject normalized supplied tool/probability controls (including empty/none/false), function history, positive penalties and non-null max_completion_tokens before routes/credentials. Nullable unset controls remain shared. Nonpositive penalties, max_tokens and administrator caps retain passthrough; the guide does not discuss max_tokens, so model/control support is not universally guaranteed.

Native Anthropic/Gemini supplied predictions reject before secrets without prefill/alternate-method translation; null/omission preserves defaults. Expected output never changes message history, approved destinations, authenticated IAM/Deny/limits or operational attribution. Do not synthesize response echoes/usage/savings/billed cost or subtract rejected prediction tokens; actual provider text may match expected text and remains valid output. Existing reported prediction-token categories stay informational, missing usage stays missing, and required audit/ledger, safe failure/cancellation behavior and private operational projection remain shared.

Version 25 selects 30 fields/18 request-history definitions, adding only prediction and its root/text-part targets. Fresh canonical provenance and removal equality preserve version 24; transitive nullable/type/enum/required/default/count/length/extensions remain guarded without inventing runtime restrictions in the source pin. SDK fixtures cover request/delivery controls; rich parts, broader combinations/native mappings, model/live guarantees, full #116 and unresolved #7 remain open. See [plan](plans/436-predicted-output.md) and [contract](../contracts/predicted-output.md).

## Explicit request cache options (#438)

Both /v1 and /api/v1 accept optional nullable prompt_cache_options={mode:"explicit",ttl?:"30m"|null} for managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Capture/freeze own known fields once before credentials. Null options omit the field; null/undefined TTL omits that member as an explicit local normalization, not a claim about native null semantics. Omission adds no mode/TTL default. Malformed/non-record/extra fields, missing/implicit/unknown mode and other TTL strings reject before routes. The TTL/extra-field restrictions are local: OpenRouter's source declares nullable string TTL with no enum/default/length or additionalProperties:false. Native OpenAI permits optional implicit mode, but that extension is not exposed here.

Native Anthropic/Gemini supplied options reject before secrets without cache_control/cachedContent/retention translation; null/omission preserves defaults. Simultaneous non-null cache_control rejects as a conservative local restriction because request-level precedence is unverified. The #438 slice left message normalization unchanged; #442 later enables the bounded explicit text-marker subset in its separate contract. Supporting OpenAI models document explicit-only requests without markers as disabling prompt caching, but forwarding cannot certify a provider/model outcome or billed savings. Administrator model eligibility is unchanged; unsupported upstream combinations retain safe failure handling.

Independent user/key/metadata/prediction, function history and existing controls retain their validators and projection. Approved model/final-provider/host scope, authenticated IAM/Deny/limits, secret references, private operational records/errors, required audit/ledger before final delivery, missing usage, possibly-billed failures and cancellation stay shared. Options never supply usage zeroes, cache read/write categories, retention proof or billed cost. No synthetic request-field echoes or routing-content disclosure.

Version 26 selects 31 request fields and 19 request/history definitions, adding only prompt_cache_options and its whole PromptCacheOptions target. Removing these two selections reproduces version 25 canonically; source shape retains nullable object, required explicit mode, nullable string TTL and absence of defaults/bounds. Transitive structural drift and missing/malformed/stale/rehashed exact-map cases are guarded. Installed SDK socket fixtures exercise control paths, not live model/caching certification. Block boundaries, implicit/arbitrary-TTL extensions, native translations/cross-control precedence, broader endpoints, full #116 and unresolved #7 remain open.

See [plan](plans/438-prompt-cache-options.md) and [contract](../contracts/prompt-cache-options.md).

## Explicit text output modality (#440)

Both /v1 and /api/v1 accept exact modalities=["text"] for managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Null/omission omits the field without a default; null normalization is an explicit native OpenAI-compatible local extension because the official OpenRouter field/SDK is nonnullable. Capture root, length and own index zero once and freeze a fresh tuple before credentials. Reject non-array, empty, sparse, duplicate/multi-item, audio/image/unknown entries and extra enumerable array members before routes. Singleton/cardinality/extra-member restrictions are local; the source declares no minimum, maximum, uniqueness or default.

Native Anthropic/Gemini supplied selectors reject before secrets without implicit native responseModalities/default translation; null/omission preserves current behavior. Text selection enables no richer output and changes no model eligibility. Existing prediction/tool/control validators, exact independent cache/user/key/metadata fields and correlated function-result history remain shared. Accepting the selector does not certify every model/control combination.

Approved model/final-provider/host scope, authentication/IAM/Deny/limits, secret references, private operational projection/errors, required audit/ledger before final frames, missing usage and possibly-billed failure/cancellation stay shared. Never derive usage or synthesize request-field echoes; actual provider text/probability output remains valid client content. Installed OpenAI 7.23.0 and OpenRouter 1.4.18 socket fixtures exercise controlled requests through both bases/routes and all supported modes/streams, not live model certification.

Version 27 selects 32 fields/19 request-history definitions, adding only the raw modalities field. Removing it reproduces version 26 canonically. Preserve the source nonnullable array, text/image/audio item enum and unknown-values extension, with absent cardinality/uniqueness/default. Structural drift and missing/malformed/stale/rehashed maps reject. Audio/image/rich workflows, broader array semantics, native mappings, model/live guarantees, full #116 and unresolved #7 remain open.

See [plan](plans/440-text-modality.md) and [contract](../contracts/text-modality.md).

## Explicit text cache breakpoints (#442)

Both chat bases preserve optional nullable prompt_cache_breakpoint={mode:"explicit"} on text parts in all five history roles through managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Any non-null marker retains the complete immutable array, exact empty/Unicode/whitespace text, order and correlated function-result boundaries; null-only/unmarked arrays retain literal concatenation. Capture before credentials. The local 128-part bound does not represent provider cache write/lookup limits. Malformed/extra/prototype markers, unknown mode/TTL and sparse/rich/refusal/prediction markers reject safely. Simultaneous request cache_control rejects as an unverified mixed-format restriction; independent root prompt_cache_options omission injects no mode/TTL.

Native Anthropic/Gemini reject marked history before secrets, including explicit converter guards, without inequivalent format/resource translation. Shared authentication, approved model/final-provider/host scope, IAM/Deny/limits, private operational records/errors, required audit/usage, missing usage and possibly-billed failure/cancellation remain enforced. Opt-in Jev disclosure joins exact text without marker metadata/object coercion. No cache hit, retention, usage, savings or billed cost is inferred; upstream model support and catalog eligibility remain unchanged.

Version 28 selects 32 fields/22 request-history definitions, adding whole ChatContentText, PromptCacheBreakpoint and ChatContentCacheControl; removal reproduces version 27 canonically. Preserve raw nullable/required/enum/reference shapes without local bounds/defaults. Source block-cache selection does not enable block directives. Actual installed SDK fixtures exercise controlled sockets; native conversions, mixed formats/block directives, richer parts, live certification, full #116 and unresolved #7 remain open. This supersedes earlier exclusions only for these explicit text markers. See [plan](plans/442-prompt-cache-breakpoints.md) and [contract](../contracts/prompt-cache-breakpoints.md).

## Explicit text block cache directives (#444)

Both chat bases preserve optional non-null cache_control={type:"ephemeral",ttl?:"5m"|"1h"} on text parts for delegated OpenRouter across all five history roles and managed Anthropic instruction/user/assistant blocks with complete unmarked tool results. Nonstream/text/refusal/function streams retain complete immutable arrays, exact text/order and omitted TTL. Capture known fields once before credentials; plain arrays keep prior concatenation. Reject null/malformed/extra/prototype directives, rich/refusal/prediction fields, empty marked text, over 128 parts, more than four directives per history and 1h markers following effective 5m markers. These are local delegated restrictions following native limits; no default field is injected.

Native Anthropic preserves system text blocks with plain newline separator blocks between instruction messages and appends tool_use after assistant text parts. All-string instructions retain prior joined strings; block token equivalence is not guaranteed. The #450 final-only result subset now maps the last nested directive to outer tool_result under documented compatibility. Earlier/partial markers remain rejected before secrets; do not move those boundaries. Native OpenAI/Gemini reject block controls before secrets. The #444 slice initially rejected all root controls; #448 permits bounded automatic/explicit cache_control coexistence. Root prompt_cache_options or any OpenAI breakpoint still reject before routes without assumed format conversion. Shared IAM/Deny/limits/hosts, private operational projection, required audit/usage, reported-only cache accounting, missing usage and safe possibly-billed failures/cancellation remain enforced. Jev opt-in disclosure keeps its text view; no hits/retention/savings/billed cost or model eligibility is inferred.

Version 28 already selects the complete text/directive/TTL shapes and remains unchanged (32 fields/22 request-history definitions); verify fresh fixed-host structural equality. Actual SDK sockets certify controlled boundaries, not live caching. This supersedes earlier block exclusions only for this subset; native nested results, tool-definition/rich directives, mixed controls, other native formats, live certification, full #116 and unresolved #7 remain open. See [plan](plans/444-text-block-cache-control.md) and [contract](../contracts/text-block-cache-control.md).

## Function tool cache directives (#446)

Both chat bases preserve optional non-null cache_control={type:"ephemeral",ttl?:"5m"|"1h"} on portable function-tool wrappers for delegated OpenRouter and managed Anthropic nonstream/text/refusal/function output and function-capable streams. Capture/freeze wrapper/directive fields once before credentials. Anthropic places the directive on the native tool alongside name/input_schema/description/strict; existing choice/parallel/history behavior remains shared. Null/malformed/extra/prototype directives, nested function cache fields, unknown type/TTL and server/custom tools reject safely. Native OpenAI/Gemini reject supplied tool directives before secrets without conversion; plain tools retain defaults.

Count tools first, then instruction/message text blocks: at most four directives total and 1h before effective 5m, with omitted TTL used only for order checking. Valid tool/text combinations are supported; #448 permits bounded same-format automatic/explicit cache_control coexistence. Root prompt_cache_options or any OpenAI history breakpoint still reject as unverified mixed formats. Shared approved destination IAM/Deny/limits/hosts, private operational projection, required audit/usage, reported-only cache accounting, missing usage and safe possibly-billed failures/cancellation remain enforced. Preferences do not broaden Jev disclosure or infer hits/retention/savings/billed cost/model eligibility.

Version 28 already tracks whole function/cache/directive/TTL shapes (32 fields/22 request-history definitions) and remains unchanged; verify fresh fixed-host equality. Actual SDK sockets exercise controlled boundaries, not native OpenAI or live caching. This supersedes earlier tool-definition exclusions only for portable wrapper directives; nested/server/custom fields, mixed controls/conversions, native partial results, live certification, full #116 and unresolved #7 remain open. See [plan](plans/446-function-tool-cache-control.md) and [contract](../contracts/function-tool-cache-control.md).

## Automatic and explicit cache control coexistence (#448)

Both chat bases support root cache_control together with explicit function-tool and instruction/user/assistant text directives for managed Anthropic and delegated OpenRouter in nonstream/text/refusal/function streams. Preserve immutable controls, whole arrays, exact text/order and correlated string tool results without injected markers/TTL or moved boundaries. This supersedes the blanket root/explicit exclusions in #434/#444/#446 only for this same-format subset.

Automatic caching reserves one of four slots, including final same-TTL no-ops: at most three explicit directives. Evaluate tools→system→messages, with 1h before effective5m. Omitted TTL counts as5m only for validation. Skip empty text when finding the final eligible block; native tool_use/outer tool_result remain eligible even with empty result strings. Instruction newline separator/joining behavior remains shared. Reject final differing effective TTL, root1h after explicit5m and four explicit markers plus root before routing/credentials. The #450 subset permits final-only tool-result markers; combined earlier/partial result markers still reject before routes/credentials. OpenAI marker/options mixtures, unsupported native OpenAI/Gemini mappings and richer targets remain outside scope.

Authentication, complete approved IAM/Deny/limits/host scope, private operational records/errors, pre-secret capture, required audit/usage, reported-only cache usage, missing usage and possibly-billed failure/cancellation remain shared. No cache hit, retention, savings, model eligibility or provider-billed cost is inferred. The unchanged version28 source pin, fresh fixed-host drift and installed OpenAI7.23.0/OpenRouter1.4.18 controlled socket tests gate this subset. Full #116, unresolved #7, live model certification, mixed conversions and nested tool-result mapping remain open. See [plan](plans/448-automatic-explicit-cache-control.md) and [contract](../contracts/automatic-explicit-cache-control.md).

## Final tool-result cache directives (#450)

Both chat bases support final-only Anthropic-style cache_control on correlated tool-result text arrays for managed Anthropic/delegated OpenRouter nonstream/text/refusal/function streams. Anthropic places the last nested directive on the parent tool_result, preserving exact plain inner text blocks/order/Unicode/empty-unmarked parts and grouping adjacent parallel results. Delegated requests retain original arrays/directives. This supersedes the earlier blanket native/combined marked-result exclusion only for this documented final boundary.

Native earlier/multiple/missing-final directives reject before secrets; empty marked text and mixed OpenAI/rich content remain rejected. Combined automatic requests reject earlier result markers before routes; valid final-only results use the outer directive as automatic target even with later empty messages. Preserve the four-slot/reserved-automatic count, tools→system→messages TTL order and effective5m omission handling without injected defaults. Native exported conversion shares safe final-only validation; explicit-only delegated partial arrays retain prior forwarding.

Immutable pre-secret captures and mutation safety, complete approved IAM/Deny/limits/hosts, private operational records/errors, required audit/usage, reported/missing accounting and possibly-billed failure/cancellation remain shared. No live caching/model eligibility/retention/hits/savings/billed cost is inferred. Unchanged version28 source integrity/fresh fixed-host drift and actual OpenAI7.23.0/OpenRouter1.4.18 sockets gate this bounded mapping. Richer/partial/mixed mappings, full #116 and unresolved #7 remain open. See [plan](plans/450-tool-result-cache-control.md) and [contract](../contracts/tool-result-cache-control.md).

## Delegated session identifiers (#452)

Both chat bases accept optional non-null session_id for delegated OpenRouter nonstream/text/refusal/function streams. A present body value takes precedence over x-session-id, including empty strings; invalid body values reject rather than falling back. Missing body uses the platform-parsed header, with empty values retained through the Node bridge. Capture exact primitive strings before routing/credentials, with at most 256 Unicode code points. Astral characters count once and combining marks separately; preserve case/Unicode/whitespace without hashing or trimming. Selected null/nonstrings/overlong identifiers reject before routes; a valid body ignores an unselected overlong header. Omission adds no default. Header exactness refers to parsed values after HTTP normalization, not raw bytes.

Only the selected delegated body field is forwarded, with unchanged approved fixed model/provider.only/final-provider enforcement. Native OpenAI/Anthropic/Gemini explicit body identifiers reject before secrets without user/cache key/metadata substitution. Independent user, prompt_cache_key, metadata, cache directives and function history retain prior behavior. Session preferences cannot create gateway session state, supply principal/credential/request/accounting identity or broaden Jev disclosure. Authentication, IAM/Deny/limits/hosts, private operational records/errors, required audit/usage, reported/missing accounting and possibly-billed failure/cancellation remain shared. No live stickiness, cache hit, retention, savings or provider-billed cost is inferred.

Version 29 selects 33 request fields and the unchanged 22 request-history definitions, adding only the raw non-null string/maxLength256 field. Canonical removal reproduces version 28; fresh provenance, offline integrity, fixed-host structural drift and stale/rehashed map guards apply. Actual OpenAI 7.23.0/OpenRouter 1.4.18 sockets test body/header precedence, empty headers, Unicode and oversized request rejection. Native equivalents, routing overrides, trace/broadcast integration, live provider certification, full #116 and unresolved #7 remain open. See [plan](plans/452-session-identifiers.md) and [contract](../contracts/session-identifiers.md).

## Bounded service-tier requests (#454)

Both chat bases accept nullable service_tier on supported nonstream/text/refusal/function paths. Managed OpenAI forwards exact auto/default/flex/scale/priority/fast literals; delegated OpenRouter forwards explicit default only. Omission/null omit the upstream field without a default. Unknown/types reject before routes; unsupported recognized delegated tiers, native OpenAI ultrafast and Anthropic/Gemini supplied values reject before secrets. Capture once before asynchronous work without trimming, coercion or alias rewriting.

OpenRouter tier preferences admit separate tier endpoint slugs under base-provider matching, so expanded delegated selection remains deferred pending endpoint-scope authorization. Preserve existing approved model/host/provider.only and final-provider controls; default-versus-trusted-tier-slug precedence is not claimed. Native Anthropic/Gemini mappings remain separate work. Requested tiers never manufacture served response metadata or prices: upstream omission and different served values remain authoritative. Auth/IAM/Deny/limits, private audit/usage/errors, required persistence, missing usage and possibly-billed failure/cancellation remain shared.

Version 30 adds only the raw nullable service_tier enum and unknown-value extension to 34 selected fields, retaining prior definitions. Removal reproduces version 29; offline integrity, fresh fixed-host drift and structural/stale/rehashed guards apply. Installed OpenAI 7.23.0/OpenRouter 1.4.18 sockets use captured mock upstreams; no live eligibility, cost, latency or tier guarantees are certified. Expanded delegated tiers, native equivalents, full #116 and unresolved #7 remain open. See [plan](plans/454-service-tier-requests.md) and [contract](../contracts/service-tier-requests.md).

## Authorized model discovery filters (#456)

GET /api/v1/models supports bounded output_modalities (one to nine distinct documented modalities, matching any, or standalone all; extended by #472), supported_parameters (one to64 distinct exact lower_snake_case tokens, each at most128 characters; extended by #474), and context (canonical positive safe integer minimum). Omitted filters preserve the current list without an implicit text default. Undocumented normalization and broader query fields remain unimplemented; conjunction across different filters is an explicit local subset. Output list union is defined in the [output contract](../contracts/model-output-filters.md). Filter-only requests retain full-list behavior; offset/limit keep existing defaults and bounds. /v1 still rejects queries.

Validate the whole catalog and fresh enabled model/final-provider IAM before applying every asserted condition to frozen administrator metadata and then paging in catalog order. Missing metadata/null context cannot establish a filtered capability; output all imposes no modality condition. total_count and fixed relative continuation links describe only authorized matching aliases and preserve all accepted filters. Required audit precedes delivery; filters/metadata stay out of operational events/errors. Listing calls no secrets, limits, inference routes or usage ports, and cannot grant routing authority. Metadata may describe a model-level union across providers; it does not certify feature support on the selected authorized endpoint.

Actual OpenRouter 1.4.18/OpenAI 7.23.0 sockets test scalar filters and OpenRouter page iteration with current-policy denial; each page rechecks current catalog/IAM without cross-page snapshots. The version-30 chat pin remains unchanged. Issue #458 adds a separate structural guard for the five supported model queries; metadata refresh/provisioning, broader filters/sorting and complete discovery/client workflows remain open, together with #116 and unresolved #7. See [plan](plans/456-model-discovery-filters.md) and [contract](../contracts/model-discovery-filters.md).

## Supported model-query source guard (#458)

The compatibility release harness tracks official GET /models identity and the five implemented paging/capability query objects in a separate provenance/digest pin. Offline integrity and explicit live structural comparison cover both pins without changing discovery semantics. The guard does not certify instances, prose-only defaults, referenced targets or live capabilities. See [plan](plans/458-model-query-schema.md) and [contract](../contracts/model-query-schema.md).

## Authorized discovery search and ordering (#460)

GET /api/v1/models adds input_modalities=text/image/audio/file (one to four distinct values, requiring all; extended by #474), literal case-insensitive q search across alias/published name/canonical_slug, and sort=newest/context-high-to-low. Search accepts1..256 Unicode code points, preserves internal spaces/punctuation, rejects outer whitespace/C0/C1 controls and uses locale-independent Unicode lowercasing without regex/wildcards/accent or normalization equivalence. These are explicit local subsets; malformed input lists and other sort values remain rejected before catalog reads. Legacy /v1 rejects queries.

Validate the complete catalog and enabled model/final-provider IAM before all conditions, stable descending ordering and paging. Missing input metadata cannot establish capability; primary context null/absence sorts after known zero, and equal values preserve trusted catalog order. Newest uses published alias creation rather than provider freshness. Basic aliases can match their alias and sort by creation. Omitted sort preserves catalog order; without offset/limit, the matching sorted list remains complete. Matching totals and fixed relative continuations preserve every accepted field. Current catalog/IAM applies independently per page and may shift offsets.

Required audit, private operational errors/events and no route/secret/inference/limit/usage calls remain shared. Metadata/output order is captured before asynchronous audit; model metadata cannot grant routing authority or guarantee live endpoint capability. Actual OpenRouter1.4.18/OpenAI7.23.0 sockets cover scalar exploration, filtered ordered pagination, current Deny and safe malformed fields.

The separate query pin version2 selects eight complete objects, adding input_modalities/q/sort without changing the previous five canonical selections or version30 chat pin. Preserve full source sort enum/open-values extension; runtime only implements two literals. Fresh fixed-host structural comparison covers both pins. Fuzzy/ranked/locale search, other sorts/provider/region fields, metadata refresh/provisioning, full #116 and unresolved #7 remain open. See [plan](plans/460-model-discovery-exploration.md) and [contract](../contracts/model-discovery-exploration.md).

## Model response source guard (#462)

A separate version1 pin selects GET /models (operationId getModels), HTTP200 application/json and all21 component definitions reachable in the reviewed source. Capture complete envelope/model/metadata schemas, including optional fields that remain unimplemented at runtime. Nested references, required/nullability/enum/default/format/bounds/extensions and annotation-named literal data are structural; editorial annotations, unrelated operations/status/media/headers/components are excluded. New reference targets are not automatically fetched or expanded.

Offline checks validate all three pins without network; explicit live checks validate them before one fixed-host credential-free bounded retrieval, compute every comparison before success output, report each subset independently and never write pins. Malformed containers, missing selections and stale/rehashed malformed maps expose fixed errors. Preserve byte-identical chat version30/query version2 pins and all runtime gateway/IAM/audit/secrets/limits/accounting behavior. Source equality does not validate instances, provision metadata, certify live capabilities or enable optional fields. Full #116 and unresolved #7 remain open. See [plan](plans/462-model-response-schema.md) and [contract](../contracts/model-response-schema.md).

## Inline user image inputs (#464)

Both chat bases accept bounded user image_url arrays with plain text, preserving exact order/empty text and omission of optional auto/low/high detail. Accept only canonical nonempty base64 data:image/png/jpeg/webp/gif URLs: at most524288 UTF-16 units per full URL and786432 across history, at most128 parts per image-bearing message; existing1MiB HTTP body cap remains. Validate encoding without certifying image pixels/MIME or live model capability. Reject other roles, remote/file URLs, original/unknown detail, unknown fields and any request/block/tool caching mixture before routes. Freeze captured primitives/parts/history before async work.

Managed OpenAI/delegated OpenRouter forward images on nonstream/text/refusal/function streams through shared approved model/final-provider IAM/Deny, limits, fixed hosts, required audit/usage and safe missing/possibly-billed failure/cancellation handling. Native Anthropic/Gemini initially rejected images before secrets; #468 adds the omitted-detail native subset documented below. Jev text disclosure rejects image histories before selector credentials rather than dropping or disclosing images; metadata-only selection remains available. Images never enter operational records/errors or generate inferred tokens/cost; no gateway image fetch or output-image support is added.

Actual installed OpenAI7.23.0/OpenRouter1.4.18 sockets exercise wire shapes, streamed/nonstream completions and image/function continuation with fresh Deny. Existing structural pins stay byte-identical; transitive image definitions, native/cache/remote/richer mappings, live model certification, full #116 and unresolved #7 remain open. See [plan](plans/464-inline-image-inputs.md) and [contract](../contracts/inline-image-inputs.md).

## Image content source guard (#466)

Version 31 adds complete ChatContentItems and ChatContentImage source definitions to the chat pin: 24 request/history targets and the same 34 fields. Capture nested URL/detail/required/enum/open-values structures and the six-variant union with discriminator/reference strings, without recursively selecting audio/video/file target bodies. Removing both additions reproduces the reviewed version-30 digest; all prior selections and both discovery pins remain unchanged. Editorial annotations are ignored, while literal defaults and annotation-named properties remain structural.

Independent fixtures cover nested image and union drift, missing/non-object targets, stale version-30 and rehashed invalid exact maps. Controlled live CLI cases verify chat-only drift, one fixed-host credential-free retrieval, unchanged pins, no fetch for stale pins and no success output for malformed selected image sources. Full checks and a fresh official three-pin comparison apply.

This extends source coverage following #464; the bounded inline-image runtime contract, authorization, secrets, audit, usage and provider restrictions stay unchanged. Remote URLs, original/unknown detail, richer content, broader native image mappings, live model certification, full #116 and unresolved #7 remain open. See [plan](plans/466-image-content-schema.md) and [contract](../contracts/image-content-schema.md).

## Bounded native inline images (#468)

Direct Anthropic and Gemini map omitted-detail user images on both chat bases and nonstream/text/function streams. Anthropic selects PNG/JPEG/WebP/GIF base64 image sources; Gemini selects PNG/JPEG/WebP inlineData as a conservative subset. Generic Gemini Blob documentation also lists GIF, so its exclusion is a local restriction. Preserve exact MIME/base64, part order, empty text, image-only/multiple arrays and correlated function-result histories. All supplied detail values reject before credentials without invented resolution equivalence.

Native histories accept at most20 image occurrences across all turns, including repeated parts; existing URL/history/part/body budgets also apply. Snapshot and serialize before secret resolution. No remote/file fetch, pixel validation, resizing, output images or marked-image caching is added. Google native plain/marked arrays without images remain rejected; public text-only normalization and Anthropic cache/function behavior stay intact.

Authentication, complete model/final-provider IAM/Deny, limits, fixed registered hosts, private operational audit/usage/errors, required persistence and missing/possibly-billed failed attempts remain shared. Actual installed OpenAI7.23.0/OpenRouter1.4.18 sockets cover both bases, streams/nonstream function follow-ups and fresh provider Deny; SDK image stream cancellation cancels native bodies and retains failed possible-billing records. Raw cases cover selected MIME, count boundaries, detail/GIF/cache/role denial, mutation, secret failure and usage/persistence errors.

All three source pins remain byte-identical. Jev text disclosure still rejects image histories before selector credentials and metadata-only selection remains available. Native resolution/detail equivalence, broader MIME/caching/output/richer inputs, remote references, live per-model certification, full #116 and unresolved #7 remain open. See [plan](plans/468-native-inline-images.md) and [contract](../contracts/native-inline-images.md).

## OpenCode inline image conformance (#470)

Measure OpenCode 1.18.5 local PNG attachments through delegated OpenRouter and managed OpenAI/Anthropic/Gemini on both bases. Use an explicitly image-capable fixture alias, omitted detail and exact inline/native bytes; require rendered text and image-preserving actual read-function/result continuation. Verify initial model/provider Deny, fresh result-follow-up provider Deny, disconnect accounting and private metadata. Keep isolated temporary configuration, fixed mocked hosts and bounded children. This expands named-client conformance and fixes advisory session-header scope; runtime image policy and unsupported native body session_id remain unchanged. It does not certify live models, remote images, general image capability or complete #116. See [contract](../contracts/opencode-inline-images.md).

OpenCode automatically sends X-Session-Id. Validate and capture bounded selected headers before awaits, but turn header-only identifiers into session_id only for delegated OpenRouter routes after resolving the approved route. Managed calls omit header-derived identifiers, while explicit native body session_id still rejects before secrets. This header never controls authentication, IAM, route choice, limits or accounting identity.

## Authorized output modality lists (#472)

GET /api/v1/models accepts one comma-separated output_modalities value with one to nine distinct exact modalities. Select any matching captured published output after enabled model AND final-provider IAM; missing/empty metadata cannot establish a match. Keep all standalone and omitted-filter behavior without an implicit text default. Reject empty/duplicate/unknown/case/whitespace items, mixed all and repeated query keys before catalog reads. Duplicate rejection and finite vocabulary bounds are explicit local restrictions.

Retain conjunction with other fields, search/order/paging, full-list behavior above500, and fixed relative continuation links preserving validated list order. Each page reevaluates current catalog/IAM. Whole-catalog validation, required private audit, metadata capture, safe dependency errors and no inference/secret/limit/usage calls remain enforced. Installed OpenRouter1.4.18/OpenAI7.23.0 socket tests cover union, pagination and fresh Deny. All three source pins remain byte-identical; metadata freshness, broader discovery queries, full #116 and unresolved #7 remain open. See [plan](plans/472-model-output-filters.md) and [contract](../contracts/model-output-filters.md).

## All-member input and parameter filters (#474)

GET /api/v1/models accepts one comma string containing one to four distinct exact input modalities (text/image/audio/file) and one comma string containing one to64 distinct lower_snake_case parameter identifiers, each1..128 characters. Require every requested input and parameter in captured published metadata after enabled model AND final-provider IAM. Missing/empty metadata cannot establish capability. Output lists still match any; different fields combine conjunctively. Parameter all and unknown valid tokens remain exact identifiers, never ignored/wildcarded. Input all, duplicates, blanks, unknown input values, case/whitespace variants, excessive bounds and repeated keys reject before catalog reads.

Complete credential-free official pair queries in both orders matched singleton intersections and contained every requested member. This supports the bounded AND contract empirically; the plain-string source schema does not encode it. Local64 capacity, uniqueness/vocabulary and exact unknown-parameter behavior are explicit restrictions. Preserve omitted-filter behavior, all other search/order/paging semantics, complete filter-only lists, fixed relative continuations retaining ordered scalar lists, fresh page IAM, whole-catalog validation, required private audit and no inference/secret/limit/usage calls. Installed SDK sockets and public boundaries cover success, Deny and failure. All three pins remain unchanged; metadata freshness, selected-provider capability, other query fields, full #116 and unresolved #7 remain open. See [plan](plans/474-model-capability-lists.md) and [contract](../contracts/model-capability-lists.md).

## Administrator-published descriptive metadata (#476)

Complete model snapshots may include own optional description strings of 0..8192 UTF-16 units and expiration_date/knowledge_cutoff strings of 0..256 units or null. Preserve exact whitespace, empty strings, explicit date null and omission; reject supplied undefined, wrong scalar types and excessive bounds safely. Dates remain opaque informational strings: they do not automatically disable aliases, change approved routes or expand search/order. Required metadata fields remain required.

Only enabled model AND final-provider IAM-authorized aliases expose these values on /api/v1/models after complete catalog validation, filters/order/paging and required private audit. Legacy/basic payloads retain their current shape. No listing inference, secret, limit or usage work is added. Metadata publication/refresh, stricter date policy, broader discovery, full #116 and unresolved #7 remain open. See [plan](plans/476-model-descriptive-metadata.md) and [contract](../contracts/model-descriptive-metadata.md).
