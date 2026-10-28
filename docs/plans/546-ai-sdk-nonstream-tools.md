# AI SDK nonstream tool continuations

## Issue and problem

- Issue: [#546](https://github.com/Theorvane/OpenGranter/issues/546), refs #116.
- The actual pinned OpenRouter AI SDK has nonstream text and streaming tool-loop coverage, but generateText parallel function/result continuations are unmeasured across the four supported route adapters. Streaming success is insufficient evidence for the JSON workflow.

## Scope and expected behavior

- Exercise createOpenRouter/generateText on both chat bases, delegated OpenRouter and managed OpenAI/Anthropic/Gemini, with two distinct parallel calls to a client-owned deterministic function and a two-request final response.
- Assert native result correlation, fresh authentication/model/provider IAM, limits, per-attempt counters and private operational records.
- Initial admission and required persistence failures must prevent tool execution; a fresh continuation provider Deny must prevent another upstream request after the local tools ran.
- No production semantics, source pins, dependencies or storage changes are planned. Signed Gemini namespaces, richer modalities/reasoning, other endpoints, live inference, complete #116 and unresolved Jev #7 remain outside this issue.

## Design

Reuse the bounded loopback client helper and existing native JSON gateway fixture. Supply explicit complete native usage and native function responses without rewriting client HTTP input/output. Inspect exact native follow-up history, not only the final client text. Keep request retries disabled, bound two steps and apply a deadline. No new domain terms, authorization choices or consequential architecture decisions are required.

Extend [AI SDK contract](../../contracts/ai-sdk-client-workflows.md), [reproduction](../ai-sdk-conformance.md), [compatibility inventory](../openrouter-compatibility.md) and [acceptance](../acceptance.md) with measured results. Existing PRD and architecture requirements already cover these paths and do not change.

## TDD plan

- Add real-client nonstream parallel loop cases before touching production code; run them against current approved main behavior.
- Add auth/implicit/model/provider Deny, limits, selection audit, outcome audit and usage failure cases, plus fresh continuation Deny. Verify no hidden retries or leaked content/credentials.
- If a runtime defect is found, retain its meaningful failing test and record the expected red before implementing the smallest correction. Do not force production changes or fabricate a red result when adding passing conformance coverage.
- Run focused SDK/native tool suites, TypeScript/Biome, then npm run check with the documented bounded CPU-affinity setup.

## Delivery

1. Record this plan before implementing tests.
2. Add fixture/native-history assertions and actual client success/control probes.
3. Update contract, reproduction, acceptance, compatibility and handoff with exact outcomes/limits.
4. Run the full gate; open a ready PR with this plan, evidence and remaining risks.

Rollback removes the new probes/docs only unless a separately demonstrated runtime fix is needed. Controlled fixtures do not certify live provider behavior, client application side effects or other SDK versions.

## Verification evidence

Conformance-only implementation completed; production code is unchanged.

- Initial actual-client run: 80 cases, 74 passed and six failed on the provisional expectation that client totalTokens preserves independent reported totals. Inspection of the pinned AI SDK asLanguageModelUsage confirmed input+output recomputation. This is a client summary limitation, not a gateway runtime defect: preserve the independent 7 on the raw response and ledger and assert the measured client 5/aggregate 10 instead. No production red/green claim is made.
- The corrected dedicated suite passed 80 cases; the combined actual-client/native tool regression selection passed 280 cases. The final full gate also includes the later denial-audit assertion, distinct request IDs and outcome-audit usage persistence assertions.
- Type checking, focused Biome formatting, planning/link/fixture-secret checks and git diff --check passed. Prior 42 lint warnings/65 infos remain unchanged. CLAUDE.md still links to AGENTS.md. Runtime source, scripts, dependencies, six pin files and migrations are byte-unchanged.

- Final npm run check passed: 7,473 total tests, 7,472 passed, zero failures/cancellations and one optional external PostgreSQL skip, approximately 223 seconds. Typecheck, Biome, all document/link/fixture-secret checks and all six offline source-pin integrity checks passed. No live inference or source refresh was needed for this test/document-only scope.
