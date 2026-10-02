# Official OpenRouter SDK streaming conformance

## Issue and problem

- Issue: [#224](https://github.com/Theorvane/OpenGranter/issues/224), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Existing actual socket tests use OpenAI SDK; official OpenRouter SDK request serialization and response validation are untested.

## Scope and expected behavior

- Pin @openrouter/sdk 1.4.18 as a development-only dependency, with actual local sockets on both chat bases and the real delegated native stream invoker behind controlled fake upstream transport.
- Exercise streamed text, request controls, final usage/DONE, unknown usage, safe authentication/IAM/limit and pre/midstream failures. Capture request destinations and verify no unevaluated routing controls or token/content leak into metadata.
- Inventory nonstream/model discovery mismatches from actual client validation explicitly. No fabricated provider/model capabilities, prices or fingerprints to satisfy strict SDK schemas; broader gaps remain follow-up work.
- No production API behavior planned. If an existing-contract defect is found, reproduce it first and revise scope before coding. No live inference or real secrets. Existing IAM, limits, audit, ledger and cancellation/backpressure remain shared.

## Design

- Use the official SDK's configurable serverURL with fixture proxy tokens and retries disabled. The real Node bridge/HTTP composition validates SDK-produced requests; trusted fake upstream responses pass through the real OpenRouter streaming invoker.
- Exact version pin makes serialization/schema changes deliberate. Tests use independent SDK validation rather than locally invented client models.
- Source: [official SDK docs](https://openrouter.ai/docs/client-sdks/typescript/overview) and [repository](https://github.com/OpenRouterTeam/typescript-sdk), checked 2026-10-02; npm metadata reports 1.4.18. No new domain terms or ADR. Independent approval-pending PRs #217/#219/#221/#223 are not prerequisites.
- See [contract](../../contracts/official-openrouter-sdk.md), [acceptance](../acceptance.md) and [compatibility](../openrouter-compatibility.md). Native/tool/rich streams, discovery metadata and named-tool integration remain open.

## TDD plan

- Test-only work requires meaningful boundary assertions rather than an artificial production failure. First run official SDK through actual socket text streaming, then add complete/unknown usage and failures/denials and record real compatibility findings.
- If SDK validation exposes a gap outside existing runtime scope, record the exact supported subset and explicit limitation with a regression that documents the gap; do not claim full compatibility.
- Format, npm run check and planning/link/secret checks. No source pin refresh expected.

## Delivery

- Issue/plan before changes, version/lockfile/tests/docs in one PR; merge after CI and review.
- Risk: SDK includes strict generated schemas and serverURL semantics; SDK acceptance is partial interoperability rather than a named external-tool workflow certification. Production has no dependency on this package. Preserve deterministic fakes and local-only transport.

## Validation evidence

- Initial actual-socket text/usage tests passed on both bases. No production-code change or artificial red step was needed for this test-only issue.
- Twelve socket tests pass: complete/unknown streamed usage and serialization, nonstream success with a real supplied fingerprint, nonstream omission schema rejection, authentication/IAM/limit/first-upstream failure boundaries, standalone midstream schema rejection with failed accounting/interruption audit, and basic model catalog schema rejection.
- Actual findings: nonstream omitted fingerprints raise ResponseValidationError; standalone midstream chunks raise ZodError with missing id; discovery raises ResponseValidationError with missing context_length. The initial assumption about the stream error class was corrected to the observed ZodError; no production behavior was changed to hide gaps.
- npm run check passed: 1,019 passing tests and one existing skip, strict types, lint, planning/link/secret checks and source-pin integrity. npm installation pinned the exact development dependency and reported zero package vulnerabilities. No live provider calls or real credentials.
- #217/#219/#221/#223 have green CI but remain review-required; baseline SDK gap cases must evolve as their implementing features are integrated. Full compatibility and named-tool workflows remain unfulfilled.
