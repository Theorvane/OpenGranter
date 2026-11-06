# Token mutation authority lifetime (#640)

1. Preserve existing SSO API, transport validation, IAM and audit. Add only a trusted single-grant host adapter; no session acquisition, renewal, UI or runtime activation.
2. Snapshot trusted request and expiry; check the clock before dispatch and after completion, including suspended timers. Dispose on logout/unmount. Never return a late secret.
3. Preserve singleflight and uncertain-outcome reconciliation lock. No authorize/reset method; constructing another adapter is not reconciliation. Fail closed on invalid clock/expiry and invalidate on 401/403.
4. RED/GREEN source and supported artifact: issue/revoke, suspended expiry, logout/expiry in flight, late secret, invalid expiry/clock, early timer, mutated grant, denial, unknown outcome.
5. Run tests, typecheck/lint/scripts/compatibility; publish dependent draft PR for exact-head review. No merge before required CI and formal approval.

## Host secret-clearing integration follow-up

6. Expose one terminal onInvalidate notification (expiry or disposal) so the owning UI can clear an already displayed one-time secret without duplicating authority timers. Never send credentials in notifications; contain observer errors and retain terminal abort semantics. No DOM, session acquisition or activation.
7. RED/GREEN source and supported artifact: expiry after successful issue notifies once, logout/denial notification and throwing observer during in-flight disposal. Integrate authority with real loopback HTTP, signed JWT, migrated embedded SQL and token verification/revocation; verify denied/audit-failure and unknown-outcome behavior separately from native browser or installed SQL.

## Existing catalog authority fail-closed integration defect (#639)

8. Before implementation, reproduce thrown/negative clocks and throwing cancellation against the existing catalog authority used by the management screen. Keep DOM ownership, session acquisition and runtime unchanged.
9. Make invalid clocks expire and clear protected snapshots, and make cancellation failures unable to prevent session abort or notification. Validate nonnegative epoch expiry. Preserve fresh grants, read-only transport and observer semantics.
10. Verify both source factories and supported browser artifacts with meaningful RED/GREEN; run focused authority/screen/API tests and static checks. Update this same PR, not another dependency stack. Native-browser/session acceptance remains blocked and distinct.

Execution: corrected regression fixture against original HEAD: 0 pass / 12 fail / 0 skip (throw/negative clock and cancellation defects). Initial SSO fixture ownership was corrected before this baseline. Final focused management + signed-HTTP/embedded-SQL suites: 270 pass / 0 fail / 0 skip. Typecheck, lint (42 warnings/196 infos; no errors), planning/link/fixture checks, schema compatibility and diff checks pass. No new native-browser, installed SQL, session or live-provider evidence.

## Owning credential workspace integration

11. Implement one host-owned credential workspace, independent of DOM and login. Keep its reconciliation latch across grant replacement, logout and navigation. No reset/reconcile claim or browser storage.
12. Own one-time secret display state; hide on navigation, expiry, logout and next mutation. Suppress stale completions after replacing authority. A pending request interrupted by replacement must immediately close the workspace mutation gate, before asynchronous completion.
13. Verify source and supported browser bundle: success/clear, suspended expiry, network ambiguity, pending logout/regrant, stale completion, singleflight and observer failure. Keep UI activation, sessions and installed acceptance explicitly incomplete.

Workspace execution: initial missing-module RED (0 pass / 1 fail; feature absent, not a prior-runtime regression). New source/artifact workspace cases 16 pass / 0 fail / 0 skip. Final management plus signed-HTTP/embedded-SQL focused suites 287 pass / 0 fail / 0 skip. Typecheck exit0, lint no errors (42 warnings/208 infos), planning/link/fixture scan, schema compatibility and diff checks pass. Native credential screen and session acquisition remain incomplete.

## Credential UI scheduler integration defect (2026-11-06)

14. Reproduce throwing initial/rearm schedulers, invalid cancellation handles, synchronous callbacks and stale repeated callbacks in source and supported browser artifacts before editing production. No session/runtime or frontend-owned files change.
15. Expire authority once on scheduler failure, abort in-flight writes with unknown-outcome semantics and clear host secret notifications; suppress obsolete timer callbacks and retain valid cancellation ownership.
16. Verify existing owning token workspace clears displayed secrets and keeps mutation ambiguity locked. Run focused UI/API tests and static checks, publish same PR for exact-head review. Native login remains blocked on the approved session contract.

Scheduler execution: corrected original-HEAD regression 20 pass / 6 fail / 0 skip (private scheduler/rearm exceptions and obsolete timer 3 vs expected 2). The initial added fixture missed scoped helpers; corrected before recording this baseline. Final all management plus persisted simulator and signed workspace HTTP suites 313 pass / 0 fail / 0 skip. Existing workspace secret-display and replacement-grant tests run source and supported bundle. Typecheck, lint (42 warnings/235 infos; no errors), scripts, six compatibility pins and diff checks pass. No native-browser/session/installed-SQL evidence.

## Reentrant owning-host installation correction (2026-11-06 18:00 KST)

17. Reproduce a current expiry notification renewing the grant during construction, lifecycle logout during scheduling, and cancellation-time replacement. Record source/artifact RED before production changes.
18. Make detach return its captured generation; never let an older authorize/logout overwrite a reentrant newer host action. Dispose a constructed authority whose installation lost ownership before publishing it. Preserve one-time display and unknown-write locks.
19. Verify supported browser artifacts and existing signed HTTP tests; update the same PR, not a new disconnected stack. Session, permissions, runtime and activation remain unchanged.

Reentrant execution: original HEAD3435c19 with new public source/artifact tests produced 24 pass / 8 fail / 0 skip (expired renewal returned ready instead of issued, logout resurrected issuance, obsolete replacement won, and older logout overwrote newer ready state). Corrected owning workspace gives 32 pass / 0 fail / 0 skip. All management plus signed workspace HTTP focused tests give 316 pass / 0 fail / 0 skip. Typecheck and lint pass in the standard full-check prelude; planning/links/fixture scan and six compatibility pins pass separately. Full repository tests are running, not yet certified. No native browser, live IdP, installed PostgreSQL or provider result.


## Mutation-entry ownership (2026-11-06 18:30 KST)

20. Reproduce suspended-expiry renewal during issue/revoke entry and synchronous clock-time grant replacement in source and supported browser artifact. Capture RED before runtime edits.
21. Capture authority identity and generation before validating it. A stale invocation must return disposed without adopting a replacement grant or inventing reconciliation for an undispatched write. A subsequent explicit action may use the new grant.
22. Preserve existing expiry, singleflight, one-time display and unknown-outcome guards. Verify the same host/HTTP integration, typecheck, lint and contracts; no frontend/session/runtime/permission changes.


Mutation-entry execution: original6cb82a1 public source/artifact RED32 pass / 6 fail / 0 skip (ready instead of disposed; actual issued under replacement authority). Corrected38 pass / 0 fail / 0 skip; all management plus signed workspace HTTP/migrated PGlite322 pass / 0 fail / 0 skip. This fixes existing host ownership, not a new feature stack. Prior6cb82a1 STANDARD fullcheck completed9364 pass / 0 fail / 1 skip (real PostgreSQL migration integration not configured), with scripts and six pins PASS; that result does not certify this new HEAD or installed PostgreSQL. Native browser, IdP, session, deployed runtime and providers remain unverified.
