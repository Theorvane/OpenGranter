# Delivery Sequence

Dates are not committed. Each phase starts after the preceding phase passes its acceptance gate.

| Phase | Deliverables | Exit gate |
| --- | --- | --- |
| 0. Planning and harness | PRD, architecture, policy and gateway contract cases, check command, CI | Documents and contract checks pass; unresolved decisions are visible |
| 1. Identity and policy | Human users, service accounts, roles, evaluator, simulator | Default Deny, Deny precedence, immediate revocation; pure evaluator contract is implemented |
| 2. Credentials and catalog | OpenRouter, OpenAI, Anthropic, and Google Gemini registration; model aliases and routes; secret references; key rotation | Raw keys stay hidden; only authorized models and routes are visible |
| 3. Gateway | Chat calls through an OpenRouter-delegated route and managed selection among OpenAI, Anthropic, and Gemini adapters | Authorized, denied, and upstream-error paths with request IDs; routing overrides cannot bypass policy; fallback stays within one kind |
| 4. Ledger and audit | Route-aware usage normalization, OpenRouter reconciliation, optional content audit, review, export | Missing/duplicate data is identifiable; views are scoped to readers |
| 5. Operational readiness | Limits, alerts, audit export, backup and recovery | Load, failure, security, and environment-specific deployment checks |

The three direct providers' sandbox and OpenRouter test account details are needed from phase 2 onward. Before service implementation, connect [acceptance scenarios](acceptance.md) to executable tests. Streaming, exact selection scores, and retry triggers remain undecided.
