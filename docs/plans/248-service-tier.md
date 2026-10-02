# Preserve nonstream service tier response metadata

## Issue and problem

- Issue: [#248](https://github.com/Theorvane/OpenGranter/issues/248), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Direct OpenAI/delegated OpenRouter adapters omit an optional official response field supported by external clients.

## Scope and expected behavior

- Preserve exact optional service_tier string/null/omission on normalized nonstream responses through both chat bases and official SDKs, including ordinary, refusal/filter and function-tool outcomes. Empty and unknown strings are valid structural metadata.
- Malformed supplied types fail safely under existing possibly-billed failure accounting. Capture each scalar once before validation/projection.
- No request control, stream metadata, native Anthropic/Gemini tier mapping, route/capability selection or billing changes. Tier cannot establish authority or influence IAM, limits, accounting attribution or estimates. Keep it out of operational metadata/errors.

## Design

- Add the optional scalar to ChatCompletion and the two OpenAI-shaped normalizers, reusing their existing safe error paths. Gateway projections preserve it by cloning normal completions.
- Source: [official schema](https://openrouter.ai/openapi.json), checked 2026-10-02, and pinned SDK 1.4.18 confirm ChatResult.service_tier is optional string/null. Repository-required read-only fact audit confirms accounting/audit extract explicit metadata and do not copy tier.
- Alternative: enum restriction would reject valid upstream/unknown tier strings; native translation requires separate semantic decisions. No new glossary term or ADR.
- No pending PR dependency. Reviewed version-9 response projection in #243 already selects the full ChatResult shape; no new request/source pin refresh is required here. Broader response and stream conformance remain open.
- Update PRD, architecture, acceptance, compatibility and a dedicated response contract.

## TDD plan

- Public delegated response regression first fails because supplied service_tier is missing. Add the smallest scalar capture/validation/projection to pass.
- Cover omission/null/exact strings, malformed values and failed-attempt accounting, ordinary/refusal/filter/tool branches, actual SDK sockets, native omission and scalar single-read capture.
- Verify denial and required ledger/outcome-audit failures, private metadata and client request rejection. Format, run focused tests and npm run check.

## Delivery

- Link plan and red/green evidence in PR; require CI and approval before merge.
- Risk: reported tier is untrusted provider metadata, not a price/provider/permission assertion. Do not infer native tiers. Rollback removes the field projection without changing accounting.

## Verification evidence

- Red: delegated public compatible completion regression failed because service_tier was undefined instead of the supplied exact value.
- Green: all 29 focused fingerprint/tier tests pass (15 new service-tier cases), including both official SDKs, public outcomes, malformed/failure accounting, single-read scalar capture, native omission and rejected request controls.
- npm run check passes 1,062 tests with one existing skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity. A read-only Response.json test override was repaired using a defined property to retain strict TypeScript validation.
- This branch starts at merged main with no pending PR dependency. The pending full ChatResult source selection already tracks service_tier; no source pin was changed here.
