# Unknown Nonstream Fingerprints on Both Bases

## Issue and problem

- Issue: [#542](https://github.com/Theorvane/OpenGranter/issues/542); refs #116 and #7.
- Pinned official OpenRouter SDK ChatResult requires nullable system_fingerprint. Existing actual-socket tests reproduce legacy /v1 ResponseValidationError for managed OpenAI/delegated OpenRouter when the upstream omits it; /api/v1 already projects unknown metadata to null.
- Start from approved main bf3d3d4 after PR #541 received approval on cc32c410e924e9e55cb1a0016f33c552f80673c6 and all three successful checks and merged. Retain the #540 both-base numeric usage correction.

## Scope and expected behavior

- Project missing/undefined system_fingerprint to null on both nonstream chat bases for normalized object:chat.completion responses. Preserve supplied exact strings (including empty/Unicode) and null.
- This intentionally changes /v1 from omitted to explicit null. Null expresses unavailable protocol metadata; do not synthesize a backend identity, provider assertion, model capability or determinism guarantee.
- Preserve complete response content/refusal/functions, reported service tiers, complete numeric usage/categories and omission of incomplete usage. The original provider/accounting input remains unchanged.
- Apply only after required usage and outcome audit on existing managed/delegated success paths. Authentication, model/final-provider IAM/Deny, limits, secrets, malformed native metadata and possible-billing failures remain shared.
- Opaque results without the completion discriminator, streaming and error formats remain unchanged. No dependency, source pin, API-version, migration, content-audit policy or ledger schema change. Full #116 and unresolved Jev #7 remain open.

## Design

- Reuse the existing completion response projector and remove the format-specific fingerprint bypass. Remove its obsolete format parameter while preserving format handling for errors. Clone only when projection is needed; never mutate a frozen completion.
- Exercise the actual official SDK text and two-request function/result lifecycle without supplied upstream fingerprints on both bases. Retain correlated tool IDs/names/results, fresh IAM on continuation and separate per-attempt accounting.
- Prefer explicit null over invented strings or client-side request/response rewriting. Keeping omission would preserve the measured SDK failure. This is a reversible protocol correction to the existing compatibility requirement, not a new domain concept or costly architectural choice.
- Update [fingerprint contract](../../contracts/compatible-completion-fingerprints.md), [usage contract](../../contracts/compatible-completion-usage.md), [official SDK contract](../../contracts/official-openrouter-sdk.md), PRD/architecture/acceptance/compatibility, AI SDK reproduction and handoff. Preserve unresolved discovery/streaming/native gaps rather than implying complete compatibility.
- Evidence: installed @openrouter/sdk 1.4.18 ChatResult schema uses required nullable string system_fingerprint; existing controlled socket probes distinguish unknown from reported metadata. No source version refresh is needed.

## TDD plan

1. Before production changes, make existing raw/official-SDK legacy cases require null and successful text rather than ResponseValidationError. Preserve reported strings/null, malformed metadata failures and immutable originals.
2. Add a no-fingerprint variant to actual official SDK two-request tool/result workflows on both bases. Reuse assertions on approved model/host/provider scope, exact history, fresh authentication and independent usage.
3. Cover preflight denials/limits and required ledger/outcome-audit failures with unknown as well as supplied fingerprints. Keep safe private error and possible-billing regression checks.
4. Record meaningful red, implement the smallest shared projection correction, then run focused fingerprint/usage/tool/SDK tests and npm run check. Verify existing six source pins and dependencies stay unchanged.

## Delivery

1. Issue and fresh branch; this plan before coding.
2. Actual failing boundary/SDK cases; minimal production fix; green and regressions.
3. Update contracts/planning/handoff with the intentional legacy response change and remaining limits.
4. Ready PR with plan, red/green/full checks, user author/committer, authorized DCO and Assisted-by trailers.
5. Merge only after approval on the exact current head and required CI success.

Risks/rollback: clients checking property presence on /v1 will now see explicit null for unavailable fingerprints. Existing supplied metadata and accounting stay unchanged. Reverting the projection and matching contract/test changes restores omission and its measured SDK parse failure. No live backend identity or whole-release certification is implied.

## Verification evidence

- Red before production changes: five public/actual-SDK suites ran 114 cases, with 10 expected failures and 104 passes. Failures reproduced legacy raw/frozen projection, official SDK text validation and two-request managed/delegated tool workflows without supplied fingerprints.
- Minimal green: the same 114 cases passed after removing the path-specific fingerprint bypass and obsolete projector format parameter. Reported strings/null, unknown metadata, opaque responses and required persistence remain covered.
- Expanded focused selection passed all 915 fingerprint/usage/native/streaming/SDK and AI SDK control cases with zero failures/cancellations. Strict type checking, touched-file Biome, planning/link/secret checks and git diff --check passed.
- First full gate ran 7,374 cases: 7,372 passed, one legacy delegated whole-response equality assertion failed on the intentional added null field and one optional external PostgreSQL case skipped. Updated that response assertion while retaining its exact authorized provider slug, ordering and audit assertions; all 122 integration/core cases then passed.
- No live inference, provider credentials, source-pin writes, dependency or storage changes were used. Live fixed-source comparison passes five selections and detects model-response v3 drift: seven nullable:true markers were removed while the selected type arrays and other structures remain unchanged. Recorded independent follow-up [#543](https://github.com/Theorvane/OpenGranter/issues/543); no pin was rewritten. Final npm run check passed: 7,373 tests passed out of 7,374 total, zero failures/cancellations and one optional external PostgreSQL skip. Type checking, lint, planning/contracts/secret checks and all six offline integrity checks passed. Existing unrelated lint output remains 42 warnings and 65 informational diagnostics. Final document/diff checks passed after recording evidence.
