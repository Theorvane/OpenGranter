# Compatible Legacy Nonstream Usage

## Issue and problem

- Issue: [#540](https://github.com/Theorvane/OpenGranter/issues/540); refs #116 and #7.
- The real AI SDK #538 probes show that legacy /v1 sparse native Google counters fail its numeric usage parser. /api/v1 already omits incomplete usage as a whole, with complete partial data retained in protected accounting history.
- Start from approved main 3dcd2c6 after PR #539 received approval on 6925f6d3e0a2dbe7f0deb528ad50c589826e109e and all three successful checks and merged. No unreviewed dependency is introduced.

## Scope and expected behavior

- Apply the existing complete-counter projection to normalized object:chat.completion responses on both bases. Include usage only when prompt_tokens, completion_tokens and total_tokens are nonnegative safe integers; otherwise omit the entire usage object.
- Preserve complete counts, zero values, independently reported totals and admitted token details exactly. Do not derive new totals, infer billed cost or replace missing values with zero at the HTTP boundary.
- This intentionally changes legacy /v1 sparse usage output. Protected ledger history remains the source for partial known counters according to existing permissions. Existing provider normalization/usage classifications and all IAM, limits, required persistence and failure behavior stay shared.
- Preserve the legacy fingerprint omission/null/string behavior, error formats, streaming and opaque results without the completion discriminator. No pins, dependencies, migrations, content-audit policy, pricing or ledger schema changes.
- The AI SDK's zero token default remains a client observation, never ledger evidence. Other legacy SDK fingerprint/schema gaps, full #116 and unresolved Jev #7 remain open.

## Design

- Remove the format-specific early bypass for normalized completions in the existing response projector; retain the format-specific unknown-fingerprint null projection separately. Clone only when usage omission or compatible fingerprint projection is necessary.
- Projection stays after required usage and outcome audit in managed and delegated response branches; it must not mutate frozen upstream/accounting input.
- Reusing the existing compatible projection is preferred over deriving Google totals or inserting zero, both of which would change unknown accounting into invented counts. Preserving invalid sparse numeric fields would retain the measured client failure.
- No unresolved product choice is implemented, new domain term or costly architecture decision introduced. This is a bounded response-contract correction to the established compatibility requirement.
- Update [usage contract](../../contracts/compatible-completion-usage.md), [native availability](../../contracts/direct-usage-availability.md), [client contract](../../contracts/ai-sdk-client-workflows.md), PRD/architecture/acceptance/compatibility/reproduction and handoff. The installed pinned client and existing source schemas provide the evidence; no API-version change is needed.

## TDD plan

1. Before production changes, update the actual AI SDK legacy sparse-Google case to require successful text with absent usage; retain partial ledger counts and observed client zero defaults. Run it and record the expected parser failure.
2. Update/extend raw and official SDK projection cases to require both-base omission for missing/partial/invalid normalized usage, unchanged complete counts/details, native providers and frozen inputs. Retain opaque results and legacy fingerprint behavior.
3. Cover both-base preflight auth/model/provider Deny, limits and required ledger/outcome audit failure, plus possible-billed upstream failure. No response projection can bypass those gates.
4. Make the smallest shared projection change; run meaningful red/green plus native/token-category/SDK regressions and npm run check. Verify all six source pins stay unchanged.

## Delivery

1. Issue and fresh branch; this English plan before test/production changes.
2. Reproduced failing boundary/SDK cases, minimal fix, green and relevant regressions.
3. Update contracts and documentation with intentional legacy wire change, evidence and remaining client gaps.
4. Ready PR with plan, red/green/full checks, human author/committer, authorized DCO and Assisted-by trailers.
5. Merge only after exact-head approval and required checks succeed.

Risks/rollback: legacy consumers inspecting sparse usage will instead need the existing protected usage history. Preserve the ledger unchanged; reverting only the projection restores sparse legacy wire behavior but also restores the measured SDK parse failure. This correction does not make client-side zero defaults authoritative.

## Verification evidence

- Red before production change: the actual AI SDK, completion projection, direct availability and delegated availability suites ran 74 cases; 35 failed for expected legacy sparse-usage output/parser reasons and 39 passed. No total or zero was added to fixtures to make the measured sparse-Google case succeed.
- Minimal green: the same 74 cases passed after separating both-base usage omission from the existing compatible-only fingerprint projection. Text/refusal/function metadata and frozen inputs remain unchanged apart from usage omission.
- Broader regression initially identified 25 legacy wire expectations in existing Anthropic cache and malformed-container cases. Updated only the HTTP response expectation to the new contract, retaining exact ledger classification/counter/privacy assertions. Google detail/hidden-thinking cases likewise now require omitted incomplete wire usage while preserving independent reported totals and partial history.
- Integrated focused validation passed all 1,542 usage/cache/tier/SDK/Google category and total cases with zero failures/cancellations. Strict type checking, touched-file Biome, planning/link/secret checks and git diff --check passed.
- First full gate ran 7,368 cases: 7,366 passed, one legacy SDK discovery/invocation expectation failed and one optional external PostgreSQL case skipped. Updated that response expectation to omitted usage on both bases and strengthened assertions that the protected ledger still retains prompt=2/completion=1 with unknown total. The resulting five-suite SDK/core regression selection passed all 91 cases. Final npm run check passed: 7,367 tests passed out of 7,368 total, zero failures/cancellations and one optional external PostgreSQL skip. Type checking, lint, planning/contracts/secret checks and all six offline pins passed. Existing unrelated lint output remains 42 warnings and 65 informational diagnostics. Final document/diff checks passed after recording the evidence. All six fixed official source comparisons passed without writes. No live inference, provider credentials, source-pin writes, dependency or storage changes were used.
