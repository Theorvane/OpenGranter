# Validate Non-streaming Upstream Finish Reasons

## Issue and problem

- Issue: [#174](https://github.com/Theorvane/OpenGranter/issues/174).
- The two compatible normalizers collapse all unrecognized/malformed/error/missing finish reasons to null and report success. This hides termination semantics.

## Scope and expected behavior

- Preserve stop, length, content_filter and explicit null in direct OpenAI and delegated OpenRouter's existing non-streaming text subset.
- Reject error, invocation/unknown reasons, missing fields and malformed types using existing safe post-response failures and possibly-billed accounting.
- No native Anthropic/Gemini mapping, IAM, limit or audit changes; errors/metadata never contain arbitrary reasons or response bodies. No tool/stream/retry-policy implementation.

## Design

- Validate the supported finish scalar before returning normalized completions instead of converting every other value into null. Preserve genuine null separately from omitted/malformed fields.
- Source: https://openrouter.ai/openapi.json, raw snapshot retrieved 2026-09-29. ChatChoice requires finish_reason; ChatFinishReasonEnum includes stop/length/content_filter/error/tool_calls/null. The local text subset cannot complete error or invocation outcomes successfully. Installed OpenAI SDK declares required termination reasons.
- Do not preserve arbitrary reasons with fabricated null semantics or introduce new client error categories. Precise upstream error taxonomy and full tool/stream behavior remain open.
- Update PRD, architecture, acceptance, compatibility and the finish-reason contract. Pending #171/#173 are separate scopes and not dependencies.

## TDD plan

- HTTP/SDK regression cases first: invalid/error reasons currently succeed.
- Cover stop/length/filter/null, missing/non-scalar/unknown/error/invocation values, both paths, safe usage failure accounting and authorization/limit/audit gates.
- Minimal adapter validation, focused green and full npm run check without relaxing types or inventing usage.

## Delivery

- Ready issue-scoped PR with plan, red/green and full-check results.
- Rollback validation only; no persisted-data migration. Full response validation, streams and tools remain unsupported.

## Verification evidence

- Red: four expected failures and four passes before implementation; error/malformed/missing reasons incorrectly reported success.
- Green: all eight new HTTP/SDK/denial/accounting tests pass. Combined registration/regression coverage passes 11 tests.
- The first full run found a historical registration-mutation success fixture missing finish_reason. Add a valid stop reason there; the new missing-field denial regression remains unchanged. Format the fixture with the configured formatter.
- Final npm run check passes: 830 tests pass, one optional external PostgreSQL test skips. Type checking, lint, planning validation and pinned integrity pass; local PGlite tests run. Git diff whitespace checks pass.
