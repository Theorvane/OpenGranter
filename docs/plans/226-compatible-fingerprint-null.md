# Represent unknown compatible completion fingerprints

## Issue and problem

- Issue: [#226](https://github.com/Theorvane/OpenGranter/issues/226), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- The official OpenRouter SDK requires nullable string system_fingerprint on nonstream chat completions. Preserving upstream omission on /api/v1 makes otherwise successful calls fail client validation.

## Scope and expected behavior

- On /api/v1 only, project absent/undefined system_fingerprint as null on normalized object:chat.completion responses. Null means unavailable metadata, never an invented backend identifier. Preserve supplied string/null exactly, including empty/Unicode values.
- Keep /v1 omission, native adapter omission, SSE, errors and opaque generic handler responses unchanged. Clone only the compatible normalized completion; do not mutate the response handed to accounting or the upstream object.
- Apply at both delegated and managed client success boundaries after existing required usage/outcome audit. IAM/limits, denial/failure accounting and operational metadata remain unchanged; no determinism/provider identity claim.
- Exact official SDK 1.4.18 development dependency supports actual socket regression tests; reuse the independently pinned version from pending PR #225. No production runtime dependency.

## Design

- A private narrow client projection uses the already-resolved path format and normalized completion discriminator. Native normalizers cannot apply this universally because /v1 deliberately preserves omission and streaming SDK schema differs.
- No new domain term/ADR. OpenRouter ChatResult and the published official SDK allow null but require the field; see [official schema](https://openrouter.ai/openapi.json) and [SDK docs](https://openrouter.ai/docs/client-sdks/typescript/overview), checked 2026-10-02.
- See [contract](../../contracts/compatible-completion-fingerprints.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md). Basic discovery metadata, streaming null allowance, sparse usage and full conformance remain separate work. Pending PRs #217/#219/#221/#223/#225 are independent.

## TDD plan

- First add managed/delegated omission projection regression; expect undefined instead of null on compatible response. Add official SDK socket omitted-fingerprint regression; expect response validation failure before coding.
- Update prior omission assertions only for intentionally changed compatible boundaries. Verify exact supplied values, legacy/native omission, opaque response identity/cloning, denied/limited and usage/audit/upstream failures, including real native Anthropic/Gemini normalized responses.
- Implement the minimal shared private projection at both success returns; format and npm run check. No source pin change.

## Delivery

- Issue/plan before code, branch/PR with red/green evidence. Merge only after green CI and approval.
- Risk: null is an explicit unavailable marker, not a fingerprint; missing usage is never repaired or fabricated. Legacy and streaming remain separate contracts; broader official SDK certification remains open.
- Integration: PR #225 currently asserts compatible omission as an expected SDK validation gap. When integrating the two PRs, update that compatible assertion to successful null deserialization and retain its legacy rejection assertion. Its separate midstream-error gap must likewise reflect PR #223 when integrated.
- Red evidence: the managed/delegated HTTP regression failed with undefined instead of null; both actual official SDK socket regressions failed with ResponseValidationError before production edits. The focused fingerprint suite then passed all 14 tests.
- Full verification: npm run check passed type checking, linting (four existing warnings), 1,011 tests with one pre-existing skip, planning/link/contract checks and pinned schema integrity. Three existing path-equivalence assertions were updated to the intentional compatible null projection; accounting and audit equivalence remain asserted.
- Integration after #217/#225 merged: the old compatible SDK gap assertion failed as expected because completion deserialization now succeeds. Update it to assert null metadata and response text, retaining legacy rejection and successful accounting. Other independent SDK gaps remain explicit.
