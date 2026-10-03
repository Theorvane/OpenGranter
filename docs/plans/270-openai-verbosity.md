# Direct OpenAI verbosity mapping

## Issue and problem

- Issue: [#270](https://github.com/Theorvane/OpenGranter/issues/270), release gate #116.
- Delegated verbosity preparation from #268 rejects every native direct value, including OpenAI's documented low/medium/high chat controls.

## Scope and expected behavior

- Registered direct OpenAI nonstream chat forwards optional low/medium/high at top level through both HTTP bases. Null/omission supply no field or injected default.
- xhigh/max remain delegated-only and reject on direct OpenAI before secrets/transport. Anthropic/Gemini supplied values remain unsupported. Managed streaming remains outside this slice.
- Preserve IAM, limits, required ledger/audit, exact immutable capture and existing output/sampling/tool controls. Native provider failures remain safe possibly-billed attempts without exposing content or keys.

## Design

- Make the existing once-captured direct verbosity guard destination-sensitive; pass the scalar into request preparation and spread only into the OpenAI body.
- Official [OpenAI chat contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and installed SDK define low/medium/high/null. Model capabilities differ; mapping does not certify every model.
- Depends on [#269](https://github.com/Theorvane/OpenGranter/pull/269). Branch starts from main and includes its issue commit. After dependency squash, rebase only this issue's own commit and revalidate actual CI/head.
- Read-only repository grill-with-docs fact audit confirms contracts and insertion points. No new glossary term, ADR or unresolved product decision.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/client-verbosity.md).

## TDD plan

- First direct HTTP low verbosity regression should fail with 502 instead of 200.
- Cover all direct enum values, null/omission, early xhigh/max and native-adapter rejection, single getter and credential-await capture, combined controls/tool history, success/transport failure, IAM/Deny/limits, required audit/ledger and actual SDK sockets on both bases.
- Update the prior delegated matrix to reflect narrower native support without removing delegated cases. Minimal body mapping, focused tests and npm run check.

## Delivery

- Record red/green, full checks and dependency in PR; require CI and approval.
- No migration. Rollback removes optional native mapping. Anthropic/Gemini/native stream, model capability and OpenRouter source/SDK gaps remain explicit.

## Verification evidence

- Red: direct HTTP low/high requests returned 502 instead of 200; native snapshot and verbosity-only cases rejected before preparation.
- Green: 21 focused tests pass, retaining all fourteen delegated/matrix cases and adding seven direct boundary cases including actual SDK sockets, exact optional/default behavior, immutable single capture, tool history and required control/failure paths.
- npm run check passes 1,068 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- Dependency #269 must merge first. Rebase this issue's own commit after its squash and verify actual integrated controls, CI and head; no broader model or SDK conformance claim.
