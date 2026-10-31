# OpenGranter documentation

OpenGranter controls LLM access through current identity, model/provider policy, approved routing, limits, and auditable usage. The source tree contains tested modules and integration boundaries; it is not yet a packaged production service.

## Start with a goal

| Goal | Read first | What it establishes |
| --- | --- | --- |
| Understand the value and current state | [Repository overview](../README.md) | Product intent, capability boundaries, and a visual overview |
| Run checks without provider credentials | [Evaluate locally](guides/evaluate.md) | Source setup, contract tests, and optional disposable PostgreSQL |
| Select a client workflow | [OpenRouter compatibility](openrouter-compatibility.md) | Supported request/response cases, exclusions, and setup |
| Review measured client evidence | [AI SDK conformance](ai-sdk-conformance.md) · [OpenCode conformance](opencode-conformance.md) | Pinned clients and controlled reproduction boundaries |
| Understand security and routing | [Routing](routing.md) · [Architecture](architecture.md) | Model/final-provider permissions, fallback, and lifecycle ownership |
| Review release requirements | [PRD](PRD.md) · [Acceptance scenarios](acceptance.md) · [Roadmap](roadmap.md) | Requirements and gates, not promised release dates |
| Make a contribution | [Contributing](../CONTRIBUTING.md) · [Coding rules](coding.md) | Issue, plan, tests, human sign-off, and review |
| Resume work as an agent | [Handoff](HANDOFF.md) · [Instructions](../AGENTS.md) · [Domain glossary](../CONTEXT.md) | Current navigation and terminology; verify against source before implementation |

## Technical reference

- [Engineering harness](harness.md): check commands, CI, and contract validation.
- [Policy fixtures](../contracts/policy_cases.json), [route fixtures](../contracts/route_cases.json), and [gateway fixtures](../contracts/gateway_cases.json): executable examples, including denial paths.
- [Chat schema guard](../contracts/openrouter-schema-drift.md), [model queries](../contracts/model-query-schema.md), and [model responses](../contracts/model-response-schema.md): selected structural coverage and limitations.
- [Model count](../contracts/model-count-schema.md), [single model](../contracts/single-model-schema.md), and [user model](../contracts/user-model-schema.md): additional reviewed schema boundaries.

## Decisions and product context

- [Internal IAM policy engine](adr/0001-internal-iam-policy-engine.md).
- [Dual upstream routing](adr/0003-dual-upstream-routing.md).
- [Final inference-provider authorization](adr/0004-authorize-final-inference-provider.md).
- [OpenRouter feature comparison](research/openrouter-comparison.md) and [control-layer review](research/openrouter-layer-review.md).
- [Naming](naming.md) and [implementation plan template](plans/TEMPLATE.md).

## Reading status and evidence

- **Implemented/tested** describes code and the named tests at a particular revision. It is not a blanket release claim.
- **Conformance** describes the named client, fixture, and workflow only. Mock upstreams do not certify live providers, billing, or arbitrary combinations.
- **Required/planned/open** describes acceptance targets or unresolved decisions, not available APIs.
- **Production readiness** requires the operational and acceptance gates as well as tests. No management dashboard or one-command deployment is provided by these guides.

The [visual asset notes](../assets/README.md) distinguish original conceptual artwork from the actual local verification visualization and retain its raw transcript. The same organization's [TypeMCP](https://github.com/Theorvane/TypeMCP) inspired the documentation structure; its artwork and package/release claims are not reused.
