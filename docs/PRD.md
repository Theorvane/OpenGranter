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

Both client paths support exact text/json_object format controls. OpenAI/OpenRouter forward them; Gemini maps native MIME; direct Anthropic supports text only and rejects JSON before credential/transport. Native output generation is model-dependent; strict schemas and capability selection remain pending. See [contract](../contracts/client-response-formats.md).

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

Direct OpenAI and delegated OpenRouter preserve optional reasoning_details arrays, including empty arrays, with validated summary/text/encrypted items. Preserve opaque payloads, optional nullable string metadata and safe integer indices without parsing/verifying them. Unknown fields, malformed data and unsupported server-tool-call items fail safely with possibly-billed failed accounting. Existing finish/content/refusal/function rules, IAM/Deny/limits, required audit/ledger and missing usage remain unchanged. Operational records/errors exclude details and credentials. This non-streaming subset does not support details in history, server tools or native thinking. Delegated streamed details are implemented under their separate contract below. See [plan](plans/284-nonstream-reasoning-details.md) and [contract](../contracts/nonstream-reasoning-details.md).

## Delegated stream reasoning details

Both chat bases preserve validated reasoning_details arrays on delegated text-stream deltas, including empty arrays and omitted fields, in frame and item order. The summary/text/encrypted subset uses immutable snapshots and preserves opaque nullable metadata without interpretation or reconstruction. Malformed items, unknown fields and server-tool-call items fail safely with possibly-billed accounting. Any supplied detail field on a usage-only event rejects, including empty arrays and incomplete token counts, as an explicit local content-free-frame restriction. IAM/Deny/limits, required audit/ledger, cancellation and unknown usage remain shared; details stay outside operational records and errors. Direct/tool streams, request/history details, native thinking and full external-client conformance remain open. See [plan](plans/286-stream-reasoning-details.md) and [contract](../contracts/stream-reasoning-details.md).
