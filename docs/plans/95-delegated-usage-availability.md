# Preserve delegated token usage availability

## Issue and problem

- Issue: [#95](https://github.com/Theorvane/OpenGranter/issues/95).
- OpenRouter normalization loses partial recognized counts and masks invalid supplied totals. This produces inaccurate usage availability in delegated history.

## Scope and expected behavior

- Apply the existing direct-provider token projection semantics to OpenRouter responses: valid supplied counts survive; missing fields stay absent; invalid values and unsafe sums become sanitized null markers.
- The existing ledger classifies reported, partial, missing, and invalid without changing inference success. Complete valid usage remains unchanged.
- No billing reconciliation, actual-provider discovery, IAM change, quota policy, new request fields, schema change, or malformed usage-container validation.

## Design

- Extract the existing direct token projection into a pure shared usage helper. Both adapters use the same known-field projection without changing provider-specific mapping.
- Keep OpenRouter's completion validation, provider restrictions, fixed URL, secret lookup, failure metadata, and no-redirect behavior intact.
- A second copied implementation could drift; sharing the existing projection keeps both route kinds consistent. Raw invalid values are never copied.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [contract](../../contracts/delegated-usage-availability.md). Existing direct contract remains applicable; reconciliation decisions remain open.

## TDD plan

- Reproduce delegated usage loss through the real OpenRouter adapter and `createChatHandler` using fake HTTP responses. Assert normalized output and captured ledger availability.
- Cover valid complete and derived totals, no counters, all partial forms including zero, malformed counters, and safe-integer overflow; verify no raw invalid content is retained.
- Extract shared normalization and apply it to OpenRouter. Keep existing direct and delegated authorization/secret/failure suites green, format, and run `npm run check`.

## Delivery

- Issue/plan precede coding. Link plan and red/green evidence in a ready PR.
- Delegated clients must accept absent/null counters for incomplete/invalid upstream reporting. No migration; rollback restores lossy delegated behavior. Report the independent scope of billing reconciliation.

## Verification evidence

- Red: the original delegated adapter failed 7 regression cases and passed the 3 complete/derived/missing baseline cases.
- Green: all 10 delegated adapter-to-gateway cases passed after extracting and sharing token projection.
- Final `npm run check` passed strict TypeScript, Biome, 376 tests, and planning/link/contract/fixture checks, including existing direct/delegated authorization, secret, and failure suites. One external PostgreSQL driver test was skipped locally without a database URL; CI supplies PostgreSQL and embedded database cases passed.
- `git diff --check` passed, and `CLAUDE.md` remains a symlink to `AGENTS.md`. No schema changes or live provider calls.
