# Executable Product Delivery Roadmap

Tracking: [#637](https://github.com/Theorvane/OpenGranter/issues/637). Baseline: main `ebd46c2d5cde2d992ceb081ecbb05d3ae3590a74`; prepared 2026-11-01 (Asia/Seoul).

## Goal and scope

Deliver the original [PRD](PRD.md), [architecture](architecture.md) and [acceptance](acceptance.md), including a TypeScript management UI. A packaged gateway, passing compatibility fixtures, or a read-only dashboard alone is not the product completion gate. Read-only screens are an intermediate increment; authorized configuration workflows are still required.

Retain one-organization scope, internal IAM, OpenRouter-delegated routing and managed direct OpenAI/Anthropic/Gemini routing. Do not silently add multitenancy, credit resale, arbitrary upstream proxying, cross-kind fallback or every provider-specific parameter. Existing optional Jev work remains explicitly tracked, not a reason to block unrelated administration work. Codex subscription integration is a separately requested extension, not a replacement for original provider delivery.

## Evidence baseline and status rules

- Gateway, policy, credential, usage/audit and deployment primitives already exist. Their presence does not establish complete public administration APIs or installation acceptance. Inventory and reuse them before adding replacements.
- No management UI is delivered in the baseline; the documentation explicitly distinguishes conceptual images and contract visualization from an administration dashboard.
- Open compatibility [#116](https://github.com/Theorvane/OpenGranter/issues/116), Jev [#7](https://github.com/Theorvane/OpenGranter/issues/7), timeout [#560](https://github.com/Theorvane/OpenGranter/issues/560) / PR #561 and OAuth [#635](https://github.com/Theorvane/OpenGranter/issues/635) / PR #636 retain their own evidence and reviews. OAuth CLI authentication management is not subscription-backed inference.
- VM123 installed acceptance is a separate evidence stream. A root JSON 404, an anonymous 401, mock provider tests or CI restart tests do not prove browser operation, live inference, billing or installed database persistence.

Track each work item as **queued**, **active**, **blocked** (named prerequisite), **review**, or **accepted**. Record separate source/test, exact-head CI/review, installed deployment, and live acceptance evidence. Unknown is not done. Roles below are accountable workstream leads, not claims that their work has already been performed.

## Dependency-ordered delivery slices

| Phase / issue | Lead and dependencies | Small deliverables | Exit gate |
| --- | --- | --- | --- |
| R0 / [#638](https://github.com/Theorvane/OpenGranter/issues/638) **active** | Architecture + backend; coordinator: LLM specialist | R0.1 requirement-to-source/test/API/UI/live matrix; R0.2 missing management API contracts; R0.3 browser security and retention decision register; R0.4 issue-sized implementation order | Every original requirement has evidence or a named gap; first UI/API slice has bounded contracts and test cases; blocking decisions are explicit |
| R1 / [#639](https://github.com/Theorvane/OpenGranter/issues/639) queued | Frontend + backend; after R0 browser contract | R1.1 TypeScript UI build and protected shell; R1.2 OIDC company login/logout and session lifecycle; R1.3 current principal, scoped navigation, loading/empty/error/denial views; R1.4 static serving and ingress contract | Browser success, expiry, logout, unauthenticated and unauthorized cases pass; API enforces permissions independently of navigation; no secret/token leakage |
| R2 / [#640](https://github.com/Theorvane/OpenGranter/issues/640) queued | Backend + frontend; after R0 contracts, integrate through R1 | R2.1 human/service-account and role views; R2.2 policy/role bindings and safe writes; R2.3 public permission simulator boundary; R2.4 proxy-token issue/revoke/expiry; R2.5 provider registration and secret-reference rotation | Success/Deny/failure tests through public API and browser; immediate revocation; permission/configuration events audited; raw upstream keys never redisplayed; simulator cannot invoke models |
| R3 / [#641](https://github.com/Theorvane/OpenGranter/issues/641) queued | Backend + frontend + LLM specialist; R0 contracts and R2 authorization | R3.1 approved model aliases and versioned prices; R3.2 delegated/direct provider routes and allowlists/order; R3.3 health/price/latency/throughput preferences and same-kind fallback controls; R3.4 per-principal limits and budget behavior | Unauthorized destinations cannot be configured or invoked; configured changes take effect under current policy; no cross-kind fallback; concurrent limit and failure cases pass; UI never grants authority by itself |
| R4 / [#642](https://github.com/Theorvane/OpenGranter/issues/642) queued | Backend + frontend; R0 read contracts, R1 session, R2 reader scopes | R4.1 usage/audit filters and pagination; R4.2 own/team/auditor views as authorized; R4.3 safe CSV export; R4.4 estimated/reported cost, unknown usage, reconciliation and duplicate markers; R4.5 optional protected content review after explicit policy decision | Reader isolation, export authorization, redaction, audit/storage failure and browser tests; no invented token counts or bills; content retention never enabled by assumption |
| R5 / existing #116, #7, #560, #635 queued / existing work in progress | LLM specialist + backend; independent of UI except shared contracts | R5.1 reconcile required external-client matrix for both bases and route kinds; R5.2 real text/stream/tool workflows and accounting failure paths; R5.3 finish reviewed timeout behavior; R5.4 resolve Jev integration target/disclosure and test eligibility; R5.5 separately deliver Codex auth then a supported inference adapter if feasible | Each original mandatory compatibility case has evidence; optional/extensions have explicit disposition; auth-only CLI never closes inference acceptance; unresolved full compatibility cannot be relabeled complete |
| R6 / [#643](https://github.com/Theorvane/OpenGranter/issues/643) queued; existing authorized VM checks may proceed | Infrastructure + all implementers; release after mandatory R1-R5 gates | R6.1 install exact reviewed UI/API revision; R6.2 TLS/SSO ingress and protected configuration; R6.3 migration/persistence/restart; R6.4 backup/restore and rollback; R6.5 security/load/limits/alerts/audit export; R6.6 approved live provider/client acceptance and operator handoff | Browser management and authenticated discovery/chat/stream/tool calls pass in installed environment; live evidence identifies revision/image/configuration; restore and rollback demonstrated; remaining limitations explicit |

R1 UI shell and authorized R4 read contracts can develop in parallel after R0 stabilizes the relevant interfaces. Do not start policy/catalog writes from an unreviewed frontend mock. Existing authorized deployment checks need not wait for all UI work. One issue may require several small implementation PRs; each must name the exact sub-slice and retain its own numbered English plan.

## Decisions that block only their dependent slices

| Decision | Required before | Responsible preparation |
| --- | --- | --- |
| Browser session vs bearer boundary, OIDC redirect/logout, CSRF/CORS and ingress origins | R1 session implementation | Backend + frontend + infrastructure propose contract; operator supplies registered identity configuration securely |
| Public simulator reader scope, management action/resource semantics, delegated team administration | R2 affected endpoints | Architecture + backend; no administrator or team-wide bypass assumed |
| Exact managed selection scoring, price freshness and concurrent budget reservation | R3 affected controls | LLM specialist + backend; preserve current authorized fallback boundaries |
| Content audit default, scope, retention/deletion, readers and protected storage | R4 content retention/review | Architecture + operator; content remains disabled unless explicitly authorized |
| TypeSafe Jev target and prompt disclosure; Codex supported transport/terms/feasibility | R5 respective extension | LLM specialist; no token extraction or unsupported subscription inference assumption |
| First release target, real provider/client/model, max paid budget, SSO/secrets/bootstrap and operational limits | R6 protected/live checks | Infrastructure + operator; AWS and on-prem support tracked separately; one VM is not certification of both |

Do not ask the operator to discover repository facts. Resolve facts in R0; request only actual policy choices, protected inputs and approvals. These decisions do not block unrelated safe work.

## Execution and completion discipline

1. Keep #637 as the umbrella; use child issues above and existing issue-specific plans. Before production code, specify the smallest public contract and a meaningful failing test; record RED, GREEN and refactoring evidence.
2. For authorization, secrets and accounting cover success, denial and failure. UI visibility never substitutes for API authorization. Preserve default Deny, Deny precedence, immediate revocation and model/final-provider checks.
3. Require applicable checks, exact-head CI and independent approval before merge. Never treat an informal chat review as formal approval. Preserve the verified contributor identity and DCO/assistance trailers.
4. After deployment verify installed artifacts separately, then only authorized live calls. Never fabricate bootstrap values, credentials, model results or paid budgets to unblock a gate.
5. Close an implementation issue only on its stated exit gate. Close #637 only after original mandatory requirements and installed release acceptance pass. Optional extensions remain separately visible if not required for that release.
6. Report completed sub-slices with PR/SHA and test evidence; report the next smallest slice, blocking decision and owner. Do not substitute repeated schema compatibility micro-fixes for missing management workflows.

## Timing and next execution

Calendar delivery dates are **not yet committed**. This is a work and dependency roadmap, not a claim of completed implementation. R0 is the first active slice as of 2026-11-01. Its output must identify the first bounded R1 implementation PR and backend prerequisites; then estimate subsequent milestones from measured implementation/review capacity. Publish and revise estimates at gate completion, keeping external SSO, review, protected-input and live-budget waits separate from engineering work.

The existing recurring implementation process should resume from this roadmap and its first unaccepted unblocked slice, while retaining earlier evidence and deployment safety boundaries. Planning documentation alone does not satisfy R0 traceability or any implementation gate.
