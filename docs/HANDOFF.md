# OpenGranter agent handoff

## Current continuation checkpoint (#528)

PR [#525](https://github.com/Theorvane/OpenGranter/pull/525) merged the user collection runtime as 87512ac; issue #524 is closed. PR [#527](https://github.com/Theorvane/OpenGranter/pull/527) was approved on dd29d2fbdfcb4f53b0aff099fe37516cce6f0ed4 with all three checks successful and merged as 1704969; issue #526 is closed. This independently refreshed the request/query/response pins to33/5/3.

Issue [#528](https://github.com/Theorvane/OpenGranter/issues/528), branch test/528-user-model-schema, adds the sixth bounded source guard for the user-list operation, its explicit bearer security, four query objects and root/array/item definitions. Read [plan](plans/528-user-model-schema.md) and [contract](../contracts/user-model-schema.md); refresh the linked PR state rather than assuming merge. The prior five pin bytes and all runtime code remain unchanged. The branch is rebased onto approved main 1704969, preserving both reviewed source changes and sixth-guard cases; integrated focused tests passed446 cases and the full gate passed7,095 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live schema comparisons passing. Full #116, rich metadata provisioning, unsupported query values, upstream preferences/privacy/regions and Jev #7 remain open. Earlier checkpoints below are historical.

## Historical reviewed-source checkpoint (2026-10-25, #526)

PR #525 was approved on a66b98155e38e145821ab2e39dc863d5322cc340 with all checks successful and merged as87512ac; issue #524 is closed. Fresh official comparison found drift in three existing selections, so issue [#526](https://github.com/Theorvane/OpenGranter/issues/526) and branch test/526-reviewed-source-drift reconcile request/query/response pins to33/5/3 before a sixth user-operation guard is added. The only selected changes are optional breakpoint TTL, removal of offset nullable:false and restoration of seven nullable:true response markers. Runtime, five-result CLI scope and count/single pin bytes remain unchanged. Read the [plan](plans/526-reviewed-source-drift.md) and refresh PR/review/CI status before assuming merge. Nine focused schema suites passed 613 cases; full validation passed 7,016 tests with one optional PostgreSQL skip and zero failures/cancellations. Fresh live and offline comparisons passed all five selections. Broad #116, user-operation structural coverage and unresolved #7 remain open.

## Continuation checkpoint (2026-10-25)

PR #523 was approved on cb9529573337c1b7d176e0dd7d40e3a06c81ffd1 with all three checks successful and merged as 3eac26f; issue #522 is closed. Issue [#524](https://github.com/Theorvane/OpenGranter/issues/524) and branch feat/524-user-model-discovery add the proxy-IAM OpenRouter user-list collection, text defaults, fixed user-path pagination and explicit bearer/identity tests. Read its [plan](plans/524-user-model-discovery.md) and [contract](../contracts/user-model-discovery.md), then refresh PR/review/CI status before assuming merge. Compatible user is now reserved over OpenAI retrieval; /v1 can still retrieve a user alias. Rich metadata, upstream account preferences/privacy/regions, this new operation's source guard and full #116 remain unresolved gates; #7 is unchanged. Local full validation passed 6,998 tests with one optional external PostgreSQL skip and zero failures/cancellations; all five offline schema checks passed. Older checkpoints below are historical.

## Continuation checkpoint (2026-10-24)

PR #521 merged this guide as 1a9d019; no new remote work was present when continuation began. Issue [#522](https://github.com/Theorvane/OpenGranter/issues/522) and branch feat/522-openai-model-retrieval now track a separate OpenAI models.retrieve extension using exact encoded alias parameters and bare listing projections on both bases. The compatible count path retains precedence; OpenRouter's singular wrapped rich lookup is unchanged. Read its [plan](plans/522-openai-model-retrieval.md) and [contract](../contracts/openai-model-retrieval.md), then refresh the linked issue's PR/review/CI state before assuming it is merged. Local full validation passed 6,977 tests with one optional PostgreSQL skip, zero failures/cancellations and all five offline schema checks, using the documented CPU-affinity gate. The older delivery/workspace snapshot below remains historical; temporary worktrees may have disappeared. Broad #116 and unresolved #7 remain open.

Snapshot: 2026-10-18, after PR #519 merged at 13:13 UTC. This is a continuation guide, not a release certification. Refresh GitHub and Git before acting on its status tables.

## Start here

1. Read [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). CLAUDE.md is a symbolic link to AGENTS.md; preserve it.
2. Read [product requirements](PRD.md), [acceptance scenarios](acceptance.md), [compatibility inventory](openrouter-compatibility.md), [coding rules](coding.md) and the [domain glossary](../CONTEXT.md). Consult [architecture](architecture.md), [routing](routing.md) and the relevant contract/issue plan before changing that behavior.
3. Refresh repository and GitHub state using the commands below. Inspect uncommitted work and worktree ownership before switching or deleting anything.
4. Finish any current review feedback before selecting another implementation issue. Use the current compatibility inventory and executable cases to identify the next bounded gap.

Repository documents contain historical checkpoints. The roadmap is a broad sequence, and an old unchecked issue checklist or earlier exclusion paragraph does not establish that a feature is still absent. Read the latest relevant sections, plans, contracts and implementation together. Conversely, a passing bounded test or structural pin does not prove complete compatibility.

## Product direction and fixed boundaries

OpenGranter is a single-organization TypeScript LLM gateway. Developers and internal services receive OpenGranter proxy tokens; provider credentials stay server-side behind secret references. Internal IAM policies control the requested model and final inference provider, with default Deny and explicit Deny precedence. This is an internal IAM-style engine, not AWS IAM integration.

Two route kinds share authentication, IAM, limits, required private audit and per-attempt usage:

- Delegated: OpenRouter chooses only within the server-approved, evaluated destination scope.
- Managed: OpenGranter selects among registered direct OpenAI, Anthropic and Google Gemini routes. Optional Jev selection operates within eligible candidates; the actual Jev integration still has unresolved product decisions.

Fallback stays within one route kind. Caller input, model metadata links, canonical slugs and alias targets must never become arbitrary upstream destinations or widen permissions. Distinguish missing usage, estimated prices, provider-reported cost and possible duplicate billing. Prompt/response content and credentials must not enter operational records or client errors; protected content-audit retention requires its own explicitly enabled policy.

External tools must eventually be able to use the compatible API end to end. Current clients use a configured gateway base such as https://gateway.example/api/v1 and an OpenGranter proxy token. Legacy /v1 remains available, with documented differences. Do not claim complete OpenRouter compatibility.

## Verified delivery checkpoint

Main commit at this snapshot: c7cbbbe15c2c6ae3e79d2c1d706c87c7d571fd95.

| PR | State at snapshot | Delivered behavior and reading |
| --- | --- | --- |
| [#511](https://github.com/Theorvane/OpenGranter/pull/511) | Merged | Reviewed official source drift; request pin v32 and model-response pin v2. [Plan](plans/509-reviewed-schema-drift.md). Structural changes do not enable new runtime fields. |
| [#513](https://github.com/Theorvane/OpenGranter/pull/513) | Merged | Exact advertised prompt/output price ranges, USD per million query units against per-token decimal strings; query pin v4. [Plan](plans/512-model-price-ranges.md), [contract](../contracts/model-price-ranges.md). |
| [#516](https://github.com/Theorvane/OpenGranter/pull/516) | Merged | GET /api/v1/model/{author}/{slug} for exact published rich aliases. Current model/provider IAM; private 404 for unknown/inaccessible targets; no metadata-target redirects. [Plan](plans/514-single-model-discovery.md), [contract](../contracts/single-model-discovery.md). |
| [#517](https://github.com/Theorvane/OpenGranter/pull/517) | Merged as 4f3d7df | Fifth structural guard for the single-model operation, required author/slug parameters and ModelResponse/Model. [Plan](plans/515-single-model-schema.md), [contract](../contracts/single-model-schema.md). Issue #515 is closed. |
| [#519](https://github.com/Theorvane/OpenGranter/pull/519) | Merged as c7cbbbe | Consistent no-store on model listing/count/lookup responses, errors and Node fallbacks. [Plan](plans/518-discovery-no-store.md), [contract](../contracts/model-discovery-cache.md). Issue #518 is closed. |

PR #519 was reapproved on exact head d5ce2cef7cada53184362f39b8279a06767e25e5; both check jobs and metadata CI succeeded before merge. An earlier approval on f0b60de was not used as approval of the rebased head. No implementation PR remains open at this snapshot. Issue [#520](https://github.com/Theorvane/OpenGranter/issues/520) tracks this documentation handoff; refresh its PR status separately.

The current schema CLI monitors six selected structural projections: chat request/response fragments, model-list queries, model-list response metadata, model count, single model and user model (including explicit operation security). Referenced metadata coverage is shared between the model-response and single-model guards. These are integrity/drift checks, not full graph traversal, runtime instance validation or live capability certification. Do not refresh provenance blindly when live drift fails.

## Remaining work and next decisions

| Tracking item | What the next agent should do |
| --- | --- |
| [#116: complete OpenRouter external-client compatibility](https://github.com/Theorvane/OpenGranter/issues/116) | Keep open. Reconcile the current inventory and conformance tests, then choose one actual missing client workflow or API behavior with explicit acceptance criteria. Use a new issue and branch for each implementation. |
| [#7: Jev-assisted managed routing](https://github.com/Theorvane/OpenGranter/issues/7) | Keep open. Existing candidate authorization/selection coordinators do not resolve the exact Jev product/API, decision-failure policy or permitted request data. Read the issue and planning decisions before any external integration; do not invent them. |
| Management and operational readiness | Separate implemented SSO/token-management runtime boundaries from incomplete binding/key provisioning, broader management UI, deployment configuration and operational procedures. Consult the relevant contracts before selecting work; this handoff does not settle those decisions. |

Examples of remaining compatibility areas recorded in the inventory include broader endpoint/query coverage, metadata publication/refresh, precise upstream errors and retry hints, remaining native/rich/tool mappings, full instance/reference conformance and complete named-client workflows. This is a gap inventory, not an ordered implementation commitment. Check the current code before creating duplicate work.

Model query age/author/architecture semantics and new client routing controls need particular care: locally published aliases or timestamps are not automatically upstream model authors/creation dates, and caller controls must only narrow fully evaluated approved destinations. Do not add a superficially compatible field whose actual meaning is unresolved.

For a plan interview, read [grill-with-docs](../skills/grill-with-docs/SKILL.md), [grilling](../skills/grilling/SKILL.md) and [domain-modeling](../skills/domain-modeling/SKILL.md). Ask the user only for unresolved decisions; inspect facts yourself. Keep agreed domain terms in CONTEXT.md and reserve ADRs for consequential trade-offs. User-facing conversation is Korean; repository documents, issues and PR bodies are English.

## Implementation map

| Area | Entry points |
| --- | --- |
| Shared HTTP and discovery | [chat-handler.ts](../src/gateway/chat-handler.ts), [model-list-query.ts](../src/gateway/model-list-query.ts), [model-discovery-metadata.ts](../src/gateway/model-discovery-metadata.ts), [single-model-query.ts](../src/gateway/single-model-query.ts) |
| Exact advertised price comparison | [model-price-order.ts](../src/gateway/model-price-order.ts). Preserve exact decimals; do not substitute floating-point billed-money arithmetic. |
| Socket and cache boundary | [node-request-server.ts](../src/gateway/node-request-server.ts), [model-discovery-path.ts](../src/gateway/model-discovery-path.ts) |
| Policy and routing | [evaluate.ts](../src/policy/evaluate.ts), [authorize-candidates.ts](../src/routing/authorize-candidates.ts), [invoke-jev-managed-route.ts](../src/routing/invoke-jev-managed-route.ts), [invoke-delegated-route.ts](../src/routing/invoke-delegated-route.ts) |
| Native and delegated adapters | [direct-chat.ts](../src/providers/direct-chat.ts), [openrouter-chat.ts](../src/providers/openrouter-chat.ts); adjacent provider modules and src/streaming handle controlled streams/functions. |
| Runtime and SSO management | [postgres-gateway-runtime.ts](../src/gateway/postgres-gateway-runtime.ts), [postgres-sso-management-http.ts](../src/gateway/postgres-sso-management-http.ts), [runtime contract](../contracts/sso-management-runtime.md). The SSO management listener is opt-in and separate from inference listeners. |
| Storage and audit | src/storage, src/audit and src/usage. [Audit projector](../src/audit/postgres-gateway-audit.ts) is an allowlist; keep new event data content-free and principal-scoped. |
| Schema conformance | [check-openrouter-schema.ts](../scripts/check-openrouter-schema.ts), scripts/openrouter-*-schema.ts and contracts/openrouter-*-schema.json. Read their contracts and independent fixture tests. |
| External client reproduction | [OpenCode conformance](opencode-conformance.md), [conformance script](../scripts/conformance-opencode.ts), installed-SDK tests in test/sdk-*.test.ts. |

Recent focused regressions: [model-discovery-cache.test.ts](../test/model-discovery-cache.test.ts), [node-discovery-cache.test.ts](../test/node-discovery-cache.test.ts), [single-model-discovery.test.ts](../test/single-model-discovery.test.ts), [single-model-schema.test.ts](../test/single-model-schema.test.ts). Reuse [the discovery fixture](../test/model-discovery-filters-fixture.ts) where it fits; it fails if discovery reaches inference, secrets, limits or accounting.

## Validation and reproduction

Use Node.js 22.14 or newer within the repository's engine requirement and npm with the committed lockfile. Run npm ci when dependencies need installation. The current WSL session uses /home/ubuntu/.local/bin for Node/npm; that path is machine-specific, not a deployment requirement. package.json defines the authoritative commands.

```sh
npm run check
npm run compatibility:check
# Optional network comparison; no inference and no automatic pin updates:
npm run compatibility:drift
```

The last integrated production gate, recorded in plan #518, completed 6,960 cases: 6,959 passed, one optional external PostgreSQL skip, zero failures/cancellations. Types, lint, planning/link/contract/fixture-secret checks and all five offline pin checks passed. GitHub CI also passed the exact reviewed PR #519 head.

An earlier integrated run had three existing 15-second PostgreSQL shutdown cancellations and zero assertion failures under host contention. The unchanged postgres-gateway-runtime and postgres-sso-management-runtime files passed all 24 cases in isolation. A full retry passed using CPU affinity to reduce Node worker parallelism:

```sh
taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS npm run check
```

This Linux command requires those CPUs to be available. It changes scheduling only; no test, deadline or assertion was disabled. Do not hide failures with warning suppression or increase timeouts merely to get a green run. The exact historical command additionally set PATH to the local Node directory; see the plan for that session-specific invocation.

Without OPENGRANTER_TEST_DATABASE_URL, the optional external PostgreSQL driver test skips while embedded database tests still run. For that integration use only a disposable test database, following [README](../README.md#postgresql-integration-checks). Never point the integration tests at production data. Named OpenCode probes have separate prerequisites in their guide; their pinned versions and mocked upstreams do not certify live providers or all client versions.

Local optional logs from the last implementation are /tmp/opengranter-518-red.log, /tmp/opengranter-518-focused.log, /tmp/opengranter-518-runtime-recheck.log and /tmp/opengranter-518-integrated-retry.log. They are not committed, may disappear and are not prerequisites for continuing. The tracked plan, tests and GitHub checks preserve the reviewable evidence.

## Contributor and review procedure

- Issue first, then a fresh branch from current main named <type>/<issue-number>-<topic>. Do not reuse a merged branch. Before implementation create docs/plans/<issue>-<topic>.md from the [template](plans/TEMPLATE.md).
- Every production change uses meaningful red/green TDD through public boundaries. Cover authorization/authentication/secret/accounting success, denial and failure paths. Record the actual failure before the implementation, then focused and full-gate results.
- Use sjungwon03 <sjungwon03@gmail.com> as both author and committer. The user explicitly authorized their human DCO for this work. Include Assisted-by: Codex and Signed-off-by: sjungwon03 <sjungwon03@gmail.com>; do not sign as an agent.
- Open ready PRs, link their plan and issue, and report material limitations. Trusted triage assigns authors, labels issues/PRs and requests sjungwon03-ai. Verify the automation outcome instead of treating the request label as approval.
- The user authorized merging approved work. Before each merge refresh exact head, reviews and required checks; require approval of the current head and successful CI. Use squash with an exact-head guard, preserving issue closure and DCO/assistance trailers. Do not bypass protections.
- Rebased/revised heads need fresh verification. A reviewDecision value of APPROVED can coexist with an approval of an earlier SHA; compare each review's commit.oid with headRefOid.
- Documentation-only changes use applicable document/link checks; do not add production tests for unchanged behavior. Leave unrelated worktrees and local changes intact.

## Local workspace snapshot

| Path | State when this guide was prepared |
| --- | --- |
| /home/ubuntu/openiam | Main advanced to c7cbbbe, then clean docs/520-agent-handoff branch created for this documentation change. This guide and its plan are the intentional changes on that branch. |
| /tmp/opengranter-benchmark-sort | Clean fix/518-discovery-no-store at d5ce2ce, now merged through squash PR #519. Its temporary directory name is historical; it is not pending benchmark work. |
| /tmp/opengranter-494-sso-management-runtime | Older worktree on test/496-schema-cli-warnings at 49ea25e. No changes made there for this request; inspect ownership/state before reusing it. |

Use git worktree list and git status before relying on these paths. Paths outside this checkout and local environment permissions may differ for another agent. Repository metadata mutations and network commands in the original WSL session needed the configured approval mechanism; never assume that environment-specific permission state transfers to a new agent.

## Refresh commands and first next action

Run from the repository root; fetch does not change local files. Inspect status before switching branches or updating a worktree.

```sh
git status --short --branch
git worktree list
git remote -v
git fetch origin
git log -5 --oneline origin/main
gh pr list --repo Theorvane/OpenGranter --state open
gh issue list --repo Theorvane/OpenGranter --state open
# For each candidate PR, compare review commits to its current head:
gh pr view <number> --repo Theorvane/OpenGranter \
  --json headRefOid,reviewDecision,reviews,statusCheckRollup,mergeStateStatus
```

First reconcile this documentation PR's status and any newer review feedback. Then inventory a concrete remaining #116 workflow against current code, open its implementation issue, create the plan and a new branch, reproduce the gap with a failing test and continue through the required review gates. Ask for the unresolved #7 decisions only if the next chosen slice actually depends on them.
