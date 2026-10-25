# OpenRouter AI SDK Client Workflows

## Issue and problem

- Issue: [#538](https://github.com/Theorvane/OpenGranter/issues/538); refs #116 and #7.
- The OpenRouter-maintained Vercel AI SDK provider is not covered by the current OpenAI/OpenRouter SDK sockets or OpenCode custom-provider probes. External applications using this distinct serializer/parser need measured workflows against the gateway.
- Start from approved main 54f548a after PR #537 received exact-head approval and all three successful checks and merged. Preserve the reported-tier changes.

## Scope and expected behavior

- Pin the actual OpenRouter AI SDK provider 3.1.0 and AI SDK 7.0.153 development dependencies, compatible with Node >=22; use their public APIs over real local HTTP sockets with a configurable base URL and fixture proxy token.
- Cover both chat bases, delegated OpenRouter and managed OpenAI/Anthropic/Gemini registered transports. Verify streamed text and correlated client function/result continuation, plus nonstream text where supported by fixtures.
- Preserve fresh authentication/model/provider IAM, limits, required audit/usage, missing counts, safe opened failures and body cancellation. Retries and external fetches must be bounded; fixtures can reach only the gateway and mocked approved hosts.
- Any production fix must reproduce an actual supported-path incompatibility before implementation. Do not mutate the client's captured wire body, invent metadata or introduce arbitrary request passthrough to make probes pass. Record unsupported client behavior as a bounded gap.
- No new endpoint, pricing/capability authority, routing controls, production client dependency, source pin, migration or ledger schema changes. Full #116 and Jev #7 remain open.

## Design

- Reuse existing public Node chat server and trusted transport fixtures where their native protocol is identical. Add focused fixture helpers only for actual missing client workflows; retain assertions on model/host/provider scope and per-attempt records.
- Prefer actual generateText/streamText and client tool execution/result handoff over synthetic SDK-shaped inputs. Inspect the installed provider's serializer/parser as evidence when a probe fails; user decisions about new product authority remain outside this slice.
- A narrow new production behavior requires updated contract/PRD/architecture/acceptance documentation; tests-only coverage requires a reproduction contract, compatibility and handoff update. No domain term or costly architectural trade-off is introduced.
- Primary source: [OpenRouter-maintained provider](https://github.com/OpenRouterTeam/ai-sdk-provider), checked 2026-10-25; public npm version/engine/peer metadata confirms the pinned Node/AI SDK line. Record installed exact dependency behavior rather than assuming main documentation matches it.
- Reusing only the existing OpenAI-compatible OpenCode provider would miss this serializer and tool-loop behavior; adding a production SDK abstraction is unnecessary for a client conformance harness.

### Reproduced tool-result name mismatch

The actual provider sends an optional name on tool-result messages, derived from the preceding assistant function call. The strict gateway currently rejects that field, breaking all eight streamed tool loops. Accept this measured client extension only when an own supplied string exactly matches the pending call's function name for that tool_call_id. Strip the redundant name after validation so native adapters do not mistake it for an unsupported speaker name. Keep the internal ChatMessage union and upstream wire shapes unchanged. No arbitrary tool name, orphan/duplicate/missing result or execution authority is admitted. The published ChatToolMessage pin does not declare this property; retain it unchanged and document this as a measured client extension rather than a source-schema addition.

Pin zod 4.6.6 as the tool-input test dependency. It also updates the existing transitive 4.6.5 patch with a reported collection-validation memory-exhaustion advisory; installation audit then reports zero vulnerabilities. Do not suppress or automatically fix unrelated dependency findings.

## TDD plan

1. Add real client probes for both bases and supported routes, run and record any genuine protocol failure before changing production code. Dependency installation or a missing import is not red evidence.
2. Exercise text, tools and follow-up results, credentials/Deny/limits/persistence failure and cancellation without printing sensitive content. Verify ledger counters separately from SDK token summaries.
3. If a supported server boundary rejects an actual compatible request or emits an invalid response, write a focused public-boundary regression and record its expected red before the smallest fix.
4. Preserve supported request subsets and privacy guards; use SDK warnings/limitations as evidence without silently dropping unsupported semantics.
5. Run focused tests, strict type/lint/document checks and npm run check. Compare the unchanged six source pins if production API behavior changes.

## Delivery

1. Issue, fresh issue branch and this plan before coding.
2. Actual-client probes, meaningful red/green for any production fix, bounded assertions for measured unsupported behavior.
3. Update reproduction/compatibility/acceptance/handoff and complete required checks.
4. Ready PR with plan, exact versions, evidence and remaining gaps; user author/committer with authorized DCO and Assisted-by trailers.
5. Merge only on exact-head approval and successful required checks.

Risks/rollback: SDK defaults, automatic retries and tool-loop serialization may differ from the supported gateway subset. Bound network/time/retries and avoid local tool side effects beyond deterministic fixtures. Revert the conformance dependencies/tests and any separately identified server fix together if needed. No live upstream or complete release certification is implied.

## Verification evidence

- Initial real-client probe: 24 cases, 14 passed and 10 failed. Eight tool-loop failures reproduced the server's rejection of the actual provider's tool-result name. Two Google nonstream failures used incomplete native totals: /v1 rejected sparse usage in the client parser and /api/v1 exposed its zero default. These are preserved as separate measured-gap tests; success fixtures explicitly report complete native totals rather than changing server accounting.
- Production regression red: tool-result names suite ran 11 cases, with 10 expected failures and one pass before changing the shared history snapshot. Failures covered correlated-name admission, exact immutable normalization and actual public provider paths; malformed-name rejection was already safe.
- Green: actual client workflows, named-result cases and existing function-history regressions passed all 51 cases. Auth/Deny/limits/persistence, follow-up Deny, cancellation and missing/partial-usage probes passed all 34 additional cases. The pinned client can synthesize finish-step after an error, so persistence assertions inspect the unchanged server wire for missing final usage/DONE as well as client error parts.
- Integrated focused selection: 372 tests passed across new client probes and existing tool capture/history/native mappings/SDK streams/cache directives. Strict type checking, touched-file Biome and planning-document/link/secret checks passed.
- Dependency installation audit reports zero vulnerabilities after the compatible zod 4.6.5 to 4.6.6 patch. All additions are development conformance dependencies; root production dependencies remain unchanged.
- No provider credentials, live inference, endpoint widening or pin writes were used. Final npm run check passed: 7,363 tests passed out of 7,364 total, zero failures/cancellations and one optional external PostgreSQL skip. Type checking, lint, planning/contracts/secret checks and all six offline pins passed. All six fixed official live schema comparisons also passed without writes. Existing unrelated lint output remains 42 warnings and 65 informational diagnostics. Final document/diff checks passed after recording this evidence.
