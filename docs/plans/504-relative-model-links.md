# Accept root-relative model details links

## Issue and problem

- Issue: [#504](https://github.com/Theorvane/OpenGranter/issues/504), part of #116.
- The [official models example](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), checked 2026-10-18, uses a root-relative links.details path. The current HTTPS-only metadata validator rejects it through both HTTP discovery and PostgreSQL list/route boundaries.

## Scope and expected behavior

- Accept bounded root-relative details links beginning with one slash; preserve exact path/query/fragment spelling. Retain existing credential-free HTTPS absolute-link behavior and the 2,048 UTF-16 unit bound.
- For the new relative form, reject authority/network paths, backslashes and raw whitespace/control characters. Resolve only for validation against a fixed synthetic origin; never use caller Host/forwarding headers, fetch links, add upstream destinations or implement the referenced resource.
- Preserve full-catalog validation, model/final-provider IAM, legacy/basic payloads, required private audit, one-time captured immutable metadata and PostgreSQL storage/approved routes. No migration, query or source pin changes.

## Design

- Branch inside the existing details validator: validate single-slash relative input and same synthetic origin, otherwise use the existing absolute HTTPS/credential checks. Return the original text, without rewriting/normalizing client-visible links.
- Reject ordinary document-relative and scheme-relative links rather than inferring a base from untrusted request context. The SDKs deserialize opaque detail strings; this extension does not certify that the linked endpoint exists or what happens if another application follows it.
- Update [metadata contract](../../contracts/model-discovery-metadata.md), [link contract](../../contracts/model-details-links.md), PRD, architecture, acceptance and compatibility inventory. No domain/ADR/product decision is needed for this bounded compatibility fix.

## TDD plan

- First reproduce valid official root-relative metadata returning 503 instead of 200 at the public HTTP boundary and failing in installed SDK/SQL cases.
- Verify exact text and bounds, managed/delegated catalogs, query/fragment preservation, HTTPS regression, explicit/implicit Deny, authentication before reads, hidden malformed links, required catalog/audit faults, snapshot/getter capture and safe errors.
- Verify PostgreSQL list and route paths, real JSONB storage and unchanged approved candidates. Use installed OpenRouter/OpenAI SDK sockets; assert no inference/secret/limit/usage calls and operational link privacy.
- Make the smallest validator change, format, run focused regressions and plain npm run check.

## Delivery

- Use an issue branch from current main, English plan-linked ready PR and authorized contributor/DCO identity. Require approval and green CI before merge.
- Risks/limits: details metadata is administrator information and can point to an unavailable resource; no endpoint routing or follow/fetch behavior is added. Rollback requires removing relative links from configured/stored metadata first. Full #116 and unresolved #7 remain open.

## Verification evidence

- Confirmed red against the unchanged main validator: the 37 new raw/SDK/storage tests produced 12 failures and 25 passes. Valid relative HTTP links returned 503 instead of 200, and SDK/SQL cases failed to consume the metadata. A test-only privacy assertion was narrowed to the actual private hostname rather than rejecting the public catalog-unavailable error; the confirmed red result uses that corrected assertion and checks supplied undefined explicitly.
- Green: all 128 new-link and existing metadata/PostgreSQL/exploration raw/SDK regressions pass after the minimal validator change. This includes all 37 new tests, managed/delegated SDK continuations, real migrated JSONB and unchanged approved SQL candidates.
- Full gate: `env -u NODE_NO_WARNINGS -u NODE_OPTIONS npm run check` with Node 22 on PATH passes strict types, lint, 6,698 tests (one optional external PostgreSQL test skipped), planning/link/contract/fixture-secret checks and all three pin integrity checks.
- Initial verification used main at 9eda07a while PR #503 was unapproved and excluded its benchmark-range changes. The later integration below supersedes that base. Relative-link changes themselves leave source pins, queries and migrations unchanged. Review and CI are required before merge.

## Integration with merged benchmark ranges

- PR #503 was approved for its exact head with successful CI and merged as 17e0294. Merge current main into this issue branch; retain both issues' appended sections when resolving the four planning/compatibility document conflicts.
- Extend installed OpenRouter/OpenAI SDK socket cases to combine relative links with inclusive intelligence/coding ranges on managed/delegated catalogs. An otherwise authorized out-of-range model must not affect counts or links; continuation query bounds and fresh provider Deny must remain enforced.
- This integration changes tests/documentation only beyond the previously implemented production patches. No new product decision, schema or migration is added. Run the focused suites and full check together before publishing the updated head; require fresh CI and review of that head.
- Integrated verification: all 128 focused link/range/schema raw/SDK tests pass, including two additional combined SDK cases. Plain full check with global warning overrides unset passes 6,741 tests, skips one optional external PostgreSQL test and reports no failures; strict types, lint, planning/link/contract/fixture-secret checks and all three schema integrity checks pass. The integrated source includes main's reviewed query pin v3; the relative-link patch itself changes no pins or production behavior beyond its original validator change.
