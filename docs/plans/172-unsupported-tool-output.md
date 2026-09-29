# Reject Unsupported Upstream Tool Invocations

## Issue and problem

- Issue: [#172](https://github.com/Theorvane/OpenGranter/issues/172).
- The shared text normalizer drops populated tool_calls/function_call when text is present; adapters collapse tool finish reasons to null. This loses required invocation semantics while reporting success.

## Scope and expected behavior

- Direct OpenAI and delegated OpenRouter reject populated or malformed tool_calls, any non-null legacy function_call, and tool_calls/function_call finish reasons through existing post-response failures.
- Omitted/null/empty-array tool_calls and omitted/null function_call mean no invocation for the existing text/refusal/filter subset. Native mappings remain unchanged.
- Keep IAM/limit/audit gates and possibly-billed usage paths; names/arguments/content never enter errors or metadata. Full tool invocation/continuation support is deferred under #116.

## Design

- Add the minimal unsupported-output guard to the shared assistant normalizer before content normalization. Native adapters receive normalized text objects and remain unchanged.
- Reject rather than silently fabricate completion semantics. Do not accept tool inputs or invent capability-based rerouting/fallback behavior.
- Update PRD, architecture, acceptance, compatibility and the dedicated contract. Official source inspection and the runtime reproduction establish the gap; source-drift extension is separate.

## TDD plan

- Public HTTP/SDK regression tests first: tool outputs currently succeed and silently lose data.
- Cover populated/malformed modern and legacy fields, tool finish reasons, ordinary no-invocation defaults, safe failure accounting and IAM/limits/audit denial.
- Minimal guard, focused green and full npm run check. No schema/compiler relaxation.

## Delivery

- Ready issue-numbered branch/PR with this plan and red/green evidence.
- Rollback guard only; no data migration. Compatible tool workflows remain unsupported and explicitly fail.

## Verification evidence

- Red: four expected regression failures and four passes before implementation. HTTP/SDK paths incorrectly reported successful text after discarding invocation semantics.
- Green: all eight new tests pass across both compatible paths and SDK bases; empty/null defaults, shared denial gates and possibly-billed failure accounting remain covered.
- Final npm run check passes: 830 tests pass, one optional external PostgreSQL test skips. Type checking, lint, planning validation and pin integrity pass; local PGlite tests run. Git diff whitespace checks pass.
- This branch starts from main containing merged schema PR #169; pending fingerprint PR #171 is independently integrated and verified there with 832 passing tests.

### Fingerprint main integration

- Integrated merged fingerprint PR #171 from main and preserved both English document sections without changing the invocation guard.
- Integrated npm run check passes: 840 tests pass, one optional external PostgreSQL test skips; type checking, lint, planning validation and pinned integrity pass. Updated-head CI/review remain required.
