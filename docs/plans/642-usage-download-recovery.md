# Usage CSV browser failure recovery (#642)

## Issue and problem
1. #642 requires failure and export acceptance. The authorized usage CSV response is followed by an unguarded Blob/object-URL creation. A browser exception rejects an event-handler promise and leaves Preparing CSV page indefinitely. A revocation exception can also abort authority cleanup before rendering.

## Scope and expected behavior
2. Catch browser download creation failures, discard protected page/export data, retain submitted query-only navigation, and expose existing Retry current page. Retry refetches through existing authorization and mandatory audit. Never display exception strings or CSV as an error fallback.
3. Clear the local URL reference before best-effort revocation, so a throwing browser API cannot prevent authority teardown or detached-link invalidation. Do not change CSV API, IAM, billing, sessions, retention, activation or deployment. This is error containment, not new authority.

## Design
4. Use existing unavailable state and query-only retry instead of inventing an export state or retaining CSV text. Alternatives: unsafe unhandled rejection or a second private preview store. No new domain decisions; BFF/session contract remains unapproved. Update usage previous-page contract, PRD and acceptance with bounded failure behavior.

## TDD plan
5. Public mount tests first: CSV succeeds over HTTP but object URL creation throws; expect no unhandled rejection, no stale records/download/error text, explicit retry and successful subsequent export. Separately force revocation failure at authority clear and verify cleared UI, blocked old link, and renewed authority remains usable.
6. Run RED before implementation; implement smallest containment, then focused usage/export suites, typecheck, lint, scripts and full standard check. Disclose resource failures rather than calling them GREEN. Browser proof is separate from headless DOM and HTTP evidence.

## Delivery
7. Create narrow stacked PR against existing PR834 branch; require exact-head mandatory CI and independent formal approval before merge. Rollback only this containment; no real provider or paid calls.

## Recorded evidence
8. RED: object-URL throw caused unhandledRejection/private-browser-error. Initial revocation fixture used an incorrect paging header; corrected it to the existing x-usage-has-more contract before confirming revocation RED/private-revoke-error. GREEN: both new public regressions pass; combined usage UI/retry/source-and-compiled SQL HTTP integration 49/49, no skips. Typecheck, lint, planning/link/secret checks and six pinned compatibility checks pass. Full standard check started separately and remains pending until terminal output.
9. Native browser with signed synthetic SSO and migrated PGlite: failed second-page CSV allocation -> safe unavailable -> exact-scope retry -> successful native 573-byte CSV download -> previous page, without consuming draft filters. See [browser evidence](642-usage-download-browser-evidence.md). No company SSO/session/deployment/live provider claim.
