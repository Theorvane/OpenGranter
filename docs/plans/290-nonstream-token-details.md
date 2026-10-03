# Preserve nonstream token usage details

## Issue and problem

- Issue: [#290](https://github.com/Theorvane/OpenGranter/issues/290); release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Direct OpenAI and delegated OpenRouter nonstream responses lose schema-backed cache/reasoning/audio/video/prediction categories during aggregate-only normalization. External clients cannot inspect supplied details.
- The version-15 ChatUsage pin and actual OpenRouter 1.4.18 SDK already select nullable optional detail groups and eight optional counters. The official schema was checked on 2026-10-03.

## Scope and expected behavior

- Preserve prompt_tokens_details fields cached_tokens, cache_write_tokens, audio_tokens and video_tokens as nonnegative safe integers. Preserve completion_tokens_details fields reasoning_tokens, audio_tokens, accepted_prediction_tokens and rejected_prediction_tokens as the same integers or null.
- Preserve absent groups, explicit null groups, empty objects and zero counters. Capture known fields once into immutable bounded snapshots; ignore unknown detail keys rather than copying arbitrary payloads.
- An invalid known field or container omits only its detail group; the other valid group and aggregate normalization remain intact. This is explicit informational projection, not complete instance validation. Nonnegative/safe bounds are the existing local count convention, stricter than the source integer type.
- No detail-derived aggregate values or subset-sum constraints. Existing normalization may derive total only from valid prompt/completion counts. Details alone never create aggregate usage; /api/v1 still omits all incomplete usage while /v1 retains sparse normalized counters and supported details.
- Permission/secret/usage/audit effects: shared authentication, model/final-provider IAM/Deny, limits, required ledger/outcome audit and per-attempt accounting remain unchanged. Details are client-only; no new ledger metadata, billed cost, duplicate charges or operational content storage.
- Streaming details, native Anthropic/Gemini category mapping, cost/BYOK/server-tool fields and complete external-client certification stay out of scope.

## Design

- Add a nonstream OpenAI-shaped usage normalizer composing existing aggregate normalization with allowlisted detail snapshots. Use it only in direct OpenAI and delegated OpenRouter nonstream adapters; leave native and stream aggregate normalization untouched.
- Omitting malformed informational groups preserves known aggregate accounting and compatible SDK validity. Failing the entire inference would discard otherwise valid aggregate reporting; fabricating category zeros or forwarding unknown fields would misrepresent data. Missing groups do not promise a zero count.
- No new domain term, irreversible decision or ADR is needed. Native/category-ledger semantics remain unresolved future work.
- Update [token-detail contract](../../contracts/nonstream-token-details.md), [compatible usage contract](../../contracts/compatible-completion-usage.md), PRD, architecture, acceptance and compatibility inventory. The existing pin already covers these inline properties; no source refresh is required.

## TDD plan

- First public-handler tests expect exact category groups on both prefixes and route kinds; expected red is missing detail fields.
- Cover null/empty/omitted groups, nullable completion categories, malformed/unsafe/fractional/negative values, unknown payload exclusion, independent valid group preservation and aggregate-only classification/no double counting.
- Cover partial/missing base counts, overlapping categories, existing total derivation, actual pinned OpenRouter/OpenAI SDK sockets, pre-dispatch authentication/IAM/limits and required persistence failures.
- Make the smallest adapter normalization change, run focused usage/provider suites and npm run check, then document evidence and inspect the issue delta.

## Delivery

- Issue and plan before tests/code; red/green evidence; authorized identity/AI/DCO commit; PR with plan and remaining risks; sjungwon03-ai review and required CI; sjungwon03 merge.
- Risks: accidentally changing aggregate accounting, forwarding unknown metadata, or implying native/stream/cost support. Public response/ledger assertions and narrowly scoped adapter calls guard these. Revert this bounded projection without a migration for rollback.
- Report missing or omitted groups as unavailable, never zero or complete detailed reporting. Keep #116 open.

### Verification evidence

- Red: `node --experimental-strip-types --test test/compatible-completion-usage.test.ts` passed twelve cases and failed twelve expected category-preservation cases. Public responses and actual SDK results lacked supplied detail groups; existing denial/persistence cases stayed green.
- Green: the compatible-usage, provider-container and delegated-usage suites passed seventy cases after the bounded nonstream adapter change. Additional cases cover immutable changing-accessor snapshots, ignored unknown getters, unsafe non-JSON numbers, native mapping exclusion and selection-audit failure.
- `npm run format` formatted only this issue's changed TypeScript. `npm run check` passed 1,354 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and unchanged pinned-schema integrity. Actual pinned OpenRouter/OpenAI socket tests run on both prefixes and supported route kinds.
- Category counters larger than aggregate counts remain informational, and public ledger assertions retain one attempt and exact base totals/status. Unknown payload/cost keys are excluded. No live model capability or complete compatibility claim is made; #116 remains open.
