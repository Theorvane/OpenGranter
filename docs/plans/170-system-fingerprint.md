# Upstream System Fingerprint Preservation

## Issue and problem

- Issue: [#170](https://github.com/Theorvane/OpenGranter/issues/170).
- Current OpenAI/OpenRouter response normalization drops optional backend fingerprint metadata. Clients using seed cannot observe upstream backend changes.

## Scope and expected behavior

- Preserve exact optional string/null system_fingerprint for non-streaming direct OpenAI and delegated OpenRouter on both HTTP/SDK bases. Omitted values remain omitted; empty/Unicode strings are valid.
- Reject non-string/non-null upstream values through existing safe post-response failure/accounting. Native Anthropic/Gemini never fabricate this metadata.
- The fingerprint is upstream protocol data, not principal authority or usage identity. Exclude it from audit/event/error metadata. Existing IAM, limits, audit and usage handling remains unchanged.
- Streaming, provider identity verification via fingerprints, deterministic output and full response conformance remain out of scope.

## Design

- Add optional nullable field to normalized ChatCompletion, validate upstream values in the two supported normalizers and preserve them in returned client objects.
- Source: official https://openrouter.ai/openapi.json ChatResult defines optional string/null; inspected raw snapshot retrieved 2026-09-29. Installed OpenAI SDK declares optional string; its runtime retains nullable upstream fields.
- No synthetic fingerprint from route/configuration hashes: that would imply equivalent backend semantics without evidence.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/system-fingerprint.md). Source response-schema drift coverage remains open.

## TDD plan

- First public HTTP/SDK tests must reproduce dropped fields and malformed-value success. Cover omitted/string/null, normal/refusal/filter outcomes, safe failure accounting and shared security gates.
- Implement minimal normalizer validation and forwarding; retain existing native response mappings. Focused green then npm run check.

## Delivery

- Ready PR linked to issue and plan with red/green and validation evidence.
- Rollback optional normalization field; no persisted-data changes. Fingerprints remain opaque upstream data with no authenticity/determinism claim.

## Verification evidence

- Red: six expected failures and four passes after correcting native fixtures to include required Anthropic registration/output limits. Failures reproduce omitted fingerprints and malformed-type success.
- Green: all ten focused HTTP/SDK/native/security tests pass; failed upstream responses retain possiblyBilled accounting without metadata leakage.
- Final npm run check passes: 822 tests pass, one optional external PostgreSQL integration test skips. Type checking, lint, planning validation and pinned integrity pass; local PGlite tests run. The literal-role fixture typing was corrected without relaxing compiler settings.
- Git diff whitespace checks pass. Complete external-client compatibility and streaming remain open.
