# Preserve non-streaming assistant reasoning content

## Issue and problem

- Issue: [#240](https://github.com/Theorvane/OpenGranter/issues/240), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Shared direct OpenAI/delegated OpenRouter normalization silently drops optional response reasoning on otherwise valid assistant outcomes.

## Scope and expected behavior

- Capture exact optional string/null reasoning in already-valid text, refusal/filter and function-call completions on both HTTP bases. Omission stays omitted; empty/Unicode/framing text stays exact.
- Reject malformed supplied reasoning safely after upstream dispatch, with existing failed possibly-billed accounting and no fallback content leakage. Preserve all existing content/refusal/tool-call validation rules.
- Authentication, model/provider IAM, limits, required audit/usage and alias attribution remain shared. Operational metadata, errors and accounting never retain reasoning.
- Exclude reasoning-only null/missing-content success, reasoning_details/encrypted formats, request controls, native Anthropic/Gemini mappings, aggregation, content-audit changes and full conformance.

## Design

- Add one optional scalar to AssistantResponse and capture it once before validating either existing tool or ordinary-output branch. Both invokers already project the normalized message, so no routing/usage changes are needed.
- Check the [official OpenAPI](https://openrouter.ai/openapi.json) and installed SDK 1.4.18 with a read-only fact audit under the repository planning skills. Actual SDK sockets use supplied fingerprints to keep the legacy omission gap separate.
- Independent branch from main; pending streaming reasoning #239 is complementary but unnecessary. No new domain term or ADR. Add a focused contract and update current planning/compatibility inventory.

## TDD plan

- First public HTTP regression expects exact reasoning on text completions and fails because the field is omitted. Run/record red before production edits.
- Cover omission/null/empty/Unicode values; text/refusal/filter/tool coexistence; malformed boolean/numeric/object/array/explicit undefined via native boundary; reasoning-only output remains rejected.
- Verify authentication, explicit model/provider Deny, limits, required pre-/post-response audit and usage failure, one safe failed-attempt record, metadata non-disclosure, and actual official SDK sockets on both bases/routes.
- Make the smallest shared-normalizer change, format and run npm run check.

## Delivery

- Issue/plan before code, focused PR with red/green and full validation. Merge after required CI and approval.
- Risks: reasoning is sensitive response content, never authority or billing data. Existing SDK/debug objects are caller-owned; do not log them. Broader/native reasoning and full external-client conformance remain open.

## Validation evidence

- Red before production edits: both managed/delegated public HTTP regressions returned undefined instead of explicit null reasoning. Green: all thirteen new reasoning cases pass, covering exact projection, refusal/filter/tool coexistence, malformed/unsupported shapes, pre-/post-response gates, missing usage and actual official SDK sockets.
- npm run check passes with 1,060 tests passing and one existing skip, strict types, lint, planning/link/contract checks and offline pin integrity. The count reflects current main plus this independent issue and excludes pending PRs.
- git diff --check passes; no schema pin, accounting schema, native mappings or content-audit policy changed. Final documentation checks pass separately.
