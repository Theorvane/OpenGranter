# AI SDK inline-image workflows

## Issue and problem

- Issue: [#550](https://github.com/Theorvane/OpenGranter/issues/550), refs #116.
- Existing actual pinned AI SDK text/tool probes do not establish inline-image serialization, native conversion or controls. Other SDKs/OpenCode are independently measured and do not certify this client.
- This work began independently from approved main 58700b6. PR #549 then received exact-head approval/green CI and merged as fcb40ea; update this branch onto that approved main and validate the combined tree.

## Scope and expected behavior

- On both chat bases and delegated OpenRouter/direct OpenAI/Anthropic/Gemini, send deterministic application-owned PNG bytes between text parts using generateText and streamText.
- Assert exact compatible/native wire image bytes, MIME/order and surrounding text without request/response rewrites, remote image fetches or live provider calls.
- Cover current auth/implicit/model/provider Deny, limits, selection/required outcome audit and usage failure, plus stream cancellation and possible-billing/privacy semantics.
- Preserve existing production behavior, MIME/detail/cardinality/size restrictions, accounting and source pins. Remote/file fetches, rich outputs, other formats/clients, live image capability and full #116 remain outside scope. Jev #7 stays unresolved.

## Design

Reuse bounded actual-client loopback infrastructure and existing image/native JSON/SSE fixtures. Use one canonical PNG fixture and explicit complete provider counters; never infer server accounting from client summaries. Inspect captured upstream wire before certifying conversion. Client fetch may target only the configured local chat endpoint, so any automatic external image fetch fails the probe. Keep retries disabled and apply an abort deadline.

Update [contract](../../contracts/ai-sdk-client-workflows.md), [reproduction](../ai-sdk-conformance.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and handoff. PRD/architecture already require these controls and no new behavior is planned. No domain choices/glossary/ADR changes are needed.

## TDD plan

- Write actual-client image success and control probes before considering runtime edits; run against approved main behavior.
- Record a meaningful expected red before any production correction if a defect is found. Do not fabricate a production red/green cycle for passing conformance-only work.
- Assert no provider work on admission denial, safe errors/operational records, no actual final server usage/DONE after required persistence failure, and failed possibly-billed interrupted accounting on cancellation.
- Run focused AI SDK/image/native suites, typecheck/Biome and npm run check with the documented CPU-affinity gate.

## Delivery

Add tests/fixtures, record measured client limits, run full validation and open a ready PR. PR #549 is now merged; preserve its implemented behavior when updating the base. Rollback removes the new tests/docs only unless a separately reproduced production fix becomes necessary.

## Verification evidence

- Initial actual-client run: 40/40 passed on approved main 58700b6. No runtime defect was found and no production red/green cycle is claimed. Tests precede any potential production correction; none was needed.
- Final focused AI SDK/image/native selection: 302 cases passed after explicit empty media-download-plan guards were added. No production source, dependency, pin or migration changed.
- Initial full npm run check on 58700b6 passed: 7,513 total, 7,512 passed, zero failures/cancellations, one optional external PostgreSQL skip (~247 seconds), all six offline integrity checks and document/link/fixture-secret validation.
- PR #549 subsequently received approval on 2346f1fc16bdb20047a1cf05333c669d38bf385e with all three checks successful and merged as fcb40ea. The branch updated onto that approved main, retaining both retry-header and image documentation when resolving overlapping updates. A final full gate is rerun on the combined tree.
- Typecheck, focused Biome, planning/link/fixture-secret checks, git diff HEAD --check and CLAUDE.md symlink checks passed. Existing 42 lint warnings/65 infos remain unchanged.

- Final integrated npm run check on approved main fcb40ea passed: 7,677 total, 7,676 passed, zero failures/cancellations, one optional external PostgreSQL skip (~253 seconds). Typecheck, lint, planning/links/fixture-secret scan and all six offline pin integrity checks passed. This includes the merged retry-header suite and all 40 new image cases.
