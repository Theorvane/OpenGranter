# Current-principal audit acknowledgement validation

## Issue and problem
- Issue: #776, refs #637 / #639.
- Required identity audit must fail closed on malformed SQL acknowledgements. The existing store accepts inherited event IDs, array rows and array-like rows without a real returned row.

## Scope and expected behavior
- Harden only the existing identity audit store, with HTTP regression proving no identity escapes a malformed acknowledgement.
- Require an actual one-element rows array, own index zero, non-array object row and own positive PostgreSQL bigint event_id string.
- Keep valid pg/PGlite acknowledgements and existing fixed audit_unavailable failure. No schema, IAM, UI, session, runtime, provider or deployment change.

## Design
- Validate returned structure before reading the acknowledged event ID. Existing append and HTTP awaiting stay unchanged.
- Reject malformed adapter responses instead of trusting prototypes or array-like values; no fallback or new factory.
- No new domain term or unresolved product decision. Existing mandatory audit contract governs this correction.
- Dependency: stacked PR775/773/771/769; not independently mergeable. Rebase/integration requires new exact-head CI and formal approval.
- Update contracts/current-principal-audit.md and PRD/architecture/acceptance references.

## TDD plan
- RED: malformed inherited/array/array-like acknowledgements currently resolve append and may expose Account identity.
- GREEN: all malformed cases reject with fixed private store error, HTTP503 audit_unavailable with no identity, valid acknowledgements retain200 and exact Account shape.
- Run affected audit and identity/read HTTP tests, typecheck, lint, document/compatibility checks and standard npm run check.

## Delivery
- Separate worktree and issue branch, DCO and Assisted-by disclosure. Record RED/GREEN and exact-HEAD gates in PR.
- Rollback removes validation only. No installed PostgreSQL, native browser, IdP or live-provider certification from local tests.

## Execution evidence
- RED unit store:33PASS3FAIL; malformed inherited/array/array-like rows erroneously resolved append. Log /tmp/og-2030-audit-red.log.
- RED signed JWT/current-binding HTTP: expected503 but actual200 for inherited event ID. Log /tmp/og-2030-http-red.log.
- GREEN affected store, SQL, principal HTTP and read API suites serially:91PASS0FAIL0SKIP, including actual Node Account socket denial and valid SQL recovery. Log /tmp/og-2030-focused-final.log.
- Typecheck PASS and document/contract/link checks PASS. Final lint, compatibility, committed standard full check and CI reported separately in PR.
- Initial extra-test script was blocked by shell syntax guard before execution; corrected command succeeded. No deployment/browser/session/live provider claim.
