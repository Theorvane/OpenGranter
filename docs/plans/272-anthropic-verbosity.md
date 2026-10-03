# Direct Anthropic verbosity-to-effort mapping

## Issue and problem

- Issue: [#272](https://github.com/Theorvane/OpenGranter/issues/272), release gate #116.
- Anthropic direct requests reject documented OpenRouter verbosity despite the stable native output_config.effort mapping.

## Scope and expected behavior

- Registered direct Anthropic nonstream requests map low/medium/high/xhigh/max to top-level output_config.effort through both HTTP bases. Null/omission inject no field/default.
- Preserve fixed destination, once-captured values, existing version header and output/sampling controls. Inject no beta header or thinking configuration. Google supplied values remain unsupported; direct OpenAI retains its narrower range.
- IAM, limits, required ledger/audit and safe possibly-billed failures remain shared. Per-model level support differs. Existing non-text/thinking blocks continue safe failure; request mapping does not establish full native thinking-response support.

## Design

- Reuse the captured scalar and prepare argument, allow Anthropic's five values and add one nested effort projection.
- [OpenRouter parameters](https://openrouter.ai/docs/api_reference/parameters#verbosity) document this mapping. [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort) and [Messages API](https://platform.claude.com/docs/en/api/messages/create) define stable top-level effort without a beta header. Per-message beta features are excluded.
- Depends on #271 and #269. Start from main and include their own issue commits; after dependency squash rebase only issue-272 and revalidate actual CI/head.
- Repository grill-with-docs read-only fact audit confirms scope and response limitations. No domain change, ADR or unresolved product decision.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/client-verbosity.md).

## TDD plan

- First public Anthropic verbosity request fails red with 502 instead of 200.
- Cover all five levels/null/omission, exact nesting and stable headers, no injected thinking/beta/default, invalid/Google rejection, credential-await and single getter capture, combined native controls, denial/limits/audit/ledger/transport failure, non-text response rejection and actual SDK sockets.
- Preserve prior matrices while checking Anthropic's nested field; minimal guard/projection, focused tests and npm run check.

## Delivery

- Record red/green and checks in PR; dependency merges, CI and approval required.
- No migration. Rollback removes the optional native mapping. Per-model support, native thinking/rich responses, managed streaming and OpenRouter source/SDK coverage remain gaps.

## Verification evidence

- Red: public Anthropic verbosity returned 502 instead of 200; scalar snapshot/default-only cases failed before dispatch.
- Green: 28 focused cases pass, retaining existing delegated/OpenAI coverage and adding seven Anthropic cases with stable headers, exact nested fields, all levels/null/omission, native caps/instruction translation, single capture, control gates, SDK sockets and safe possibly-billed thinking-block rejection.
- npm run check passes 1,075 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- Dependencies #269 then #271 must merge first; rebase only issue-272 after their squash merges and verify actual integrated tree/CI/head. No native thinking/rich-response compatibility claim.
