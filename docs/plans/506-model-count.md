# Expose IAM-filtered model counts

## Issue and problem

- Issue: [#506](https://github.com/Theorvane/OpenGranter/issues/506), part of #116.
- Installed OpenRouter clients expose models.count but GET /api/v1/models/count currently returns 404. Counting the unfiltered catalog would disclose inaccessible aliases.

## Scope and expected behavior

- Return exactly data.count with no-store caching for authenticated compatible GET count requests. Count enabled authorized aliases once when any approved candidate satisfies complete model/final-provider IAM. Explicit/implicit Deny and inactive credentials retain shared discovery behavior.
- Accept only output_modalities with current bounded any-member/all validation. Default to text, excluding metadata that cannot establish text output; explicit all includes authorized basic aliases. Existing list defaults and all other queries stay unchanged. Legacy count paths, trailing slashes and unsupported methods remain 404.
- Validate complete hidden catalog and capture metadata before filtering; reject invalid queries after authentication but before catalog reads. Required private audit must complete before returning the count. Do not call routing, inference, secrets, limits or usage.
- Add models-counted with existing attribution and only the visible count; persist/project it through existing PostgreSQL audit storage and principal-scoped history. No migration, metadata extension or source pin changes.

## Design

- Recognize the exact compatible GET route. Use a narrow count-query parser that permits only output_modalities, delegates its validation to the existing list parser and supplies the official text default. Share the catalog snapshot/IAM/filter boundary rather than duplicating its policy logic.
- Skip model payload construction for count requests; return the independent count envelope after required audit. Use the existing safe catalog/invalid-query/authentication errors. Extend the audit allowlist for the distinct success kind; existing unavailable/denial events remain shared.
- Source: [official count reference](https://openrouter.ai/docs/api/api-reference/models/get-total-count-of-available-models) and OpenAPI inspected 2026-10-18. Proxy-token IAM determines local visibility; no separate OpenRouter management-key model is introduced. Official documentation includes a management-key error example, which does not define this product's credential policy.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/model-count.md). Count-specific structural schema drift remains outside existing pins; disclose this gap rather than manufacturing coverage. No glossary/ADR change is needed.

## TDD plan

- First add raw/installed OpenRouter SDK count tests and audit store/history cases; record expected 404/missing audit-kind failures before production changes.
- Verify default text, any-member/all/empty lists, alias versus candidate counts, both route kinds, model/provider/implicit Deny and fresh policy/catalog reads. Cover malformed/duplicate/unsupported queries, auth-before-read/body, hidden bad metadata, required catalog/audit failure, snapshot mutation and operational privacy.
- Exercise actual SDK count requests on sockets and persisted count events in migrated PGlite, principal isolation and invalid/nonfinite/negative/unsafe counts. Reuse shared public boundaries and assert no invocation/credential/accounting ports.
- Implement minimal route/parser/audit changes; format, focused regressions and plain npm run check.

## Delivery

- Create ready plan-linked PR with red/green/full-check evidence, authorized identity/DCO and automatic reviewer request. Require current-head approval and green CI before merge.
- Risks: counts reload current catalog/policy and have no snapshot consistency guarantee; metadata may be stale. Default text differs from the existing local list's omitted-filter behavior, so clients comparing totals must use the same explicit output filter. Existing source pins do not monitor the count endpoint. Full #116 and unresolved #7 remain open.

## Verification evidence

- Red before production changes: 23 raw/SDK/audit tests produced 22 failures and one pass. The supported endpoint returned 404 instead of 200 and models-counted projection/storage rejected the unknown kind; unavailable-path regression already passed.
- Green: all 23 new tests pass. The expanded discovery/audit regression run passes 126 tests, including installed OpenRouter SDK sockets on both route kinds and migrated PGlite audit/history with principal isolation and safe fault handling.
- Full gate: `env -u NODE_NO_WARNINGS -u NODE_OPTIONS npm run check` with Node 22 on PATH passes strict types, lint, 6,725 tests (one optional external PostgreSQL test skipped), planning/link/contract/fixture-secret checks and all three pin integrity checks. A test-only method/path tuple annotation was narrowed after the first full gate stopped at type checking; strictness settings remain enabled.
- Initial verification used main 17e0294 without the then-pending relative-link PR #505. Feature documentation is placed beside canonical API/release sections so its changes do not compete with that PR's appended history. Source pins and migrations are byte-identical to that base. The later integration below supersedes this initial base.

## Integration with relative links

- PR #505 received approval for its exact current head and successful CI, then merged as 4f0abfe. Merge current main into this branch; the API-section document placement lets both planning histories combine without conflicts.
- Extend installed OpenRouter count cases on both route kinds to include relative-link metadata, while retaining the original cases, modality counts and fresh provider Deny. This verifies that complete catalog validation accepts official-style metadata before returning private counts.
- No new production behavior is introduced beyond the two implemented patches. Run count/link/audit focused regressions and the integrated full gate before publishing the new PR #507 head; require CI and review of that head.
- Integrated verification passes all 64 focused count/link/audit cases, including two additional SDK relative-link combinations. The first integrated full gate was interrupted by SIGTERM (exit 143) during tests without a failure report; the complete retry exits successfully with 6,766 tests passed, one optional external PostgreSQL test skipped and zero failures. Strict types, lint, planning/link/contract/fixture-secret checks and all three pin integrity checks pass with global warning overrides unset.
