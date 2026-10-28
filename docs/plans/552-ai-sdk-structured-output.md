# AI SDK structured-output workflows

## Issue and problem

- Issue: [#552](https://github.com/Theorvane/OpenGranter/issues/552), refs #116.
- Actual pinned text/tool/image workflows do not certify Output.object schema serialization, generation/stream parsing or accounting after a client parse failure.
- This work began independently from approved main fcb40ea. PR #551 then received exact-head approval with all three checks successful and merged as c22b303; update onto that approved main before final full validation.

## Scope and expected behavior

- Actual generateText/streamText with Output.object on both chat bases through managed OpenAI and delegated OpenRouter, with exact captured response_format and deterministic JSON text.
- Exercise valid objects, extra properties, malformed JSON and schema-mismatched outputs. Server completion success/usage can persist before the client parser rejects output; do not rewrite accounting from SDK exceptions.
- Verify shared auth/IAM/limits, required usage/outcome audit, schema/content privacy and absence of unauthorized upstream work. Native Anthropic/Gemini schema rejection stays pre-secret and unbilled.
- No native schema mapping, server-side validation/repair, new output modes, dependency/schema-pin/storage changes or live capability certification. Full #116 and unresolved Jev #7 remain open.

## Design

Reuse bounded actual-client loopback and native/delegated transport fixtures. Supply explicit complete usage and JSON/SSE completions, without caller wire rewrites. Inspect exact generated schema/name/description/strict at the actual upstream boundary. Disable retries, bound requests and apply abort deadlines. For streaming persistence errors inspect real wire completion frames separately from SDK-generated finish events.

Extend [AI SDK contract](../../contracts/ai-sdk-client-workflows.md), [format contract](../../contracts/client-response-formats.md), [reproduction](../ai-sdk-conformance.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and handoff. Existing PRD/architecture already require these boundaries; new product/domain choices are not needed.

## TDD plan

- Write actual-client cases against approved runtime before considering production edits. Record a meaningful expected red before any correction if a defect is found; do not fabricate a production red/green cycle for passing conformance work.
- Test valid/malformed/mismatched outputs, admission denial, persistence failures, exact schema privacy and unsupported-native pre-secret rejection on both bases and stream/nonstream modes.
- Distinguish client parsing from server validation, incomplete streams from complete malformed content, and client token summaries from server usage evidence.
- Run focused AI SDK/format/provider/routing tests and npm run check with the documented CPU-affinity setup.

## Delivery

Add probes, record measured output/accounting limits, update documents and open a ready PR after full validation. Update onto any newly approved main changes and rerun integrated validation when justified. Rollback removes tests/docs unless a separately reproduced runtime defect requires correction.

## Verification evidence

- Initial actual-client run: 40 cases, 36 passed and 4 failed on the provisional assumption that stream result.output must reject after a persistence error. The pinned client can parse already-delivered text despite error parts. No gateway defect or production red/green cycle is claimed; assertions now retain actual wire error/final usage/DONE withholding alongside the measured resolved client object.
- The corrected 40-case suite passed, then 8 extra-property probes measured default Zod stripping while preserving gateway text. Final SDK/format selection on approved main c22b303 passed 258 cases, including merged image coverage and all 48 new structured cases.
- PR #551 was approved on eb544ee2b25da81d031150796bd09b22a922fd65 with all three checks successful and merged as c22b303. This branch updated onto that approved main before the final full gate.
- Typecheck, focused Biome, planning/link/fixture-secret checks, whitespace and CLAUDE.md symlink checks passed. No production source, scripts, pin, dependency or migration changes relative to approved main.

- Final npm run check on approved main c22b303 passed: 7,725 total, 7,724 passed, zero failures/cancellations and one optional external PostgreSQL skip (~232 seconds). Typecheck, lint, planning/links/fixture-secret scan and all six offline integrity checks passed. Existing 42 lint warnings/65 infos remain unchanged.
