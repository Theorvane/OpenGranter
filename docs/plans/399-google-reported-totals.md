# Preserve reported-only Gemini totals

## Issue and problem

Issue: #399. Gemini totalTokenCount includes hidden thoughts as well as prompt and candidate tokens. Existing nonstream normalization derives a missing total from promptTokenCount plus candidatesTokenCount, which can undercount and incorrectly label usage reported. Native streaming already preserves reported-only totals after #398.

## Scope and expected behavior

Disable total derivation only for native Google nonstream success and supported prompt/candidate safety outcomes. Preserve supplied totals, known components, missing/partial/invalid ledger classifications, valid zero counts and content-free metadata. No billing amount is inferred. OpenAI, Anthropic, delegated and Gemini stream semantics remain unchanged.

## Design

Use the existing normalizeProviderUsage deriveTotal=false option at the Google nonstream boundary. Native totalTokenCount is authoritative; do not rebuild it from visible component counts or guess missing thought/tool categories. Existing IAM, limits, fixed destinations, required accounting/audit and safe response failure continue unchanged. No new domain term or costly ADR decision is required. Full #116 and unresolved #7 remain open.

Official source: https://ai.google.dev/api/generate-content . Affected [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [usage contract](../../contracts/direct-usage-availability.md).

## TDD plan

Before code, add HTTP-boundary regressions on both bases for text, prompt SAFETY and candidate SAFETY with hidden thought metadata and missing/reported totals. Missing totals must fail red because total_tokens=5 and reported accounting are fabricated. Update the existing unsafe-sum Google acceptance case to the correct partial classification; no sum is attempted. Then make the one normalization change and rerun native/provider usage and gateway regressions. Run npm run format and full npm run check.

## Delivery

Plan and issue precede production edits. Report actual red/green and complete checks in the PR, then exact-head sjungwon03-ai approval and both CI checks precede sjungwon03 squash merge. Future records are corrected; historical ledgers cannot be reconstructed from omitted upstream totals and are not rewritten.

The initial regression expectation was refined to preserve the existing /api/v1 whole-object omission of partial usage, while /v1 keeps sparse known counters. Both ledger paths retain partial counters. The existing SDK fixture omits native Google total, so its acceptance now asserts missing client total and partial ledger instead of an invented sum.

## Verification evidence

When Gemini omitted totalTokenCount, nonstream responses derived prompt+candidate counts and could undercount hidden thinking while marking the ledger fully reported. Google normalization now preserves only a supplied total; missing total remains partial with exact known components. The same boundary covers text and supported prompt/candidate SAFETY outcomes. Supplied totals (including hidden thinking), invalid counters and all other provider mappings retain their contracts.

TDD: the HTTP and usage regression set initially had 7 expected failures (6 missing-total cases on both bases plus the Google unsafe-sum case). The minimal deriveTotal=false Google change passes the 149 focused native/provider/SDK regression cases. Twelve new HTTP cases cover missing/reported totals with hidden thinking for text and both safety outcomes on /v1 and /api/v1, exact provider attribution and content-free accounting. Existing official SDK Google fixtures now assert a missing client total and partial ledger. The compatible /api/v1 boundary continues omitting incomplete usage as a whole; /v1 retains sparse components, and both ledger paths preserve known counts.

No billing amount is fabricated. Historical ledger records are not rewritten: unavailable upstream totals cannot be reconstructed. Native category reporting, broader provider/tool/client certification and full #116 remain open.


Full npm run check passes strict types, lint, 2052 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
