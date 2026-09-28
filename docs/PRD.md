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
3. **Authorization:** Attach policies to principals and roles. Evaluate principal, action, resource, and supported conditions on every request. Deny by default and give explicit Deny precedence. A PostgreSQL reader can load a principal's direct and inherited policy snapshot from one consistent SQL statement; policy-management writes remain separate work.
4. **Gateway and routing:** Provide the core OpenAI-compatible `POST /v1/chat/completions` and `GET /v1/models` shapes. A delegated route sends an authorized request to OpenRouter; a managed route has OpenGranter choose among registered direct OpenAI, Anthropic, and Google Gemini adapters. Both use the same proxy-token, policy, limit, and audit path. The routing controls resemble OpenRouter's: administrator-approved provider allowlists and order, price/latency/throughput preferences, health-aware selection, optional Jev-assisted selection, and bounded fallback. Jev may recommend only a destination that passed all OpenGranter eligibility checks. Fallback may try another authorized candidate of the same route kind; it cannot silently switch between delegated and managed routes. Reject unsupported fields and routing overrides clearly. Streaming support remains undecided.
5. **Usage:** Record request ID, principal, credential ID, requested alias, route kind, upstream, actual model and provider when known, timestamp, status, latency, input and output tokens, estimated cost, and upstream-reported cost separately. Represent unavailable token usage as unknown.
6. **Audit:** Record authentication and credential events; policy, role, model, and provider changes; access decisions; and credential revocation. Include actor, target, time, outcome, and request ID. Make prompt and response retention configurable for company audit needs. Default behavior, configuration scope, retention, and reader permissions remain undecided.
7. **Review:** Filter usage and audit events by time, principal, and model, and export CSV. Ordinary users see only their own usage.

## 4. Authorization semantics

The initial resource formats include `model:<alias>` and `provider:<inference-provider-id>`. The starting action set is `llm:InvokeModel`, `llm:UseProvider`, `llm:ListModels`, `usage:ReadSelf`, `usage:ReadAll`, `audit:Read`, `iam:Manage`, and `catalog:Manage`. For usage history, `usage:ReadSelf` applies to the authenticated `principal:<id>` resource; specifying `principal_id` requires `usage:ReadAll` on that target resource, even when it names the caller. A candidate is eligible only when the principal may invoke its model and use its inference provider. A policy contains statements with `Allow` or `Deny`. Any matching Deny rejects that candidate; absent a matching Allow on either resource, that candidate is also denied. Roles reuse policies across principals. This is not an implementation of the full AWS IAM policy language.

For example, an `analyst` role may allow `model:approved-*`, while a policy attached directly to one principal denies `model:approved-expensive`. Internal denial details may identify the matching policy, but must not expose secrets.

## 5. Main flow

1. An administrator registers OpenRouter or direct provider upstreams, credential references, model aliases, approved routes, and prices.
2. The administrator creates policies and roles and attaches them to human users or service accounts.
3. A principal requests a model alias through the internal API. The gateway authenticates, resolves approved route candidates, evaluates policy, checks limits, and calls OpenRouter or a direct provider according to the selected route.
4. The gateway normalizes usage and records audit events. If content auditing is enabled for this request, it stores prompts and responses separately under the content-audit policy.
5. Authorized readers inspect usage, denials, and permission changes.

The current implementation has a minimal HTTP slice for non-streaming text chat (`model` and string-content `messages`) and an OpenAI-compatible `GET /v1/models` list of IAM-visible published aliases. Other OpenAI-compatible chat fields fail validation in this slice; the release-level supported-field list remains an open decision. Direct OpenAI, Anthropic, and Gemini adapters and a bounded OpenRouter chat adapter cover the chat subset through secret references. A managed route can omit Jev and select the first IAM-eligible direct candidate in administrator order, recording an ordered decision; price, latency, and throughput ranking remain open. The HTTP gateway dispatches a trusted delegated route through IAM filtering, a verified provider-slug mapping port, a limit check, attributed audit, and the OpenRouter adapter. An identity adapter resolves direct and role policy attachments from a trusted snapshot before the HTTP boundary evaluates model and provider permissions. A PostgreSQL-backed proxy-token primitive issues, verifies, and revokes opaque tokens with atomic nonsecret lifecycle events. A trusted internal coordinator checks `iam:Manage`, target ownership, and required decision audit before using that primitive; a PostgreSQL internal factory now composes it with credential storage and persists sanitized allow/deny decisions. An allowed decision does not certify a completed mutation; atomic credential lifecycle events record completion. Actor authentication and a public management API still need implementation. Authenticated request and attempt audit events carry nonsecret principal, credential, and policy-version identifiers; unauthenticated failures remain anonymous. A PostgreSQL adapter can append allowlisted gateway and route audit metadata; retention, tamper-resistant export, and exactly-once delivery remain open. The gateway hands one normalized usage record per upstream attempt to an injected ledger port, including possibly billed failures and managed fallback attempts. A PostgreSQL adapter implements idempotent append for that port and is tested against embedded PostgreSQL. A failed handoff does not replay inference. A node-postgres connection factory provides query, dedicated-transaction, and shutdown ports. Deployment startup, recovery, pricing, and reconciliation are still missing. An authenticated `GET /v1/usage` extension supports IAM-scoped self and specified-principal history with bounded pagination, exact model-alias filters, and occurrence-time ranges; A bounded CSV page format is available with explicit continuation headers; full-history export jobs and aggregates remain open. A PostgreSQL read adapter now supplies the injected published-model and active-route ports; catalog publication writes remain missing. A PostgreSQL composition function connects credentials, IAM, catalog, audit, and usage to the HTTP boundary. A Node server factory can expose that composition over HTTP without automatically listening. A PostgreSQL reader supplies enabled direct-provider registration snapshots containing secret references and validated output limits. An asynchronous handler/server factory can load these snapshots and construct the direct invoker automatically; custom-invocation factories remain available. Live configuration reload and registration-management writes remain missing. Process startup, limits, secret resolution, and upstream wiring remain caller-supplied rather than deployed backing services.

A PostgreSQL audit reader returns bounded, sanitized metadata history for one principal. The authenticated `GET /v1/audit` boundary requires `audit:Read` on `principal:<target-id>` even for the caller's own events, supports occurrence-time range filters, validates the entire page, and records metadata for successful, denied, and unavailable reads. Authorized audit pages can also be downloaded as bounded CSV with explicit continuation headers; full-history/tamper-resistant export jobs remain open. Anonymous and organization-wide audit searches remain open.

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
| Human sign-in | Company SSO; protocol TBD |
| Deployment | AWS and on-premises support; release order TBD |
| Content audit | Configurable; default, scope, retention, and readers TBD |
| Streaming and monthly limits | Awaiting planning decisions |

## 8. Release gate

The scenarios in [acceptance.md](acceptance.md) must pass, including unauthorized-call rejection, Deny precedence, non-disclosure of credentials, failure auditing, usage attribution, and isolation of each principal's view.

## References

- [AWS IAM default denial and explicit Deny](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)
- [OpenRouter's unified API format](https://openrouter.ai/docs/quickstart)
- [AWS Secrets Manager's credential storage and rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
